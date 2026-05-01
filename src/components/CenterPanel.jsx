import React, { useEffect, useRef, useState, useCallback } from 'react'
import useStore, { fmtBytes, getExt, estimateOutputSize } from '../store/useStore'
import { isVideoLike } from '../lib/mediaIngest.js'
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
/**
 * `ownsTimeline={false}`: this `<video>` follows scrub/ play state but does not push duration or
 * currentTime into the parent (split view: short preview vs full-length original).
 */
function VideoPreview({ src, loop, playing, scrubPct, onDuration, onTimeUpdate, isAfter, ownsTimeline = true }) {
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
    if (playing) {
      prevScrub.current = scrubPct
      return
    }
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
      onLoadedMetadata={() => {
        if (!ownsTimeline || !vidRef.current) return
        onDuration(vidRef.current.duration)
      }}
      onTimeUpdate={() => {
        if (!ownsTimeline) return
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
function VideoAfterPlaceholder({ loading, pct, log, error, onEncode, startTime, onStartTimeChange, duration, scrubPct }) {
  const [showRange, setShowRange] = useState(false)
  const fmt = (sec) => {
    const m = Math.floor(sec / 60)
    const s2 = Math.floor(sec % 60)
    return `${m}:${String(s2).padStart(2, '0')}`
  }

  const grabFromScrubber = () => {
    if (duration > 0) {
      const t = Math.floor((scrubPct / 100) * duration)
      onStartTimeChange(t)
    }
  }

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
          {error ? (
            <div className={s.encError}>{error}</div>
          ) : (
            <div className={s.videoAfterHint}>
              Encodes 4s from {fmt(startTime)}
            </div>
          )}

          {/* Range selection */}
          <button
            className={s.rangeToggle}
            onClick={() => setShowRange((v) => !v)}
          >
            {showRange ? '▾ Hide range' : '▸ Choose range'}
          </button>

          {showRange && (
            <div className={s.rangePanel}>
              <div className={s.rangeRow}>
                <label className={s.rangeLabel}>Start at</label>
                <input
                  className={s.rangeInput}
                  type="number"
                  min={0}
                  max={duration > 0 ? Math.floor(duration) : 9999}
                  step={1}
                  value={startTime}
                  onChange={(e) => onStartTimeChange(Number(e.target.value) || 0)}
                />
                <span className={s.rangeSec}>s</span>
              </div>
              {duration > 0 && (
                <button className={s.rangeGrab} onClick={grabFromScrubber}>
                  ⏱ Use scrubber ({fmt(Math.floor((scrubPct / 100) * duration))})
                </button>
              )}
              <div className={s.rangeHint}>
                Preview: {fmt(startTime)} → {fmt(startTime + 4)}
              </div>
            </div>
          )}

          <button className={s.encodeBtn} onClick={onEncode}>
            {error ? 'Retry' : 'Generate Preview'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Wheel zoom + drag pan on the preview surface; resets when `resetKey` changes. */
function ZoomStage({ resetKey, children }) {
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const drag = useRef({ on: false, sx: 0, sy: 0, tx0: 0, ty0: 0 })

  useEffect(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [resetKey])

  const clampPan = useCallback((nextScale, nx, ny) => {
    const el = wrapRef.current
    if (!el || nextScale <= 1) return { x: 0, y: 0 }
    const maxX = ((nextScale - 1) * el.clientWidth) / 2
    const maxY = ((nextScale - 1) * el.clientHeight) / 2
    return {
      x: Math.max(-maxX, Math.min(maxX, nx)),
      y: Math.max(-maxY, Math.min(maxY, ny)),
    }
  }, [])

  const onWheel = (e) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setScale((prev) => {
      const next = Math.min(4, Math.max(1, prev * factor))
      if (next <= 1) {
        setTx(0)
        setTy(0)
      } else {
        const p = clampPan(next, tx, ty)
        setTx(p.x)
        setTy(p.y)
      }
      return next
    })
  }

  const onPointerDown = (e) => {
    if (scale <= 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty }
  }
  const onPointerMove = (e) => {
    if (!drag.current.on) return
    const dx = e.clientX - drag.current.sx
    const dy = e.clientY - drag.current.sy
    const p = clampPan(scale, drag.current.tx0 + dx, drag.current.ty0 + dy)
    setTx(p.x)
    setTy(p.y)
  }
  const endDrag = (e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) {}
    drag.current.on = false
  }

  return (
    <div
      ref={wrapRef}
      className={s.zoomViewport}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className={s.zoomInner}
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }}
      >
        {children}
      </div>
      <div className={s.zoomToolbar}>
        <button type="button" className={s.zoomBtn} title="Zoom out"
          onClick={() => setScale((z) => {
            const n = Math.max(1, z / 1.2)
            if (n <= 1) { setTx(0); setTy(0) }
            return n
          })}>−</button>
        <button type="button" className={s.zoomBtn} title="Zoom in"
          onClick={() => setScale((z) => Math.min(4, z * 1.2))}>+</button>
        <button type="button" className={s.zoomBtn} title="Reset zoom / pan"
          onClick={() => { setScale(1); setTx(0); setTy(0) }}>Fit</button>
      </div>
    </div>
  )
}

// ─── CenterPanel ──────────────────────────────────────────
export default function CenterPanel() {
  const {
    files, activeIdx, viewMode, format, quality,
    loopPlayback, setLoopPlayback,
    previewLoading,
    videoPreviewLoading, videoPreviewPct, videoPreviewLog, videoPreviewError,
    encodeVideoPreview,
    previewStartTime, setPreviewStartTime,
  } = useStore()

  const [playing,  setPlaying]  = useState(false)
  const [scrubPct, setScrubPct] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentT, setCurrentT] = useState(0)

  const timeRaf = useRef(0)
  const pendingFrac = useRef(null)

  const fo      = files[activeIdx]
  const isVideo = !!(fo?.file && isVideoLike(fo.file))
  const ext     = fo ? getExt(fo.file.name) : ''
  const hasVideoPreview = isVideo && !!fo?.afterUrl

  // Reset on file change
  const prevId = useRef(null)
  useEffect(() => {
    if (!fo || fo.id === prevId.current) return
    prevId.current = fo.id
    if (timeRaf.current) cancelAnimationFrame(timeRaf.current)
    timeRaf.current = 0
    pendingFrac.current = null
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

  const handleDuration = useCallback((d) => setDuration(d), [])
  const handleTimeUpdate = useCallback((frac) => {
    pendingFrac.current = frac
    if (timeRaf.current) return
    timeRaf.current = requestAnimationFrame(() => {
      timeRaf.current = 0
      const f = pendingFrac.current
      if (f == null) return
      setCurrentT(f)
      setScrubPct(f * 100)
    })
  }, [])

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
  /** Only one `<video>` may advance scrubber % during play — avoid split-view duel between full clip and short preview. */
  const beforeDrivesTimeline = showBefore && isVideo && viewMode !== 'after'
  const afterDrivesTimeline    = isVideo && viewMode === 'after'

  return (
    <section className={s.panel}>
      <div className={s.previewArea}>

        {/* Before */}
        {showBefore && (
          <div className={s.side}>
            <div className={s.label}>Original</div>
            <ZoomStage resetKey={`${fo?.id || 'none'}-before`}>
              {isVideo
                ? <VideoPreview src={fo?.previewUrl} loop={loopPlayback} playing={playing}
                    scrubPct={scrubPct} onDuration={handleDuration} onTimeUpdate={handleTimeUpdate} isAfter={false}
                    ownsTimeline={beforeDrivesTimeline} />
                : <StaticPreview src={fo?.previewUrl} isAfter={false} />
              }
            </ZoomStage>
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

            <ZoomStage resetKey={`${fo?.id || 'none'}-after`}>
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
                      ownsTimeline={afterDrivesTimeline}
                    />
                  : <VideoAfterPlaceholder
                      loading={videoPreviewLoading}
                      pct={videoPreviewPct}
                      log={videoPreviewLog}
                      error={videoPreviewError}
                      onEncode={encodeVideoPreview}
                      startTime={previewStartTime}
                      onStartTimeChange={setPreviewStartTime}
                      duration={duration}
                      scrubPct={scrubPct}
                    />
              ) : (
                <StaticPreview src={afterUrl} isAfter={true} loading={previewLoading} />
              )}
            </ZoomStage>

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
        <div
          className={`${s.scrubber} ${playing && isVideo ? s.scrubberPlaying : ''}`}
          style={{ opacity: isVideo ? 1 : 0.3, pointerEvents: isVideo ? 'auto' : 'none' }}
          onClick={seekScrubber}
        >
          <div className={s.scrubFill}  style={{ width: scrubPct + '%' }} />
          <div className={s.scrubThumb} style={{ left:  scrubPct + '%' }} />
        </div>
        <span className={s.vcTime}>{isVideo && duration ? `${fmt2(cur)} / ${fmt2(duration)}` : '—'}</span>
        <button className={`${s.loopTag} ${loopPlayback ? s.loopOn : ''}`}
          onClick={() => setLoopPlayback(!loopPlayback)} title="Toggle loop (L)">
          ↻ Loop
        </button>

      </div>
    </section>
  )
}
