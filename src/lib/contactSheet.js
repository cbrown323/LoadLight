import { CanvasSink } from 'mediabunny'
import { withInput, canvasToJpeg } from './mediaInspector.js'

/** Generate a bounded, sequentially decoded sheet; labels use actual frame timestamps. */
export function createContactSheet(file, { count = 12, signal, onProgress = () => {} } = {}) {
  if (![6, 12, 24].includes(count)) throw new Error('Choose 6, 12, or 24 frames.')
  return withInput(file, signal, async (input) => {
    if (!await input.canRead()) throw new Error('Contact sheets are unavailable for this container.')
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw new Error('This browser cannot decode this video for a contact sheet.')
    const start = await track.getFirstTimestamp()
    const end = await track.computeDuration()
    if (!Number.isFinite(end) || end <= start) throw new Error('The video has no readable duration.')
    const columns = 3, tileWidth = 320, tileHeight = 180, labelHeight = 28, gap = 12
    const canvas = document.createElement('canvas')
    canvas.width = columns * (tileWidth + gap) + gap
    canvas.height = Math.ceil(count / columns) * (tileHeight + labelHeight + gap) + gap
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The browser could not create a contact sheet.')
    context.fillStyle = '#16191d'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.font = '14px monospace'
    const sink = new CanvasSink(track, { width: tileWidth, height: tileHeight, fit: 'contain', poolSize: 1 })
    const timestamps = []
    for (let index = 0; index < count; index++) {
      signal?.throwIfAborted()
      const frame = await sink.getCanvas(start + (end - start) * index / count)
      if (!frame) throw new Error('A frame could not be read. Try another video.')
      const x = gap + (index % columns) * (tileWidth + gap)
      const y = gap + Math.floor(index / columns) * (tileHeight + labelHeight + gap)
      context.drawImage(frame.canvas, x, y, tileWidth, tileHeight)
      context.fillStyle = '#ffffff'
      context.fillText(`${frame.timestamp.toFixed(3)} s`, x + 8, y + tileHeight + 19)
      timestamps.push(frame.timestamp)
      onProgress(Math.round((index + 1) / count * 100))
    }
    signal?.throwIfAborted()
    return { blob: await canvasToJpeg(canvas), timestamps, width: canvas.width, height: canvas.height }
  })
}
