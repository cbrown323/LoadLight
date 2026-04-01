/**
 * ffmpegLoader.js
 *
 * Loads ffmpeg from public/ffmpeg/ using dynamic imports with
 * /* @vite-ignore */ comments so Vite skips analysis entirely.
 * The files are served as static assets — Rollup must not touch them.
 */

let _instance    = null
let _loadPromise = null

export async function getFFmpeg(onLog) {
  if (_instance)    return _instance
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    onLog?.('Loading ffmpeg (~30 MB, cached after first run)…')

    // @vite-ignore tells Vite/Rollup to skip static analysis of this import.
    // The files live in public/ffmpeg/ and are served at runtime from the same origin.
    const { FFmpeg }               = await import(/* @vite-ignore */ '/ffmpeg/ffmpeg-esm.js')
    const { fetchFile, toBlobURL } = await import(/* @vite-ignore */ '/ffmpeg/util-esm.js')

    const ff = new FFmpeg()
    if (onLog) ff.on('log', ({ message }) => onLog(`[ffmpeg] ${message}`))

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
