/**
 * Shared ingestion rules: allowed extensions/MIME hints, video vs image grouping,
 * and validation for the file queue (LoadLight — Vite + React, no TS).
 */
import { isChromium } from './capabilitySupport.js'

/** @typedef {{ ok: true }} IngestOk */
/** @typedef {{ ok: false, reason: string }} IngestErr */
/** @typedef {IngestOk | IngestErr} IngestResult */

/** Lowercase extensions we accept for queue ingestion (output formats unchanged). */
export const INGEST_IMAGE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'tif', 'tiff',
])

/** Video-like extensions (may carry generic MIME like octet-stream). */
export const INGEST_VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'avi'])

const IMAGE_MIME_PREFIX = 'image/'
const VIDEO_MIME_PREFIX = 'video/'

/**
 * @param {string} name
 * @returns {string}
 */
export function ingestExt(name) {
  const i = name.lastIndexOf('.')
  if (i < 0) return ''
  return name.slice(i + 1).toLowerCase()
}

/**
 * Prefer ffmpeg.wasm over WebCodecs for fragile containers — Chromium only.
 * Chrome often breaks .mov / .avi seeks on a detached `<video>`; Safari and Firefox
 * decode QuickTime natively, so WebCodecs is the better path there.
 * @param {File} file
 */
export function preferFfmpegExportForFile(file) {
  if (!isChromium()) return false
  const ext = ingestExt(file.name)
  if (ext === 'mov' || ext === 'avi') return true
  const t = (file.type || '').toLowerCase()
  if (t.includes('quicktime')) return true
  return false
}

/**
 * True when the file should use the video pipeline (preview, export, timeline).
 * GIF is treated as video-like to match existing UI grouping.
 * @param {File} file
 */
export function isVideoLike(file) {
  const t = (file.type || '').toLowerCase()
  if (t.startsWith(VIDEO_MIME_PREFIX)) return true
  const ext = ingestExt(file.name)
  if (ext === 'gif') return true
  return INGEST_VIDEO_EXT.has(ext)
}

/**
 * True for static image paths (includes TIFF; excludes GIF when grouped as video).
 * @param {File} file
 */
export function isRasterStillImage(file) {
  if (isVideoLike(file)) return false
  const t = (file.type || '').toLowerCase()
  if (t.startsWith(IMAGE_MIME_PREFIX)) return true
  const ext = ingestExt(file.name)
  return INGEST_IMAGE_EXT.has(ext)
}

/**
 * Whether this file may be added to the processing queue.
 * @param {File} file
 * @returns {IngestResult}
 */
export function validateIngestFile(file) {
  const ext = ingestExt(file.name)
  const t = (file.type || '').toLowerCase()

  if (isVideoLike(file) || isRasterStillImage(file)) {
    return { ok: true }
  }

  if (!ext && !t) {
    return { ok: false, reason: `Could not read type for “${file.name}”.` }
  }

  return {
    ok: false,
    reason: `Unsupported file type: “${file.name}” (${t || 'no MIME'}). Use images (${[...INGEST_IMAGE_EXT].join(', ')}) or video (${[...INGEST_VIDEO_EXT].join(', ')}).`,
  }
}

/** HTML `accept` for hidden file inputs + drag-and-drop hint parity. */
export const MEDIA_INPUT_ACCEPT = [
  'image/*',
  'image/tiff',
  'video/*',
  '.gif',
  '.webp',
  '.avif',
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
].join(',')
