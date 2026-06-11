/**
 * videoPreviewEncoder.js
 * Encodes a short preview clip from a video file.
 *
 * Routing:
 *  1. WebCodecs path (hardware-accelerated) — preferred
 *  2. Native source blob — Safari / non-Chromium when wasm is unavailable
 *  3. ffmpeg.wasm fallback — Chromium only (GIF, WebCodecs failure, fragile containers)
 */
import { getFFmpeg, formatFfmpegWorkerError } from './ffmpegLoader.js'
import { preferFfmpegExportForFile } from './mediaIngest.js'
import { canUseFfmpegWasm } from './capabilitySupport.js'
import {
  supportsWebCodecsVideo,
  webCodecsVideoSkipReason,
  encodePreviewWebCodecs,
} from './webCodecsEncoder.js'

const PREVIEW_DURATION = 4

/**
 * Show the original file in the after panel when re-encode is impossible.
 * @param {File} file
 * @param {(pct: number) => void} [onProgress]
 * @param {(msg: string) => void} [onLog]
 */
function nativeVideoPreviewFallback(file, onProgress, onLog) {
  onLog?.('ℹ Showing original file as after preview (re-encode unavailable in this browser).')
  onProgress?.(100)
  const url = URL.createObjectURL(file)
  return { url, size: file.size }
}

export async function encodeVideoPreview(file, opts, onProgress, onLog) {
  const { quality = 72, startTime = 0 } = opts

  const isGif = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const forceFfmpeg = preferFfmpegExportForFile(file)
  const canWebCodecs = supportsWebCodecsVideo()

  // ── WebCodecs fast-path ──
  if (canWebCodecs && !isGif && !forceFfmpeg) {
    onLog?.('🚀 Preview via WebCodecs (hardware-accelerated)…')
    try {
      onProgress?.(10)
      const result = await encodePreviewWebCodecs(file, { quality, startTime })
      if (result) {
        onProgress?.(100)
        onLog?.(`Done — ${(result.size / 1024).toFixed(0)} KB (WebCodecs)`)
        return result
      }
      onLog?.('⚠ WebCodecs preview returned empty — falling back')
    } catch (err) {
      onLog?.(`⚠ WebCodecs preview failed: ${err.message} — falling back`)
      console.warn('WebCodecs preview failed:', err)
    }
  } else if (!isGif && !forceFfmpeg) {
    onLog?.(webCodecsVideoSkipReason())
  }

  // ── Native fallback (Safari / Firefox — wasm worker cannot load) ──
  if (!canUseFfmpegWasm()) {
    return nativeVideoPreviewFallback(file, onProgress, onLog)
  }

  // ── ffmpeg.wasm fallback (Chromium) ──
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
