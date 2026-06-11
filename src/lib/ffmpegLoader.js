/**
 * ffmpegLoader.js
 *
 * Loads @ffmpeg/ffmpeg from npm (Vite bundles it at build time),
 * pointing at self-hosted core/wasm files in public/ffmpeg/.
 *
 * ★ Two cores may load:
 *   - Multi-threaded (SharedArrayBuffer + COOP/COEP) — fast for MP4/WebM
 *   - Single-threaded — required for reliable .mov / AVI transcode in Chromium
 *     (MT core is known to hang or throw on some containers/filters).
 *
 * Log listener is stored in a mutable ref so batch exports
 * can update it per-file without re-initialising ffmpeg.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'
import { canUseFfmpegWasm, isChromium } from './capabilitySupport.js'

let _onLog = null

/** Per-frame ffmpeg stats — would flood React state and slow the UI. */
function isFfmpegProgressNoise(message) {
  if (!message || typeof message !== 'string') return false
  const m = message.trimStart()
  return /^frame=\s*\d+/.test(m) || /^size=\s*\d+kB\s+time=/.test(m)
}

/** MT singleton */
let _instanceMT = null
let _loadPromiseMT = null
/** ST singleton (separate worker — used for demux-heavy / fragile inputs) */
let _instanceST = null
let _loadPromiseST = null

/** MT core needs SharedArrayBuffer + a browser that can spawn wasm pthread workers. */
function canUseMultiThread() {
  if (!isChromium()) return false
  try {
    return typeof SharedArrayBuffer !== 'undefined'
  } catch { return false }
}

/** @param {boolean} multiThreaded */
async function loadFfmpegCore(multiThreaded) {
  const label = multiThreaded ? 'multi-threaded' : 'single-threaded'
  _onLog?.(`Loading ffmpeg ${label} (~31 MB, cached after first run)…`)

  const ff = new FFmpeg()
  ff.on('log', ({ message }) => {
    if (isFfmpegProgressNoise(message)) return
    _onLog?.(`[ffmpeg] ${message}`)
  })

  const baseURL = '/ffmpeg'

  let coreURL, wasmURL, workerURL

  if (multiThreaded) {
    coreURL   = await toBlobURL(`${baseURL}/ffmpeg-core-mt.js`,       'text/javascript')
    wasmURL   = await toBlobURL(`${baseURL}/ffmpeg-core-mt.wasm`,     'application/wasm')
    workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`,   'text/javascript')
  } else {
    coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`,  'text/javascript')
    wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
  }

  const loadOpts = { coreURL, wasmURL }
  if (workerURL) loadOpts.workerURL = workerURL

  await ff.load(loadOpts)

  _onLog?.(`ffmpeg ready ✓ (${label})`)
  return { ff, fetchFile, multiThreaded }
}

/**
 * @param {(msg: string) => void} [onLog]
 * @param {{ preferSingleThread?: boolean }} [opts]
 *   preferSingleThread — use ST core (reliable for .mov/.avi in Chrome; slower)
 */
export async function getFFmpeg(onLog, opts = {}) {
  _onLog = onLog

  if (!canUseFfmpegWasm()) {
    throw new Error('ffmpeg.wasm is not supported in this browser (use WebCodecs or Chrome for software encode).')
  }

  const useMT = !opts.preferSingleThread && canUseMultiThread()

  if (useMT) {
    if (_instanceMT) return _instanceMT
    if (_loadPromiseMT) return _loadPromiseMT
    _loadPromiseMT = (async () => {
      _instanceMT = await loadFfmpegCore(true)
      _loadPromiseMT = null
      return _instanceMT
    })()
    return _loadPromiseMT
  }

  if (_instanceST) return _instanceST
  if (_loadPromiseST) return _loadPromiseST
  _loadPromiseST = (async () => {
    _instanceST = await loadFfmpegCore(false)
    _loadPromiseST = null
    return _instanceST
  })()
  return _loadPromiseST
}

export function releaseFFmpeg() {
  if (_instanceMT) { try { _instanceMT.ff.terminate() } catch (_) {} }
  if (_instanceST) { try { _instanceST.ff.terminate() } catch (_) {} }
  _instanceMT = null
  _instanceST = null
  _loadPromiseMT = null
  _loadPromiseST = null
  _onLog = null
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function formatFfmpegWorkerError(err) {
  if (err == null) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || String(err)
  try { return String(err) } catch { return 'Unknown error' }
}

/**
 * Detect which encoding mode is available for video.
 * Returns 'webcodecs' (hardware-accel) or 'wasm' (software fallback).
 */
export function getEncodingMode() {
  try {
    if (
      globalThis.isSecureContext &&
      typeof VideoEncoder === 'function' &&
      typeof VideoDecoder === 'function' &&
      typeof VideoFrame === 'function'
    ) {
      return 'webcodecs'
    }
  } catch {}
  return 'wasm'
}
