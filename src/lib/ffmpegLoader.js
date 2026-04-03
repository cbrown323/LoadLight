/**
 * ffmpegLoader.js
 *
 * Loads @ffmpeg/ffmpeg from npm (Vite bundles it at build time),
 * pointing at self-hosted core/wasm files in public/ffmpeg/.
 *
 * ★ Multi-threaded by default — falls back to single-threaded
 *   if SharedArrayBuffer is unavailable (missing COOP/COEP headers).
 *
 * Files in public/ffmpeg/:
 *   MT:  ffmpeg-core-mt.js, ffmpeg-core-mt.wasm, ffmpeg-core.worker.js
 *   ST:  ffmpeg-core.js,    ffmpeg-core.wasm
 *
 * Log listener is stored in a mutable ref so batch exports
 * can update it per-file without re-initialising ffmpeg.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

let _instance    = null
let _loadPromise = null
let _onLog       = null   // mutable — updated on every getFFmpeg() call

/** Check if the browser supports multi-threaded wasm */
function canUseMultiThread() {
  try {
    return typeof SharedArrayBuffer !== 'undefined'
  } catch { return false }
}

export async function getFFmpeg(onLog) {
  // Always update the log listener so batch exports see per-file logs
  _onLog = onLog

  if (_instance)    return _instance
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    const mt      = canUseMultiThread()
    const label   = mt ? 'multi-threaded' : 'single-threaded'
    _onLog?.(`Loading ffmpeg ${label} (~31 MB, cached after first run)…`)

    const ff = new FFmpeg()

    // Use an indirect reference so the listener always calls the latest _onLog
    ff.on('log', ({ message }) => _onLog?.(`[ffmpeg] ${message}`))

    const baseURL = '/ffmpeg'

    let coreURL, wasmURL, workerURL

    if (mt) {
      // Multi-threaded core — uses SharedArrayBuffer + web workers
      coreURL   = await toBlobURL(`${baseURL}/ffmpeg-core-mt.js`,       'text/javascript')
      wasmURL   = await toBlobURL(`${baseURL}/ffmpeg-core-mt.wasm`,     'application/wasm')
      workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`,   'text/javascript')
    } else {
      // Single-threaded fallback
      coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`,  'text/javascript')
      wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    }

    const loadOpts = { coreURL, wasmURL }
    if (workerURL) loadOpts.workerURL = workerURL

    await ff.load(loadOpts)

    _onLog?.(`ffmpeg ready ✓ (${label})`)
    _instance = { ff, fetchFile, multiThreaded: mt }
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

/**
 * Detect which encoding mode is available for video.
 * Returns 'webcodecs' (hardware-accel) or 'wasm' (software fallback).
 */
export function getEncodingMode() {
  try {
    if (typeof VideoEncoder === 'function' && typeof VideoFrame === 'function') {
      return 'webcodecs'
    }
  } catch {}
  return 'wasm'
}
