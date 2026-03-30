/**
 * aiMaxGenerator.js
 * Generates a single token-optimized JSON snippet for all exported assets.
 *
 * Format rationale:
 * - Array rows with shared schema = no repeated keys (biggest token saving)
 * - Nested sizes array = one row per logical asset, not one per breakpoint
 * - Short keys throughout: w, h, dur, fmt
 * - Palette (3 dominant hex colors) per image — useful for AI layout decisions
 * - Trailing nulls omitted from asset rows
 * - No instructions block — wastes tokens, LLMs don't need hand-holding
 */

import { getExt } from '../store/useStore.js'

// ── Dominant color extraction from a loaded image ──────────
// Samples a grid of pixels, clusters by proximity, returns top 3 hex colors.
export function extractPalette(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 40  // sample at 40x40 for speed
        const c = document.createElement('canvas')
        c.width = c.height = size
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data

        // Bucket colors into 8-level quantization per channel
        const buckets = {}
        for (let i = 0; i < data.length; i += 4) {
          const r = Math.round(data[i]   / 32) * 32
          const g = Math.round(data[i+1] / 32) * 32
          const b = Math.round(data[i+2] / 32) * 32
          const key = `${r},${g},${b}`
          buckets[key] = (buckets[key] || 0) + 1
        }

        const sorted = Object.entries(buckets)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k]) => {
            const [r, g, b] = k.split(',').map(Number)
            return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
          })

        resolve(sorted)
      } catch {
        resolve([])
      }
    }
    img.onerror = () => resolve([])
    img.src = imageUrl
  })
}

/**
 * Build the AI Max JSON snippet for all files.
 *
 * @param {Array}  files        — store file objects (with width, height, duration, previewUrl)
 * @param {string} format       — output format setting
 * @param {Array}  breakpoints  — [{name, w}] responsive breakpoints
 * @param {string} responsiveMode
 * @param {boolean} withPalette — extract dominant colors (requires canvas access)
 *
 * @returns {Promise<string>} — formatted snippet string
 */
export async function buildAiMaxSnippet(files, { format, breakpoints, responsiveMode, withPalette = true }) {
  const useResponsive = responsiveMode !== 'none' && breakpoints.length > 0

  const assets = []
  const groups = { img: [], vid: [] }

  for (let i = 0; i < files.length; i++) {
    const fo      = files[i]
    const isVideo = fo.file.type.startsWith('video/') || fo.file.name.toLowerCase().endsWith('.gif')
    const isGif   = fo.file.name.toLowerCase().endsWith('.gif')
    const type    = isVideo ? 'vid' : 'img'
    const name    = fo.file.name.replace(/\.[^.]+$/, '')

    // Resolve output format
    let fmt = format === 'auto' ? (isVideo ? 'mp4' : 'webp') : format
    if (isGif && format === 'auto') fmt = 'mp4'

    // Build sizes array
    let sizes
    if (useResponsive && !isVideo) {
      const srcW = fo.width || 0
      const validBps = breakpoints
        .filter((bp) => srcW === 0 || bp.w <= srcW)
        .sort((a, b) => b.w - a.w)
      sizes = validBps.length > 0
        ? validBps.map((bp) => [bp.w, fo.height ? Math.round(fo.height * (bp.w / (fo.width || bp.w))) : 0])
        : [[fo.width || 0, fo.height || 0]]
    } else {
      sizes = [[fo.width || 0, fo.height || 0]]
    }
    // Remove zero dimensions
    sizes = sizes.map(([w, h]) => h > 0 ? [w, h] : [w]).filter(([w]) => w > 0)
    if (sizes.length === 0) sizes = undefined

    // Duration for video
    const dur = isVideo && fo.duration ? Math.round(fo.duration * 10) / 10 : undefined

    // Palette for images
    let palette
    if (withPalette && !isVideo && fo.previewUrl) {
      palette = await extractPalette(fo.previewUrl)
      if (palette.length === 0) palette = undefined
    }

    // Build asset row — omit trailing undefined fields
    const row = [i, type, name, fmt]
    if (sizes)   row.push(sizes)
    else         row.push(null)
    if (dur !== undefined) row.push(dur)
    else if (palette)      row.push(null)
    if (palette)           row.push(palette)

    // Trim trailing nulls
    while (row.length > 4 && row[row.length - 1] === null) row.pop()

    assets.push(row)
    groups[type].push(i)
  }

  // Remove empty groups
  const cleanGroups = {}
  if (groups.img.length) cleanGroups.img = groups.img
  if (groups.vid.length) cleanGroups.vid = groups.vid

  const schema = ['id', 'type', 'name', 'fmt', 'sizes', 'dur', 'palette']

  const payload = {
    meta:   { v: '1.3', tool: 'loadlight', n: files.length, _parse: 'schema-mapped' },
    schema,
    assets,
    groups: cleanGroups,
  }

  const json = JSON.stringify(payload, null, 2)
  return `<!-- LOADLIGHT AI MAX v1.3 -->\n<script type="application/json" id="loadlight-ai-max">\n${json}\n</script>`
}
