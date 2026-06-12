/**
 * Lazy frame URLs for image sequence preview (revoke when superseded).
 */

/** @type {Map<string, { url: string, frameIndex: number }>} */
const _cache = new Map()

/** @param {string} ownerId @param {import('./sequenceNaming.js').SequenceFrame[]} frames @param {number} frameIndex */
export function getSequenceFrameUrl(ownerId, frames, frameIndex) {
  const idx = Math.max(0, Math.min(frames.length - 1, frameIndex))
  const prev = _cache.get(ownerId)
  if (prev && prev.frameIndex === idx) return prev.url

  if (prev?.url) URL.revokeObjectURL(prev.url)
  const url = URL.createObjectURL(frames[idx].file)
  _cache.set(ownerId, { url, frameIndex: idx })
  return url
}

/** @param {string} ownerId */
export function revokeSequencePreview(ownerId) {
  const prev = _cache.get(ownerId)
  if (prev?.url) URL.revokeObjectURL(prev.url)
  _cache.delete(ownerId)
}

/** @param {number} scrubPct @param {number} frameCount */
export function scrubPctToFrameIndex(scrubPct, frameCount) {
  if (frameCount <= 1) return 0
  const frac = Math.max(0, Math.min(1, scrubPct / 100))
  return Math.min(frameCount - 1, Math.floor(frac * frameCount))
}

/** @param {number} currentT @param {number} fps @param {number} frameCount */
export function timeToFrameIndex(currentT, fps, frameCount) {
  if (frameCount <= 0) return 0
  const idx = Math.floor(currentT * fps)
  return Math.max(0, Math.min(frameCount - 1, idx))
}

/** @param {number} frameIndex @param {number} fps */
export function frameIndexToTime(frameIndex, fps) {
  return frameIndex / fps
}

/** Virtual duration in seconds for a sequence. */
export function sequenceDuration(frameCount, fps) {
  if (frameCount <= 0 || fps <= 0) return 0
  return frameCount / fps
}
