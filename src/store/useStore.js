import { create } from 'zustand'
import {
  BP_PRESETS,
  BP_PRESETS_PORTRAIT,
  isPortrait,
} from '../lib/breakpointPresets.js'
import { runExport as _runExport }      from '../lib/exportEngine.js'
import { schedulePreview, cancelPreview } from '../lib/previewEncoder.js'
import { encodeVideoPreview } from '../lib/videoPreviewEncoder.js'
import { savePreset, loadPreset, listPresets, deletePreset } from '../lib/presets.js'
import { getEncodingMode, formatFfmpegWorkerError } from '../lib/ffmpegLoader.js'
import { validateIngestFile, isVideoLike, isMotionAsset, isImageSequence, ingestExt } from '../lib/mediaIngest.js'
import { buildIngestBatch, resolveAmbiguousGroup } from '../lib/sequenceIngest.js'
import { DEFAULT_SEQUENCE_FPS } from '../lib/sequenceNaming.js'
import { decodeTiffToCanvas } from '../lib/tiffDecode.js'

// ── helpers ───────────────────────────────────────────────
export function fmtBytes(b) {
  if (!b || b === 0) return '0 B'
  if (b < 1024)      return b + ' B'
  if (b < 1048576)   return (b / 1024).toFixed(1) + ' KB'
  return (b / 1048576).toFixed(1) + ' MB'
}

export function getExt(name) { return name.split('.').pop().toLowerCase() }

// Kept for the stats bar when no real size is known yet
export function estimateOutputSize(file, quality) {
  const q       = quality / 100
  const isVideo = isVideoLike(file)
  const ratio   = isVideo ? 0.15 + q * 0.25 : 0.08 + q * 0.35
  return Math.round(file.size * ratio)
}

export { BP_PRESETS, BP_PRESETS_PORTRAIT, isPortrait } from '../lib/breakpointPresets.js'

export const QUALITY_PRESETS = {
  web:        { quality: 72, formatStill: 'auto', formatMotion: 'auto' },
  mobile:     { quality: 55, formatStill: 'webp', formatMotion: 'auto' },
  hq:         { quality: 90, formatStill: 'auto', formatMotion: 'auto' },
  aggressive: { quality: 30, formatStill: 'avif', formatMotion: 'auto' },
}

export function qualityZone(q) {
  if (q >= 90) return { label: 'High Quality', color: 'var(--green)',  bg: 'rgba(34,211,160,0.15)' }
  if (q >= 60) return { label: 'Balanced',     color: 'var(--orange)', bg: 'rgba(245,158,11,0.15)' }
  if (q >= 30) return { label: 'Optimized',    color: '#FBBF24',       bg: 'rgba(251,191,36,0.12)' }
  return             { label: 'Aggressive',    color: 'var(--red)',    bg: 'rgba(239,68,68,0.15)'  }
}

// ── store ─────────────────────────────────────────────────
const useStore = create((set, get) => ({

  // ── encoding mode ──────────────────────────────────────
  encodingMode: getEncodingMode(), // 'webcodecs' or 'wasm'

  // ── files ──────────────────────────────────────────────
  files:         [],
  activeIdx:     -1,
  ingestNotice:  null,
  ingestMode:    'smart-sequence',
  pendingAmbiguous: [],

  clearIngestNotice: () => set({ ingestNotice: null }),
  setIngestMode: (ingestMode) => set({ ingestMode }),

  /** @param {import('../lib/sequenceIngest.js').QueuePayload[]} payloads */
  _enqueuePayloads: (payloads) => {
    payloads.forEach((payload) => {
      const fo = {
        file: payload.file,
        kind: payload.kind,
        frames: payload.frames,
        sequenceBaseName: payload.sequenceBaseName,
        versionLabel: payload.versionLabel,
        frameCount: payload.frameCount,
        startFrame: payload.startFrame,
        endFrame: payload.endFrame,
        fps: payload.fps ?? DEFAULT_SEQUENCE_FPS,
        thumbUrl:   null,
        previewUrl: null,
        afterUrl:   null,
        afterSize:  null,
        realSizes:  null,
        width: 0, height: 0,
        duration: payload.kind === 'sequence'
          ? payload.frameCount / (payload.fps ?? DEFAULT_SEQUENCE_FPS)
          : 0,
        qStatus: 'pending',
        id: Math.random().toString(36).slice(2),
      }
      set((s) => ({ files: [...s.files, fo] }))
      generateThumb(
        fo,
        (updated) => {
          set((s) => {
            const files     = s.files.map((f) => (f.id === updated.id ? updated : f))
            const activeIdx = s.activeIdx < 0 ? 0 : s.activeIdx
            return { files, activeIdx }
          })
          get()._refreshPreview(updated)
        },
        (msg) => get().appendLog(msg),
      )
    })
  },

  resolveAmbiguous: (groupId, choice) => {
    const state = get()
    const group = state.pendingAmbiguous.find((g) => g.id === groupId)
    if (!group) return
    const payloads = resolveAmbiguousGroup(group, choice)
    get()._enqueuePayloads(payloads)
    set({ pendingAmbiguous: state.pendingAmbiguous.filter((g) => g.id !== groupId) })
  },

  dismissAmbiguous: (groupId) => {
    set((s) => ({ pendingAmbiguous: s.pendingAmbiguous.filter((g) => g.id !== groupId) }))
  },

  addFiles: async (input, opts = {}) => {
    const state = get()
    const mode = opts.mode ?? state.ingestMode
    const batch = await buildIngestBatch(input, { mode, fromFolder: !!opts.fromFolder })

    get()._enqueuePayloads(batch.queue)

    const notices = []
    if (batch.summary) notices.push(batch.summary)
    if (batch.skipReasons.length) {
      notices.push(
        batch.skipReasons.length === 1
          ? batch.skipReasons[0]
          : `${batch.skipReasons.length} file(s) skipped: ${batch.skipReasons[0]}`,
      )
    }

    set({
      pendingAmbiguous: [...state.pendingAmbiguous, ...batch.ambiguous],
      ingestNotice: notices.length ? notices.join(' ') : null,
    })
  },

  removeFile: (id) => set((s) => {
    const files     = s.files.filter((f) => f.id !== id)
    const activeIdx = Math.min(s.activeIdx, files.length - 1)
    return { files, activeIdx }
  }),

  duplicateFile: (id) => set((s) => {
    const idx  = s.files.findIndex((f) => f.id === id)
    if (idx < 0) return {}
    const copy = { ...s.files[idx], id: Math.random().toString(36).slice(2), qStatus: 'pending', afterUrl: null, afterSize: null, realSizes: null }
    return { files: [...s.files.slice(0, idx + 1), copy, ...s.files.slice(idx + 1)] }
  }),

  setActiveIdx: (i) => {
    set({ activeIdx: i })
    // Auto-adapt breakpoints for portrait vs landscape
    const state = get()
    const fo    = state.files[i]
    if (!fo || state.responsiveMode === 'none' || state.responsiveMode === 'custom') return
    const presetSrc = isPortrait(fo) ? BP_PRESETS_PORTRAIT : BP_PRESETS
    const newBPs    = (presetSrc[state.responsiveMode] || []).slice()
    set({ breakpoints: newBPs })
  },

  setFileStatus: (id, qStatus) =>
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, qStatus } : f)) })),

  setFileRealSizes: (id, realSizes) =>
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, realSizes } : f)) })),

  // ── after-preview ───────────────────────────────────────
  previewLoading:      false,
  videoPreviewLoading: false,
  videoPreviewPct:     0,
  videoPreviewLog:     '',
  videoPreviewError:   null,
  previewStartTime:    0,
  setPreviewStartTime: (v) => set({ previewStartTime: Number(v) || 0 }),

  _refreshPreview: (fo) => {
    if (!fo) return
    const { formatStill, quality, advResolution } = get()
    if (isVideoLike(fo.file) && !isImageSequence(fo)) return

    const previewFile = isImageSequence(fo) && fo.frames?.[0]?.file
      ? fo.frames[0].file
      : fo.file

    set({ previewLoading: true })

    schedulePreview(
      previewFile,
      { format: formatStill, quality, advResolution },
      ({ url, size }) => {
        // Revoke old after URL
        set((s) => {
          const old = s.files.find((f) => f.id === fo.id)?.afterUrl
          if (old) URL.revokeObjectURL(old)
          return {
            previewLoading: false,
            files: s.files.map((f) =>
              f.id === fo.id ? { ...f, afterUrl: url, afterSize: size } : f
            ),
          }
        })
      },
      () => set({ previewLoading: true }),
      450
    )
  },

  encodeVideoPreview: async () => {
    const state = get()
    const fo = state.files[state.activeIdx]
    if (!fo) return
    const isVideo = isVideoLike(fo.file)
    if (!isVideo || state.videoPreviewLoading) return

    set({ videoPreviewLoading: true, videoPreviewPct: 0, videoPreviewLog: '', videoPreviewError: null })

    try {
      const { url, size } = await encodeVideoPreview(
        fo.file,
        { format: state.formatMotion, quality: state.quality, fps: state.advFps, startTime: state.previewStartTime },
        (pct) => set({ videoPreviewPct: pct }),
        (msg) => { set({ videoPreviewLog: msg }); get().appendLog(msg) },
      )
      set((s) => {
        const old = s.files.find((f) => f.id === fo.id)?.afterUrl
        if (old && old !== fo.previewUrl) URL.revokeObjectURL(old)
        return {
          videoPreviewLoading: false,
          videoPreviewPct: 100,
          files: s.files.map((f) =>
            f.id === fo.id ? { ...f, afterUrl: url, afterSize: size } : f
          ),
        }
      })
    } catch (err) {
      console.error('Video preview failed:', err)
      const errMsg = 'Preview failed: ' + formatFfmpegWorkerError(err)
      get().appendLog('✗ ' + errMsg)
      set({ videoPreviewLoading: false, videoPreviewError: errMsg, videoPreviewLog: errMsg })
    }
  },

  triggerPreviewRefresh: () => {
    const { files, activeIdx, _refreshPreview } = get()
    const fo = files[activeIdx]
    if (fo) _refreshPreview(fo)
  },

  // ── settings ────────────────────────────────────────────
  formatStill:     'auto',
  formatMotion:    'auto',
  quality:         82,
  smartFormat:     true,
  responsiveMode:  'standard',
  breakpoints:     BP_PRESETS.standard.slice(),
  generatePoster:  true,
  exportAs:        'zip',
  generateSnippet: false,
  generateAiMax:   false,
  namingPattern:   '{name}-{width}.{ext}',
  showAdvanced:    false,
  projectName:     'Untitled Batch',
  viewMode:        'split',
  loopPlayback:    true,
  advResolution:   100,
  advBitrate:      0,
  advFps:          0,

  setFormatStill: (v) => {
    set({ formatStill: v })
    get().triggerPreviewRefresh()
  },
  setFormatMotion: (v) => {
    set({ formatMotion: v })
    get().triggerPreviewRefresh()
  },
  setQuality: (v) => {
    set({ quality: v })
    get().triggerPreviewRefresh()
  },
  setSmartFormat:    (v) => set({ smartFormat: v }),
  setGeneratePoster: (v) => set({ generatePoster: v }),
  setExportAs:       (v) => set({ exportAs: v }),
  setGenerateSnippet:(v) => set({ generateSnippet: v }),
  setGenerateAiMax:  (v) => set({ generateAiMax: v }),
  setNamingPattern:  (v) => set({ namingPattern: v }),
  setShowAdvanced:   (v) => set({ showAdvanced: v }),
  setProjectName:    (v) => set({ projectName: v }),
  setViewMode:       (v) => set({ viewMode: v }),
  setLoopPlayback:   (v) => set({ loopPlayback: v }),
  setAdvResolution:  (v) => { set({ advResolution: Number(v) }); get().triggerPreviewRefresh() },
  setAdvBitrate:     (v) => set({ advBitrate: Number(v) }),
  setAdvFps:         (v) => set({ advFps: Number(v) }),

  setResponsiveMode: (mode) =>
    set((s) => {
      let breakpoints = []
      if (mode === 'none') {
        breakpoints = []
      } else if (mode === 'custom') {
        breakpoints = (BP_PRESETS.custom || []).slice()
      } else {
        const fo = s.files[s.activeIdx]
        const presetSrc = isPortrait(fo) ? BP_PRESETS_PORTRAIT : BP_PRESETS
        breakpoints = (presetSrc[mode] || []).slice()
      }
      return { responsiveMode: mode, breakpoints }
    }),

  addBreakpoint: (w, name = 'Custom') =>
    set((s) => ({ breakpoints: [...s.breakpoints, { name, w }].sort((a, b) => b.w - a.w) })),

  removeBreakpoint: (idx) =>
    set((s) => ({ breakpoints: s.breakpoints.filter((_, i) => i !== idx) })),

  applyPreset: (key) => {
    const p = QUALITY_PRESETS[key]
    if (p) {
      set({
        quality: p.quality,
        formatStill: p.formatStill ?? 'auto',
        formatMotion: p.formatMotion ?? 'auto',
      })
      get().triggerPreviewRefresh()
    }
  },

  // ── named presets ────────────────────────────────────────
  savedPresets: listPresets(),

  saveCurrentPreset: (name) => {
    const s = get()
    const ok = savePreset(name, {
      formatStill: s.formatStill, formatMotion: s.formatMotion, quality: s.quality, namingPattern: s.namingPattern,
      responsiveMode: s.responsiveMode, breakpoints: s.breakpoints,
      advResolution: s.advResolution, advBitrate: s.advBitrate, advFps: s.advFps,
      generateSnippet: s.generateSnippet, generatePoster: s.generatePoster,
      exportAs: s.exportAs,
    })
    if (ok) set({ savedPresets: listPresets() })
    return ok
  },

  loadNamedPreset: (name) => {
    const p = loadPreset(name)
    if (!p) return false
    let formatStill = p.formatStill
    let formatMotion = p.formatMotion
    if (formatStill == null && formatMotion == null && p.format != null) {
      const f = p.format
      if (f === 'auto') {
        formatStill = 'auto'; formatMotion = 'auto'
      } else if (['mp4', 'webm', 'gif'].includes(f)) {
        formatStill = 'auto'; formatMotion = f
      } else {
        formatStill = f; formatMotion = 'auto'
      }
    }
    set({
      formatStill:     formatStill ?? 'auto',
      formatMotion:    formatMotion ?? 'auto',
      quality:         p.quality         ?? 82,
      responsiveMode:  p.responsiveMode  ?? 'standard',
      breakpoints:     p.breakpoints     ?? BP_PRESETS.standard.slice(),
      advResolution:   p.advResolution   ?? 100,
      advBitrate:      p.advBitrate      ?? 0,
      advFps:          p.advFps          ?? 0,
      generateSnippet: p.generateSnippet ?? false,
      generatePoster:  p.generatePoster  ?? true,
      exportAs:        p.exportAs        ?? 'zip',
      namingPattern:   p.namingPattern   ?? '{name}-{width}.{ext}',
    })
    get().triggerPreviewRefresh()
    return true
  },

  deleteNamedPreset: (name) => {
    deletePreset(name)
    set({ savedPresets: listPresets() })
  },

  // ── export ───────────────────────────────────────────────
  exportRunning:  false,
  exportProgress: 0,
  exportLog:      [],

  appendLog: (msg) =>
    set((s) => ({ exportLog: [...s.exportLog.slice(-99), msg] })),

  runExport: async () => {
    const state = get()
    if (!state.files.length || state.exportRunning) return

    const {
      files, formatStill, formatMotion, quality, smartFormat, breakpoints, responsiveMode,
      generateSnippet, generateAiMax, generatePoster, exportAs, projectName,
      setFileStatus, setFileRealSizes, appendLog,
      advResolution, advBitrate, advFps,
    } = state

    set({ exportRunning: true, exportProgress: 0, exportLog: [] })
    files.forEach((f) => setFileStatus(f.id, 'pending'))

    const useResponsive = responsiveMode !== 'none'
    const perFile          = {}
    files.forEach((f) => { perFile[f.id] = 0 })

    function recalcProgress() {
      const total = Object.values(perFile).reduce((s, v) => s + v, 0)
      set({ exportProgress: Math.round(total / files.length) })
    }

    try {
      await _runExport({
        files, formatStill, formatMotion, quality, smartFormat, breakpoints, responsiveMode,
        useResponsive, resolutionPct: advResolution || 100,
        fps: advFps || 0, bitrate: advBitrate || 0,
        generateSnippet, generateAiMax, generatePoster, exportAs, projectName,

        onFileStart:    (id) => { setFileStatus(id, 'processing'); appendLog(`Starting ${files.find((f) => f.id === id)?.file.name}…`) },
        onFileProgress: (id, pct) => { perFile[id] = pct; recalcProgress() },
        onFileDone:     ({ id, realSizes }) => {
          perFile[id] = 100
          recalcProgress()
          setFileStatus(id, 'done')
          setFileRealSizes(id, realSizes)
          const name     = files.find((f) => f.id === id)?.file.name
          const totalOut = realSizes.reduce((s, r) => s + r.size, 0)
          appendLog(`✓ ${name} — ${fmtBytes(totalOut)}`)
        },
        onFileError: (id, err) => {
          setFileStatus(id, 'error')
          appendLog(`✗ ${files.find((f) => f.id === id)?.file.name}: ${formatFfmpegWorkerError(err)}`)
        },
        onLog: appendLog,
      })
    } catch (err) {
      appendLog(`Fatal: ${formatFfmpegWorkerError(err)}`)
      console.error('Export failed:', err)
    }

    set({ exportRunning: false, exportProgress: 100 })
  },
}))

// ── thumbnail generator ───────────────────────────────────
/** @param {(msg: string) => void} [log] — e.g. TIFF ffmpeg fallback progress */
function generateThumb(fo, cb, log = () => {}) {
  let { file } = fo
  if (isImageSequence(fo) && fo.frames?.length) {
    const mid = fo.frames[Math.floor(fo.frames.length / 2)]
    if (mid?.file) file = mid.file
  }
  const ext = ingestExt(file.name)

  const isTiff =
    ext === 'tif' || ext === 'tiff' || (file.type || '').toLowerCase() === 'image/tiff'
  if (isTiff) {
    decodeTiffToCanvas(file, log)
      .then((canvas) => {
        const w = canvas.width
        const h = canvas.height
        const thumb = document.createElement('canvas')
        const ts = Math.min(80 / w, 60 / h, 1)
        thumb.width = Math.max(1, Math.round(w * ts))
        thumb.height = Math.max(1, Math.round(h * ts))
        thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height)
        const thumbUrl = thumb.toDataURL('image/jpeg', 0.85)
        const maxPrev = 2048
        const ps = Math.min(1, maxPrev / w, maxPrev / h)
        const pw = Math.round(w * ps)
        const ph = Math.round(h * ps)
        const prev = document.createElement('canvas')
        prev.width = pw
        prev.height = ph
        prev.getContext('2d').drawImage(canvas, 0, 0, pw, ph)
        prev.toBlob((blob) => {
          if (!blob) {
            cb({ ...fo, thumbUrl, previewUrl: null, width: w, height: h })
            return
          }
          cb({ ...fo, thumbUrl, previewUrl: URL.createObjectURL(blob), width: w, height: h })
        }, 'image/png')
      })
      .catch(() => {
        cb({
          ...fo,
          thumbUrl:   null,
          previewUrl: null,
          width:      0,
          height:     0,
        })
      })
    return
  }

  if (file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.gif')) {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => cb({ ...fo, thumbUrl: url, previewUrl: url, width: img.width, height: img.height })
    img.onerror = () => cb({ ...fo, previewUrl: url, thumbUrl: url })
    img.src = url
  } else if (isVideoLike(file)) {
    const url = URL.createObjectURL(file)
    const vid = document.createElement('video')
    vid.src = url; vid.muted = true; vid.playsInline = true; vid.currentTime = 0.5
    vid.onloadeddata = () => {
      const c = document.createElement('canvas')
      c.width = 80; c.height = 60
      c.getContext('2d').drawImage(vid, 0, 0, 80, 60)
      cb({ ...fo, thumbUrl: c.toDataURL(), previewUrl: url, width: vid.videoWidth, height: vid.videoHeight, duration: vid.duration })
    }
    vid.onerror = () => cb({ ...fo, previewUrl: url, thumbUrl: null })
    vid.load()
  } else {
    cb(fo)
  }
}

export default useStore
