import React, { useState, useRef, useEffect } from 'react'
import s from './ReleaseNotes.module.css'

const NOTES = [
  {
    version: 'v1.3a',
    date: 'Mar 2026',
    items: [
      'AI Max v2.1 — explicit object format with LLM directive for token-efficient asset manifests',
      'Fixed video Generate Preview — portrait-safe scale filter, reliable ffmpeg preset',
      'Release notes panel with version history',
      'Portrait / landscape orientation detection — breakpoints auto-adapt per file',
      'File list grouped by type with visual dividers (images / video)',
      'Tooltip z-index fix — AI Max hover now floats above the canvas',
    ],
  },
  {
    version: 'v1.3',
    date: 'Mar 2026',
    items: [
      'AI Max export — token-optimized JSON manifest for LLM workflows',
      'Real after-preview for images, re-encodes live on settings change',
      'Video after-preview — encode a 4s clip at current settings',
      'Save / Load named presets persisted to localStorage',
      'HTML snippet combines all files into one output file',
      'Upscale guard — breakpoints wider than source flagged and skipped',
    ],
  },
  {
    version: 'v1.0–1.2',
    date: 'Initial',
    items: [
      'Drag & drop import for images, GIFs, and video',
      'WebP, AVIF, JPG, PNG, MP4, WebM, GIF output via ffmpeg.wasm',
      'Multi-step downscale with unsharp mask sharpening',
      'Responsive breakpoint export with ZIP or individual download',
      'Before / Split / After preview modes with real scrubber',
      'Fully client-side — no server, no uploads',
    ],
  },
]

export default function ReleaseNotes() {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className={s.wrap} ref={ref}>
      <button className={s.trigger} onClick={() => setOpen((o) => !o)} title="Release notes">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          <line x1="3" y1="4" x2="10" y2="4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          <line x1="3" y1="6.5" x2="10" y2="6.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          <line x1="3" y1="9" x2="7" y2="9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div className={s.panel}>
          <div className={s.panelHeader}>
            <span className={s.panelTitle}>LoadLight Release Notes</span>
            <button className={s.close} onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className={s.scroll}>
            {NOTES.map((section) => (
              <div key={section.version} className={s.section}>
                <div className={s.versionRow}>
                  <span className={s.ver}>{section.version}</span>
                  <span className={s.date}>{section.date}</span>
                </div>
                <ul className={s.list}>
                  {section.items.map((item, i) => (
                    <li key={i} className={s.item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
