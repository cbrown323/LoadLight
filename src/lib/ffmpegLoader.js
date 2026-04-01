/**
 * ffmpegLoader.js
 *
 * Loads ALL ffmpeg assets from /ffmpeg/ (public folder, same origin).
 * Uses dynamic import() for the ESM bundles so Vite NEVER bundles them.
 *
 * Why dynamic import instead of static:
 *   import { FFmpeg } from '@ffmpeg/ffmpeg'  ← Vite bundles this, transforms
 *   the internal worker URL, breaks our workerURL override = Worker CORS error.
 *
 *   const { FFmpeg } = await import('/ffmpeg/ffmpeg-esm.js')  ← Vite leaves
 *   this alone at runtime, the file is served as-is from public/, no transforms.
 *
 * Required files in public/ffmpeg/ (run: node scripts/download-ffmpeg.js):
 *   ffmpeg-core.js      ~30 KB
 *   ffmpeg-core.wasm    ~30 MB
 *   worker.js           ~5 KB
 *   ffmpeg-esm.js       ~5 KB
 *   util-esm.js         ~5 KB
 */

let _instance    = null
let _loadPromise = null

export async function getFFmpeg(onLog) {
  if (_instance)    return _instance
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    onLog?.('Loading ffmpeg (~30 MB, cached after first run)…')

    // Dynamic import from same origin — Vite does NOT transform these
    const { FFmpeg }               = await import('/ffmpeg/ffmpeg-esm.js')
    const { fetchFile, toBlobURL } = await import('/ffmpeg/util-esm.js')

    const ff = new FFmpeg()
    if (onLog) ff.on('log', ({ message }) => onLog(`[ffmpeg] ${message}`))

    // All three core assets as blob URLs from same origin
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
