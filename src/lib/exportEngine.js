/**
 * exportEngine.js — full export pipeline
 * Handles: ZIP/individual download, poster frames, HTML snippet (combined),
 * AI Max snippet (single file for all assets), AVIF fallback, upscale guard
 */
import JSZip from 'jszip'
import { createContactSheet } from './contactSheet.js'
import { canvasToJpeg, extractVideoPoster } from './mediaInspector.js'
import { timeToFrameIndex } from './sequencePreview.js'
import { getBreakpointsForFile } from './breakpointPresets.js'
import { buildAiMaxSnippet } from './aiMaxGenerator.js'
import { encodeImage } from './imageEncoder.js'
import { encodeVideo } from './videoEncoder.js'
import { resolveWithFallback } from './formatSupport.js'
import { isVideoLike, isImageSequence, isMotionAsset } from './mediaIngest.js'
import { pickExportPipeline, resolveExportRawFormat } from './exportFormatRouting.js'
import { encodeImageSequence } from './sequenceEncoder.js'

// ── Combined HTML snippet for ALL files ───────────────────
function buildCombinedSnippet(fileResults, useResponsive) {
  const lines = []
  fileResults.forEach(({ fo, resolvedFmt, safeWidths }) => {
    const motion = isMotionAsset(fo)
    const name   = fo.sequenceBaseName || fo.file.name.replace(/\.[^.]+$/, '')
    const fmt    = resolvedFmt

    if (motion) {
      lines.push('<video controls playsinline>')
      if (useResponsive && safeWidths.length > 0) {
        const sorted = [...safeWidths].sort((a, b) => a - b)
        const largest = [...safeWidths].sort((a, b) => b - a)[0]
        sorted.forEach((w) => lines.push(`  <source src="${name}-${w}.${fmt}" media="(max-width: ${w}px)">`))
        lines.push(`  <source src="${name}-${largest}.${fmt}">`)
      } else {
        lines.push(`  <source src="${name}.${fmt}">`)
      }
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

async function frameFileToPoster(file) {
  const url = URL.createObjectURL(file)
  const img = new Image()
  let timer
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Poster image decoding timed out.')), 30000)
      img.onload = resolve
      img.onerror = () => reject(new Error('Could not decode the selected sequence frame.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d').drawImage(img, 0, 0)
    return await canvasToJpeg(canvas)
  } finally {
    clearTimeout(timer)
    img.onload = null
    img.onerror = null
    img.src = ''
    URL.revokeObjectURL(url)
  }
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
    formatStill,
    formatMotion,
    quality,
    smartFormat      = true,
    breakpoints      = [],
    responsiveMode   = 'none',
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

  const zip         = new JSZip()
  const fileResults = []  // collect for combined snippet generation

  for (const fo of files) {
    const { file, id } = fo
    onFileStart(id)

    try {
      const isGif   = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
      const isVideo = isVideoLike(file) && !isImageSequence(fo)
      const isSeq   = isImageSequence(fo)

      const rawFmt = resolveExportRawFormat(file, formatStill, formatMotion, smartFormat, fo)

      let resolvedFmt = await resolveWithFallback(rawFmt)
      if (resolvedFmt !== rawFmt)
        onLog(`⚠ ${rawFmt.toUpperCase()} not supported — using ${resolvedFmt.toUpperCase()}`)

      const { resolvedFmt: safeFmt, useVideoPipeline } = pickExportPipeline(file, resolvedFmt, onLog, fo)
      const srcW        = fo.width || 99999
      const bpForFile   = getBreakpointsForFile(fo, responsiveMode, breakpoints)
      const widths      = bpForFile.map((bp) => bp.w)
      const safeWidths  = widths.filter((w) => w <= srcW)
      const skipped     = widths.filter((w) => w > srcW)
      if (skipped.length)
        onLog(`⚠ ${file.name}: skipping ${skipped.join(', ')}px (would upscale)`)

      const labelWidthsInFilename = useResponsive && safeWidths.length > 0

      let outputs

      if (isSeq) {
        const seqFps = fo.fps || fps || 24
        outputs = await encodeImageSequence(fo, {
          format: safeFmt, quality, widths: safeWidths, fps: seqFps, bitrate,
          labelWidthsInFilename,
          onProgress: (pct) => onFileProgress(id, pct), onLog,
        })
      } else if (useVideoPipeline) {
        outputs = await encodeVideo(file, {
          audioTrack: fo.audioTrack ?? 'auto',
          format: safeFmt, quality, widths: safeWidths, fps, bitrate,
          labelWidthsInFilename,
          onProgress: (pct) => onFileProgress(id, pct), onLog,
        })
      } else {
        outputs = await encodeImage(file, {
          format: safeFmt, quality, widths: safeWidths, resolutionPct,
          labelWidthsInFilename,
          onProgress: (pct) => onFileProgress(id, pct),
          onLog,
        })
      }

      const realSizes = []
      for (const out of outputs) {
        if (exportAs === 'individual') downloadBlob(out.blob, out.filename)
        else zip.file(out.filename, out.blob)
        realSizes.push({ filename: out.filename, size: out.blob.size, width: out.width })
      }

      // Poster frame
      if (generatePoster && (isVideo || isGif || isSeq)) {
        onLog(`Extracting poster for ${isSeq ? fo.sequenceBaseName : file.name}…`)
        try {
          const posterTime = fo.posterTime ?? 0
          const frameIndex = isSeq ? timeToFrameIndex(posterTime, fo.fps || 24, fo.frames?.length || 0) : 0
          const result = isSeq && fo.frames?.[frameIndex]
            ? { blob: await frameFileToPoster(fo.frames[frameIndex].file), timestamp: frameIndex / (fo.fps || 24) }
            : await extractVideoPoster(file, posterTime)
          if (!result.blob) throw new Error('Could not decode the selected poster frame.')
          const posterName = (isSeq ? fo.sequenceBaseName : file.name.replace(/\.[^.]+$/, '')) + '-poster.jpg'
          if (exportAs === 'individual') downloadBlob(result.blob, posterName)
          else zip.file(posterName, result.blob)
          onLog(`✓ Poster: ${posterName} (frame at ${result.timestamp.toFixed(3)} s)`)
        } catch (err) {
          onLog(`⚠ Poster skipped for ${file.name}: ${err.message}`)
        }
      }

      if (fo.contactSheet && isVideo) {
        try {
          onLog(`Creating contact sheet for ${file.name}…`)
          const sheet = await createContactSheet(file)
          const sheetName = `${file.name.replace(/\.[^.]+$/, '')}-contact-sheet.jpg`
          if (exportAs === 'individual') downloadBlob(sheet.blob, sheetName)
          else zip.file(sheetName, sheet.blob)
          onLog(`✓ Contact sheet: ${sheetName}`)
        } catch (err) {
          onLog(`⚠ Contact sheet skipped for ${file.name}: ${err.message}`)
        }
      }

      // Track for combined snippets
      fileResults.push({ fo, resolvedFmt: safeFmt, safeWidths })

      onFileDone({ id, realSizes })
    } catch (err) {
      console.error(`Export failed for ${file.name}:`, err)
      onFileError(id, err)
    }
  }

  // ── Combined HTML snippet — ONE file for all assets ──────
  if (generateSnippet && fileResults.length > 0) {
    onLog('Building HTML snippet…')
    const snippet = buildCombinedSnippet(fileResults, useResponsive)
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
        formatStill,
        formatMotion,
        smartFormat,
        breakpoints,
        responsiveMode: useResponsive ? responsiveMode : 'none',
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
