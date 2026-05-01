import React, { useState, useRef, useEffect } from 'react'
import ReleaseNotes from './ReleaseNotes'
import useStore from '../store/useStore'
import s from './TopBar.module.css'

function PresetModal({ mode, onClose }) {
  const { savedPresets, saveCurrentPreset, loadNamedPreset, deleteNamedPreset } = useStore()
  const [name, setName] = useState('')
  const [msg,  setMsg]  = useState('')
  const inputRef = useRef()

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSave() {
    if (!name.trim()) { setMsg('Enter a name'); return }
    const ok = saveCurrentPreset(name.trim())
    if (ok) { setMsg('Saved!'); setTimeout(onClose, 800) }
  }

  function handleLoad(presetName) {
    const ok = loadNamedPreset(presetName)
    if (ok) { setMsg(`Loaded "${presetName}"`); setTimeout(onClose, 600) }
  }

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalTitle}>{mode === 'save' ? 'Save Preset' : 'Load Preset'}</div>
        {mode === 'save' && (
          <div className={s.modalRow}>
            <input ref={inputRef} className={s.modalInput} placeholder="Preset name…"
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()} />
            <button className={s.modalBtn} onClick={handleSave}>Save</button>
          </div>
        )}
        {savedPresets.length > 0 ? (
          <div className={s.presetList}>
            {savedPresets.map((p) => (
              <div key={p.name} className={s.presetItem}>
                <span className={s.presetName}>{p.name}</span>
                <div className={s.presetActions}>
                  {mode === 'load' && (
                    <button className={`${s.presetBtn} ${s.presetLoad}`} onClick={() => handleLoad(p.name)}>Load</button>
                  )}
                  <button className={`${s.presetBtn} ${s.presetDel}`} onClick={() => deleteNamedPreset(p.name)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={s.presetEmpty}>No saved presets yet</div>
        )}
        {msg && <div className={s.modalMsg}>{msg}</div>}
        <button className={s.modalClose} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

export default function TopBar() {
  const { projectName, setProjectName, viewMode, setViewMode } = useStore()
  const [modal, setModal] = useState(null)

  return (
    <>
      <header className={s.bar}>
        <div className={s.logo}>
          <div className={s.logoIcon}>LL</div>
          LoadLight
          <span className={s.version}>v1.4</span>
          <ReleaseNotes />
        </div>

        <div className={s.batchNameBlock}>
          <label className={s.batchNameLabel} htmlFor="loadlight-batch-name">Batch name</label>
          <input
            id="loadlight-batch-name"
            className={s.projectName}
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            spellCheck={false}
            placeholder="e.g. hero-images-apr"
            title="Used as the ZIP / export download name"
          />
        </div>

        <div className={s.spacer} />

        <div className={s.viewToggle}>
          {['before', 'split', 'after'].map((m) => (
            <button key={m}
              className={`${s.vtBtn} ${viewMode === m ? s.active : ''}`}
              onClick={() => setViewMode(m)}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        <div className={s.spacer} />

        <button className={s.topAction} onClick={() => setModal('save')}>Save Preset</button>
        <button className={s.topAction} onClick={() => setModal('load')}>Load Preset</button>
        {/* Settings button removed — fix #2 */}
      </header>

      {modal && <PresetModal mode={modal} onClose={() => setModal(null)} />}
    </>
  )
}
