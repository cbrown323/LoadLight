/**
 * videoPreviewEncoder.js
 * Encodes a short preview clip for the After panel.
 * - 4 second trim
 * - Max 640px on the LONG edge (handles portrait correctly)
 * - Uses 'fast' preset (ultrafast not always available in wasm build)
 */
import { getFFmpeg } from './ffmpegLoader.js'

const PREVIEW_DURATION = 4
const PREVIEW_MAX_PX   = 640

export async function encodeVideoPreview(file, opts, onProgress, onLog) {
  const {
    format:  fmtSetting = 'auto',
    quality  = 72,
    fps      = 0,
  } = opts

  const isGif     = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const fmt       = (fmtSetting === 'auto' || fmtSetting === 'gif') ? 'mp4' : fmtSetting
  const inExt     = isGif ? 'gif' : (file.name.split('.').pop() || 'mp4')
  const inputName  = `prev_in_${Date.now()}.${inExt}`
  const outputName = `prev_out_${Date.now()}.mp4`

  onProgress?.(5)
  onLog?.('Loading ffmpeg…')
  const { ff, fetchFile } = await getFFmpeg(onLog)

  onLog?.('Writing to virtual FS…')
  await ff.writeFile(inputName, await fetchFile(file))
  onProgress?.(20)

  const crf = Math.round(38 - (quality / 100) * 16)

  // Scale the longest dimension to PREVIEW_MAX_PX, keep aspect ratio, ensure even dims
  // This works for both landscape AND portrait without errors
  const scaleFilter = `scale='if(gt(iw,ih),min(${PREVIEW_MAX_PX}\\,iw),-2)':'if(gt(iw,ih),-2,min(${PREVIEW_MAX_PX}\\,ih))'`
  const vfParts = [scaleFilter]
  if (fps > 0) vfParts.push(`fps=${fps}`)

  const args = [
    '-i',       inputName,
    '-t',       String(PREVIEW_DURATION),
    '-vf',      vfParts.join(','),
    '-c:v',     'libx264',
    '-crf',     String(crf),
    '-preset',  'fast',
    '-pix_fmt', 'yuv420p',
    '-movflags','+faststart',
    '-an',
    '-y',       outputName,
  ]

  onLog?.(`Encoding ${PREVIEW_DURATION}s preview (CRF ${crf})…`)
  await ff.exec(args)
  onProgress?.(88)

  const data = await ff.readFile(outputName)
  const blob = new Blob([data.buffer], { type: 'video/mp4' })
  const url  = URL.createObjectURL(blob)

  try { await ff.deleteFile(inputName)  } catch (_) {}
  try { await ff.deleteFile(outputName) } catch (_) {}

  onProgress?.(100)
  onLog?.(`Preview ready — ${(blob.size / 1024).toFixed(0)} KB`)

  return { url, size: blob.size }
}
