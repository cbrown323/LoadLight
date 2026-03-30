/**
 * exportEngine.js — full export pipeline
 * Handles: ZIP bundling, individual file download, poster frames,
 * HTML snippets, AVIF fallback, smart format selection, upscale guard
 */
import JSZip from 'jszip'
import { encodeImage, resolveFormat } from './imageEncoder.js'
import { encodeVideo } from './videoEncoder.js'
import { resolveWithFallback } from './formatSupport.js'

function buildSnippet(baseName, fmt, breakpoints) {
  const ext    = fmt === 'jpeg' ? 'jpg' : fmt
  const sorted = [...breakpoints].sort((a, b) => a.w - b.w)
  const largest = [...breakpoints].sort((a, b) => b.w - a.w)[0]

  if (fmt === 'mp4' || fmt === 'webm' || fmt === 'gif') {
    const lines = ['<video controls playsinline>']
    sorted.forEach((bp) =>
      lines.push(`  <source src="${baseName}-${bp.w}.${ext}" media="(max-width: ${bp.w}px)">`)
    )
    if (largest) lines.push(`  <source src="${baseName}-${largest.w}.${ext}">`)
    lines.push('</video>')
    return lines.join('\n')
  }

  const lines = ['<picture>']
  sorted.forEach((bp) =>
    lines.push(`  <source srcset="${baseName}-${bp.w}.${ext}" media="(max-width: ${bp.w}px)">`)
  )
  if (largest) lines.push(`  <img src="${baseName}-${largest.w}.${ext}" alt="" loading="lazy">`)
  lines.push('</picture>')
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

// Download a single blob immediately
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
    smartFormat       = true,
    breakpointWidths  = [],
    useResponsive     = false,
    resolutionPct     = 100,
    fps               = 0,
    bitrate           = 0,
    generateSnippet   = false,
    generatePoster    = false,
    exportAs          = 'zip',          // 'zip' | 'individual'
    projectName       = 'loadlight-export',
    onFileStart       = () => {},
    onFileProgress    = () => {},
    onFileDone        = () => {},
    onFileError       = () => {},
    onLog             = () => {},
  } = params

  const zip    = new JSZip()
  const widths = useResponsive ? breakpointWidths : []

  for (const fo of files) {
    const { file, id } = fo
    onFileStart(id)

    try {
      const isGif   = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
      const isVideo = file.type.startsWith('video/')

      // Smart format: pick best format for file type if enabled
      let rawFmt = resolveFormat(file, format)
      if (smartFormat && format === 'auto') {
        if (isGif)   rawFmt = 'mp4'
        else if (isVideo) rawFmt = 'mp4'
        else if (file.type === 'image/png' && file.size < 200000) rawFmt = 'png' // keep small PNGs lossless
        else rawFmt = 'webp'
      }

      const resolvedFmt = await resolveWithFallback(rawFmt)
      if (resolvedFmt !== rawFmt)
        onLog(`⚠ ${rawFmt.toUpperCase()} not supported — using ${resolvedFmt.toUpperCase()}`)

      const needsFFmpeg = isVideo || isGif || resolvedFmt === 'mp4' || resolvedFmt === 'webm' || resolvedFmt === 'gif'

      // Filter out breakpoints that would upscale the source
      const srcW          = fo.width || 99999
      const safeWidths    = widths.filter((w) => w <= srcW)
      const skipped       = widths.filter((w) => w >  srcW)
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
        if (exportAs === 'individual') {
          downloadBlob(out.blob, out.filename)
        } else {
          zip.file(out.filename, out.blob)
        }
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

      // HTML snippet
      if (generateSnippet && safeWidths.length > 0) {
        const baseName = file.name.replace(/\.[^.]+$/, '')
        const snippet  = buildSnippet(baseName, resolvedFmt, safeWidths.map((w) => ({ w })))
        const snipName = `${baseName}.html`
        if (exportAs === 'individual') downloadBlob(new Blob([snippet], { type: 'text/html' }), snipName)
        else zip.file(snipName, snippet)
        onLog(`✓ Snippet: ${snipName}`)
      }

      onFileDone({ id, realSizes })
    } catch (err) {
      console.error(`Export failed for ${file.name}:`, err)
      onFileError(id, err)
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
