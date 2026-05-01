/**
 * TIFF decode for browsers where createImageBitmap(File) fails (common in Chrome
 * for LZW / CMYK / layered TIFFs). Falls back to ffmpeg.wasm → PNG → canvas.
 */
import { getFFmpeg } from './ffmpegLoader.js'
import { ingestExt } from './mediaIngest.js'

function bitmapToCanvas(bmp) {
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  c.getContext('2d').drawImage(bmp, 0, 0)
  bmp.close?.()
  return c
}

/**
 * @param {File} file
 * @param {(msg: string) => void} [onLog]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function decodeTiffToCanvas(file, onLog = () => {}) {
  try {
    const bmp = await createImageBitmap(file)
    return bitmapToCanvas(bmp)
  } catch {
    onLog(`TIFF: native decode failed for “${file.name}” — trying ffmpeg…`)
  }

  const { ff, fetchFile } = await getFFmpeg(onLog)
  const ext = ingestExt(file.name) || 'tif'
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const inName = `tiff_in_${id}.${ext}`
  const outName = `tiff_out_${id}.png`

  await ff.writeFile(inName, await fetchFile(file))
  let ret = 1
  try {
    ret = await ff.exec(['-y', '-i', inName, '-frames:v', '1', outName])
  } finally {
    await ff.deleteFile(inName).catch(() => {})
  }

  let data
  try {
    data = await ff.readFile(outName)
  } finally {
    await ff.deleteFile(outName).catch(() => {})
  }

  const bytes = data && typeof data.byteLength === 'number' ? data.byteLength : 0
  if (!data || bytes === 0) {
    throw new Error(ret !== 0 ? `ffmpeg exit ${ret}` : 'empty decode output')
  }

  const blob = new Blob([data.slice ? data.slice(0) : data], { type: 'image/png' })
  const bmp = await createImageBitmap(blob)
  return bitmapToCanvas(bmp)
}
