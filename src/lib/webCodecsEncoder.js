/**
 * webCodecsEncoder.js — Hardware-accelerated video encoding via WebCodecs API
 *
 * v5: Deterministic seeking-based capture.
 *
 * Why not playback capture (requestVideoFrameCallback + video.play)?
 *  - At 2× speed, back-pressure via pause/play skips frames → "steppy" output
 *  - After video.onended, subsequent resolutions can't re-play reliably
 *  - rvfc frame delivery is tied to display refresh rate, not video framerate
 *  - Non-deterministic: frame count varies between runs
 *
 * Seeking-based capture is:
 *  - Deterministic: every frame at the exact timestamp
 *  - Multi-resolution safe: same video element, seek back to 0 for each pass
 *  - ~4-5s per 10s/30fps video (15ms per seek + hardware encode)
 *  - Still 5-10× faster than ffmpeg.wasm
 *
 * Other features:
 *  - Source FPS detection via requestVideoFrameCallback (brief probe only)
 *  - hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime'
 *  - Direct VideoFrame from <video> when no scaling needed
 *  - Sequential audio (after video) to avoid memory pressure
 *  - Encoder back-pressure via encodeQueueSize polling
 */

import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'

// ── Feature detection ──────────────────────────────────────

export function supportsWebCodecs() {
  try {
    return (
      typeof VideoEncoder === 'function' &&
      typeof VideoDecoder === 'function' &&
      typeof VideoFrame === 'function' &&
      typeof AudioEncoder === 'function' &&
      typeof AudioContext === 'function'
    )
  } catch {
    return false
  }
}

function hasRVFC() {
  return typeof HTMLVideoElement !== 'undefined' &&
    'requestVideoFrameCallback' in HTMLVideoElement.prototype
}

/** Map quality 0-100 → bitrate (bps) for a given width */
function qualityToBitrate(quality, width, fps) {
  const base = width * width * (fps || 30) * 0.07
  const factor = 0.3 + (quality / 100) * 1.7
  return Math.round(base * factor)
}

// ── Video loading ──────────────────────────────────────────

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = URL.createObjectURL(file)

    // Append hidden to DOM — some browsers optimize frame decoding
    // for elements in the document vs detached elements
    video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(video)

    video.onloadedmetadata = () => {
      video.oncanplaythrough = () => resolve(video)
      video.onerror = reject
    }
    video.onerror = reject
    video.load()
  })
}

/** Remove video element from DOM and revoke blob URL */
function cleanupVideo(video) {
  try { video.pause() } catch (_) {}
  try { URL.revokeObjectURL(video.src) } catch (_) {}
  try { video.parentNode?.removeChild(video) } catch (_) {}
  video.src = ''
}

/**
 * Seek to a time and wait for the frame to actually paint.
 * Uses requestAnimationFrame after onseeked to ensure the video
 * element's internal texture is updated before we read from it.
 */
function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      // Already at this time — but still wait a rAF for paint consistency
      requestAnimationFrame(() => resolve())
      return
    }
    video.onseeked = () => {
      // Wait one animation frame for the decoded frame to be composited
      // to the video element's rendering surface
      requestAnimationFrame(() => resolve())
    }
    video.currentTime = time
  })
}

// ── FPS detection (brief playback probe) ───────────────────

async function detectFPS(video) {
  if (!hasRVFC()) return 30

  return new Promise((resolve) => {
    const times = []
    const timeout = setTimeout(() => {
      video.pause()
      resolve(estimateFromTimes(times))
    }, 2000)

    function onFrame(now, metadata) {
      times.push(metadata.mediaTime)
      if (times.length >= 15) {
        clearTimeout(timeout)
        video.pause()
        resolve(estimateFromTimes(times))
        return
      }
      video.requestVideoFrameCallback(onFrame)
    }

    video.currentTime = 0
    video.onseeked = () => {
      video.requestVideoFrameCallback(onFrame)
      video.play().catch(() => { clearTimeout(timeout); resolve(30) })
    }
  })
}

function estimateFromTimes(times) {
  if (times.length < 3) return 30

  const intervals = []
  for (let i = 1; i < times.length; i++) {
    const diff = times[i] - times[i - 1]
    if (diff > 0.001) intervals.push(diff)
  }
  if (intervals.length === 0) return 30

  intervals.sort((a, b) => a - b)
  const median = intervals[Math.floor(intervals.length / 2)]
  const rawFps = 1 / median

  const standards = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]
  let closest = 30, closestDiff = Infinity
  for (const std of standards) {
    const diff = Math.abs(rawFps - std)
    if (diff < closestDiff) { closestDiff = diff; closest = std }
  }
  return closest
}

// ── Frame capture (seeking-based) ──────────────────────────

/**
 * Capture every frame by sequential seeking.
 *
 * ALWAYS draws to canvas before creating VideoFrame. This:
 *  1. Guarantees we snapshot the actual decoded frame (not a stale texture)
 *  2. Handles scaling when needed
 *  3. Produces consistent results regardless of video element state
 *
 * Every frame gets an explicit `duration` so the muxer knows exactly
 * how long each frame should display. Without it, playback timing
 * was uneven ("steppy").
 */
async function captureFrames(video, encoder, opts) {
  const {
    totalFrames, outFps, duration,
    finalWidth, finalHeight,
    onProgress, startTime = 0,
  } = opts

  // Always use canvas — guarantees we get the actual painted frame
  const canvas = new OffscreenCanvas(finalWidth, finalHeight)
  const ctx = canvas.getContext('2d')
  const frameDurationUs = Math.round(1_000_000 / outFps)

  for (let i = 0; i < totalFrames; i++) {
    const time = startTime + (i / outFps)
    if (time > video.duration) break

    await seekTo(video, time)

    // Draw to canvas first — this forces a read of the video's current
    // decoded frame, guaranteeing we capture the correct content
    ctx.drawImage(video, 0, 0, finalWidth, finalHeight)

    const timestampUs = Math.round((time - startTime) * 1_000_000)

    // Explicit duration ensures correct playback timing
    const frame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: frameDurationUs,
    })

    const keyFrame = i % (outFps * 2) === 0
    encoder.encode(frame, { keyFrame })
    frame.close()

    // Back-pressure: wait if encoder queue is too deep
    while (encoder.encodeQueueSize > 8) {
      await new Promise(r => setTimeout(r, 5))
    }

    // Yield to UI + report progress every 20 frames
    if (i % 20 === 0) {
      onProgress(Math.round((i / totalFrames) * 85))
      await new Promise(r => setTimeout(r, 0))
    }
  }
}

// ── Audio extraction & encoding ────────────────────────────

async function extractAudioBuffer(file) {
  try {
    const audioCtx = new AudioContext()
    const arrayBuf = await file.arrayBuffer()
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf)
    audioCtx.close()
    return audioBuf
  } catch {
    return null
  }
}

async function encodeAudio(muxer, audioBuf, isWebm, maxDuration) {
  const numberOfChannels = Math.min(audioBuf.numberOfChannels, 2)
  const srcRate = audioBuf.sampleRate

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (err) => console.error('AudioEncoder error:', err),
  })

  audioEncoder.configure({
    codec: isWebm ? 'opus' : 'mp4a.40.2',
    numberOfChannels,
    sampleRate: srcRate,
    bitrate: 128_000,
  })

  const useDuration = Math.min(audioBuf.duration, maxDuration)
  const totalSamples = Math.floor(useDuration * srcRate)
  const chunkSize = 4096

  for (let offset = 0; offset < totalSamples; offset += chunkSize) {
    const remaining = Math.min(chunkSize, totalSamples - offset)

    const planarData = new Float32Array(remaining * numberOfChannels)
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const chanData = audioBuf.getChannelData(ch)
      planarData.set(chanData.subarray(offset, offset + remaining), ch * remaining)
    }

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: srcRate,
      numberOfFrames: remaining,
      numberOfChannels,
      timestamp: Math.round((offset / srcRate) * 1_000_000),
      data: planarData,
    })

    audioEncoder.encode(audioData)
    audioData.close()

    if ((offset / chunkSize) % 100 === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
  }

  await audioEncoder.flush()
  audioEncoder.close()
}

// ── Muxer setup ────────────────────────────────────────────

function createMuxer(fmt, finalWidth, finalHeight, outFps, includeAudio) {
  const isWebm = fmt === 'webm'

  if (isWebm) {
    const target = new WebmTarget()
    const muxer = new WebmMuxer({
      target,
      video: {
        codec: 'V_VP8',
        width: finalWidth,
        height: finalHeight,
        frameRate: outFps,
      },
      ...(includeAudio ? {
        audio: { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 },
      } : {}),
    })
    return { muxer, target, isWebm }
  }

  const target = new Mp4Target()
  const muxer = new Mp4Muxer({
    target,
    video: { codec: 'avc', width: finalWidth, height: finalHeight },
    ...(includeAudio ? {
      audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 44100 },
    } : {}),
    fastStart: 'in-memory',
  })
  return { muxer, target, isWebm }
}

// ── Main encode function ───────────────────────────────────

export async function encodeVideoWebCodecs(file, opts) {
  const {
    format: fmtSetting = 'auto',
    quality = 72,
    widths = [],
    fps: targetFps = 0,
    bitrate: userBitrate = 0,
    onProgress = () => {},
    onLog = () => {},
  } = opts

  const isGif = file.name.toLowerCase().endsWith('.gif') || file.type === 'image/gif'
  const fmt = fmtSetting === 'auto' ? 'mp4' : fmtSetting
  const baseName = file.name.replace(/\.[^.]+$/, '')

  if (fmt === 'gif') return null

  onProgress(2)
  onLog('Loading video for WebCodecs encode…')
  const video = await loadVideo(file)
  const srcWidth = video.videoWidth
  const srcHeight = video.videoHeight
  const duration = video.duration

  // Detect actual source FPS (brief playback probe)
  onLog('Detecting source frame rate…')
  const detectedFps = await detectFPS(video)
  const outFps = targetFps > 0 ? targetFps : detectedFps

  onLog(`Source: ${srcWidth}×${srcHeight}, ${duration.toFixed(1)}s, ${detectedFps}fps`)
  onLog(`Output: ${outFps}fps via WebCodecs ⚡ (seek capture)`)
  onProgress(5)

  const includeAudio = !isGif
  const targetWidths = widths.length > 0 ? widths : [0]
  const results = []

  for (let wi = 0; wi < targetWidths.length; wi++) {
    const w = targetWidths[wi]
    const outWidth = w > 0 ? w : srcWidth
    const scale = outWidth / srcWidth
    const outHeight = Math.round(srcHeight * scale)
    const finalWidth = outWidth % 2 === 0 ? outWidth : outWidth - 1
    const finalHeight = outHeight % 2 === 0 ? outHeight : outHeight - 1

    const isWebm = fmt === 'webm'
    const videoCodec = isWebm ? 'vp8' : 'avc1.640028'
    const videoBitrate = userBitrate > 0
      ? userBitrate * 1000
      : qualityToBitrate(quality, finalWidth, outFps)

    const totalFrames = Math.ceil(duration * outFps)

    onLog(`[${wi + 1}/${targetWidths.length}] Encoding ${finalWidth}×${finalHeight} @ ${outFps}fps…`)
    const t0 = performance.now()

    try {
      const { muxer, target } = createMuxer(fmt, finalWidth, finalHeight, outFps, includeAudio)

      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (err) => console.error('VideoEncoder error:', err),
      })

      encoder.configure({
        codec: videoCodec,
        width: finalWidth,
        height: finalHeight,
        bitrate: videoBitrate,
        framerate: outFps,
        latencyMode: 'realtime',
        hardwareAcceleration: 'prefer-hardware',
        ...(isWebm ? {} : { avc: { format: 'avc' } }),
      })

      // Capture all frames via sequential seeking
      await captureFrames(video, encoder, {
        totalFrames, outFps, duration,
        finalWidth, finalHeight,
        onProgress: (pct) => {
          const base = 5 + (wi / targetWidths.length) * 90
          const range = 90 / targetWidths.length
          onProgress(Math.round(base + (pct / 100) * range))
        },
      })

      await encoder.flush()
      encoder.close()

      // Audio extracted AFTER video to reduce peak memory
      if (includeAudio) {
        onLog('Encoding audio…')
        const audioBuf = await extractAudioBuffer(file)
        if (audioBuf) {
          await encodeAudio(muxer, audioBuf, isWebm, duration)
        }
      }

      muxer.finalize()

      const mimeType = isWebm ? 'video/webm' : 'video/mp4'
      const blob = new Blob([target.buffer], { type: mimeType })
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      onLog(`✓ ${finalWidth}px done — ${(blob.size / 1024 / 1024).toFixed(1)} MB in ${elapsed}s`)

      const filename = targetWidths.length > 1 && w > 0
        ? `${baseName}-${w}.${fmt}`
        : `${baseName}.${fmt}`
      results.push({ filename, blob, width: w })
    } catch (err) {
      onLog(`✗ Failed ${finalWidth}px: ${err.message}`)
      console.error('WebCodecs encode error:', err)
    }

    onProgress(5 + Math.round(((wi + 1) / targetWidths.length) * 93))
  }

  cleanupVideo(video)
  onProgress(100)
  return results.length > 0 ? results : null
}

// ── Preview encode (4s clip) ───────────────────────────────

export async function encodePreviewWebCodecs(file, opts) {
  const { quality = 72, startTime = 0 } = opts

  if (!supportsWebCodecs()) return null

  const video = await loadVideo(file)
  const duration = Math.min(4, video.duration - startTime)
  if (duration <= 0) {
    cleanupVideo(video)
    throw new Error('Selected time range is past the end of the video.')
  }

  const detectedFps = await detectFPS(video)
  const outFps = detectedFps
  const totalFrames = Math.ceil(duration * outFps)

  const width = video.videoWidth
  const height = video.videoHeight
  const finalWidth = width % 2 === 0 ? width : width - 1
  const finalHeight = height % 2 === 0 ? height : height - 1

  const bitrate = qualityToBitrate(quality, finalWidth, outFps) * 0.7
  const { muxer, target } = createMuxer('mp4', finalWidth, finalHeight, outFps, false)

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => console.error('Preview VideoEncoder error:', err),
  })

  encoder.configure({
    codec: 'avc1.640028',
    width: finalWidth,
    height: finalHeight,
    bitrate,
    framerate: outFps,
    latencyMode: 'realtime',
    hardwareAcceleration: 'prefer-hardware',
    avc: { format: 'avc' },
  })

  await captureFrames(video, encoder, {
    totalFrames, outFps, duration,
    finalWidth, finalHeight,
    onProgress: () => {},
    startTime,
  })

  await encoder.flush()
  encoder.close()
  muxer.finalize()

  cleanupVideo(video)

  const blob = new Blob([target.buffer], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)
  return { url, size: blob.size }
}
