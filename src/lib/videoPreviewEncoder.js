/**
 * videoPreviewEncoder.js
 * Encodes a 4s preview clip via ffmpeg.wasm for the After panel.
 *
 * Scale strategy — works for both portrait and landscape:
 *   scale=640:640:force_original_aspect_ratio=decrease
 *   pad=640:640:(ow-iw)/2:(oh-ih)/2:black   (no — simpler below)
 *
 * Actually the simplest reliable approach in wasm is:
 *   scale=w=640:h=640:force_original_aspect_ratio=decrease
 * This fits the video inside a 640×640 box, keeping aspect ratio,
 * outputting whatever the natural dimensions are (no padding).
 * Then we ensure even pixel counts with another scale step.
 *
 * We deliberately avoid if() expressions — they require shell escaping
 * that the wasm exec() array API does not apply.
 */
import { getFFmpeg } from './ffmpegLoader.js'

const PREVIEW_DURATION = 4

export async function encodeVideoPreview(file, opts, onProgress, onLog) {
  const {
    format:  fmtSetting = 'auto',
    quality  = 72,
    fps      = 0,
  } = opts

  const isGif      = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const inExt      = isGif ? 'gif' : (file.name.split('.').pop() || 'mp4')
  const inputName  = `prev_in_${Date.now()}.${inExt}`
  const outputName = `prev_out_${Date.now()}.mp4`

  onProgress?.(5)
  onLog?.('Loading ffmpeg…')
  const { ff, fetchFile } = await getFFmpeg(onLog)

  onLog?.('Writing file…')
  await ff.writeFile(inputName, await fetchFile(file))
  onProgress?.(20)

  const crf = Math.round(38 - (quality / 100) * 16)

  // scale=w:h:force_original_aspect_ratio=decrease
  // Fits the video inside 640×640, keeps aspect ratio, no distortion.
  // Works identically for portrait (e.g. 1080×1920 → 360×640) and
  // landscape (e.g. 1920×1080 → 640×360).
  // The trailing scale=-2:-2 step snaps to even pixel counts for libx264.
  const vfParts = [
    'scale=640:640:force_original_aspect_ratio=decrease',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',  // ensure even dims for libx264
  ]
  if (fps > 0) vfParts.push(`fps=${fps}`)

  const args = [
    '-i',        inputName,
    '-t',        String(PREVIEW_DURATION),
    '-vf',       vfParts.join(','),
    '-c:v',      'libx264',
    '-crf',      String(crf),
    '-preset',   'fast',
    '-pix_fmt',  'yuv420p',
    '-movflags', '+faststart',
    '-an',
    '-y',        outputName,
  ]

  onLog?.(`Encoding ${PREVIEW_DURATION}s preview — CRF ${crf}…`)
  onLog?.(`Filter: ${vfParts.join(', ')}`)

  await ff.exec(args)
  onProgress?.(88)

  const data = await ff.readFile(outputName)
  if (!data || data.byteLength === 0) throw new Error('ffmpeg produced empty output — check the log for errors')

  // data is a Uint8Array view into wasm heap — must copy before heap is freed
  const copied = data.slice(0)
  const blob = new Blob([copied], { type: 'video/mp4' })
  const url  = URL.createObjectURL(blob)

  try { await ff.deleteFile(inputName)  } catch (_) {}
  try { await ff.deleteFile(outputName) } catch (_) {}

  onProgress?.(100)
  onLog?.(`Preview ready — ${(blob.size / 1024).toFixed(0)} KB`)

  return { url, size: blob.size }
}
