import React, { useRef, useCallback } from 'react'
import useStore, { fmtBytes, getExt, isPortrait } from '../store/useStore'
import { MEDIA_INPUT_ACCEPT, isVideoLike, isImageSequence } from '../lib/mediaIngest.js'
import IngestReviewModal from './IngestReviewModal.jsx'
import s from './LeftPanel.module.css'

const BADGE_CLASS = {
  gif: s.badgeGif, png: s.badgePng, jpg: s.badgeJpg, jpeg: s.badgeJpg,
  mp4: s.badgeMp4, webm: s.badgeMp4, mov: s.badgeMp4, avi: s.badgeMp4,
  webp: s.badgeWebp, avif: s.badgeWebp, tif: s.badgePng, tiff: s.badgePng,
}

function FileBadge({ ext }) {
  return <span className={`${s.badge} ${BADGE_CLASS[ext] || s.badgePng}`}>{ext.toUpperCase()}</span>
}

function SeqBadge({ fo }) {
  if (!isImageSequence(fo)) return null
  const range = fo.startFrame != null && fo.endFrame != null
    ? `${fo.startFrame}–${fo.endFrame}`
    : `${fo.frameCount}f`
  return (
    <span className={s.seqBadge} title="Image sequence">
      SEQ · {fo.frameCount}f{fo.versionLabel ? ` · ${fo.versionLabel}` : ''} · {range}
    </span>
  )
}

function OrientationTag({ fo }) {
  if (!fo.width || !fo.height) return null
  const portrait = fo.height > fo.width
  return (
    <span
      className={`${s.orientTag} ${portrait ? s.orientPortrait : s.orientLandscape}`}
      title={portrait ? 'Portrait' : 'Landscape'}
    >
      {portrait ? 'P' : 'L'}
    </span>
  )
}

function FileItem({ fo, index, isActive }) {
  const { setActiveIdx, removeFile } = useStore()
  const label = isImageSequence(fo)
    ? (fo.sequenceBaseName || fo.file.name)
    : fo.file.name

  return (
    <div className={`${s.fileItem} ${isActive ? s.active : ''}`} onClick={() => setActiveIdx(index)}>
      <div className={s.thumb}>
        {fo.thumbUrl
          ? <img src={fo.thumbUrl} alt="" />
          : <span className={s.thumbLabel}>{getExt(fo.file.name).toUpperCase()}</span>
        }
      </div>
      <div className={s.meta}>
        <div className={s.fileNameRow} data-tooltip={label}>
          <span className={s.fileName} title={label}>{label}</span>
          <OrientationTag fo={fo} />
        </div>
        <div className={s.fileInfo}>
          {fmtBytes(fo.file.size)}&nbsp;
          {fo.width && fo.height && <span className={s.dims}>{fo.width}×{fo.height}&nbsp;</span>}
          <SeqBadge fo={fo} />
          {!isImageSequence(fo) && <FileBadge ext={getExt(fo.file.name)} />}
        </div>
      </div>
      <div className={s.actions}>
        <button className={s.actionBtn} title="Remove"
          onClick={(e) => { e.stopPropagation(); removeFile(fo.id) }}>✕</button>
      </div>
    </div>
  )
}

function GroupDivider({ label, count }) {
  return (
    <div className={s.groupDivider}>
      <span className={s.groupLabel}>{label}</span>
      <span className={s.groupCount}>{count}</span>
      <div className={s.groupLine} />
    </div>
  )
}

export default function LeftPanel() {
  const {
    files, activeIdx, addFiles, applyPreset, ingestNotice, clearIngestNotice,
    ingestMode, setIngestMode, pendingAmbiguous, resolveAmbiguous, dismissAmbiguous,
  } = useStore()
  const inputRef  = useRef()
  const folderRef = useRef()
  const [dragging, setDragging] = React.useState(false)

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setDragging(false)
    await addFiles(e.dataTransfer, { fromFolder: true })
  }, [addFiles])

  const handleInput = async (e) => {
    await addFiles(e.target.files)
    e.target.value = ''
  }

  const handleFolderInput = async (e) => {
    await addFiles(e.target.files, { fromFolder: true })
    e.target.value = ''
  }

  const isVideoFile = (fo) => isVideoLike(fo.file) && !isImageSequence(fo)
  const sequences = files.map((fo, i) => ({ fo, i })).filter(({ fo }) => isImageSequence(fo))
  const images = files.map((fo, i) => ({ fo, i })).filter(({ fo }) => !isVideoFile(fo) && !isImageSequence(fo))
  const videos = files.map((fo, i) => ({ fo, i })).filter(({ fo }) => isVideoFile(fo))

  return (
    <aside className={s.panel}>
      <div className={s.header}>
        <span className={s.headerLabel}>Files</span>
        <span className={s.countBadge}>{files.length}</span>
        <div className={s.headerActions}>
          <button className={s.addBtn} onClick={() => inputRef.current.click()}>+ Add</button>
          <button className={s.addBtn} title="Import folder" onClick={() => folderRef.current.click()}>📁</button>
        </div>
      </div>

      <div className={s.modeRow}>
        <button
          type="button"
          className={`${s.modeBtn} ${ingestMode === 'flat' ? s.modeActive : ''}`}
          onClick={() => setIngestMode('flat')}
        >
          Files
        </button>
        <button
          type="button"
          className={`${s.modeBtn} ${ingestMode === 'smart-sequence' ? s.modeActive : ''}`}
          onClick={() => setIngestMode('smart-sequence')}
        >
          Smart Import
        </button>
      </div>

      <input ref={inputRef} type="file" multiple accept={MEDIA_INPUT_ACCEPT}
        style={{ display: 'none' }} onChange={handleInput} />
      <input ref={folderRef} type="file" webkitdirectory="" multiple
        style={{ display: 'none' }} onChange={handleFolderInput} />

      <div
        className={`${s.dropZone} ${dragging ? s.dragOver : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onClick={() => folderRef.current.click()}
      >
        <div className={s.dropIcon}>⬆</div>
        <div className={s.dropText}>
          Drop files or folders — {ingestMode === 'smart-sequence' ? 'detects numbered frame sequences and keeps versions labelled' : 'each file imports separately'}
        </div>
        <div className={s.dropBtns}>
          <button type="button" className={s.dropBtn} onClick={(e) => { e.stopPropagation(); inputRef.current.click() }}>
            Pick files
          </button>
          <button type="button" className={s.folderBtn} onClick={(e) => { e.stopPropagation(); folderRef.current.click() }}>
            Pick folder
          </button>
        </div>
      </div>

      {ingestNotice && (
        <div className={s.ingestBanner} role="status">
          <span className={s.ingestBannerText}>{ingestNotice}</span>
          <button type="button" className={s.ingestDismiss} onClick={() => clearIngestNotice()} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className={s.fileList}>
        {files.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>🖼</div>
            <div>No files yet</div>
            <div className={s.emptyHint}>Drop a folder of numbered frames to get started</div>
          </div>
        ) : (
          <>
            {sequences.length > 0 && (
              <>
                <GroupDivider label="Sequences" count={sequences.length} />
                {sequences.map(({ fo, i }) => (
                  <FileItem key={fo.id} fo={fo} index={i} isActive={i === activeIdx} />
                ))}
              </>
            )}
            {images.length > 0 && (
              <>
                <GroupDivider label="Images" count={images.length} />
                {images.map(({ fo, i }) => (
                  <FileItem key={fo.id} fo={fo} index={i} isActive={i === activeIdx} />
                ))}
              </>
            )}
            {videos.length > 0 && (
              <>
                <GroupDivider label="Video" count={videos.length} />
                {videos.map(({ fo, i }) => (
                  <FileItem key={fo.id} fo={fo} index={i} isActive={i === activeIdx} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      <IngestReviewModal
        groups={pendingAmbiguous}
        onResolve={resolveAmbiguous}
        onDismiss={dismissAmbiguous}
      />

      <div className={s.batchControls}>
        <label className={s.batchLabel}>
          <div className={s.check} />
          Apply settings to all
        </label>
        <select className={s.presetSelect} defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
          <option value="" disabled>— Select Preset —</option>
          <option value="web">Web Optimized</option>
          <option value="mobile">Mobile First</option>
          <option value="hq">High Quality</option>
          <option value="aggressive">Aggressive Compress</option>
        </select>
      </div>
    </aside>
  )
}
