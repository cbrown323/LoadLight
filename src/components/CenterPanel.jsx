import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import useStore, { fmtBytes, getExt, estimateOutputSize } from '../store/useStore'
import { isVideoLike, isImageSequence, isMotionAsset } from '../lib/mediaIngest.js'
import { previewStillFormatExt } from '../lib/exportFormatRouting.js'
import {
  getSequenceFrameUrl,
  revokeSequencePreview,
  scrubPctToFrameIndex,
  sequenceDuration,
  frameIndexToTime,
  timeToFrameIndex,
} from '../lib/sequencePreview.js'
import {
  ZOOM_STEP,
  WHEEL_ZOOM_FACTOR,
  computeFitScale,
  computeTotalScale,
  computePanBounds,
  clampPan,
  panEnabled,
  effectiveZoomMax,
  stepUserZoom,
  formatZoomLabel,
  panForZoomAtCursor,
} from '../lib/canvasViewport.js'
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
function VideoPreview({ src, loop, playing, scrubPct, onDuration, onTimeUpdate, onNaturalSize, isAfter, ownsTimeline = true }) {
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
      className={`${s.zoomMedia} ${isAfter ? s.zoomMediaAfter : s.zoomMediaBefore}`}
      muted
      playsInline
      onLoadedMetadata={() => {
        const vid = vidRef.current
        if (!vid) return
        if (vid.videoWidth > 0 && vid.videoHeight > 0) {
          onNaturalSize?.(vid.videoWidth, vid.videoHeight)
        }
        if (!ownsTimeline) return
        onDuration(vid.duration)
      }}
      onTimeUpdate={() => {
        if (!ownsTimeline) return
        if (isSeeking.current) { isSeeking.current = false; return }
        const vid = vidRef.current
        if (vid && vid.duration && isFinite(vid.duration)) onTimeUpdate(vid.currentTime / vid.duration)
      }}
    />
  )
}

// ─── SequencePreview ──────────────────────────────────────
function SequencePreview({ fo, scrubPct, playing, loop, onDuration, onTimeUpdate, onEnded, isAfter }) {
  const ownerId = `${fo.id}-${isAfter ? 'after' : 'before'}`
  const frames = fo.frames || []
  const fps = fo.fps || 24
  const [src, setSrc] = useState(null)
  const currentT = useRef(0)
  const tickRef = useRef(0)

  const duration = sequenceDuration(frames.length, fps)

  useEffect(() => {
    onDuration?.(duration)
  }, [duration, onDuration])

  useEffect(() => () => revokeSequencePreview(ownerId), [ownerId])

  const showFrameAtTime = useCallback((t) => {
    if (!frames.length) return
    const idx = timeToFrameIndex(t, fps, frames.length)
    setSrc(getSequenceFrameUrl(ownerId, frames, idx))
    onTimeUpdate?.(duration > 0 ? Math.min(1, t / duration) : 0)
  }, [frames, fps, ownerId, duration, onTimeUpdate])

  useEffect(() => {
    if (playing) return
    const idx = scrubPctToFrameIndex(scrubPct, frames.length)
    const t = frameIndexToTime(idx, fps)
    currentT.current = t
    showFrameAtTime(t)
  }, [scrubPct, playing, frames, fps, showFrameAtTime])

  useEffect(() => {
    if (!playing || !frames.length || duration <= 0) return

    tickRef.current = window.setInterval(() => {
      let t = currentT.current + 1 / fps
      if (t >= duration) {
        if (loop) t = 0
        else {
          t = Math.max(0, duration - 1 / fps)
          currentT.current = t
          showFrameAtTime(t)
          onEnded?.()
          return
        }
      }
      currentT.current = t
      showFrameAtTime(t)
    }, 1000 / fps)

    return () => clearInterval(tickRef.current)
  }, [playing, loop, frames.length, fps, duration, showFrameAtTime, onEnded])

  if (!frames.length) {
    return (
      <div className={s.noPreview}>
        <span className={s.noIcon}>🎞</span>
        <span>Empty sequence</span>
      </div>
    )
  }

  if (!src) {
    return (
      <div className={s.noPreview}>
        <span className={s.noIcon}>🎞</span>
        <span>Loading sequence…</span>
      </div>
    )
  }

  return (
    <div className={s.zoomMediaFrame}>
      <img
        src={src}
        alt=""
        className={`${s.zoomMedia} ${isAfter ? s.zoomMediaAfter : s.zoomMediaBefore}`}
      />
    </div>
  )
}

// ─── StaticPreview ────────────────────────────────────────
function StaticPreview({ src, isAfter, loading, onNaturalSize }) {
  if (!src) {
    return (
      <div className={s.noPreview}>
        <span className={s.noIcon}>📂</span>
        <span>Select a file to preview</span>
      </div>
    )
  }
  return (
    <div className={s.zoomMediaFrame}>
      <img
        src={src}
        alt=""
        className={`${s.zoomMedia} ${isAfter ? s.zoomMediaAfter : s.zoomMediaBefore}`}
        style={{ opacity: loading && isAfter ? 0.5 : 1 }}
        onLoad={(e) => {
          const img = e.currentTarget
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            onNaturalSize?.(img.naturalWidth, img.naturalHeight)
          }
        }}
      />
      {loading && isAfter && (
        <div className={s.zoomMediaSpinner}>
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

/** Fit-based zoom + pan; 100% = contain in viewport. Resets when `resetKey` changes. */
function ZoomStage({ resetKey, mediaWidth = 0, mediaHeight = 0, zoomable = true, children }) {
  const wrapRef = useRef(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [measured, setMeasured] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ userZoom: 1, panX: 0, panY: 0 })
  const drag = useRef({ on: false, sx: 0, sy: 0, panX0: 0, panY0: 0, bounds: null })
  const pendingPan = useRef(null)
  const panRaf = useRef(0)

  const mediaW = mediaWidth || measured.width
  const mediaH = mediaHeight || measured.height
  const hasMedia = zoomable && mediaW > 0 && mediaH > 0

  const metrics = useMemo(() => {
    const { width: vpW, height: vpH } = viewport
    if (!hasMedia) {
      return { fitScale: 1, maxZoom: 1, totalScale: 1, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } }
    }
    const fitScale = computeFitScale(vpW, vpH, mediaW, mediaH)
    const maxZoom = effectiveZoomMax(vpW, vpH, mediaW, mediaH)
    const totalScale = computeTotalScale(fitScale, view.userZoom)
    const bounds = computePanBounds(vpW, vpH, mediaW, mediaH, totalScale)
    return { fitScale, maxZoom, totalScale, bounds }
  }, [hasMedia, viewport, mediaW, mediaH, view.userZoom])

  useEffect(() => {
    setMeasured({ width: 0, height: 0 })
    setView({ userZoom: 1, panX: 0, panY: 0 })
  }, [resetKey])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setViewport({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => {
    if (panRaf.current) cancelAnimationFrame(panRaf.current)
  }, [])

  useEffect(() => {
    if (!hasMedia) return
    const { width: vpW, height: vpH } = viewport
    setView((v) => {
      if (v.userZoom <= 1) {
        return v.panX === 0 && v.panY === 0 ? v : { ...v, panX: 0, panY: 0 }
      }
      const fitScale = computeFitScale(vpW, vpH, mediaW, mediaH)
      const totalScale = computeTotalScale(fitScale, v.userZoom)
      const bounds = computePanBounds(vpW, vpH, mediaW, mediaH, totalScale)
      const p = clampPan(v.panX, v.panY, bounds)
      return p.x === v.panX && p.y === v.panY ? v : { ...v, panX: p.x, panY: p.y }
    })
  }, [hasMedia, viewport.width, viewport.height, mediaW, mediaH, view.userZoom])

  const applyZoom = useCallback((factor, cursorX = 0, cursorY = 0) => {
    if (!hasMedia) return
    const { width: vpW, height: vpH } = viewport
    setView((prev) => {
      const fitScale = computeFitScale(vpW, vpH, mediaW, mediaH)
      const maxZoom = effectiveZoomMax(vpW, vpH, mediaW, mediaH)
      const oldTotal = computeTotalScale(fitScale, prev.userZoom)
      const nextZoom = stepUserZoom(prev.userZoom, factor, maxZoom)
      if (nextZoom <= 1) {
        return { userZoom: nextZoom, panX: 0, panY: 0 }
      }
      const newTotal = computeTotalScale(fitScale, nextZoom)
      const moved = panForZoomAtCursor(prev.panX, prev.panY, oldTotal, newTotal, cursorX, cursorY)
      const p = clampPan(moved.x, moved.y, computePanBounds(vpW, vpH, mediaW, mediaH, newTotal))
      return { userZoom: nextZoom, panX: p.x, panY: p.y }
    })
  }, [hasMedia, viewport, mediaW, mediaH])

  const onWheel = (e) => {
    if (!hasMedia) return
    e.preventDefault()
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const cursorX = e.clientX - rect.left - rect.width / 2
    const cursorY = e.clientY - rect.top - rect.height / 2
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR
    applyZoom(factor, cursorX, cursorY)
  }

  const onPointerDown = (e) => {
    if (!hasMedia || !panEnabled(metrics.bounds)) return
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      on: true,
      sx: e.clientX,
      sy: e.clientY,
      panX0: view.panX,
      panY0: view.panY,
      bounds: metrics.bounds,
    }
  }

  const onPointerMove = (e) => {
    if (!drag.current.on) return
    e.preventDefault()
    const dx = e.clientX - drag.current.sx
    const dy = e.clientY - drag.current.sy
    const p = clampPan(drag.current.panX0 + dx, drag.current.panY0 + dy, drag.current.bounds)
    pendingPan.current = p
    if (panRaf.current) return
    panRaf.current = requestAnimationFrame(() => {
      panRaf.current = 0
      const nextPan = pendingPan.current
      pendingPan.current = null
      if (nextPan) setView((v) => ({ ...v, panX: nextPan.x, panY: nextPan.y }))
    })
  }

  const endDrag = (e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) {}
    drag.current.on = false
    if (panRaf.current) {
      cancelAnimationFrame(panRaf.current)
      panRaf.current = 0
    }
    const nextPan = pendingPan.current
    pendingPan.current = null
    if (nextPan) setView((v) => ({ ...v, panX: nextPan.x, panY: nextPan.y }))
  }

  const fitToCanvas = () => setView({ userZoom: 1, panX: 0, panY: 0 })

  const onNaturalSize = useCallback((w, h) => {
    setMeasured({ width: w, height: h })
  }, [])

  const child = React.Children.only(children)
  const previewChild = React.isValidElement(child)
    ? React.cloneElement(child, { onNaturalSize })
    : child

  const canPan = hasMedia && panEnabled(metrics.bounds)
  const viewportClass = `${s.zoomViewport} ${canPan ? s.zoomViewportPan : s.zoomViewportIdle}`

  return (
    <div ref={wrapRef} className={viewportClass}>
      <div
        className={s.zoomSurface}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragStart={(e) => e.preventDefault()}
      >
        <div
          className={s.zoomInner}
          style={{
            width: hasMedia ? mediaW : undefined,
            height: hasMedia ? mediaH : undefined,
            transform: hasMedia
              ? `translate(${view.panX}px, ${view.panY}px) scale(${metrics.totalScale})`
              : undefined,
          }}
        >
          {previewChild}
        </div>
      </div>
      {hasMedia && (
        <div className={s.zoomToolbar}>
          <button
            type="button"
            className={s.zoomBtn}
            title="Zoom out"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => applyZoom(1 / ZOOM_STEP)}
          >
            −
          </button>
          <span className={s.zoomLabel}>{formatZoomLabel(view.userZoom)}</span>
          <button
            type="button"
            className={s.zoomBtn}
            title="Zoom in"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => applyZoom(ZOOM_STEP)}
          >
            +
          </button>
          <button
            type="button"
            className={s.zoomBtn}
            title="Fit to canvas"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={fitToCanvas}
          >
            Fit
          </button>
        </div>
      )}
    </div>
  )
}

// ─── CenterPanel ──────────────────────────────────────────
export default function CenterPanel() {
  const {
    files, activeIdx, viewMode, formatStill, formatMotion, smartFormat, quality,
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

  const fo         = files[activeIdx]
  const isSequence = isImageSequence(fo)
  const isVideo    = !!(fo?.file && isVideoLike(fo.file) && !isSequence)
  const isMotion   = isMotionAsset(fo)
  const ext        = fo ? getExt(fo.file.name) : ''
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
      if (e.code === 'Space')       { e.preventDefault(); if (isMotion) setPlaying((p) => !p) }
      if (e.code === 'ArrowLeft')   { e.preventDefault(); setScrubPct((p) => Math.max(0,   p - 5)) }
      if (e.code === 'ArrowRight')  { e.preventDefault(); setScrubPct((p) => Math.min(100, p + 5)) }
      if (e.code === 'KeyL') setLoopPlayback(!loopPlayback)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMotion, loopPlayback, setLoopPlayback])

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

  const fmtPick  = isMotion ? formatMotion : formatStill
  const outFmt   = isMotion
    ? (fmtPick === 'auto' ? 'MP4' : fmtPick.toUpperCase())
    : (fo?.file ? previewStillFormatExt(fo.file, formatStill, smartFormat) : 'webp').toUpperCase()
  const outSize  = fo?.afterSize ?? (fo ? estimateOutputSize(fo.file, quality) : 0)
  const savings  = fo ? Math.round((1 - outSize / fo.file.size) * 100) : 0
  const afterUrl = fo?.afterUrl ?? fo?.previewUrl
  const res      = fo?.width && fo?.height ? `${fo.width}×${fo.height}` : '—'
  const cur      = duration ? duration * currentT : 0
  const fmt2     = (n) => { const t = Math.floor(n); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') }

  const showBefore = viewMode === 'before' || viewMode === 'split'
  const showAfter  = viewMode === 'after'  || viewMode === 'split'
  const beforeDrivesTimeline = showBefore && isMotion && viewMode !== 'after'
  const afterDrivesTimeline    = isVideo && viewMode === 'after'

  const renderBeforePreview = () => {
    if (isSequence) {
      return (
        <SequencePreview
          fo={fo}
          loop={loopPlayback}
          playing={playing}
          scrubPct={scrubPct}
          onDuration={handleDuration}
          onTimeUpdate={beforeDrivesTimeline ? handleTimeUpdate : undefined}
          onEnded={() => setPlaying(false)}
          isAfter={false}
        />
      )
    }
    if (isVideo) {
      return (
        <VideoPreview src={fo?.previewUrl} loop={loopPlayback} playing={playing}
          scrubPct={scrubPct} onDuration={handleDuration} onTimeUpdate={handleTimeUpdate} isAfter={false}
          ownsTimeline={beforeDrivesTimeline} />
      )
    }
    return <StaticPreview src={fo?.previewUrl} isAfter={false} />
  }

  return (
    <section className={s.panel}>
      <div className={s.previewArea}>

        {/* Before */}
        {showBefore && (
          <div className={s.side}>
            <div className={s.label}>Original</div>
            <ZoomStage
              resetKey={`${fo?.id || 'none'}-before`}
              mediaWidth={fo?.width ?? 0}
              mediaHeight={fo?.height ?? 0}
              zoomable={!!fo}
            >
              {renderBeforePreview()}
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

            <ZoomStage
              resetKey={`${fo?.id || 'none'}-after`}
              mediaWidth={fo?.width ?? 0}
              mediaHeight={fo?.height ?? 0}
              zoomable={isVideo ? hasVideoPreview : !!(fo && afterUrl)}
            >
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
              ) : isSequence ? (
                <StaticPreview src={afterUrl} isAfter={true} loading={previewLoading} />
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
          onClick={() => setPlaying((p) => !p)} disabled={!isMotion}>
          {playing ? '⏸' : '▶'}
        </button>
        <button className={s.vcBtn}
          onClick={() => { setScrubPct(0); setCurrentT(0); setPlaying(false) }} disabled={!isMotion}>
          ⏮
        </button>
        <div
          className={`${s.scrubber} ${playing && isMotion ? s.scrubberPlaying : ''}`}
          style={{ opacity: isMotion ? 1 : 0.3, pointerEvents: isMotion ? 'auto' : 'none' }}
          onClick={seekScrubber}
        >
          <div className={s.scrubFill}  style={{ width: scrubPct + '%' }} />
          <div className={s.scrubThumb} style={{ left:  scrubPct + '%' }} />
        </div>
        <span className={s.vcTime}>
          {isMotion && duration
            ? `${fmt2(cur)} / ${fmt2(duration)}${isSequence ? ` · f${scrubPctToFrameIndex(scrubPct, fo?.frameCount || 1) + 1}` : ''}`
            : '—'}
        </span>
        <button className={`${s.loopTag} ${loopPlayback ? s.loopOn : ''}`}
          onClick={() => setLoopPlayback(!loopPlayback)} title="Toggle loop (L)">
          ↻ Loop
        </button>

      </div>
    </section>
  )
}
