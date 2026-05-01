/**
 * previewEncoder.js
 * Generates a real encoded preview blob for the "After" side.
 * Images only — video preview stays as original (re-encoding video on every
 * settings change would be too slow).
 *
 * Returns { url: string, size: number } or null on failure.
 * Caller is responsible for revoking old object URLs.
 */

import { encodeImage, resolveFormat } from './imageEncoder.js'
import { isVideoLike } from './mediaIngest.js'

// Debounce timer shared across calls
let _timer = null

/**
 * Schedule a preview encode. Cancels any pending encode first.
 * @param {File}     file
 * @param {object}   settings  — { format, quality, advResolution }
 * @param {function} onResult  — ({ url, size, width, height }) => void
 * @param {function} onStart   — () => void  (called when encode begins)
 * @param {number}   delay     — debounce ms (default 400)
 */
export function schedulePreview(file, settings, onResult, onStart, delay = 400) {
  clearTimeout(_timer)
  _timer = setTimeout(() => _encode(file, settings, onResult, onStart), delay)
}

export function cancelPreview() {
  clearTimeout(_timer)
}

async function _encode(file, settings, onResult, onStart) {
  // Only encode images — videos stay as-is in preview
  if (isVideoLike(file)) return

  const fmt = resolveFormat(file, settings.format)
  if (fmt === 'mp4' || fmt === 'webm') return

  try {
    onStart?.()
    const results = await encodeImage(file, {
      format:        settings.format,
      quality:       settings.quality,
      widths:        [],           // single full-size preview
      resolutionPct: settings.advResolution || 100,
      onProgress:    () => {},
    })

    if (results.length > 0) {
      const { blob, width } = results[0]
      const url = URL.createObjectURL(blob)
      onResult({ url, size: blob.size, width })
    }
  } catch (err) {
    console.warn('Preview encode failed:', err)
  }
}
