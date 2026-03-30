import React from 'react'
import useStore, { getExt, qualityZone } from '../store/useStore'
import Toggle from './Toggle'
import s from './RightPanel.module.css'

const FORMATS    = ['Auto ✦', 'WebP', 'AVIF', 'JPG', 'PNG', 'MP4', 'WebM', 'GIF']
const FORMAT_KEYS = ['auto', 'webp', 'avif', 'jpg', 'png', 'mp4', 'webm', 'gif']

function Section({ title, action, actionLabel, children }) {
  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>
        {title}
        {action && <span className={s.sectionAction} onClick={action}>{actionLabel}</span>}
      </div>
      {children}
    </div>
  )
}

export default function RightPanel() {
  const {
    format, setFormat,
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
    showAdvanced, setShowAdvanced,
    files, activeIdx,
  } = useStore()

  const fo       = files[activeIdx]
  const baseName = fo ? fo.file.name.replace(/\.[^.]+$/, '') : 'file'
  const srcW     = fo?.width || 0
  const outExt   = format === 'auto' ? 'webp' : format
  const zone     = qualityZone(quality)

  function buildSnippet() {
    const sorted  = [...breakpoints].sort((a, b) => a.w - b.w)
    const largest = [...breakpoints].sort((a, b) => b.w - a.w)[0]
    const lines   = ['<picture>']
    sorted.forEach((bp) => {
      lines.push(`  <source srcset="${baseName}-${bp.w}.${outExt}"`)
      lines.push(`          media="(max-width: ${bp.w}px)">`)
    })
    if (largest) lines.push(`  <img src="${baseName}-${largest.w}.${outExt}" alt="">`)
    lines.push('</picture>')
    return lines.join('\n')
  }

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
        <div className={s.formatGrid}>
          {FORMATS.map((label, i) => (
            <button
              key={label}
              className={`${s.fmtBtn} ${format === FORMAT_KEYS[i] ? s.selected : ''}`}
              onClick={() => setFormat(FORMAT_KEYS[i])}
            >{label}</button>
          ))}
        </div>
        <div className={s.row}>
          <span className={s.toggleLabel}>Smart Format Selection</span>
          <Toggle on={smartFormat} onChange={setSmartFormat} />
        </div>
      </Section>

      {/* ── QUALITY ── */}
      <Section
        title="Quality"
        action={() => setShowAdvanced(!showAdvanced)}
        actionLabel={showAdvanced ? 'Advanced ▴' : 'Advanced ▾'}
      >
        <div className={s.qualityLabels}>
          <span>Aggressive</span><span>Optimized</span><span>Balanced</span><span>High</span>
        </div>
        <input
          type="range" min={0} max={100} step={1} value={quality}
          className={s.qSlider}
          style={{ background: `linear-gradient(to right, var(--cyan) ${quality}%, var(--bg-surface) ${quality}%)` }}
          onChange={(e) => setQuality(Number(e.target.value))}
        />
        <div className={s.qualityReadout}>
          <span className={s.qValue}>{quality}</span>
          <span className={s.qZone} style={{ color: zone.color, borderColor: zone.color, background: zone.bg }}>
            {zone.label}
          </span>
        </div>

        {showAdvanced && (
          <div className={s.advGrid}>
            <div className={s.advField}>
              <label className={s.advLabel}>Resolution %</label>
              <input className={s.advInput} type="number" value={advResolution} min={10} max={200} onChange={(e) => setAdvResolution(e.target.value)} />
            </div>
            <div className={s.advField}>
              <label className={s.advLabel}>Bitrate kbps (0=auto)</label>
              <input className={s.advInput} type="number" value={advBitrate} min={0} onChange={(e) => setAdvBitrate(e.target.value)} />
            </div>
            <div className={s.advField}>
              <label className={s.advLabel}>FPS (0=source)</label>
              <input className={s.advInput} type="number" value={advFps} min={0} max={120} onChange={(e) => setAdvFps(e.target.value)} />
            </div>
            <div className={s.advField}>
              <label className={s.advLabel}>Color depth</label>
              <input className={s.advInput} type="number" defaultValue={24} />
            </div>
          </div>
        )}
      </Section>

      {/* ── RESPONSIVE ── */}
      <Section title="Responsive Export">
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
                    <span className={s.bpFile}>{baseName}-{bp.w}.{outExt}</span>
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
        <div className={s.outputRow}>
          <span className={s.outputLabel}>Naming pattern</span>
          <code className={s.outputCode}>{'{name}-{width}.{ext}'}</code>
        </div>
        <div className={s.outputRow}>
          <span className={s.outputLabel}>Export as</span>
          <select className={s.outputSelect} value={exportAs} onChange={(e) => setExportAs(e.target.value)}>
            <option value="zip">ZIP Archive</option>
            <option value="individual">Individual Files</option>
          </select>
        </div>
        <div className={s.row}>
          <span className={s.toggleLabel}>Generate HTML snippet</span>
          <Toggle on={generateSnippet} onChange={setGenerateSnippet} />
        </div>
        {generateSnippet && <pre className={s.snippetPreview}>{buildSnippet()}</pre>}
      </Section>

    </aside>
  )
}
