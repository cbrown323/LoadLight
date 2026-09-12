import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import { isVideoLike, validateIngestFile } from './mediaIngest.js'

/** Read from the File lazily; dispose readers on completion, cancellation, or timeout. */
export async function withInput(file, signal, operation) {
  const validation = validateIngestFile(file)
  if (!validation.ok) throw new Error(validation.reason)
  if (!isVideoLike(file)) throw new Error('Select a video for track inspection.')
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  let timer
  let abort
  const interrupted = new Promise((_, reject) => {
    abort = () => {
      reject(new DOMException('Cancelled', 'AbortError'))
      input.dispose()
    }
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      reject(new Error('Media reading timed out. Try a smaller or different file.'))
      input.dispose()
    }, 30000)
  })
  try {
    return await Promise.race([operation(input), interrupted])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    input.dispose()
  }
}

/** Inspect encoded tracks without decoding the full file. Capability is specific to this browser. */
export function inspectMedia(file, { signal } = {}) {
  return withInput(file, signal, async (input) => {
    if (!await input.canRead()) throw new Error('This container is not supported by the inspector. The existing export options remain available.')
    const format = await input.getFormat()
    const duration = await input.computeDuration()
    const primary = await input.getPrimaryVideoTrack()
    const tracks = []
    let audioIndex = 0
    for (const track of await input.getTracks()) {
      const info = {
        id: track.id, type: track.type,
        codec: await track.getCodecParameterString() || await track.getCodec() || 'Unknown',
        decodable: await track.canDecode().catch(() => null),
      }
      if (track.isVideoTrack()) {
        Object.assign(info, {
          width: await track.getDisplayWidth(), height: await track.getDisplayHeight(),
          rotation: await track.getRotation(),
          // Bounded sampling; do not label this as an exact constant frame rate.
          fps: (await track.computePacketStats(120)).averagePacketRate,
        })
      } else if (track.isAudioTrack()) {
        info.audioIndex = audioIndex++
        info.language = await track.getLanguageCode()
        info.name = await track.getName()
        info.sampleRate = await track.getSampleRate()
        info.channels = await track.getNumberOfChannels()
      }
      tracks.push(info)
    }
    return { container: format.name, duration, tracks,
      posterSupported: !!primary && tracks.find((track) => track.id === primary.id)?.decodable === true }
  })
}

/** Select the last presented frame at/before the requested source time, including the end of a clip. */
export function extractVideoPoster(file, timestamp = 0, { signal } = {}) {
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Poster time must be a non-negative number of seconds.')
  return withInput(file, signal, async (input) => {
    if (!await input.canRead()) throw new Error('Accurate posters are not supported for this container.')
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No video track was found for the poster.')
    if (!await track.canDecode()) throw new Error('This browser cannot decode the video codec for an accurate poster.')
    const start = await track.getFirstTimestamp()
    const end = await track.computeDuration()
    const requested = Math.max(start, Math.min(timestamp, end))
    const frame = await new CanvasSink(track, { poolSize: 1 }).getCanvas(requested)
    if (!frame) throw new Error('No video frame exists at the selected time.')
    const blob = await canvasToJpeg(frame.canvas)
    return { blob, timestamp: frame.timestamp, width: frame.canvas.width, height: frame.canvas.height }
  })
}

export async function canvasToJpeg(canvas) {
  const blob = typeof canvas.convertToBlob === 'function'
    ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
    : await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
  if (!blob || blob.type !== 'image/jpeg') throw new Error('The browser could not create a JPEG poster.')
  return blob
}
