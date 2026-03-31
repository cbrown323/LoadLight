/**
 * videoPreviewEncoder.js
 * Absolute minimum ffmpeg args — no -vf filter at all.
 * Trim to 4s, re-encode with libx264, copy audio out.
 * This is the most compatible command possible with ffmpeg-core wasm.
 */
import { getFFmpeg } from './ffmpegLoader.js'

const PREVIEW_DURATION = 4

export async function encodeVideoPreview(file, opts, onProgress, onLog) {
  const { quality = 72 } = opts

  const isGif     = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const inExt     = isGif ? 'gif' : (file.name.split('.').pop().toLowerCase() || 'mp4')
  const ts        = Date.now()
  const inputName  = `prev_in_${ts}.${inExt}`
  const outputName = `prev_out_${ts}.mp4`

  onProgress?.(5)
  onLog?.('Loading ffmpeg…')
  const { ff, fetchFile } = await getFFmpeg(onLog)

  onLog?.('Writing file…')
  await ff.writeFile(inputName, await fetchFile(file))
  onProgress?.(20)

  const crf = Math.round(38 - (quality / 100) * 16)

  // Minimal args — no video filter, no preset, no audio.
  // Works on any input resolution, portrait or landscape.
  const args = [
    '-i',        inputName,
    '-t',        String(PREVIEW_DURATION),
    '-c:v',      'libx264',
    '-crf',      String(crf),
    '-pix_fmt',  'yuv420p',
    '-movflags', '+faststart',
    '-an',
    '-y',        outputName,
  ]

  onLog?.(`Encoding ${PREVIEW_DURATION}s clip (CRF ${crf})…`)
  await ff.exec(args)
  onProgress?.(88)

  const data = await ff.readFile(outputName)
  if (!data || data.byteLength === 0) {
    throw new Error('ffmpeg returned empty output. Check browser console for ffmpeg logs.')
  }

  const blob = new Blob([data.slice(0)], { type: 'video/mp4' })
  const url  = URL.createObjectURL(blob)

  try { await ff.deleteFile(inputName)  } catch (_) {}
  try { await ff.deleteFile(outputName) } catch (_) {}

  onProgress?.(100)
  onLog?.(`Done — ${(blob.size / 1024).toFixed(0)} KB`)

  return { url, size: blob.size }
}
