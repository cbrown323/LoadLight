/**
 * videoEncoder.js — ffmpeg.wasm 0.12.x
 * Handles: MP4, WebM, and GIF output (including GIF→GIF re-optimize)
 *
 * Notes on the ffmpeg-core@0.12.6 WASM build:
 * - libx264 is available and works well for MP4
 * - libvpx (VP8) is available for WebM — libvpx-vp9 is technically
 *   present but ~4x slower in single-threaded WASM so we avoid it
 * - libvorbis is available for WebM audio
 * - aac is available for MP4 audio
 */
import { getFFmpeg } from './ffmpegLoader.js'

function qualityToCRF(q) { return Math.round(40 - (q / 100) * 22) }

function buildArgs(inputName, outputName, { quality, fps, width, bitrate, format, isGif }) {
  const args = ['-i', inputName]
  const vf   = []
  if (width > 0) vf.push(`scale=${width}:-2`)
  if (fps > 0)   vf.push(`fps=${fps}`)

  if (format === 'gif') {
    // GIF re-optimize: palette-based encode for smallest file
    const gifFps  = fps > 0 ? fps : 15
    const scaleW  = width > 0 ? width : 'iw'
    args.push('-vf', `fps=${gifFps},scale=${scaleW}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`)
    args.push('-loop', '0', '-y', outputName)
    return args
  }

  if (vf.length) args.push('-vf', vf.join(','))

  if (format === 'webm') {
    // Use libvpx (VP8) — much faster than VP9 in single-threaded WASM.
    // -deadline realtime + -cpu-used 8 = fastest possible VP8 encoding.
    args.push('-c:v', 'libvpx')
    args.push('-deadline', 'realtime', '-cpu-used', '8')
    if (bitrate > 0) {
      args.push('-b:v', `${bitrate}k`)
    } else {
      // VP8 CRF mode: -crf sets quality target, -b:v sets max bitrate ceiling
      const crf = qualityToCRF(quality)
      args.push('-crf', String(crf), '-b:v', '2M')
    }
    if (!isGif) args.push('-c:a', 'libvorbis', '-q:a', '3')
    else        args.push('-an')
  } else {
    // MP4
    args.push('-c:v', 'libx264', '-crf', String(qualityToCRF(quality)), '-preset', 'fast')
    if (bitrate > 0) args.push('-b:v', `${bitrate}k`)
    args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart')
    if (isGif) args.push('-an')
    else       args.push('-c:a', 'aac', '-b:a', quality >= 80 ? '192k' : quality >= 50 ? '128k' : '96k')
  }

  args.push('-y', outputName)
  return args
}

export async function encodeVideo(file, opts) {
  const {
    format: fmtSetting = 'auto',
    quality    = 72,
    widths     = [],
    fps        = 0,
    bitrate    = 0,
    onProgress = () => {},
    onLog      = () => {},
  } = opts

  const isGif    = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const fmt      = fmtSetting === 'auto' ? 'mp4' : fmtSetting
  const inExt    = isGif ? 'gif' : (file.name.split('.').pop() || 'mp4')
  const baseName = file.name.replace(/\.[^.]+$/, '')
  const inputName = `in_${Date.now()}.${inExt}`

  onProgress(2)
  const { ff, fetchFile } = await getFFmpeg(onLog)

  onLog(`Writing ${file.name} to virtual FS…`)
  const fileData = await fetchFile(file)
  await ff.writeFile(inputName, fileData)
  onProgress(10)

  const targetWidths = widths.length > 0 ? widths : [0]
  const results = []

  for (let i = 0; i < targetWidths.length; i++) {
    const w          = targetWidths[i]
    const outputName = `out_${Date.now()}_${i}.${fmt}`
    onLog(`Encoding ${w > 0 ? w + 'px' : 'original'} @ CRF ${qualityToCRF(quality)}…`)
    const args = buildArgs(inputName, outputName, { quality, fps, width: w, bitrate, format: fmt, isGif })
    onLog(`args: ${args.join(' ')}`)

    const ret = await ff.exec(args)
    if (ret !== 0) {
      onLog(`⚠ ffmpeg returned ${ret} for ${outputName} — may be partial or empty`)
    }

    let data
    try {
      data = await ff.readFile(outputName)
    } catch (readErr) {
      onLog(`✗ Failed to read ${outputName}: ${readErr.message}`)
      continue  // skip this width, don't crash the whole batch
    }

    if (!data || data.byteLength === 0) {
      onLog(`⚠ Empty output for ${w > 0 ? w + 'px' : 'original'} — skipping`)
      continue
    }

    const mimeType = fmt === 'webm' ? 'video/webm' : fmt === 'gif' ? 'image/gif' : 'video/mp4'
    // slice() copies out of wasm heap before it gets freed
    const blob     = new Blob([data.slice(0)], { type: mimeType })
    const filename = targetWidths.length > 1 && w > 0 ? `${baseName}-${w}.${fmt}` : `${baseName}.${fmt}`
    results.push({ filename, blob, width: w })
    try { await ff.deleteFile(outputName) } catch (_) {}
    onProgress(10 + Math.round(((i + 1) / targetWidths.length) * 88))
  }

  try { await ff.deleteFile(inputName) } catch (_) {}
  onProgress(100)
  return results
}
