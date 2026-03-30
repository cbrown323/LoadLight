import React, { useEffect, useRef, useState, useCallback } from 'react'
import useStore, { fmtBytes, getExt, estimateOutputSize } from '../store/useStore'
import s from './CenterPanel.module.css'

// ─── InfoChips ────────────────────────────────────────────
function InfoChips({ res, fmt, size, variant }) {
  const after = variant === 'after'
  return (
    <>
      <div className={s.infoLeft}>
        <span className={`${s.chip} ${after ? s.chipCyan : ''}`}>{res}</span>
        <span className={`${s.chip} ${after ? s.chipCyan : ''}`}>{fmt}</span>
      </div>
      <div className={s.infoRight}>
        <span className={`${s.chip} ${after ? s.chipGreen : ''}`}>{size}</span>
      </div>
    </>
  )
}

// ─── VideoPreview ─────────────────────────────────────────
// Module-scope so React never remounts it on parent re-renders.
function VideoPreview({ src, loop, playing, scrubPct, onDuration, onTimeUpdate, isAfter }) {
  const vidRef    = useRef(null)
  const prevSrc   = useRef(null)
  const isSeeking = useRef(false)

  useEffect(() => {
    const vid = vidRef.current
    if (!vid || src === prevSrc.current) return
    prevSrc.current = src
    vid.src = src
    vid.load()
  }, [src])

  useEffect(() => {
    const vid = vidRef.current
    if (!vid) return
    if (playing) vid.play().catch(() => {})
    else         vid.pause()
  }, [playing])

  useEffect(() => {
    if (vidRef.current) vidRef.current.loop = loop
  }, [loop])

  const prevScrub = useRef(scrubPct)
  useEffect(() => {
    if (playing) return
    if (scrubPct === prevScrub.current) return
    prevScrub.current = scrubPct
    const vid = vidRef.current
    if (!vid || !vid.duration || !isFinite(vid.duration)) return
    isSeeking.current = true
    vid.currentTime = (scrubPct / 100) * vid.duration
  }, [scrubPct, playing])

  return (
    <video
      ref={vidRef}
      muted
      playsInline
      onLoadedMetadata={() => { if (vidRef.current) onDuration(vidRef.current.duration) }}
      onTimeUpdate={() => {
        if (isSeeking.current) { isSeeking.current = false; return }
        const vid = vidRef.current
        if (vid && vid.duration && isFinite(vid.duration)) onTimeUpdate(vid.currentTime / vid.duration)
      }}
      style={{
        maxWidth: '100%', maxHeight: 300, borderRadius: 6, display: 'block', background: '#000',
        border: isAfter ? '1px solid var(--border-cyan)' : '1px solid var(--border)',
        filter: isAfter ? 'saturate(1.08) contrast(1.03)' : 'none',
      }}
    />
  )
}

// ─── StaticPreview ────────────────────────────────────────
function StaticPreview({ src, isAfter, loading }) {
  if (!src) {
    return (
      <div className={s.noPreview}>
        <span className={s.noIcon}>📂</span>
        <span>Select a file to preview</span>
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <img
        src={src} alt=""
        style={{
          maxWidth: '100%', maxHeight: 300, borderRadius: 6, display: 'block',
          border: isAfter ? '1px solid var(--border-cyan)' : '1px solid var(--border)',
          opacity: loading && isAfter ? 0.5 : 1,
          transition: 'opacity 0.2s',
        }}
      />
      {loading && isAfter && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className={s.spinner} />
        </div>
      )}
    </div>
  )
}

// ─── VideoAfterPlaceholder ────────────────────────────────
// Shown in the After panel when no video preview has been encoded yet,
// or while encoding is in progress.
function VideoAfterPlaceholder({ loading, pct, log, onEncode }) {
  return (
    <div className={s.videoAfterWrap}>
      {loading ? (
        <div className={s.videoAfterEncoding}>
          <div className={s.encProgressBar}>
            <div className={s.encProgressFill} style={{ width: pct + '%' }} />
          </div>
          <div className={s.encPct}>{pct}%</div>
          <div className={s.encLog}>{log || 'Encoding preview…'}</div>
        </div>
      ) : (
        <div className={s.videoAfterIdle}>
          <div className={s.videoAfterIcon}>▶</div>
          <div className={s.videoAfterLabel}>Video preview</div>
          <div className={s.videoAfterHint}>Encodes a 4s clip at current settings</div>
          <button className={s.encodeBtn} onClick={onEncode}>
            Generate Preview
          </button>
        </div>
      )}
    </div>
  )
}

// ─── CenterPanel ──────────────────────────────────────────
export default function CenterPanel() {
  const {
    files, activeIdx, viewMode, format, quality,
    loopPlayback, setLoopPlayback,
    previewLoading,
    videoPreviewLoading, videoPreviewPct, videoPreviewLog,
    encodeVideoPreview,
  } = useStore()

  const [playing,  setPlaying]  = useState(false)
  const [scrubPct, setScrubPct] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentT, setCurrentT] = useState(0)

  const fo      = files[activeIdx]
  const isVideo = !!(fo?.file.type.startsWith('video/') || fo?.file.name?.toLowerCase().endsWith('.gif'))
  const ext     = fo ? getExt(fo.file.name) : ''
  const hasVideoPreview = isVideo && !!fo?.afterUrl

  // Reset on file change
  const prevId = useRef(null)
  useEffect(() => {
    if (!fo || fo.id === prevId.current) return
    prevId.current = fo.id
    setPlaying(false); setScrubPct(0); setCurrentT(0); setDuration(0)
  }, [fo])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space')       { e.preventDefault(); if (isVideo) setPlaying((p) => !p) }
      if (e.code === 'ArrowLeft')   { e.preventDefault(); setScrubPct((p) => Math.max(0,   p - 5)) }
      if (e.code === 'ArrowRight')  { e.preventDefault(); setScrubPct((p) => Math.min(100, p + 5)) }
      if (e.code === 'KeyL') setLoopPlayback(!loopPlayback)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isVideo, loopPlayback, setLoopPlayback])

  const handleDuration   = useCallback((d)    => setDuration(d), [])
  const handleTimeUpdate = useCallback((frac) => { setCurrentT(frac); setScrubPct(frac * 100) }, [])

  function seekScrubber(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    setScrubPct(pct); setCurrentT(pct / 100)
  }

  const outFmt   = format === 'auto' ? (isVideo ? 'MP4' : 'WebP') : format.toUpperCase()
  const outSize  = fo?.afterSize ?? (fo ? estimateOutputSize(fo.file, quality) : 0)
  const savings  = fo ? Math.round((1 - outSize / fo.file.size) * 100) : 0
  const afterUrl = fo?.afterUrl ?? fo?.previewUrl
  const res      = fo?.width && fo?.height ? `${fo.width}×${fo.height}` : '—'
  const cur      = duration ? duration * currentT : 0
  const fmt2     = (n) => { const t = Math.floor(n); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') }

  const showBefore = viewMode === 'before' || viewMode === 'split'
  const showAfter  = viewMode === 'after'  || viewMode === 'split'

  return (
    <section className={s.panel}>
      <div className={s.previewArea}>

        {/* Before */}
        {showBefore && (
          <div className={s.side}>
            <div className={s.label}>Original</div>
            {isVideo
              ? <VideoPreview src={fo?.previewUrl} loop={loopPlayback} playing={playing}
                  scrubPct={scrubPct} onDuration={handleDuration} onTimeUpdate={handleTimeUpdate} isAfter={false} />
              : <StaticPreview src={fo?.previewUrl} isAfter={false} />
            }
            {fo && <InfoChips res={res} fmt={ext.toUpperCase()} size={fmtBytes(fo.file.size)} variant="before" />}
          </div>
        )}

        {viewMode === 'split' && <div className={s.divider} />}

        {/* After */}
        {showAfter && (
          <div className={s.side}>
            <div className={`${s.label} ${s.labelCyan}`}>
              {outFmt} · {hasVideoPreview ? '4s Preview' : 'Optimized'}
            </div>

            {isVideo ? (
              hasVideoPreview
                ? <VideoPreview
                    src={fo.afterUrl}
                    loop={loopPlayback}
                    playing={playing}
                    scrubPct={scrubPct}
                    onDuration={handleDuration}
                    onTimeUpdate={handleTimeUpdate}
                    isAfter={true}
                  />
                : <VideoAfterPlaceholder
                    loading={videoPreviewLoading}
                    pct={videoPreviewPct}
                    log={videoPreviewLog}
                    onEncode={encodeVideoPreview}
                  />
            ) : (
              <StaticPreview src={afterUrl} isAfter={true} loading={previewLoading} />
            )}

            {fo && (
              <InfoChips
                res={res}
                fmt={outFmt}
                size={hasVideoPreview ? `${fmtBytes(outSize)} · −${savings}%` : (fo ? `${fmtBytes(outSize)} · est.` : '—')}
                variant="after"
              />
            )}

            {/* Re-encode button shown after a preview exists */}
            {hasVideoPreview && !videoPreviewLoading && (
              <button className={s.reEncodeBtn} onClick={encodeVideoPreview} title="Re-encode preview with current settings">
                ↺ Re-encode
              </button>
            )}
          </div>
        )}

        {!fo && (
          <div className={s.emptyCenter}>
            <span className={s.noIcon}>🖼</span>
            <span>Add files to begin</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className={s.controls}>
        <button className={`${s.vcBtn} ${playing ? s.playActive : ''}`}
          onClick={() => setPlaying((p) => !p)} disabled={!isVideo}>
          {playing ? '⏸' : '▶'}
        </button>
        <button className={s.vcBtn}
          onClick={() => { setScrubPct(0); setCurrentT(0); setPlaying(false) }} disabled={!isVideo}>
          ⏮
        </button>
        <div className={s.scrubber}
          style={{ opacity: isVideo ? 1 : 0.3, pointerEvents: isVideo ? 'auto' : 'none' }}
          onClick={seekScrubber}>
          <div className={s.scrubFill}  style={{ width: scrubPct + '%' }} />
          <div className={s.scrubThumb} style={{ left:  scrubPct + '%' }} />
        </div>
        <span className={s.vcTime}>{isVideo && duration ? `${fmt2(cur)} / ${fmt2(duration)}` : '—'}</span>
        <button className={`${s.loopTag} ${loopPlayback ? s.loopOn : ''}`}
          onClick={() => setLoopPlayback(!loopPlayback)} title="Toggle loop (L)">
          ↻ Loop
        </button>
        <span className={s.kbHint} title="Space: play/pause · ←→: seek · L: loop">⌨</span>
      </div>
    </section>
  )
}
