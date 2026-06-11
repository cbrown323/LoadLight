/**
 * Fit-based canvas viewport math for preview zoom / pan (LoadLight — pure JS, no React).
 *
 * Semantics:
 * - fitScale: contain media inside viewport (no crop)
 * - userZoom: 1 = 100% fit, 2 = 200% of fit, etc.
 * - totalScale = fitScale * userZoom
 */

/** @typedef {{ width: number, height: number }} ViewportSize */

/** @typedef {{ fitScale: number, userZoom: number, panX: number, panY: number }} ViewportTransform */

/** @typedef {{ minX: number, maxX: number, minY: number, maxY: number }} PanBounds */

/** Multiplier applied per toolbar +/− click. */
export const ZOOM_STEP = 1.2

/** Minimum user zoom (100% = fit to canvas). */
export const ZOOM_MIN = 1

/** Hard cap on user zoom multiplier above fit. */
export const ZOOM_MAX = 16

/** Multiplier per wheel notch (applied when deltaY < 0). */
export const WHEEL_ZOOM_FACTOR = 1.12

/**
 * Contain scale: largest uniform scale so full media fits in viewport (no crop).
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} mediaW
 * @param {number} mediaH
 * @returns {number}
 */
export function computeFitScale(viewportW, viewportH, mediaW, mediaH) {
  if (!(viewportW > 0 && viewportH > 0 && mediaW > 0 && mediaH > 0)) return 1
  return Math.min(viewportW / mediaW, viewportH / mediaH)
}

/**
 * @param {number} fitScale
 * @param {number} userZoom
 * @returns {number}
 */
export function computeTotalScale(fitScale, userZoom) {
  const fit = fitScale > 0 ? fitScale : 1
  const zoom = userZoom > 0 ? userZoom : 1
  return fit * zoom
}

/**
 * Displayed media size after scaling.
 * @param {number} mediaW
 * @param {number} mediaH
 * @param {number} totalScale
 * @returns {{ width: number, height: number }}
 */
export function computeDisplaySize(mediaW, mediaH, totalScale) {
  const s = totalScale > 0 ? totalScale : 1
  return { width: mediaW * s, height: mediaH * s }
}

/**
 * Pan limits (symmetric) from overflow of scaled media vs viewport.
 * Pan 0 = centered. Positive panX moves content right (user drags left).
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} mediaW
 * @param {number} mediaH
 * @param {number} totalScale
 * @returns {PanBounds}
 */
export function computePanBounds(viewportW, viewportH, mediaW, mediaH, totalScale) {
  const { width: dispW, height: dispH } = computeDisplaySize(mediaW, mediaH, totalScale)
  const overflowX = Math.max(0, dispW - viewportW)
  const overflowY = Math.max(0, dispH - viewportH)
  const halfX = overflowX / 2
  const halfY = overflowY / 2
  return { minX: -halfX, maxX: halfX, minY: -halfY, maxY: halfY }
}

/**
 * @param {number} panX
 * @param {number} panY
 * @param {PanBounds} bounds
 * @returns {{ x: number, y: number }}
 */
export function clampPan(panX, panY, bounds) {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, panX)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, panY)),
  }
}

/**
 * True when scaled media exceeds viewport and pan is meaningful.
 * @param {PanBounds} bounds
 * @returns {boolean}
 */
export function panEnabled(bounds) {
  return bounds.maxX > 0 || bounds.maxY > 0
}

/**
 * Max userZoom so totalScale reaches 1:1 native media pixels (totalScale = fitScale * userZoom = 1).
 * @param {number} fitScale
 * @returns {number}
 */
export function maxUserZoomForNativePixels(fitScale) {
  if (!(fitScale > 0)) return ZOOM_MAX
  return Math.min(ZOOM_MAX, 1 / fitScale)
}

/**
 * Effective zoom ceiling: UI cap and optional native-pixel cap.
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} mediaW
 * @param {number} mediaH
 * @param {{ capAtNativePixels?: boolean }} [opts]
 * @returns {number}
 */
export function effectiveZoomMax(viewportW, viewportH, mediaW, mediaH, opts = {}) {
  const { capAtNativePixels = true } = opts
  if (!capAtNativePixels) return ZOOM_MAX
  const fitScale = computeFitScale(viewportW, viewportH, mediaW, mediaH)
  return maxUserZoomForNativePixels(fitScale)
}

/**
 * Clamp userZoom to [ZOOM_MIN, effectiveMax].
 * @param {number} userZoom
 * @param {number} maxZoom
 * @returns {number}
 */
export function clampUserZoom(userZoom, maxZoom) {
  const max = maxZoom > ZOOM_MIN ? maxZoom : ZOOM_MAX
  return Math.max(ZOOM_MIN, Math.min(max, userZoom))
}

/**
 * Step userZoom by factor (for +/− buttons).
 * @param {number} userZoom
 * @param {number} factor — e.g. ZOOM_STEP or 1/ZOOM_STEP
 * @param {number} maxZoom
 * @returns {number}
 */
export function stepUserZoom(userZoom, factor, maxZoom) {
  return clampUserZoom(userZoom * factor, maxZoom)
}

/**
 * @param {number} userZoom
 * @returns {string}
 */
export function formatZoomLabel(userZoom) {
  return `${Math.round((userZoom > 0 ? userZoom : 1) * 100)}%`
}

/**
 * After zoom changes, adjust pan so a viewport point stays under the cursor (optional wheel UX).
 * @param {number} panX
 * @param {number} panY
 * @param {number} oldTotalScale
 * @param {number} newTotalScale
 * @param {number} cursorX — offset from viewport center
 * @param {number} cursorY
 * @returns {{ x: number, y: number }}
 */
export function panForZoomAtCursor(panX, panY, oldTotalScale, newTotalScale, cursorX, cursorY) {
  if (!(oldTotalScale > 0 && newTotalScale > 0) || oldTotalScale === newTotalScale) {
    return { x: panX, y: panY }
  }
  const ratio = newTotalScale / oldTotalScale
  return {
    x: panX + cursorX * (1 - ratio),
    y: panY + cursorY * (1 - ratio),
  }
}
