/**
 * ffmpegLoader.js
 * Loads ffmpeg.wasm 0.12.x — all assets served as blob: URLs to avoid
 * cross-origin Worker restrictions (browsers block CDN-origin workers).
 */

let _instance    = null
let _loadPromise = null

const CDN = 'https://cdn.jsdelivr.net/npm'

export async function getFFmpeg(onLog) {
  if (_instance)    return _instance
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    const { FFmpeg }              = await import(`${CDN}/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js`)
    const { fetchFile, toBlobURL } = await import(`${CDN}/@ffmpeg/util@0.12.1/dist/esm/index.js`)

    const ff = new FFmpeg()
    if (onLog) ff.on('log', ({ message }) => onLog(`[ffmpeg] ${message}`))

    const coreBase = `${CDN}/@ffmpeg/core@0.12.6/dist/esm`

    onLog?.('Downloading ffmpeg (~30 MB, cached after first run)…')

    // ALL three assets must be blob: URLs — worker.js especially,
    // because the browser refuses to spawn a Worker from a foreign origin.
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      toBlobURL(`${coreBase}/ffmpeg-core.js`,        'text/javascript'),
      toBlobURL(`${coreBase}/ffmpeg-core.wasm`,      'application/wasm'),
      toBlobURL(`${CDN}/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js`, 'text/javascript'),
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
