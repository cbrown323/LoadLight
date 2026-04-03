/**
 * webCodecsEncoder.js — Hardware-accelerated video encoding via WebCodecs API
 *
 * Uses the browser's built-in hardware encoder (VideoEncoder / AudioEncoder)
 * instead of ffmpeg.wasm's software x264. Typically 10–50× faster.
 *
 * Flow:
 *  1. Load video via <video> element (browser's native decoder)
 *  2. Seek frame-by-frame, capture via VideoFrame
 *  3. Encode with VideoEncoder (hardware accelerated H.264 / VP8)
 *  4. Encode audio with AudioEncoder
 *  5. Mux into MP4 / WebM container via mp4-muxer / webm-muxer
 *
 * Falls back to null if WebCodecs is unavailable (caller should use ffmpeg.wasm).
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

/** Map quality 0-100 → bitrate (bps) for a given width */
function qualityToBitrate(quality, width, fps) {
  // Rough mapping: higher quality and higher resolution = higher bitrate
  const base = width * width * (fps || 30) * 0.07
  const factor = 0.3 + (quality / 100) * 1.7 // 0.3x at q=0, 2.0x at q=100
  return Math.round(base * factor)
}

// ── Audio extraction ───────────────────────────────────────

async function extractAudioBuffer(file) {
  try {
    const audioCtx = new AudioContext()
    const arrayBuf = await file.arrayBuffer()
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf)
    audioCtx.close()
    return audioBuf
  } catch {
    return null // no audio track or decode failed — that's fine
  }
}

/**
 * Convert AudioBuffer to interleaved Float32 samples for AudioEncoder.
 * Returns { data: Float32Array, numberOfChannels, sampleRate }
 */
function audioBufferToFloat32(audioBuf) {
  const numberOfChannels = Math.min(audioBuf.numberOfChannels, 2) // stereo max
  const sampleRate = audioBuf.sampleRate
  const length = audioBuf.length

  if (numberOfChannels === 1) {
    return { data: audioBuf.getChannelData(0), numberOfChannels, sampleRate, length }
  }

  // Interleave stereo
  const left = audioBuf.getChannelData(0)
  const right = audioBuf.getChannelData(1)
  const interleaved = new Float32Array(length * 2)
  for (let i = 0; i < length; i++) {
    interleaved[i * 2] = left[i]
    interleaved[i * 2 + 1] = right[i]
  }
  return { data: interleaved, numberOfChannels, sampleRate, length }
}

// ── Frame extraction helpers ───────────────────────────────

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = URL.createObjectURL(file)

    video.onloadedmetadata = () => {
      // Need to also wait for enough data to seek
      video.oncanplaythrough = () => resolve(video)
      video.onerror = reject
    }
    video.onerror = reject
    video.load()
  })
}

function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      resolve()
      return
    }
    video.onseeked = () => resolve()
    video.currentTime = time
  })
}

// ── Main encode function ───────────────────────────────────

/**
 * Encode a video file using WebCodecs + mp4-muxer/webm-muxer.
 *
 * Returns the same shape as videoEncoder.js's encodeVideo():
 *   { filename, blob, width }[]
 */
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

  // GIF output isn't supported via WebCodecs — caller should use ffmpeg.wasm
  if (fmt === 'gif') return null

  onProgress(2)
  onLog('Loading video for WebCodecs encode…')
  const video = await loadVideo(file)
  const srcWidth = video.videoWidth
  const srcHeight = video.videoHeight
  const duration = video.duration
  const srcFps = 30 // Browser doesn't expose exact FPS; default to 30
  const outFps = targetFps > 0 ? targetFps : srcFps

  onLog(`Source: ${srcWidth}×${srcHeight}, ${duration.toFixed(1)}s`)
  onLog(`Encoding via WebCodecs ⚡ (hardware-accelerated)`)
  onProgress(5)

  // Extract audio in parallel
  const includeAudio = !isGif
  const audioBufPromise = includeAudio ? extractAudioBuffer(file) : Promise.resolve(null)

  const targetWidths = widths.length > 0 ? widths : [0]
  const results = []

  for (let wi = 0; wi < targetWidths.length; wi++) {
    const w = targetWidths[wi]
    const outWidth = w > 0 ? w : srcWidth
    const scale = outWidth / srcWidth
    const outHeight = Math.round(srcHeight * scale)
    // Ensure even dimensions (required by most codecs)
    const finalWidth = outWidth % 2 === 0 ? outWidth : outWidth - 1
    const finalHeight = outHeight % 2 === 0 ? outHeight : outHeight - 1

    onLog(`Encoding ${finalWidth}×${finalHeight} @ ${outFps}fps…`)
    const t0 = performance.now()

    try {
      const blob = await encodeSingleResolution({
        video,
        file,
        audioBufPromise,
        fmt,
        finalWidth,
        finalHeight,
        outFps,
        duration,
        quality,
        userBitrate,
        includeAudio,
        onProgress: (pct) => {
          const base = 5 + (wi / targetWidths.length) * 90
          const range = 90 / targetWidths.length
          onProgress(Math.round(base + (pct / 100) * range))
        },
        onLog,
      })

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

  // Clean up
  URL.revokeObjectURL(video.src)
  onProgress(100)
  return results.length > 0 ? results : null // null signals fallback to WASM
}

// ── Single resolution encode ───────────────────────────────

async function encodeSingleResolution(params) {
  const {
    video, file, audioBufPromise, fmt,
    finalWidth, finalHeight, outFps, duration,
    quality, userBitrate, includeAudio,
    onProgress, onLog,
  } = params

  const isWebm = fmt === 'webm'
  const totalFrames = Math.ceil(duration * outFps)
  const frameDuration = 1_000_000 / outFps // microseconds

  // ── Set up muxer ──
  let muxer, target

  const videoBitrate = userBitrate > 0
    ? userBitrate * 1000
    : qualityToBitrate(quality, finalWidth, outFps)

  if (isWebm) {
    target = new WebmTarget()
    muxer = new WebmMuxer({
      target,
      video: {
        codec: 'V_VP8',
        width: finalWidth,
        height: finalHeight,
        frameRate: outFps,
      },
      ...(includeAudio ? {
        audio: {
          codec: 'A_OPUS',
          numberOfChannels: 2,
          sampleRate: 48000,
        },
      } : {}),
    })
  } else {
    target = new Mp4Target()
    muxer = new Mp4Muxer({
      target,
      video: {
        codec: 'avc',
        width: finalWidth,
        height: finalHeight,
      },
      ...(includeAudio ? {
        audio: {
          codec: 'aac',
          numberOfChannels: 2,
          sampleRate: 44100,
        },
      } : {}),
      fastStart: 'in-memory',
    })
  }

  // ── Set up video encoder ──
  let videoEncoderDone
  const videoEncoderPromise = new Promise(r => { videoEncoderDone = r })
  let encodedFrames = 0

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta)
      encodedFrames++
      onProgress(Math.round((encodedFrames / totalFrames) * 85))
    },
    error: (err) => {
      console.error('VideoEncoder error:', err)
    },
  })

  const videoCodec = isWebm ? 'vp8' : 'avc1.640028' // H.264 High Level 4.0

  videoEncoder.configure({
    codec: videoCodec,
    width: finalWidth,
    height: finalHeight,
    bitrate: videoBitrate,
    framerate: outFps,
    latencyMode: 'quality',
    ...(isWebm ? {} : {
      avc: { format: 'avc' },
    }),
  })

  // ── Set up canvas for frame capture ──
  const canvas = new OffscreenCanvas(finalWidth, finalHeight)
  const ctx = canvas.getContext('2d')

  // ── Extract frames ──
  onLog(`Extracting ${totalFrames} frames…`)

  for (let i = 0; i < totalFrames; i++) {
    const time = i / outFps

    // Don't seek past the end
    if (time > duration) break

    await seekTo(video, time)

    // Draw video frame to canvas (handles scaling)
    ctx.drawImage(video, 0, 0, finalWidth, finalHeight)

    // Create VideoFrame from canvas
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    })

    // Encode — keyframe every 2 seconds
    const keyFrame = i % (outFps * 2) === 0
    videoEncoder.encode(frame, { keyFrame })
    frame.close()

    // Yield to UI thread periodically
    if (i % 10 === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
  }

  // Flush remaining frames
  await videoEncoder.flush()
  videoEncoder.close()

  // ── Encode audio ──
  if (includeAudio) {
    const audioBuf = await audioBufPromise
    if (audioBuf) {
      onLog('Encoding audio…')
      onProgress(88)
      await encodeAudio(muxer, audioBuf, isWebm, duration)
    }
  }

  onProgress(95)

  // ── Finalize ──
  muxer.finalize()

  const mimeType = isWebm ? 'video/webm' : 'video/mp4'
  const blob = new Blob([target.buffer], { type: mimeType })
  return blob
}

// ── Audio encoder ──────────────────────────────────────────

async function encodeAudio(muxer, audioBuf, isWebm, maxDuration) {
  const targetSampleRate = isWebm ? 48000 : 44100
  const numberOfChannels = Math.min(audioBuf.numberOfChannels, 2)

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      muxer.addAudioChunk(chunk, meta)
    },
    error: (err) => console.error('AudioEncoder error:', err),
  })

  audioEncoder.configure({
    codec: isWebm ? 'opus' : 'mp4a.40.2', // Opus for WebM, AAC-LC for MP4
    numberOfChannels,
    sampleRate: targetSampleRate,
    bitrate: 128_000,
  })

  // Resample if needed and create AudioData chunks
  const srcRate = audioBuf.sampleRate
  const useDuration = Math.min(audioBuf.duration, maxDuration)
  const totalSamples = Math.floor(useDuration * srcRate)

  // Process audio in chunks of 1024 samples
  const chunkSize = 1024
  for (let offset = 0; offset < totalSamples; offset += chunkSize) {
    const remaining = Math.min(chunkSize, totalSamples - offset)

    // Gather planar data
    const planarData = new Float32Array(remaining * numberOfChannels)
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const chanData = audioBuf.getChannelData(ch)
      for (let s = 0; s < remaining; s++) {
        planarData[ch * remaining + s] = chanData[offset + s]
      }
    }

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: srcRate,
      numberOfFrames: remaining,
      numberOfChannels,
      timestamp: Math.round((offset / srcRate) * 1_000_000), // microseconds
      data: planarData,
    })

    audioEncoder.encode(audioData)
    audioData.close()

    // Yield periodically
    if ((offset / chunkSize) % 50 === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
  }

  await audioEncoder.flush()
  audioEncoder.close()
}

// ── Preview encode (4s clip) ───────────────────────────────

/**
 * Encode a short preview clip using WebCodecs.
 * Returns { url, size } — same as videoPreviewEncoder.js
 */
export async function encodePreviewWebCodecs(file, opts) {
  const {
    quality = 72,
    startTime = 0,
  } = opts

  if (!supportsWebCodecs()) return null

  const video = await loadVideo(file)
  const duration = Math.min(4, video.duration - startTime)
  if (duration <= 0) {
    URL.revokeObjectURL(video.src)
    throw new Error('Selected time range is past the end of the video.')
  }

  const outFps = 30
  const totalFrames = Math.ceil(duration * outFps)
  const frameDuration = 1_000_000 / outFps
  const width = video.videoWidth
  const height = video.videoHeight
  // Ensure even
  const finalWidth = width % 2 === 0 ? width : width - 1
  const finalHeight = height % 2 === 0 ? height : height - 1

  const bitrate = qualityToBitrate(quality, finalWidth, outFps) * 0.7 // slightly lower for preview
  const target = new Mp4Target()
  const muxer = new Mp4Muxer({
    target,
    video: {
      codec: 'avc',
      width: finalWidth,
      height: finalHeight,
    },
    fastStart: 'in-memory',
  })

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => console.error('Preview VideoEncoder error:', err),
  })

  videoEncoder.configure({
    codec: 'avc1.640028',
    width: finalWidth,
    height: finalHeight,
    bitrate,
    framerate: outFps,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  })

  const canvas = new OffscreenCanvas(finalWidth, finalHeight)
  const ctx = canvas.getContext('2d')

  for (let i = 0; i < totalFrames; i++) {
    const time = startTime + (i / outFps)
    if (time > video.duration) break

    await seekTo(video, time)
    ctx.drawImage(video, 0, 0, finalWidth, finalHeight)

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    })

    videoEncoder.encode(frame, { keyFrame: i % (outFps * 2) === 0 })
    frame.close()

    if (i % 10 === 0) await new Promise(r => setTimeout(r, 0))
  }

  await videoEncoder.flush()
  videoEncoder.close()
  muxer.finalize()

  URL.revokeObjectURL(video.src)

  const blob = new Blob([target.buffer], { type: 'video/mp4' })
  const url = URL.createObjectURL(blob)
  return { url, size: blob.size }
}
