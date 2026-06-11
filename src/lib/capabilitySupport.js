/**
 * capabilitySupport.js
 * Browser capability probes for encoding / preview routing.
 */

/**
 * ffmpeg.wasm runs in a module worker — reliable on Chromium only; Safari workers throw on WebAssembly.
 */
export function canUseFfmpegWasm() {
  if (!isChromium()) return false
  try {
    return typeof WebAssembly !== 'undefined'
  } catch {
    return false
  }
}

/**
 * True for Chromium-based desktop/mobile browsers (Chrome, Edge, Opera, Chrome iOS).
 * Safari and Firefox return false — they decode QuickTime natively; WebCodecs is preferred there.
 */
export function isChromium() {
  try {
    const brands = navigator.userAgentData?.brands
    if (brands?.length) {
      return brands.some((b) =>
        /Chromium|Google Chrome|Microsoft Edge|Opera/i.test(b.brand),
      )
    }
  } catch {}
  const ua = navigator.userAgent
  // Desktop Safari includes "Safari/" but not "Chrome/"
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua) && !/CriOS\//.test(ua)) {
    return false
  }
  return /Chrome\//.test(ua) || /Chromium\//.test(ua) || /Edg\//.test(ua) || /CriOS\//.test(ua)
}
