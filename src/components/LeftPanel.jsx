import React, { useRef, useCallback } from 'react'
import useStore, { fmtBytes, getExt } from '../store/useStore'
import s from './LeftPanel.module.css'

const BADGE_CLASS = {
  gif: s.badgeGif, png: s.badgePng, jpg: s.badgeJpg, jpeg: s.badgeJpg,
  mp4: s.badgeMp4, webm: s.badgeMp4, mov: s.badgeMp4,
  webp: s.badgeWebp, avif: s.badgeWebp,
}

function FileBadge({ ext }) {
  return <span className={`${s.badge} ${BADGE_CLASS[ext] || s.badgePng}`}>{ext.toUpperCase()}</span>
}

function FileItem({ fo, index, isActive }) {
  const { setActiveIdx, removeFile, duplicateFile } = useStore()
  return (
    <div className={`${s.fileItem} ${isActive ? s.active : ''}`} onClick={() => setActiveIdx(index)}>
      <div className={s.thumb}>
        {fo.thumbUrl
          ? <img src={fo.thumbUrl} alt="" />
          : <span className={s.thumbLabel}>{getExt(fo.file.name).toUpperCase()}</span>
        }
      </div>
      <div className={s.meta}>
        <div className={s.fileName}>{fo.file.name}</div>
        <div className={s.fileInfo}>
          {fmtBytes(fo.file.size)}&nbsp;
          <FileBadge ext={getExt(fo.file.name)} />
        </div>
      </div>
      <div className={s.actions}>
        <button className={`${s.actionBtn} ${s.dup}`} title="Duplicate"
          onClick={(e) => { e.stopPropagation(); duplicateFile(fo.id) }}>⧉</button>
        <button className={s.actionBtn} title="Remove"
          onClick={(e) => { e.stopPropagation(); removeFile(fo.id) }}>✕</button>
      </div>
    </div>
  )
}

export default function LeftPanel() {
  const { files, activeIdx, addFiles, applyPreset } = useStore()
  const inputRef  = useRef()
  const folderRef = useRef()
  const [dragging, setDragging] = React.useState(false)

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files)
  }, [addFiles])

  const handleInput = (e) => { addFiles(e.target.files); e.target.value = '' }

  return (
    <aside className={s.panel}>

      {/* Header row — Files label + count + Add button inline */}
      <div className={s.header}>
        <span className={s.headerLabel}>Files</span>
        <span className={s.countBadge}>{files.length}</span>
        <div className={s.headerActions}>
          <button className={s.addBtn} onClick={() => inputRef.current.click()}>+ Add</button>
          <button className={s.addBtn} onClick={() => folderRef.current.click()}>📁</button>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={inputRef} type="file" multiple accept="image/*,video/*,.gif,.webp,.avif"
        style={{ display: 'none' }} onChange={handleInput} />
      <input ref={folderRef} type="file" webkitdirectory="" multiple
        style={{ display: 'none' }} onChange={handleInput} />

      {/* Drop zone — no buttons inside, just the drop target */}
      <div
        className={`${s.dropZone} ${dragging ? s.dragOver : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current.click()}
      >
        <div className={s.dropIcon}>⬆</div>
        <div className={s.dropText}>Drop images, GIFs or video here</div>
      </div>

      {/* File list */}
      <div className={s.fileList}>
        {files.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>🖼</div>
            <div>No files yet</div>
            <div className={s.emptyHint}>Drop files above to get started</div>
          </div>
        ) : (
          files.map((fo, i) => (
            <FileItem key={fo.id} fo={fo} index={i} isActive={i === activeIdx} />
          ))
        )}
      </div>

      {/* Batch controls */}
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
