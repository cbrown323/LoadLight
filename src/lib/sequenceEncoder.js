/**
 * Encode an image sequence to mp4/webm/gif via ffmpeg concat demuxer.
 */
import { getFFmpeg, formatFfmpegWorkerError } from './ffmpegLoader.js'
import { canUseFfmpegWasm } from './capabilitySupport.js'
import { ingestExt } from './mediaIngest.js'

/**
 * @param {object} fo — queue object with frames[]
 * @param {object} opts
 * @returns {Promise<{ blob: Blob, filename: string, width: number }[]>}
 */
export async function encodeImageSequence(fo, opts) {
  if (!canUseFfmpegWasm()) {
    throw new Error('Image sequence export requires ffmpeg.wasm in this browser.')
  }

  const {
    format = 'mp4',
    quality = 72,
    widths = [],
    fps = fo.fps || 24,
    bitrate = 0,
    labelWidthsInFilename = false,
    onProgress = () => {},
    onLog = () => {},
  } = opts

  const frames = fo.frames || []
  if (frames.length < 2) throw new Error('Sequence has too few frames to export.')

  const { ff } = await getFFmpeg(onLog)
  const tag = `seq_${Date.now()}`
  const listName = `${tag}_list.txt`
  const ext = ingestExt(frames[0].file.name) || 'png'

  onLog(`Writing ${frames.length} frames for ${fo.sequenceBaseName || fo.file.name}…`)

  /** @type {string[]} */
  const lines = []
  for (let i = 0; i < frames.length; i++) {
    const frameName = `${tag}_${String(i).padStart(5, '0')}.${ext}`
    const data = new Uint8Array(await frames[i].file.arrayBuffer())
    await ff.writeFile(frameName, data)
    lines.push(`file '${frameName}'`)
    lines.push(`duration ${1 / fps}`)
    if (i % 10 === 0) onProgress(Math.round((i / frames.length) * 40))
  }
  const lastName = `${tag}_${String(frames.length - 1).padStart(5, '0')}.${ext}`
  lines.push(`file '${lastName}'`)

  await ff.writeFile(listName, new TextEncoder().encode(lines.join('\n')))

  const targetWidths = widths.length ? widths : [0]
  /** @type {{ blob: Blob, filename: string, width: number }[]} */
  const outputs = []

  for (let wi = 0; wi < targetWidths.length; wi++) {
    const width = targetWidths[wi]
    const outName = `${tag}_out.${format === 'jpeg' ? 'jpg' : format}`
    const args = ['-f', 'concat', '-safe', '0', '-i', listName, '-r', String(fps)]

    if (width > 0) args.push('-vf', `scale=${width}:-2`)

    if (format === 'gif') {
      const gifFps = fps > 0 ? fps : 15
      const scaleW = width > 0 ? width : 'iw'
      args.push(
        '-vf', `fps=${gifFps},scale=${scaleW}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=128[p];[s1][p]paletteuse`,
      )
    } else if (format === 'webm') {
      args.push('-c:v', 'libvpx', '-b:v', bitrate > 0 ? `${bitrate}k` : '2M')
    } else if (format === 'mp4') {
      const crf = Math.round(40 - (quality / 100) * 22)
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf))
      if (bitrate > 0) args.push('-b:v', `${bitrate}k`)
    }

    args.push('-y', outName)
    onLog(`Encoding sequence → ${format.toUpperCase()}${width ? ` @ ${width}px` : ''}…`)
    const ret = await ff.exec(args)
    if (ret !== 0) throw new Error(formatFfmpegWorkerError(`ffmpeg exited ${ret}`))

    const outData = await ff.readFile(outName)
    if (!outData || outData.byteLength === 0) {
      throw new Error('Sequence encode produced an empty file.')
    }
    const blob = new Blob([outData.slice(0)], { type: mimeForFormat(format) })
    const base = (fo.sequenceBaseName || fo.file.name.replace(/\.[^.]+$/, ''))
      .replace(/\.+$/, '')
    const suffix = labelWidthsInFilename && width > 0 ? `-${width}` : ''
    outputs.push({
      blob,
      filename: `${base}${suffix}.${format === 'jpeg' ? 'jpg' : format}`,
      width: width || fo.width || 0,
    })

    try { await ff.deleteFile(outName) } catch (_) {}
    onProgress(40 + Math.round(((wi + 1) / targetWidths.length) * 60))
  }

  for (let i = 0; i < frames.length; i++) {
    try { await ff.deleteFile(`${tag}_${String(i).padStart(5, '0')}.${ext}`) } catch (_) {}
  }
  try { await ff.deleteFile(listName) } catch (_) {}

  onProgress(100)
  return outputs
}

/** @param {string} format */
function mimeForFormat(format) {
  if (format === 'webm') return 'video/webm'
  if (format === 'gif') return 'image/gif'
  return 'video/mp4'
}
