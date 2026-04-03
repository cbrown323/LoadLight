/**
 * webCodecsEncoder.js — Hardware-accelerated video encoding via WebCodecs API
 *
 * v3: Fixed frame timing + FPS detection.
 *
 * Key design decisions:
 *  1. Source FPS detection via requestVideoFrameCallback — measures actual
 *     frame intervals from the decoded video instead of guessing 30fps
 *  2. Playback capture at 2× speed — 8× was too fast, browser dropped frames
 *     and produced black output. 2× is still faster than realtime while
 *     giving the decoder time to produce every frame.
 *  3. Timestamps from metadata.mediaTime — uses the browser's actual decode
 *     timestamps instead of computed frameIndex × frameDuration.
 *     This preserves the original video's timing exactly.
 *  4. hardwareAcceleration: 'prefer-hardware' — explicitly requests GPU path
 *  5. latencyMode: 'realtime' — skip look-ahead analysis for faster encode
 *  6. Direct VideoFrame from <video> when no scaling — skips canvas copy
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

    video.onloadedmetadata = () => {
      video.oncanplaythrough = () => resolve(video)
      video.onerror = reject
    }
    video.onerror = reject
    video.load()
  })
}

function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) { resolve(); return }
    video.onseeked = () => resolve()
    video.currentTime = time
  })
}

/**
 * Detect the actual frame rate of a video by playing it briefly
 * and measuring frame intervals via requestVideoFrameCallback.
 * Falls back to 30fps if detection fails.
 */
async function detectFPS(video) {
  if (!hasRVFC()) return 30

  return new Promise((resolve) => {
    const times = []
    let callbackId = null
    const timeout = setTimeout(() => {
      video.pause()
      resolve(estimateFromTimes(times))
    }, 2000) // Max 2s to detect

    function onFrame(now, metadata) {
      times.push(metadata.mediaTime)

      if (times.length >= 15) {
        // Enough samples to estimate
        clearTimeout(timeout)
        video.pause()
        resolve(estimateFromTimes(times))
        return
      }

      callbackId = video.requestVideoFrameCallback(onFrame)
    }

    // Seek to start and play briefly
    video.currentTime = 0
    video.onseeked = () => {
      callbackId = video.requestVideoFrameCallback(onFrame)
      video.play().catch(() => {
        clearTimeout(timeout)
        resolve(30)
      })
    }
  })
}

function estimateFromTimes(times) {
  if (times.length < 3) return 30

  // Calculate median interval
  const intervals = []
  for (let i = 1; i < times.length; i++) {
    const diff = times[i] - times[i - 1]
    if (diff > 0.001) intervals.push(diff)
  }

  if (intervals.length === 0) return 30

  intervals.sort((a, b) => a - b)
  const median = intervals[Math.floor(intervals.length / 2)]

  // Round to nearest standard FPS
  const rawFps = 1 / median
  const standards = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]
  let closest = 30
  let closestDiff = Infinity
  for (const std of standards) {
    const diff = Math.abs(rawFps - std)
    if (diff < closestDiff) {
      closestDiff = diff
      closest = std
    }
  }

  return closest
}

// ── Frame capture strategies ───────────────────────────────

/**
 * FAST: Capture frames by playing video and using requestVideoFrameCallback.
 *
 * Key fix (v3): Uses metadata.mediaTime for timestamps instead of computed
 * frameIndex × frameDuration. This preserves the original video's frame
 * timing exactly. Playback rate capped at 2× to prevent dropped frames
 * and black frame output.
 */
async function captureFramesPlayback(video, encoder, opts) {
  const {
    duration, finalWidth, finalHeight, srcWidth, srcHeight,
    needsScaling, canvas, ctx, onProgress, outFps,
  } = opts

  await seekTo(video, 0)

  return new Promise((resolve, reject) => {
    let frameCount = 0
    let lastMediaTime = -Infinity

    function processFrame(now, metadata) {
      const mediaTime = metadata.mediaTime

      // Skip duplicate frames (same mediaTime)
      if (mediaTime - lastMediaTime < 0.001) {
        video.requestVideoFrameCallback(processFrame)
        return
      }
      lastMediaTime = mediaTime

      try {
        // Use actual media time for timestamp — preserves original timing
        const timestampUs = Math.round(mediaTime * 1_000_000)

        let frame
        if (needsScaling) {
          ctx.drawImage(video, 0, 0, finalWidth, finalHeight)
          frame = new VideoFrame(canvas, { timestamp: timestampUs })
        } else {
          frame = new VideoFrame(video, { timestamp: timestampUs })
        }

        // Keyframe every ~2 seconds based on actual time
        const keyFrame = frameCount === 0 || (mediaTime - 0) % 2.0 < (1 / outFps)
        encoder.encode(frame, { keyFrame })
        frame.close()
        frameCount++

        onProgress(Math.round((mediaTime / duration) * 85))
      } catch (err) {
        console.warn('Frame capture error at', mediaTime.toFixed(2) + 's:', err.message)
      }

      video.requestVideoFrameCallback(processFrame)
    }

    video.onerror = () => reject(new Error('Video playback error during capture'))

    video.onended = () => {
      video.pause()
      resolve(frameCount)
    }

    video.requestVideoFrameCallback(processFrame)

    // 2× speed: fast enough to be quicker than realtime, slow enough
    // that the browser can decode every frame without dropping/black output
    video.playbackRate = 2
    video.play().catch(reject)
  })
}

/**
 * FALLBACK: Frame-by-frame seeking (slower, but works everywhere).
 */
async function captureFramesSeeking(video, encoder, opts) {
  const {
    totalFrames, outFps, duration, frameDuration,
    finalWidth, finalHeight, needsScaling, canvas, ctx,
    onProgress, startTime = 0,
  } = opts

  for (let i = 0; i < totalFrames; i++) {
    const time = startTime + (i / outFps)
    if (time > video.duration) break

    await seekTo(video, time)

    // Use actual time for timestamp, not computed index
    const timestampUs = Math.round((time - startTime) * 1_000_000)

    let frame
    if (needsScaling) {
      ctx.drawImage(video, 0, 0, finalWidth, finalHeight)
      frame = new VideoFrame(canvas, { timestamp: timestampUs })
    } else {
      frame = new VideoFrame(video, { timestamp: timestampUs })
    }

    const keyFrame = i % (outFps * 2) === 0
    encoder.encode(frame, { keyFrame })
    frame.close()

    // Back-pressure: wait if encoder queue is filling up
    if (encoder.encodeQueueSize > 5) {
      await new Promise(r => setTimeout(r, 1))
    }

    if (i % 30 === 0) {
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
  const useRVFC = hasRVFC()

  // Detect actual source FPS instead of guessing 30
  onLog('Detecting source frame rate…')
  const detectedFps = await detectFPS(video)
  const outFps = targetFps > 0 ? targetFps : detectedFps

  onLog(`Source: ${srcWidth}×${srcHeight}, ${duration.toFixed(1)}s, ${detectedFps}fps`)
  onLog(`Output: ${outFps}fps via WebCodecs ⚡ (${useRVFC ? 'playback capture' : 'seek capture'})`)
  onProgress(5)

  const includeAudio = !isGif
  const audioBufPromise = includeAudio ? extractAudioBuffer(file) : Promise.resolve(null)

  const targetWidths = widths.length > 0 ? widths : [0]
  const results = []

  for (let wi = 0; wi < targetWidths.length; wi++) {
    const w = targetWidths[wi]
    const outWidth = w > 0 ? w : srcWidth
    const scale = outWidth / srcWidth
    const outHeight = Math.round(srcHeight * scale)
    const finalWidth = outWidth % 2 === 0 ? outWidth : outWidth - 1
    const finalHeight = outHeight % 2 === 0 ? outHeight : outHeight - 1
    const needsScaling = finalWidth !== srcWidth || finalHeight !== srcHeight

    const isWebm = fmt === 'webm'
    const videoCodec = isWebm ? 'vp8' : 'avc1.640028'
    const videoBitrate = userBitrate > 0
      ? userBitrate * 1000
      : qualityToBitrate(quality, finalWidth, outFps)

    const totalFrames = Math.ceil(duration * outFps)
    const frameDuration = 1_000_000 / outFps

    onLog(`Encoding ${finalWidth}×${finalHeight} @ ${outFps}fps (${needsScaling ? 'scaling' : 'direct'})…`)
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

      let canvas = null, ctx = null
      if (needsScaling) {
        canvas = new OffscreenCanvas(finalWidth, finalHeight)
        ctx = canvas.getContext('2d')
      }

      const captureOpts = {
        totalFrames, outFps, duration, frameDuration,
        finalWidth, finalHeight, srcWidth, srcHeight,
        needsScaling, canvas, ctx,
        onProgress: (pct) => {
          const base = 5 + (wi / targetWidths.length) * 90
          const range = 90 / targetWidths.length
          onProgress(Math.round(base + (pct / 100) * range))
        },
      }

      if (useRVFC) {
        const capturedCount = await captureFramesPlayback(video, encoder, captureOpts)
        onLog(`Captured ${capturedCount} frames via playback`)
      } else {
        await captureFramesSeeking(video, encoder, captureOpts)
      }

      await encoder.flush()
      encoder.close()

      if (includeAudio) {
        const audioBuf = await audioBufPromise
        if (audioBuf) {
          onLog('Encoding audio…')
          await encodeAudio(muxer, audioBuf, isWebm, duration)
        }
      }

      muxer.finalize()

      const mimeType = isWebm ? 'video/webm' : 'video/mp4'
      const blob = new Blob([target.buffer], { type: mimeType })
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      onLog(`✓ Encoded ${finalWidth}px in ${elapsed}s (WebCodecs)`)

      const filename = targetWidths.length > 1 && w > 0
        ? `${baseName}-${w}.${fmt}`
        : `${baseName}.${fmt}`
      results.push({ filename, blob, width: w })
    } catch (err) {
      onLog(`✗ WebCodecs encode failed for ${finalWidth}px: ${err.message}`)
      console.error('WebCodecs encode error:', err)
    }

    onProgress(5 + Math.round(((wi + 1) / targetWidths.length) * 93))
  }

  URL.revokeObjectURL(video.src)
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
    URL.revokeObjectURL(video.src)
    throw new Error('Selected time range is past the end of the video.')
  }

  // Detect source FPS for the preview too
  const detectedFps = await detectFPS(video)
  const outFps = detectedFps
  const totalFrames = Math.ceil(duration * outFps)
  const frameDuration = 1_000_000 / outFps

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

  // Preview uses seeking since we start at startTime
  await captureFramesSeeking(video, encoder, {
    totalFrames, outFps, duration, frameDuration,
    finalWidth, finalHeight,
    srcWidth: video.videoWidth, srcHeight: video.videoHeight,
    needsScaling: false, canvas: null, ctx: null,
    onProgress: () => {},
    startTime,
  })

  await encoder.flush()
  encoder.close()
  muxer.finalize()

  URL.revokeObjectURL(video.src)

  const blob = new Blob([target.buffer], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)
  return { url, size: blob.size }
}
