/**
 * imageEncoder.js
 *
 * High-quality image resizing pipeline:
 *  1. Multi-step halving to avoid single-step blur
 *  2. Unsharp mask sharpening pass after downscale
 *  3. imageSmoothingQuality = 'high' at every step
 *  4. For PNG: quality param is ignored (lossless), always full fidelity
 *  5. Maps quality 0-100 linearly but clamps JPEG minimum to 0.5 to avoid
 *     block artifacts at lower settings
 */

const MIME = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
}

export function resolveFormat(file, formatSetting) {
  if (formatSetting !== 'auto') return formatSetting
  const isGif   = file.name.toLowerCase().endsWith('.gif')
  const isVideo = file.type.startsWith('video/')
  if (isVideo || isGif) return 'mp4'
  return 'webp'
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Failed to load ${file.name}`)) }
    img.src = url
  })
}

/**
 * Apply a mild unsharp mask to a canvas to recover sharpness lost during downscale.
 * Uses a 3×3 Laplacian sharpening kernel blended at `strength`.
 * Only applied when downscaling by more than 40%.
 */
function sharpenCanvas(src, strength = 0.25) {
  const w = src.width
  const h = src.height
  const ctx = src.getContext('2d')
  const imageData = ctx.getImageData(0, 0, w, h)
  const d  = imageData.data
  const out = new Uint8ClampedArray(d.length)

  // 3×3 unsharp kernel: center weighted, neighbours negative
  const kernel = [
     0, -1,  0,
    -1,  5, -1,
     0, -1,  0,
  ]

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        let val = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const ni  = ((y + ky) * w + (x + kx)) * 4
            val += d[ni + c] * kernel[(ky + 1) * 3 + (kx + 1)]
          }
        }
        // Blend original with sharpened
        out[i + c] = Math.round(d[i + c] * (1 - strength) + Math.min(255, Math.max(0, val)) * strength)
      }
      out[i + 3] = d[i + 3] // preserve alpha
    }
  }

  // Copy border pixels unmodified
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y === 0 || y === h - 1 || x === 0 || x === w - 1) {
        const i = (y * w + x) * 4
        out[i] = d[i]; out[i+1] = d[i+1]; out[i+2] = d[i+2]; out[i+3] = d[i+3]
      }
    }
  }

  ctx.putImageData(new ImageData(out, w, h), 0, 0)
  return src
}

/**
 * Multi-step downscale with high-quality smoothing.
 * Halves repeatedly until within 2× of target, then final precise step.
 */
function resizeCanvas(source, targetW, targetH) {
  let curW = source.naturalWidth || source.width
  let curH = source.naturalHeight || source.height
  let cur  = source

  while (curW * 0.5 > targetW || curH * 0.5 > targetH) {
    const nextW = Math.max(Math.round(curW * 0.5), targetW)
    const nextH = Math.max(Math.round(curH * 0.5), targetH)
    const step  = document.createElement('canvas')
    step.width  = nextW
    step.height = nextH
    const ctx = step.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, nextW, nextH)
    cur  = step
    curW = nextW
    curH = nextH
  }

  // Final resize to exact target
  const out = document.createElement('canvas')
  out.width  = targetW
  out.height = targetH
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, targetW, targetH)
  return out
}

async function renderToBlob(img, targetW, quality, format) {
  const srcW   = img.naturalWidth
  const srcH   = img.naturalHeight
  const scale  = targetW > 0 && targetW < srcW ? targetW / srcW : 1
  const w      = Math.round(srcW * scale)
  const h      = Math.round(srcH * scale)

  let canvas
  if (scale < 0.75) {
    // Large reduction: use multi-step + sharpening
    canvas = resizeCanvas(img, w, h)
    // Sharpen more aggressively for very small outputs
    const sharpenStrength = scale < 0.4 ? 0.35 : 0.22
    sharpenCanvas(canvas, sharpenStrength)
  } else {
    // Small reduction: single pass is fine
    canvas = document.createElement('canvas')
    canvas.width  = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
  }

  const mime = MIME[format] || 'image/webp'

  // PNG is lossless — quality param has no effect, always pass 1.0
  // JPEG: remap 0-100 to 0.5-1.0 to avoid severe block artefacts at low settings
  // WebP: pass quality directly (0.0–1.0), handles low quality gracefully
  let q
  if (format === 'png') {
    q = undefined  // ignored by browser
  } else if (format === 'jpg' || format === 'jpeg') {
    q = 0.50 + (quality / 100) * 0.50
  } else {
    q = quality / 100
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error(`toBlob failed — ${mime} may be unsupported in this browser`)),
      mime,
      q
    )
  })
}

export async function encodeImage(file, opts) {
  const {
    format: formatSetting = 'auto',
    quality       = 90,
    widths        = [],
    resolutionPct = 100,
    onProgress    = () => {},
  } = opts

  const fmt = resolveFormat(file, formatSetting)
  if (fmt === 'mp4' || fmt === 'webm') {
    throw new Error('Use encodeVideo for video/GIF files')
  }

  const img      = await loadImage(file)
  const baseName = file.name.replace(/\.[^.]+$/, '')
  const ext      = fmt === 'jpeg' ? 'jpg' : fmt

  const srcW    = img.naturalWidth
  const scaledW = Math.round(srcW * (resolutionPct / 100))

  let targetWidths = widths.length > 0
    ? [...new Set(widths.filter((w) => w <= scaledW))].sort((a, b) => b - a)
    : []

  if (!targetWidths.includes(scaledW)) targetWidths.unshift(scaledW)
  if (targetWidths.length === 0) targetWidths = [scaledW]

  const results = []
  for (let i = 0; i < targetWidths.length; i++) {
    const w    = targetWidths[i]
    const blob = await renderToBlob(img, w, quality, fmt)
    const filename = targetWidths.length > 1
      ? `${baseName}-${w}.${ext}`
      : `${baseName}.${ext}`
    results.push({ filename, blob, width: w })
    onProgress(Math.round(((i + 1) / targetWidths.length) * 100))
  }

  return results
}
