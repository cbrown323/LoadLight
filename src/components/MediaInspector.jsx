import React, { useEffect, useState } from 'react'
import useStore, { fmtBytes } from '../store/useStore'
import { isImageSequence, isVideoLike } from '../lib/mediaIngest.js'
import { inspectMedia, extractVideoPoster } from '../lib/mediaInspector.js'
import ContactSheet from './ContactSheet.jsx'
import { canUseFfmpegWasm } from '../lib/capabilitySupport.js'
import s from './RightPanel.module.css'

export default function MediaInspector({ fo }) {
  const setAudioTrack = useStore((state) => state.setAudioTrack)
  const setPosterTime = useStore((state) => state.setPosterTime)
  const [inspection, setInspection] = useState(null)
  const [error, setError] = useState('')
  const [poster, setPoster] = useState(null)
  const [posterError, setPosterError] = useState('')
  const [busy, setBusy] = useState(false)
  const [request, setRequest] = useState(0)
  const sequence = isImageSequence(fo)
  const video = !!fo && !sequence && isVideoLike(fo.file)
  const timestamp = fo?.posterTime ?? 0

  useEffect(() => {
    setInspection(null); setError('')
    if (!video) return
    const controller = new AbortController()
    inspectMedia(fo.file, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setInspection(result)
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err.message)
    })
    return () => controller.abort()
  }, [fo?.file, video])

  useEffect(() => {
    setPoster(null); setPosterError(''); setBusy(false)
    if (!video || !request) return
    const controller = new AbortController()
    let url
    setBusy(true)
    extractVideoPoster(fo.file, timestamp, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(result.blob)
      setPoster({ ...result, url })
    }).catch((err) => {
      if (!controller.signal.aborted) setPosterError(err.message)
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [fo?.file, timestamp, video, request])

  if (!fo) return null
  const audioTracks = inspection?.tracks.filter((track) => track.type === 'audio') || []
  const duration = inspection?.duration ?? fo.duration
  return (
    <section className={s.section} aria-label="Media inspector">
      <div className={s.sectionTitle}>Media inspector</div>
      <div className={s.inspectorText}>{fo.file.name}</div>
      <div className={s.inspectorText}>{fmtBytes(fo.file.size)} · {sequence ? 'Image sequence' : inspection?.container || fo.file.type || 'Unknown type'}</div>
      {!video && <div className={s.inspectorText}>{fo.width || '—'} × {fo.height || '—'}{sequence ? ` · ${fo.frameCount} frames · ${fo.fps} fps` : ''}</div>}
      {video && !inspection && !error && <p className={s.inspectorText} role="status">Inspecting media…</p>}
      {error && <p className={s.inspectorText} role="status">{error}</p>}
      {duration > 0 && <div className={s.inspectorText}>Duration: {duration.toFixed(3)} s</div>}
      {inspection?.tracks.map((track) => <div key={track.id} className={s.inspectorTrack}>
        <strong>{track.type} · {track.codec}</strong>
        {track.width > 0 && <div>{track.width} × {track.height} · {track.rotation}° rotation{Number.isFinite(track.fps) ? ` · ~${track.fps.toFixed(2)} fps` : ''}</div>}
        {track.sampleRate > 0 && <div>{track.sampleRate} Hz · {track.channels} channels</div>}
        <div>Browser decoding: {track.decodable === null ? 'Unknown' : track.decodable ? 'Supported' : 'Unavailable'}</div>
      </div>)}
      {video && <div className={s.inspectorTrack}>
        <label className={s.inspectorText} htmlFor="audio-track">Export audio</label>
        <select id="audio-track" className={s.respSelect} value={fo.audioTrack ?? 'auto'}
          onChange={(event) => setAudioTrack(fo.id, /^\d+$/.test(event.target.value) ? Number(event.target.value) : event.target.value)}>
          <option value="auto">Automatic</option>
          <option value="none">Remove audio</option>
          {audioTracks.map((track) => <option key={track.id} value={track.audioIndex} disabled={!canUseFfmpegWasm()}>
            Track {track.audioIndex + 1} · {track.name || track.language || 'Unnamed'} · {track.codec} · {track.channels} ch
          </option>)}
        </select>
        {inspection && !audioTracks.length && <p className={s.inspectorText}>No audio tracks detected.</p>}
        <p className={s.inspectorText}>Applies to this file’s MP4/WebM exports. GIF and the visual preview are silent. Automatic uses the encoder’s default audio track.</p>
        {audioTracks.length > 0 && <p className={s.inspectorText}>Specific track selection uses software encoding in Chrome or Edge.</p>}
      </div>}
      {video && <ContactSheet key={fo.id} fo={fo} supported={!!inspection?.posterSupported} />}
      {(video || sequence) && <>
        <label className={s.inspectorText} htmlFor="poster-time">Poster time (source seconds)</label>
        <input id="poster-time" className={s.respSelect} type="number" min="0" step="0.001"
          value={timestamp} onChange={(e) => {
            const value = e.target.valueAsNumber
            if (Number.isFinite(value) && value >= 0) setPosterTime(fo.id, value)
          }} />
        <p className={s.inspectorText}>Used when “Generate poster image” is enabled. Times past the end use the last frame.</p>
      </>}
      {video && <>
        <button className={s.addBp} disabled={busy || !inspection?.posterSupported} onClick={() => setRequest((value) => value + 1)}>
          {busy ? 'Reading frame…' : 'Preview poster'}
        </button>
        {inspection && !inspection.posterSupported && <p className={s.inspectorText}>Accurate poster decoding is unavailable in this browser.</p>}
        {posterError && <p className={s.inspectorText} role="alert">{posterError}</p>}
        {poster && <>
          <img className={s.posterPreview} src={poster.url} alt={`Poster at ${poster.timestamp.toFixed(3)} seconds`} />
          <div className={s.inspectorText}>Frame starts at {poster.timestamp.toFixed(3)} s · {poster.width} × {poster.height}</div>
          <a className={s.addBp} href={poster.url} download={`${fo.file.name.replace(/\.[^.]+$/, '')}-poster.jpg`}>Download poster JPEG</a>
        </>}
      </>}
    </section>
  )
}
