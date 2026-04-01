/**
 * ffmpegLoader.js
 *
 * Loads @ffmpeg/ffmpeg from npm (Vite bundles it at build time),
 * but points it at self-hosted core/wasm files in public/ffmpeg/
 * to avoid CDN CORS issues on Vercel.
 *
 * The only files needed in public/ffmpeg/ are:
 *   - ffmpeg-core.js   (~114 KB)
 *   - ffmpeg-core.wasm (~30 MB)
 *
 * Log listener is stored in a mutable ref so batch exports
 * can update it per-file without re-initialising ffmpeg.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

let _instance    = null
let _loadPromise = null
let _onLog       = null   // mutable — updated on every getFFmpeg() call

export async function getFFmpeg(onLog) {
  // Always update the log listener so batch exports see per-file logs
  _onLog = onLog

  if (_instance)    return _instance
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    _onLog?.('Loading ffmpeg (~30 MB, cached after first run)…')

    const ff = new FFmpeg()

    // Use an indirect reference so the listener always calls the latest _onLog
    ff.on('log', ({ message }) => _onLog?.(`[ffmpeg] ${message}`))

    const baseURL = '/ffmpeg'
    const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript')
    const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')

    await ff.load({ coreURL, wasmURL })

    _onLog?.('ffmpeg ready ✓')
    _instance = { ff, fetchFile }
    return _instance
  })()

  return _loadPromise
}

export function releaseFFmpeg() {
  if (_instance) { try { _instance.ff.terminate() } catch (_) {} }
  _instance    = null
  _loadPromise = null
  _onLog       = null
}
