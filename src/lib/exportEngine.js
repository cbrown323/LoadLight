/**
 * exportEngine.js — full export pipeline
 * Handles: ZIP/individual download, poster frames, HTML snippet (combined),
 * AI Max snippet (single file for all assets), AVIF fallback, upscale guard
 */
import JSZip from 'jszip'
import { buildAiMaxSnippet } from './aiMaxGenerator.js'
import { encodeImage, resolveFormat } from './imageEncoder.js'
import { encodeVideo } from './videoEncoder.js'
import { resolveWithFallback } from './formatSupport.js'
import { isVideoLike } from './mediaIngest.js'

// ── Combined HTML snippet for ALL files ───────────────────
function buildCombinedSnippet(fileResults, format, breakpointWidths, useResponsive) {
  const lines = []
  fileResults.forEach(({ fo, resolvedFmt, safeWidths }) => {
    const isVideo = isVideoLike(fo.file)
    const name    = fo.file.name.replace(/\.[^.]+$/, '')
    const fmt     = resolvedFmt

    if (isVideo) {
      lines.push('<video controls playsinline>')
      if (useResponsive && safeWidths.length > 0) {
        const sorted = [...safeWidths].sort((a, b) => a - b)
        sorted.forEach((w) => lines.push(`  <source src="${name}-${w}.${fmt}" media="(max-width: ${w}px)">`))
      }
      lines.push(`  <source src="${name}.${fmt}">`)
      lines.push('</video>')
    } else {
      if (useResponsive && safeWidths.length > 0) {
        const sorted  = [...safeWidths].sort((a, b) => a - b)
        const largest = [...safeWidths].sort((a, b) => b - a)[0]
        lines.push('<picture>')
        sorted.forEach((w) => lines.push(`  <source srcset="${name}-${w}.${fmt}" media="(max-width: ${w}px)">`))
        lines.push(`  <img src="${name}-${largest}.${fmt}" alt="" loading="lazy">`)
        lines.push('</picture>')
      } else {
        lines.push(`<img src="${name}.${fmt}" alt="" loading="lazy">`)
      }
    }
  })
  return lines.join('\n')
}

async function extractPosterFrame(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const vid = document.createElement('video')
    vid.src = url; vid.muted = true; vid.playsInline = true; vid.currentTime = 0.5
    vid.onloadeddata = () => {
      const c = document.createElement('canvas')
      c.width = vid.videoWidth; c.height = vid.videoHeight
      c.getContext('2d').drawImage(vid, 0, 0)
      c.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob) }, 'image/jpeg', 0.88)
    }
    vid.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    vid.load()
  })
}

function downloadBlob(blob, filename) {
  const url  = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename
  document.body.appendChild(link); link.click(); document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function runExport(params) {
  const {
    files,
    format,
    quality,
    smartFormat      = true,
    breakpointWidths = [],
    useResponsive    = false,
    resolutionPct    = 100,
    fps              = 0,
    bitrate          = 0,
    generateSnippet  = false,
    generateAiMax    = false,
    generatePoster   = false,
    exportAs         = 'zip',
    projectName      = 'loadlight-export',
    onFileStart      = () => {},
    onFileProgress   = () => {},
    onFileDone       = () => {},
    onFileError      = () => {},
    onLog            = () => {},
  } = params

  const zip        = new JSZip()
  const widths     = useResponsive ? breakpointWidths : []
  const fileResults = []  // collect for combined snippet generation

  for (const fo of files) {
    const { file, id } = fo
    onFileStart(id)

    try {
      const isGif   = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
      const isVideo = isVideoLike(file)

      let rawFmt = resolveFormat(file, format)
      if (smartFormat && format === 'auto') {
        if (isGif || isVideo) rawFmt = 'mp4'
        else if (file.type === 'image/png' && file.size < 200000) rawFmt = 'png'
        else rawFmt = 'webp'
      }

      const resolvedFmt = await resolveWithFallback(rawFmt)
      if (resolvedFmt !== rawFmt)
        onLog(`⚠ ${rawFmt.toUpperCase()} not supported — using ${resolvedFmt.toUpperCase()}`)

      const needsFFmpeg = isVideo || isGif || resolvedFmt === 'mp4' || resolvedFmt === 'webm' || resolvedFmt === 'gif'
      const srcW        = fo.width || 99999
      const safeWidths  = widths.filter((w) => w <= srcW)
      const skipped     = widths.filter((w) => w > srcW)
      if (skipped.length) onLog(`⚠ Skipping ${skipped.join(', ')}px (would upscale ${file.name})`)

      let outputs

      if (needsFFmpeg) {
        outputs = await encodeVideo(file, {
          format: resolvedFmt, quality, widths: safeWidths, fps, bitrate,
          onProgress: (pct) => onFileProgress(id, pct), onLog,
        })
      } else {
        outputs = await encodeImage(file, {
          format: resolvedFmt, quality, widths: safeWidths, resolutionPct,
          onProgress: (pct) => onFileProgress(id, pct),
        })
      }

      const realSizes = []
      for (const out of outputs) {
        if (exportAs === 'individual') downloadBlob(out.blob, out.filename)
        else zip.file(out.filename, out.blob)
        realSizes.push({ filename: out.filename, size: out.blob.size, width: out.width })
      }

      // Poster frame
      if (generatePoster && (isVideo || isGif)) {
        onLog(`Extracting poster for ${file.name}…`)
        const posterBlob = await extractPosterFrame(file)
        if (posterBlob) {
          const posterName = file.name.replace(/\.[^.]+$/, '') + '-poster.jpg'
          if (exportAs === 'individual') downloadBlob(posterBlob, posterName)
          else zip.file(posterName, posterBlob)
          onLog(`✓ Poster: ${posterName}`)
        }
      }

      // Track for combined snippets
      fileResults.push({ fo, resolvedFmt, safeWidths })

      onFileDone({ id, realSizes })
    } catch (err) {
      console.error(`Export failed for ${file.name}:`, err)
      onFileError(id, err)
    }
  }

  // ── Combined HTML snippet — ONE file for all assets ──────
  if (generateSnippet && fileResults.length > 0) {
    onLog('Building HTML snippet…')
    const snippet = buildCombinedSnippet(fileResults, format, breakpointWidths, useResponsive)
    const snipBlob = new Blob([snippet], { type: 'text/html' })
    if (exportAs === 'individual') downloadBlob(snipBlob, 'loadlight-snippet.html')
    else zip.file('loadlight-snippet.html', snippet)
    onLog('✓ Snippet: loadlight-snippet.html')
  }

  // ── AI Max snippet — ONE file for all assets ─────────────
  if (generateAiMax && fileResults.length > 0) {
    onLog('Building AI Max snippet…')
    try {
      const aiSnippet = await buildAiMaxSnippet(files, {
        format,
        breakpoints: breakpointWidths.map((w) => ({ w })),
        responsiveMode: useResponsive ? 'standard' : 'none',
        withPalette: true,
      })
      const aiBlob = new Blob([aiSnippet], { type: 'text/html' })
      if (exportAs === 'individual') downloadBlob(aiBlob, 'loadlight-ai-max.html')
      else zip.file('loadlight-ai-max.html', aiSnippet)
      onLog('✓ AI Max: loadlight-ai-max.html')
    } catch (err) {
      onLog(`⚠ AI Max failed: ${err.message}`)
    }
  }

  if (exportAs === 'zip') {
    onLog('Building ZIP…')
    const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    downloadBlob(zipBlob, `${projectName.replace(/\s+/g, '-').toLowerCase()}-export.zip`)
    onLog(`Done! ZIP: ${(zipBlob.size / 1048576).toFixed(1)} MB`)
    return { zipSize: zipBlob.size }
  }

  onLog('Done! Files downloaded individually.')
  return {}
}
