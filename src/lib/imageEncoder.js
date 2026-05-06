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

import { isVideoLike, ingestExt } from './mediaIngest.js'
import { decodeTiffToCanvas } from './tiffDecode.js'
import { downscaleImageSourceToCanvas } from './canvasDownscale.js'

const MIME = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
}

export function resolveFormat(file, formatSetting) {
  if (formatSetting !== 'auto') return formatSetting
  const isGif = file.name.toLowerCase().endsWith('.gif')
  if (isVideoLike(file) || isGif) return 'mp4'
  return 'webp'
}

function loadImage(file, onLog = () => {}) {
  const ext = ingestExt(file.name)
  const isTiff =
    ext === 'tif' || ext === 'tiff' || (file.type || '').toLowerCase() === 'image/tiff'
  if (isTiff) {
    return decodeTiffToCanvas(file, onLog).catch((err) =>
      Promise.reject(new Error(`Failed to decode TIFF ${file.name}: ${err.message}`)))
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Failed to load ${file.name}`)) }
    img.src = url
  })
}

async function renderToBlob(img, targetW, quality, format) {
  const srcW   = img.naturalWidth || img.width
  const srcH   = img.naturalHeight || img.height
  const scale  = targetW > 0 && targetW < srcW ? targetW / srcW : 1
  const w      = Math.round(srcW * scale)
  const h      = Math.round(srcH * scale)

  const canvas = downscaleImageSourceToCanvas(img, srcW, srcH, w, h)

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
    /** When true and `widths` is non-empty (responsive export), always use `name-{w}.ext`. */
    labelWidthsInFilename = false,
    onProgress    = () => {},
    onLog           = () => {},
  } = opts

  const fmt = resolveFormat(file, formatSetting)
  if (fmt === 'mp4' || fmt === 'webm') {
    throw new Error('Use encodeVideo for video/GIF files')
  }

  const img      = await loadImage(file, onLog)
  const baseName = file.name.replace(/\.[^.]+$/, '')
  const ext      = fmt === 'jpeg' ? 'jpg' : fmt

  const srcW    = img.naturalWidth || img.width
  const scaledW = Math.round(srcW * (resolutionPct / 100))

  let targetWidths = widths.length > 0
    ? [...new Set(widths.filter((w) => w <= scaledW))].sort((a, b) => b - a)
    : []

  if (!targetWidths.includes(scaledW)) targetWidths.unshift(scaledW)
  if (targetWidths.length === 0) targetWidths = [scaledW]

  const labelResponsive = labelWidthsInFilename && widths.length > 0
  const results = []
  for (let i = 0; i < targetWidths.length; i++) {
    const w    = targetWidths[i]
    const blob = await renderToBlob(img, w, quality, fmt)
    const filename = labelResponsive || targetWidths.length > 1
      ? `${baseName}-${w}.${ext}`
      : `${baseName}.${ext}`
    results.push({ filename, blob, width: w })
    onProgress(Math.round(((i + 1) / targetWidths.length) * 100))
  }

  return results
}
