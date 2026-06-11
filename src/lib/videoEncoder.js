/**
 * videoEncoder.js — hybrid encoder with WebCodecs fast-path
 *
 * Routing:
 *  1. If WebCodecs is available AND format is MP4/WebM → hardware-accelerated path
 *  2. Otherwise → ffmpeg.wasm software path (GIF, unsupported browsers)
 *
 * WebCodecs path: 10–50× faster via GPU/hardware encoder
 * WASM path:      universal fallback, handles GIF + old browsers
 */
import { getFFmpeg, formatFfmpegWorkerError } from './ffmpegLoader.js'
import { canUseFfmpegWasm } from './capabilitySupport.js'
import { supportsWebCodecsVideo, webCodecsVideoSkipReason, encodeVideoWebCodecs } from './webCodecsEncoder.js'
import { preferFfmpegExportForFile } from './mediaIngest.js'

/**
 * Map quality slider (0-100) to CRF.
 * Range: quality 100 → CRF 18 (best), quality 0 → CRF 40 (worst)
 */
function qualityToCRF(q) { return Math.round(40 - (q / 100) * 22) }

/** libx264 preset: slower at high quality → better compression per CRF (often smaller + cleaner). */
function x264PresetForQuality(q) {
  if (q >= 88) return 'medium'
  if (q >= 75) return 'fast'
  if (q >= 55) return 'veryfast'
  if (q >= 35) return 'superfast'
  return 'ultrafast'
}

/** libvpx VP8: ease off realtime/cpu-used when the slider asks for quality. */
function vp8SpeedArgsForQuality(q) {
  if (q >= 80) return ['-deadline', 'good', '-cpu-used', '2']
  if (q >= 55) return ['-deadline', 'good', '-cpu-used', '5']
  return ['-deadline', 'realtime', '-cpu-used', '8']
}

/** GIF palette size tied to quality (128–256). */
function gifMaxColorsForQuality(q) {
  return Math.max(128, Math.min(256, Math.round(128 + (q / 100) * 128)))
}

/** @param {{ ffprobe: Function, readFile: Function, deleteFile: Function }} ff */
async function probeInputDurationSec(ff, inputName) {
  const outName = `_probe_${Date.now()}.txt`
  try {
    const ret = await ff.ffprobe([
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputName,
      '-o', outName,
    ])
    if (ret !== 0) return 0
    const data = await ff.readFile(outName)
    try { await ff.deleteFile(outName) } catch (_) {}
    const text = new TextDecoder().decode(data)
    const n = parseFloat(String(text).trim())
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    try { await ff.deleteFile(outName) } catch (_) {}
    return 0
  }
}

function buildArgs(inputName, outputName, { quality, fps, width, bitrate, format, isGif, mt }) {
  const args = []

  // Threading flag (only matters for MT core, harmless on ST)
  args.push('-threads', '0')

  args.push('-i', inputName)

  const vf = []
  if (width > 0) vf.push(`scale=${width}:-2`)
  if (fps > 0)   vf.push(`fps=${fps}`)

  if (format === 'gif') {
    const gifFps = fps > 0 ? fps : 15
    const scaleW = width > 0 ? width : 'iw'
    const colors = gifMaxColorsForQuality(quality)
    args.push(
      '-vf', `fps=${gifFps},scale=${scaleW}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer`,
      '-loop', '0', '-y', outputName,
    )
    return args
  }

  if (vf.length) args.push('-vf', vf.join(','))

  if (format === 'webm') {
    args.push('-c:v', 'libvpx')
    args.push(...vp8SpeedArgsForQuality(quality))
    if (bitrate > 0) {
      args.push('-b:v', `${bitrate}k`)
    } else {
      args.push('-crf', String(qualityToCRF(quality)), '-b:v', '2M')
    }
    if (!isGif) args.push('-c:a', 'libvorbis', '-q:a', '3')
    else        args.push('-an')
  } else {
    args.push('-c:v', 'libx264')
    args.push('-preset', x264PresetForQuality(quality))
    if (quality < 72) args.push('-tune', 'fastdecode')
    args.push('-crf', String(qualityToCRF(quality)))
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
    labelWidthsInFilename = false,
    onProgress = () => {},
    onLog      = () => {},
  } = opts

  const isGif    = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const fmt      = fmtSetting === 'auto' ? 'mp4' : fmtSetting

  // ── WebCodecs fast-path (hardware-accelerated) ──────────
  // Available for MP4 and WebM in Chrome 94+, Edge 94+, Safari 16.4+
  // GIF and non-container keys never use WebCodecs muxers here.
  const webCodecsEligible = (fmt === 'mp4' || fmt === 'webm')
  if (supportsWebCodecsVideo() && webCodecsEligible && !preferFfmpegExportForFile(file)) {
    onLog('🚀 Using WebCodecs (hardware-accelerated)…')
    try {
      const results = await encodeVideoWebCodecs(file, opts)
      if (results && results.length > 0) return results
      onLog('⚠ WebCodecs returned empty — falling back to ffmpeg.wasm')
    } catch (err) {
      onLog(`⚠ WebCodecs failed: ${err.message} — falling back to ffmpeg.wasm`)
      console.warn('WebCodecs failed, using WASM fallback:', err)
    }
  } else if (fmt !== 'gif') {
    if (preferFfmpegExportForFile(file)) {
      onLog('ℹ Using ffmpeg.wasm for this container (.mov / .avi / QuickTime MIME) — more reliable than browser decode.')
    } else if (!supportsWebCodecsVideo()) {
      onLog(webCodecsVideoSkipReason())
    } else {
      onLog('ℹ WebCodecs unavailable — using ffmpeg.wasm (slower)')
    }
  }

  if (!canUseFfmpegWasm()) {
    throw new Error(
      'Software video encode (ffmpeg.wasm) is not available in Safari. Use http://localhost:5173 so WebCodecs works, or export from Chrome.',
    )
  }

  // ── ffmpeg.wasm fallback path ───────────────────────────
  const inExt    = isGif ? 'gif' : (file.name.split('.').pop() || 'mp4')
  const baseName = file.name.replace(/\.[^.]+$/, '')
  const inputName = `in_${Date.now()}.${inExt}`

  onProgress(2)
  const useStableCore = preferFfmpegExportForFile(file)
  const { ff, fetchFile, multiThreaded: mt } = await getFFmpeg(onLog, {
    preferSingleThread: useStableCore,
  })
  onLog(
    useStableCore
      ? 'Mode: single-threaded (QuickTime / AVI — reliable wasm path)'
      : `Mode: ${mt ? 'multi-threaded ⚡' : 'single-threaded'}`,
  )

  onLog(`Writing ${file.name} to virtual FS…`)
  const fileData = await fetchFile(file)
  await ff.writeFile(inputName, fileData)
  onProgress(10)

  const durSec = await probeInputDurationSec(ff, inputName)
  if (durSec > 0) onLog(`Input duration: ${durSec.toFixed(1)}s`)

  const targetWidths = widths.length > 0 ? widths : [0]
  const results = []
  const nOut = targetWidths.length
  /** Wall-clock rough budget for wasm (VP8 is much slower than x264 here). */
  const estWallSec =
    durSec > 0
      ? durSec * (fmt === 'webm' ? 10 : 2.5)
      : Math.max(120, (file.size / 1024 / 1024) * 30)

  for (let i = 0; i < targetWidths.length; i++) {
    const w          = targetWidths[i]
    const outputName = `out_${Date.now()}_${i}.${fmt}`
    const crf        = qualityToCRF(quality)
    onLog(`Encoding ${w > 0 ? w + 'px' : 'original'} @ CRF ${crf}…`)

    const slice = 88 / nOut
    const basePct = 10 + i * slice
    let mono = basePct

    const bump = (p) => {
      const v = Math.min(99, Math.max(mono, Math.round(p)))
      mono = v
      onProgress(v)
    }

    const progressHandler = ({ progress: fp }) => {
      const p = typeof fp === 'number' && !Number.isNaN(fp) ? Math.min(1, Math.max(0, fp)) : 0
      bump(basePct + p * slice * 0.92)
    }
    ff.on('progress', progressHandler)

    const t0 = performance.now()
    const tick = setInterval(() => {
      const elapsed = (performance.now() - t0) / 1000
      const frac = Math.min(0.92, elapsed / Math.max(45, estWallSec))
      bump(basePct + frac * slice * 0.92)
    }, 2000)

    const args = buildArgs(inputName, outputName, { quality, fps, width: w, bitrate, format: fmt, isGif, mt })
    onLog(`args: ${args.join(' ')}`)

    let ret = -1
    try {
      ret = await ff.exec(args)
    } catch (execErr) {
      onLog(`✗ ffmpeg exec: ${formatFfmpegWorkerError(execErr)}`)
      throw execErr instanceof Error ? execErr : new Error(formatFfmpegWorkerError(execErr))
    } finally {
      clearInterval(tick)
      ff.off('progress', progressHandler)
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1)

    if (ret !== 0) {
      onLog(`⚠ ffmpeg returned ${ret} for ${outputName} (${elapsed}s) — may be partial`)
    } else {
      onLog(`✓ Encoded in ${elapsed}s`)
    }

    bump(basePct + slice * 0.95)

    let data
    try {
      data = await ff.readFile(outputName)
    } catch (readErr) {
      onLog(`✗ Failed to read ${outputName}: ${formatFfmpegWorkerError(readErr)}`)
      continue
    }

    if (!data || data.byteLength === 0) {
      onLog(`⚠ Empty output for ${w > 0 ? w + 'px' : 'original'} — skipping`)
      continue
    }

    const mimeType = fmt === 'webm' ? 'video/webm' : fmt === 'gif' ? 'image/gif' : 'video/mp4'
    const blob     = new Blob([data.slice(0)], { type: mimeType })
    const labelResponsive = labelWidthsInFilename && widths.length > 0
    const filename =
      labelResponsive || (targetWidths.length > 1 && w > 0)
        ? `${baseName}-${w}.${fmt}`
        : `${baseName}.${fmt}`
    results.push({ filename, blob, width: w })
    try { await ff.deleteFile(outputName) } catch (_) {}
    bump(10 + Math.round(((i + 1) / nOut) * 88))
  }

  try { await ff.deleteFile(inputName) } catch (_) {}

  if (results.length === 0) {
    throw new Error(
      fmt === 'webm'
        ? 'WebM export produced no file. Long clips in the browser are very slow with VP8; try format “Auto” or MP4 for a faster, reliable export.'
        : 'Video encoding produced no output. Try a shorter clip, MP4, or lower resolution.',
    )
  }

  onProgress(100)
  return results
}
