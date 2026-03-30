/**
 * formatSupport.js
 * Detects which image formats the browser can encode via Canvas.toBlob.
 * Results are cached after first check.
 */

const _cache = {}

/**
 * Returns true if the browser can encode to this mime type via canvas.toBlob.
 * Uses a 1×1 canvas and checks if blob is non-null and non-trivially small.
 */
export async function canEncode(mime) {
  if (_cache[mime] !== undefined) return _cache[mime]

  return new Promise((resolve) => {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    c.toBlob((blob) => {
      // A null blob or a blob under 10 bytes means the format isn't supported
      const ok = blob !== null && blob.size > 10
      _cache[mime] = ok
      resolve(ok)
    }, mime, 0.9)
  })
}

export async function getSupportedFormats() {
  const checks = await Promise.all([
    canEncode('image/webp'),
    canEncode('image/avif'),
    canEncode('image/jpeg'),
    canEncode('image/png'),
  ])
  return {
    webp: checks[0],
    avif: checks[1],
    jpg:  checks[2],
    png:  checks[3],
  }
}

/**
 * Given a desired format key, return the best available fallback.
 * e.g. if AVIF not supported, falls back to WebP, then JPEG.
 */
export async function resolveWithFallback(format) {
  if (format === 'auto' || format === 'mp4' || format === 'webm' || format === 'gif') return format

  const mimeMap = { webp: 'image/webp', avif: 'image/avif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }
  const mime = mimeMap[format]
  if (!mime) return format

  const ok = await canEncode(mime)
  if (ok) return format

  // Fallback chain
  const fallbacks = { avif: 'webp', webp: 'jpg', jpg: 'jpg', png: 'png' }
  return fallbacks[format] || 'jpg'
}
