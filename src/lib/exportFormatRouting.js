/**
 * Per-file export format: still vs motion buckets, smart rules, pipeline choice.
 */
import { resolveFormat } from './imageEncoder.js'
import { isVideoLike } from './mediaIngest.js'

const STILL_OUT = new Set(['webp', 'avif', 'jpg', 'jpeg', 'png'])
const MOTION_OUT = new Set(['mp4', 'webm', 'gif'])

/** Same logic as export loop: bucket + resolveFormat + smart rules for Auto. */
export function resolveExportRawFormat(file, formatStill, formatMotion, smartFormat) {
  const motion = isVideoLike(file)
  const setting = motion ? formatMotion : formatStill
  let rawFmt = resolveFormat(file, setting)
  if (smartFormat && motion && formatMotion === 'auto') {
    rawFmt = 'mp4'
  }
  if (smartFormat && !motion && formatStill === 'auto') {
    if (file.type === 'image/png' && file.size < 200000) rawFmt = 'png'
    else rawFmt = 'webp'
  }
  return rawFmt
}

/**
 * After browser codec fallback, force image encoder vs video encoder from input kind.
 * Coerces impossible pairs (still + MP4, motion + JPG) with optional logging.
 */
export function pickExportPipeline(file, resolvedFmt, onLog = () => {}) {
  const motion = isVideoLike(file)
  let fmt = resolvedFmt === 'jpeg' ? 'jpg' : resolvedFmt

  if (fmt === 'auto') {
    fmt = motion ? 'mp4' : 'webp'
    onLog(`⚠ ${file.name}: ambiguous output format — using ${fmt.toUpperCase()}`)
  }

  if (motion) {
    if (!MOTION_OUT.has(fmt)) {
      onLog(`⚠ ${file.name}: ${String(resolvedFmt).toUpperCase()} is not a video container — using MP4`)
      fmt = 'mp4'
    }
    return { resolvedFmt: fmt, useVideoPipeline: true }
  }

  if (!STILL_OUT.has(fmt)) {
    onLog(`⚠ ${file.name}: ${String(resolvedFmt).toUpperCase()} is not a still-image format — using WebP`)
    fmt = 'webp'
  }
  return { resolvedFmt: fmt, useVideoPipeline: false }
}

/** Extension hint for still outputs when bucket is Auto (matches export smart PNG rule). */
export function previewStillFormatExt(file, formatStill, smartFormat) {
  if (formatStill !== 'auto') return formatStill
  if (!file) return 'webp'
  if (smartFormat && file.type === 'image/png' && file.size < 200000) return 'png'
  return 'webp'
}
