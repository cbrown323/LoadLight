/**
 * ffmpegLoader.js
 * Loads ffmpeg.wasm 0.12.x from /ffmpeg/ (self-hosted in public/).
 *
 * WHY self-hosted instead of CDN:
 * Vercel's COEP headers block fetching CDN assets unless the CDN
 * responds with Cross-Origin-Resource-Policy: cross-origin — jsDelivr
 * doesn't, so toBlobURL() fails before the Worker is even constructed.
 * Serving the files from the same origin (public/ffmpeg/) sidesteps
 * all cross-origin restrictions entirely.
 *
 * Setup: run `node scripts/download-ffmpeg.js` once before deploying.
 * This downloads the three files into public/ffmpeg/ and commits them.
 */

let _instance    = null
let _loadPromise = null

// These resolve to /ffmpeg/... on both localhost and Vercel
const BASE = '/ffmpeg'

export async function getFFmpeg(onLog) {
  if (_instance)    return _instance
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    // Import the ffmpeg ESM package — still from CDN since it's JS only,
    // not a Worker, so dynamic import works fine cross-origin.
    const CDN = 'https://cdn.jsdelivr.net/npm'
    const { FFmpeg }               = await import(`${CDN}/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js`)
    const { fetchFile, toBlobURL } = await import(`${CDN}/@ffmpeg/util@0.12.1/dist/esm/index.js`)

    const ff = new FFmpeg()
    if (onLog) ff.on('log', ({ message }) => onLog(`[ffmpeg] ${message}`))

    onLog?.('Loading ffmpeg (~30 MB, cached after first run)…')

    // All three assets served from same origin — no CORS issues
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      toBlobURL(`${BASE}/ffmpeg-core.js`,   'text/javascript'),
      toBlobURL(`${BASE}/ffmpeg-core.wasm`, 'application/wasm'),
      toBlobURL(`${BASE}/worker.js`,        'text/javascript'),
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
