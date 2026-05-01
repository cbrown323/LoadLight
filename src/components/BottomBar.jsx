import React, { useEffect, useRef } from 'react'
import useStore, { fmtBytes, estimateOutputSize } from '../store/useStore'
import s from './BottomBar.module.css'

const STATUS_LABEL = { done: 'Done', processing: 'Converting…', pending: 'Pending', error: 'Error' }

export default function BottomBar() {
  const { files, quality, exportRunning, exportProgress, exportLog = [], runExport, encodingMode } = useStore()
  const logRef = useRef()

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [exportLog])

  const totalOrig = files.reduce((sum, f) => sum + f.file.size, 0)
  const totalOpt  = files.reduce((sum, f) => {
    if (f.realSizes) return sum + f.realSizes.reduce((s, r) => s + r.size, 0)
    return sum + estimateOutputSize(f.file, quality)
  }, 0)
  const allDone = files.length > 0 && files.every((f) => f.qStatus === 'done')
  const savings = totalOrig > 0 ? Math.round((1 - totalOpt / totalOrig) * 100) : null
  const showLog = exportRunning || exportLog.length > 0

  return (
    <footer className={`${s.bar} ${showLog ? s.barTall : ''}`}>

      {/* ── Top row: always visible ── */}
      <div className={s.topRow}>

        {/* Queue */}
        <div className={s.queue}>
          {files.length === 0 ? (
            <span className={s.qEmpty}>Queue empty — add files to begin</span>
          ) : (
            files.map((fo) => (
              <div key={fo.id} className={`${s.qItem} ${fo.qStatus === 'error' ? s.qItemError : ''}`}>
                <div className={`${s.qDot} ${s['dot_' + fo.qStatus]}`} />
                <span className={s.qLabel}>{fo.file.name}</span>
                <span className={`${s.qStatus} ${s['status_' + fo.qStatus]}`}>
                  {STATUS_LABEL[fo.qStatus] || fo.qStatus}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Progress */}
        <div className={s.progressWrap}>
          <div className={s.progressLabel}>
            <span>Batch</span>
            <span>{exportProgress}%</span>
          </div>
          <div className={s.progressBar}>
            <div className={s.progressFill} style={{ width: exportProgress + '%' }} />
          </div>
        </div>

        {/* Stats */}
        <div className={s.stats}>
          <div className={s.stat}>
            <div className={s.statVal}>{fmtBytes(totalOrig)}</div>
            <div className={s.statLbl}>Original</div>
          </div>
          <div className={s.stat}>
            <div className={`${s.statVal} ${s.green}`}>{fmtBytes(totalOpt)}</div>
            <div className={s.statLbl}>{allDone ? 'Actual output' : 'Estimated'}</div>
          </div>
          <div className={s.stat}>
            <div className={`${s.statVal} ${s.green}`}>{savings !== null ? `-${savings}%` : '—'}</div>
            <div className={s.statLbl}>Savings</div>
          </div>
        </div>

        {/* Export button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <button
            className={s.exportBtn}
            disabled={files.length === 0 || exportRunning}
            onClick={runExport}
          >
            {exportRunning ? '⏳ Processing…' : '⚡ Export All'}
          </button>
          <span style={{
            fontSize: 9,
            letterSpacing: '0.05em',
            color: encodingMode === 'webcodecs' ? '#22d3a0' : '#94a3b8',
            opacity: 0.8,
          }}>
            {encodingMode === 'webcodecs'
              ? '⚡ WebCodecs ready (GPU path when used)'
              : '🔧 WASM / ffmpeg (no WebCodecs)'}
          </span>
        </div>
      </div>

      {/* ── Log row: inline, expands the bar downward ── */}
      {showLog && (
        <div className={s.logRow} ref={logRef}>
          <div className={s.logInner}>
            {exportLog.map((line, i) => (
              <span key={i} className={s.logLine}>{line}</span>
            ))}
            {exportRunning && <span className={s.logCursor}>▌</span>}
          </div>
        </div>
      )}

    </footer>
  )
}
