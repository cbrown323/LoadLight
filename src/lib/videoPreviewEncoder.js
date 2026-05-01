/**
 * videoPreviewEncoder.js
 * Encodes a short preview clip from a video file.
 *
 * Routing:
 *  1. WebCodecs path (hardware-accelerated) — preferred
 *  2. ffmpeg.wasm fallback — GIF input or unsupported browsers
 */
import { getFFmpeg, formatFfmpegWorkerError } from './ffmpegLoader.js'
import { preferFfmpegExportForFile } from './mediaIngest.js'
import { supportsWebCodecs, encodePreviewWebCodecs } from './webCodecsEncoder.js'

const PREVIEW_DURATION = 4

export async function encodeVideoPreview(file, opts, onProgress, onLog) {
  const { quality = 72, startTime = 0 } = opts

  // ── WebCodecs fast-path ──
  // .mov / .avi / QuickTime: skip WebCodecs — element decode is flaky; same as full export.
  const isGif = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const forceFfmpeg = preferFfmpegExportForFile(file)
  if (supportsWebCodecs() && !isGif && !forceFfmpeg) {
    onLog?.('🚀 Preview via WebCodecs (hardware-accelerated)…')
    try {
      onProgress?.(10)
      const result = await encodePreviewWebCodecs(file, { quality, startTime })
      if (result) {
        onProgress?.(100)
        onLog?.(`Done — ${(result.size / 1024).toFixed(0)} KB (WebCodecs)`)
        return result
      }
    } catch (err) {
      onLog?.(`⚠ WebCodecs preview failed: ${err.message} — falling back`)
      console.warn('WebCodecs preview failed:', err)
    }
  }

  // ── ffmpeg.wasm fallback ──
  if (forceFfmpeg) {
    onLog?.('ℹ Preview via ffmpeg.wasm (.mov / .avi / QuickTime) — reliable vs browser decode.')
  }

  const inExt     = isGif ? 'gif' : (file.name.split('.').pop().toLowerCase() || 'mp4')
  const ts        = Date.now()
  const inputName  = `prev_in_${ts}.${inExt}`
  const outputName = `prev_out_${ts}.mp4`

  onProgress?.(5)
  onLog?.(
    forceFfmpeg
      ? 'Loading ffmpeg (single-threaded, QuickTime-safe)…'
      : 'Loading ffmpeg…',
  )
  const { ff, fetchFile, multiThreaded: mt } = await getFFmpeg(onLog, {
    preferSingleThread: forceFfmpeg,
  })

  onLog?.('Writing file…')
  await ff.writeFile(inputName, await fetchFile(file))
  onProgress?.(20)

  const crf = Math.round(38 - (quality / 100) * 16)
  const ss  = Math.max(0, startTime)

  // -ss before -i = fast seek (input seeking), then trim -t seconds
  const args = [
    '-threads',  '0',
    '-ss',       String(ss),
    '-i',        inputName,
    '-t',        String(PREVIEW_DURATION),
    '-c:v',      'libx264',
    '-preset',   'ultrafast',
    '-tune',     'zerolatency',
    '-crf',      String(crf),
    '-pix_fmt',  'yuv420p',
    '-movflags', '+faststart',
    '-an',
    '-y',        outputName,
  ]

  onLog?.(`Encoding ${PREVIEW_DURATION}s clip from ${formatTime(ss)} (CRF ${crf}, ${mt ? 'MT ⚡' : 'ST'})…`)
  const t0  = performance.now()
  let ret = 0
  try {
    ret = await ff.exec(args)
  } catch (e) {
    throw new Error(formatFfmpegWorkerError(e))
  }
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)

  if (ret !== 0) {
    onLog?.(`⚠ ffmpeg returned exit code ${ret} (${elapsed}s)`)
  }

  onProgress?.(88)

  const data = await ff.readFile(outputName)
  if (!data || data.byteLength === 0) {
    throw new Error('ffmpeg returned empty output — the selected time range may be past the end of the video.')
  }

  const blob = new Blob([data.slice(0)], { type: 'video/mp4' })
  const url  = URL.createObjectURL(blob)

  try { await ff.deleteFile(inputName)  } catch (_) {}
  try { await ff.deleteFile(outputName) } catch (_) {}

  onProgress?.(100)
  onLog?.(`Done — ${(blob.size / 1024).toFixed(0)} KB in ${elapsed}s`)

  return { url, size: blob.size }
}

function formatTime(s) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}
