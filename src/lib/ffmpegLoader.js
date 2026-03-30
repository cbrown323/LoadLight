/**
 * ffmpegLoader.js
 *
 * Imports @ffmpeg/ffmpeg and @ffmpeg/util from npm (bundled by Vite),
 * then loads the core/wasm/worker from /ffmpeg/ — self-hosted in public/.
 *
 * This is the only reliable way to avoid the CDN Worker CORS error on Vercel.
 * The npm package is bundled at build time so no CDN fetch happens at runtime.
 * The core/wasm/worker files are served from the same origin.
 *
 * Before deploying, run: node scripts/download-ffmpeg.js
 */

import { FFmpeg }              from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let _instance    = null
let _loadPromise = null

export async function getFFmpeg(onLog) {
  if (_instance)    return _instance
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    const ff = new FFmpeg()
    if (onLog) ff.on('log', ({ message }) => onLog(`[ffmpeg] ${message}`))

    onLog?.('Loading ffmpeg (~30 MB, cached after first run)…')

    // All assets served from same origin — zero CORS involvement
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      toBlobURL('/ffmpeg/ffmpeg-core.js',   'text/javascript'),
      toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
      toBlobURL('/ffmpeg/worker.js',        'text/javascript'),
    ])

    await ff.load({ coreURL, wasmURL, workerURL })

    onLog?.('ffmpeg ready ✓')
    _instance = { ff, fetchFile }
    return _instance
  })()

  return _loadPromise
}

export function releaseFFmpeg() {
  if (_instance) { try { _instance.ff.terminate() } catch (_) {} }
  _instance    = null
  _loadPromise = null
}
