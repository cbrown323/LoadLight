import React, { useState, useEffect } from 'react'
import useStore, { getExt, qualityZone, isPortrait } from '../store/useStore'
import { getBreakpointsForFile } from '../lib/breakpointPresets.js'
import { buildAiMaxSnippet } from '../lib/aiMaxGenerator.js'
import { isVideoLike } from '../lib/mediaIngest.js'
import { previewStillFormatExt } from '../lib/exportFormatRouting.js'
import Toggle from './Toggle'
import s from './RightPanel.module.css'

const STILL_LABELS = ['Auto ✦', 'WebP', 'AVIF', 'JPG', 'PNG']
const STILL_KEYS   = ['auto', 'webp', 'avif', 'jpg', 'png']
const MOTION_LABELS = ['Auto ✦', 'MP4', 'WebM', 'GIF']
const MOTION_KEYS   = ['auto', 'mp4', 'webm', 'gif']

function Section({ title, action, actionLabel, children }) {
  return (
    <div className={s.section}>
      <div className={s.sectionTitle} style={{textTransform:'none'}}>
        {title}
        {action && <span className={s.sectionAction} onClick={action}>{actionLabel}</span>}
      </div>
      {children}
    </div>
  )
}

// Combined HTML snippet for ALL files (per-file breakpoints match exportEngine)
function buildHtmlSnippet(files, formatStill, formatMotion, breakpoints, responsiveMode, smartFormat) {
  const lines = []

  files.forEach((fo) => {
    const isVideo = isVideoLike(fo.file)
    const name    = fo.file.name.replace(/\.[^.]+$/, '')
    const fmt     = isVideo
      ? (formatMotion === 'auto' ? 'mp4' : formatMotion)
      : previewStillFormatExt(fo.file, formatStill, smartFormat)
    const srcW    = fo.width || 99999

    const bpForFile =
      responsiveMode !== 'none' ? getBreakpointsForFile(fo, responsiveMode, breakpoints) : []
    const safeBps = bpForFile.filter((bp) => bp.w <= srcW).sort((a, b) => a.w - b.w)
    const useFileResponsive = safeBps.length > 0

    if (isVideo) {
      lines.push(`<video controls playsinline>`)
      if (useFileResponsive) {
        const largest = [...safeBps].sort((a, b) => b.w - a.w)[0]
        safeBps.forEach((bp) =>
          lines.push(`  <source src="${name}-${bp.w}.${fmt}" media="(max-width: ${bp.w}px)">`))
        lines.push(`  <source src="${name}-${largest.w}.${fmt}">`)
      } else {
        lines.push(`  <source src="${name}.${fmt}">`)
      }
      lines.push(`</video>`)
    } else {
      if (useFileResponsive) {
        const largest = [...safeBps].sort((a, b) => b.w - a.w)[0]
        lines.push(`<picture>`)
        safeBps.forEach((bp) => {
          lines.push(`  <source srcset="${name}-${bp.w}.${fmt}" media="(max-width: ${bp.w}px)">`)
        })
        lines.push(`  <img src="${name}-${largest.w}.${fmt}" alt="" loading="lazy">`)
        lines.push(`</picture>`)
      } else {
        lines.push(`<img src="${name}.${fmt}" alt="" loading="lazy">`)
      }
    }
  })

  return lines.join('\n')
}

export default function RightPanel() {
  const {
    formatStill, setFormatStill, formatMotion, setFormatMotion,
    quality, setQuality,
    smartFormat, setSmartFormat,
    advResolution, setAdvResolution,
    advBitrate, setAdvBitrate,
    advFps, setAdvFps,
    responsiveMode, setResponsiveMode,
    breakpoints, addBreakpoint, removeBreakpoint,
    generatePoster, setGeneratePoster,
    exportAs, setExportAs,
    generateSnippet, setGenerateSnippet,
    generateAiMax, setGenerateAiMax,
    namingPattern, setNamingPattern,
    showAdvanced, setShowAdvanced,
    files, activeIdx,
  } = useStore()

  const [aiMaxPreview, setAiMaxPreview] = useState('')
  const [aiMaxLoading, setAiMaxLoading] = useState(false)

  const fo      = files[activeIdx]
  const srcW    = fo?.width || 0
  const motion   = fo && isVideoLike(fo.file)
  const fmtPick  = motion ? formatMotion : formatStill
  const outExt   = motion
    ? (fmtPick === 'auto' ? 'mp4' : fmtPick)
    : (fo?.file ? previewStillFormatExt(fo.file, formatStill, smartFormat) : 'webp')
  const zone    = qualityZone(quality)

  // Rebuild AI Max preview whenever toggle turns on or files/settings change
  useEffect(() => {
    if (!generateAiMax || files.length === 0) { setAiMaxPreview(''); return }
    setAiMaxLoading(true)
    buildAiMaxSnippet(files, { formatStill, formatMotion, smartFormat, breakpoints, responsiveMode, withPalette: true })
      .then((s) => { setAiMaxPreview(s); setAiMaxLoading(false) })
      .catch(() => setAiMaxLoading(false))
  }, [generateAiMax, files, formatStill, formatMotion, smartFormat, breakpoints, responsiveMode])

  const htmlSnippet = generateSnippet && files.length > 0
    ? buildHtmlSnippet(files, formatStill, formatMotion, breakpoints, responsiveMode, smartFormat)
    : ''

  const queueHasStill  = files.some((f) => !isVideoLike(f.file))
  const queueHasMotion = files.some((f) => isVideoLike(f.file))
  const showStillFmt   = files.length === 0 || queueHasStill
  const showMotionFmt  = files.length === 0 || queueHasMotion

  function handleAddBreakpoint() {
    const w = window.prompt('Breakpoint width (px):', '1024')
    if (!w || isNaN(parseInt(w))) return
    const name = window.prompt('Label:', 'Custom') || 'Custom'
    addBreakpoint(parseInt(w), name)
  }

  return (
    <aside className={s.panel}>

      {/* ── FORMAT ── */}
      <Section title="Output Format">
        {showStillFmt && (
          <>
            <div className={s.formatSegmentLabel}>Still images</div>
            <div className={s.formatGrid}>
              {STILL_LABELS.map((label, i) => (
                <button key={label}
                  type="button"
                  className={`${s.fmtBtn} ${formatStill === STILL_KEYS[i] ? s.selected : ''}`}
                  onClick={() => setFormatStill(STILL_KEYS[i])}>{label}</button>
              ))}
            </div>
          </>
        )}
        {showMotionFmt && (
          <>
            <div className={s.formatSegmentLabel}>Video / GIF</div>
            <div className={s.formatGrid}>
              {MOTION_LABELS.map((label, i) => (
                <button key={label}
                  type="button"
                  className={`${s.fmtBtn} ${formatMotion === MOTION_KEYS[i] ? s.selected : ''}`}
                  onClick={() => setFormatMotion(MOTION_KEYS[i])}>{label}</button>
              ))}
            </div>
          </>
        )}
        <div className={s.row}>
          <span className={s.toggleLabel}>Smart Format Selection</span>
          <Toggle on={smartFormat} onChange={setSmartFormat} />
        </div>
      </Section>

      {/* ── QUALITY ── */}
      <Section title="Quality"
        action={() => setShowAdvanced(!showAdvanced)}
        actionLabel={showAdvanced ? 'Advanced ▴' : 'Advanced ▾'}>
        <div className={s.qualityLabels}>
          <span>Aggressive</span><span>Optimized</span><span>Balanced</span><span>High</span>
        </div>
        <input type="range" min={0} max={100} step={1} value={quality}
          className={s.qSlider}
          style={{ background: `linear-gradient(to right, var(--cyan) ${quality}%, var(--bg-surface) ${quality}%)` }}
          onChange={(e) => setQuality(Number(e.target.value))} />
        <div className={s.qualityReadout}>
          <span className={s.qValue}>{quality}</span>
          <span className={s.qZone} style={{ color: zone.color, borderColor: zone.color, background: zone.bg }}>
            {zone.label}
          </span>
        </div>
        {showAdvanced && (
          <div className={s.advGrid}>
            <div className={s.advField}><label className={s.advLabel}>Resolution %</label>
              <input className={s.advInput} type="number" value={advResolution} min={10} max={200} onChange={(e) => setAdvResolution(e.target.value)} /></div>
            <div className={s.advField}><label className={s.advLabel}>Bitrate kbps (0=auto)</label>
              <input className={s.advInput} type="number" value={advBitrate} min={0} onChange={(e) => setAdvBitrate(e.target.value)} /></div>
            <div className={s.advField}><label className={s.advLabel}>FPS (0=source)</label>
              <input className={s.advInput} type="number" value={advFps} min={0} max={120} onChange={(e) => setAdvFps(e.target.value)} /></div>
            <div className={s.advField}><label className={s.advLabel}>Color depth</label>
              <input className={s.advInput} type="number" defaultValue={24} /></div>
          </div>
        )}
      </Section>

      {/* ── RESPONSIVE ── */}
      <Section title={
          <span style={{display:'flex',alignItems:'center',gap:6}}>
            Responsive Export
            {fo && isPortrait(fo) && (
              <span style={{fontSize:9,color:'#a78bfa',background:'rgba(167,139,250,0.1)',border:'1px solid rgba(167,139,250,0.3)',borderRadius:3,padding:'1px 5px',fontWeight:400,textTransform:'none',letterSpacing:0}}>
                portrait mode
              </span>
            )}
          </span>
        }>
        <select className={s.respSelect} value={responsiveMode} onChange={(e) => setResponsiveMode(e.target.value)}>
          <option value="none">None</option>
          <option value="standard">Standard Responsive</option>
          <option value="mobile">Mobile First</option>
          <option value="custom">Custom</option>
        </select>
        {responsiveMode !== 'none' && (
          <>
            <div className={s.bpList}>
              {breakpoints.map((bp, i) => {
                const willUpscale = srcW > 0 && bp.w > srcW
                return (
                  <div key={i} className={`${s.bpItem} ${willUpscale ? s.bpWarn : ''}`}>
                    <div className={`${s.bpDot} ${willUpscale ? s.bpDotWarn : ''}`} />
                    <span className={s.bpName}>{bp.name}</span>
                    <span className={s.bpFile}>
                      {(files[activeIdx]?.file.name.replace(/\.[^.]+$/,'') || 'file')}-{bp.w}.{outExt}
                    </span>
                    <span className={s.bpSize}>{bp.w}px {willUpscale && <span className={s.upscaleTag}>↑ skip</span>}</span>
                    <button className={s.bpRemove} onClick={() => removeBreakpoint(i)}>✕</button>
                  </div>
                )
              })}
            </div>
            <button className={s.addBp} onClick={handleAddBreakpoint}>+ Add Breakpoint</button>
          </>
        )}
        <div className={s.row} style={{ marginTop: 10 }}>
          <span className={s.toggleLabel}>Generate poster image</span>
          <Toggle on={generatePoster} onChange={setGeneratePoster} />
        </div>
      </Section>

      {/* ── OUTPUT SETTINGS ── */}
      <Section title="Output Settings">

        {/* Editable naming pattern */}
        <div className={s.outputRow}>
          <span className={s.outputLabel}>Naming pattern</span>
          <input
            className={s.namingInput}
            value={namingPattern}
            onChange={(e) => setNamingPattern(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className={s.outputRow}>
          <span className={s.outputLabel}>Export as</span>
          <select className={s.outputSelect} value={exportAs} onChange={(e) => setExportAs(e.target.value)}>
            <option value="zip">ZIP Archive</option>
            <option value="individual">Individual Files</option>
          </select>
        </div>

        {/* HTML Snippet */}
        <div className={s.row}>
          <span className={s.toggleLabel}>Generate HTML snippet</span>
          <Toggle on={generateSnippet} onChange={setGenerateSnippet} />
        </div>
        {generateSnippet && (
          <pre className={s.snippetPreview}>{htmlSnippet || '<!-- add files to preview -->'}</pre>
        )}

        {/* AI Max */}
        <div className={s.row} style={{ marginTop: 10 }}>
          <span className={s.toggleLabel}>
            AI Max
            <span className={s.aiMaxTooltip} data-tip="Exports a single token-optimized JSON structure for all assets. Schema-mapped rows, responsive sizes as nested arrays, dominant color palettes — designed to minimize LLM token usage when working with large media batches.">?</span>
          </span>
          <Toggle on={generateAiMax} onChange={setGenerateAiMax} />
        </div>
        {generateAiMax && (
          <pre className={s.snippetPreview}>
            {aiMaxLoading ? '// Building AI Max snippet…' : (aiMaxPreview || '<!-- add files to preview -->')}
          </pre>
        )}

      </Section>
    </aside>
  )
}
