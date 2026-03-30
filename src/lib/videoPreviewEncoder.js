/**
 * videoPreviewEncoder.js
 * Encodes a short preview clip (first N seconds) for the After panel.
 * Runs on demand only — not debounced like image preview.
 *
 * Strategy:
 *  - Trim to first 4 seconds (fast to encode, representative)
 *  - Scale down to max 640px wide (keeps encode time under ~5s)
 *  - Use low CRF overhead (faster preset)
 *  - Returns a blob URL the VideoPreview component can play directly
 */

import { getFFmpeg } from './ffmpegLoader.js'

const PREVIEW_DURATION = 4   // seconds to encode
const PREVIEW_MAX_W    = 640 // max width for speed

export async function encodeVideoPreview(file, opts, onProgress, onLog) {
  const {
    format:  fmtSetting = 'auto',
    quality  = 72,
    fps      = 0,
  } = opts

  const isGif    = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const fmt      = (fmtSetting === 'auto' || fmtSetting === 'gif') ? 'mp4' : fmtSetting
  const inExt    = isGif ? 'gif' : (file.name.split('.').pop() || 'mp4')
  const inputName  = `prev_in_${Date.now()}.${inExt}`
  const outputName = `prev_out_${Date.now()}.${fmt}`

  onLog?.('Loading ffmpeg for preview…')
  onProgress?.(5)

  const { ff, fetchFile } = await getFFmpeg(onLog)

  onLog?.('Writing file to virtual FS…')
  await ff.writeFile(inputName, await fetchFile(file))
  onProgress?.(20)

  // CRF: use slightly higher (lower quality) for speed
  const crf = Math.round(40 - (quality / 100) * 18)

  const vf = [`scale='min(${PREVIEW_MAX_W},iw)':-2`]
  if (fps > 0) vf.push(`fps=${fps}`)

  const args = [
    '-i', inputName,
    '-t', String(PREVIEW_DURATION),   // trim to first N seconds
    '-vf', vf.join(','),
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', 'ultrafast',           // fastest possible encode
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',                            // no audio needed for preview
    '-y', outputName,
  ]

  onLog?.(`Preview encode: CRF ${crf}, max ${PREVIEW_MAX_W}px, ${PREVIEW_DURATION}s clip…`)
  await ff.exec(args)
  onProgress?.(90)

  const data = await ff.readFile(outputName)
  const blob = new Blob([data.buffer], { type: 'video/mp4' })
  const url  = URL.createObjectURL(blob)

  try { await ff.deleteFile(inputName)  } catch (_) {}
  try { await ff.deleteFile(outputName) } catch (_) {}

  onProgress?.(100)
  onLog?.(`Preview ready — ${(blob.size / 1024).toFixed(0)} KB`)

  return { url, size: blob.size }
}
