import React, { useRef, useCallback } from 'react'
import useStore, { fmtBytes, getExt, isPortrait } from '../store/useStore'
import s from './LeftPanel.module.css'

const BADGE_CLASS = {
  gif: s.badgeGif, png: s.badgePng, jpg: s.badgeJpg, jpeg: s.badgeJpg,
  mp4: s.badgeMp4, webm: s.badgeMp4, mov: s.badgeMp4,
  webp: s.badgeWebp, avif: s.badgeWebp,
}

function FileBadge({ ext }) {
  return <span className={`${s.badge} ${BADGE_CLASS[ext] || s.badgePng}`}>{ext.toUpperCase()}</span>
}

function OrientationTag({ fo }) {
  if (!fo.width || !fo.height) return null
  const portrait = fo.height > fo.width
  return (
    <span className={`${s.orientTag} ${portrait ? s.orientPortrait : s.orientLandscape}`}>
      {portrait ? '▯' : '▭'}
    </span>
  )
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
        <div className={s.fileNameRow}>
          <span className={s.fileName}>{fo.file.name}</span>
          <OrientationTag fo={fo} />
        </div>
        <div className={s.fileInfo}>
          {fmtBytes(fo.file.size)}&nbsp;
          {fo.width && fo.height && <span className={s.dims}>{fo.width}×{fo.height}&nbsp;</span>}
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
  const { files, activeIdx, addFiles, applyPreset } = useStore()
  const inputRef  = useRef()
  const folderRef = useRef()
  const [dragging, setDragging] = React.useState(false)

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files)
  }, [addFiles])
  const handleInput = (e) => { addFiles(e.target.files); e.target.value = '' }

  // Sort: images first, then video/gif
  const isVideoFile = (fo) => fo.file.type.startsWith('video/') || fo.file.name.toLowerCase().endsWith('.gif')
  const images = files.map((fo, i) => ({ fo, i })).filter(({ fo }) => !isVideoFile(fo))
  const videos = files.map((fo, i) => ({ fo, i })).filter(({ fo }) => isVideoFile(fo))

  return (
    <aside className={s.panel}>
      <div className={s.header}>
        <span className={s.headerLabel}>Files</span>
        <span className={s.countBadge}>{files.length}</span>
        <div className={s.headerActions}>
          <button className={s.addBtn} onClick={() => inputRef.current.click()}>+ Add</button>
          <button className={s.addBtn} onClick={() => folderRef.current.click()}>📁</button>
        </div>
      </div>

      <input ref={inputRef} type="file" multiple accept="image/*,video/*,.gif,.webp,.avif"
        style={{ display: 'none' }} onChange={handleInput} />
      <input ref={folderRef} type="file" webkitdirectory="" multiple
        style={{ display: 'none' }} onChange={handleInput} />

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

      <div className={s.fileList}>
        {files.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>🖼</div>
            <div>No files yet</div>
            <div className={s.emptyHint}>Drop files above to get started</div>
          </div>
        ) : (
          <>
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
