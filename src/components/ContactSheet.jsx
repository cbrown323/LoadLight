import React, { useEffect, useState } from 'react'
import useStore from '../store/useStore.js'
import { createContactSheet } from '../lib/contactSheet.js'
import s from './RightPanel.module.css'

export default function ContactSheet({ fo, supported }) {
  const setContactSheet = useStore((state) => state.setContactSheet)
  const [request, setRequest] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(null)
  useEffect(() => {
    setResult(null); setError(''); setProgress(null)
    if (!request) return
    const controller = new AbortController()
    let url
    setProgress(0)
    createContactSheet(fo.file, {
      signal: controller.signal,
      onProgress: (value) => { if (!controller.signal.aborted) setProgress(value) },
    }).then((sheet) => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(sheet.blob)
      setResult({ ...sheet, url })
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err.message)
    }).finally(() => { if (!controller.signal.aborted) setProgress(null) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [fo.file, request])

  return <div className={s.inspectorTrack}>
    <strong>Contact sheet</strong>
    <p className={s.inspectorText}>12 evenly spaced source frames with timestamps. Short clips may repeat frames.</p>
    <label className={s.inspectorText}>
      <input type="checkbox" checked={!!fo.contactSheet} disabled={!supported}
        onChange={(event) => setContactSheet(fo.id, event.target.checked)} /> Include JPEG in export
    </label>
    <button className={s.addBp} disabled={!supported || progress !== null} onClick={() => setRequest((value) => value + 1)}>
      {progress !== null ? `Reading frames… ${progress}%` : 'Preview contact sheet'}
    </button>
    {progress !== null && <button className={s.addBp} onClick={() => setRequest(0)}>Cancel contact sheet</button>}
    {!supported && <p className={s.inspectorText}>Requires a video codec this browser can decode.</p>}
    {error && <p className={s.inspectorText} role="alert">{error}</p>}
    {result && <>
      <img className={s.posterPreview} src={result.url} alt="Contact sheet of 12 video frames with source timestamps" />
      <a className={s.addBp} href={result.url} download={`${fo.file.name.replace(/\.[^.]+$/, '')}-contact-sheet.jpg`}>Download contact sheet JPEG</a>
    </>}
  </div>
}
