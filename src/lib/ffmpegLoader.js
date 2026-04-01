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
 * @ffmpeg/ffmpeg and @ffmpeg/util are installed via npm and bundled by Vite.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

let _instance    = null
let _loadPromise = null

export async function getFFmpeg(onLog) {
  if (_instance)    return _instance
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    onLog?.('Loading ffmpeg (~30 MB, cached after first run)…')

    const ff = new FFmpeg()
    if (onLog) ff.on('log', ({ message }) => onLog(`[ffmpeg] ${message}`))

    const baseURL = '/ffmpeg'

    // Convert core files to blob URLs so they work from any origin.
    // The core.js and core.wasm are the only files we self-host.
    const coreURL = await toBlobURL(
      `${baseURL}/ffmpeg-core.js`,
      'text/javascript'
    )
    const wasmURL = await toBlobURL(
      `${baseURL}/ffmpeg-core.wasm`,
      'application/wasm'
    )

    await ff.load({ coreURL, wasmURL })

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
