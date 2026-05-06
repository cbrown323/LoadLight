import { getBreakpointsForFile } from './breakpointPresets.js'
import { isVideoLike } from './mediaIngest.js'
import { resolveExportRawFormat, pickExportPipeline } from './exportFormatRouting.js'
import { resolveWithFallback } from './formatSupport.js'

/**
 * aiMaxGenerator.js v2.1
 *
 * Grok-informed format: explicit named objects (not positional array rows).
 * LLMs parse field names directly — no schema→position mental mapping.
 * Strong llm_directive forces reference-by-ID mode for large batches.
 * Palette via canvas pixel sampling, 3 dominant colors per image.
 */

// ── Dominant color extraction ─────────────────────────────
export function extractPalette(imageUrl) {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      // No crossOrigin needed for blob: URLs (same origin)
      img.onload = () => {
        try {
          const SIZE = 48
          const c   = document.createElement('canvas')
          c.width   = SIZE
          c.height  = SIZE
          const ctx = c.getContext('2d', { willReadFrequently: true })
          ctx.drawImage(img, 0, 0, SIZE, SIZE)
          const { data } = ctx.getImageData(0, 0, SIZE, SIZE)

          // Quantize to 6-bit per channel for clustering
          const counts = {}
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue   // skip transparent
            const r = Math.round(data[i]   / 32) * 32
            const g = Math.round(data[i+1] / 32) * 32
            const b = Math.round(data[i+2] / 32) * 32
            const k = (r << 16) | (g << 8) | b
            counts[k] = (counts[k] || 0) + 1
          }

          const palette = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k]) => {
              const n = parseInt(k)
              const r = (n >> 16) & 0xff
              const g = (n >>  8) & 0xff
              const b =  n        & 0xff
              return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
            })

          resolve(palette.length ? palette : null)
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = imageUrl
    } catch { resolve(null) }
  })
}

/**
 * Build AI Max v2.1 snippet for all files.
 * Returns the full <script> block as a string.
 */
export async function buildAiMaxSnippet(files, {
  formatStill = 'auto',
  formatMotion = 'auto',
  smartFormat = true,
  breakpoints = [],
  responsiveMode = 'none',
}) {
  const useResponsive = responsiveMode !== 'none'
  const assets = []
  const groups = {}

  for (let i = 0; i < files.length; i++) {
    const fo      = files[i]
    const isVideo = isVideoLike(fo.file)
    const type = isVideo ? 'vid' : 'img'
    const name = fo.file.name.replace(/\.[^.]+$/, '')

    const rawFmt = resolveExportRawFormat(fo.file, formatStill, formatMotion, smartFormat)
    const afterFallback = await resolveWithFallback(rawFmt)
    const { resolvedFmt: fmt } = pickExportPipeline(fo.file, afterFallback, () => {})

    // Responsive sizes — nested [[w,h], ...] skipping upscales
    let sizes = null
    if (!isVideo) {
      const srcW = fo.width || 0
      const bpForFile = useResponsive ? getBreakpointsForFile(fo, responsiveMode, breakpoints) : []
      const bps       = useResponsive
        ? bpForFile.filter((bp) => srcW === 0 || bp.w <= srcW).sort((a, b) => b.w - a.w)
        : []
      if (bps.length > 0) {
        sizes = bps.map((bp) => {
          const h = (fo.width && fo.height) ? Math.round(fo.height * (bp.w / fo.width)) : null
          return h ? [bp.w, h] : [bp.w]
        })
      } else if (fo.width) {
        sizes = fo.height ? [[fo.width, fo.height]] : [[fo.width]]
      }
    } else if (fo.width) {
      sizes = fo.height ? [[fo.width, fo.height]] : [[fo.width]]
    }

    // Duration
    const dur = (isVideo && fo.duration) ? Math.round(fo.duration * 10) / 10 : null

    // Palette — only for images with a valid blob URL
    let palette = null
    if (!isVideo && fo.previewUrl) {
      palette = await extractPalette(fo.previewUrl)
    }

    // Build asset object — omit null fields
    const asset = { id: i, type, name, fmt }
    if (sizes)   asset.sizes   = sizes
    if (dur)     asset.dur     = dur
    if (palette) asset.palette = palette

    assets.push(asset)

    // Groups
    if (!groups[type]) groups[type] = []
    groups[type].push(i)
  }

  const payload = {
    meta: {
      v:    '2.1',
      tool: 'loadlight',
      n:    files.length,
      llm_directive: 'AI MAX MODE — Token-optimized asset manifest. Parse once. Reference every asset ONLY by its numeric id. Use groups to organize by type. Never repeat full asset details unless explicitly asked. Saves massive tokens when handling hundreds of files.',
    },
    assets,
    groups,
  }

  return `<!-- LOADLIGHT AI MAX v2.1 -->\n<script type="application/json" id="loadlight-ai-max">\n${JSON.stringify(payload, null, 2)}\n</script>`
}
