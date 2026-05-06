/**
 * Shared high-quality downscale for canvas drawImage sources (ImageBitmap, HTMLVideoElement, CanvasImageSource).
 * Matches the former imageEncoder pipeline: multi-step halving + mild unsharp for strong reductions.
 */

/**
 * @param {HTMLCanvasElement} src
 * @param {number} strength
 * @returns {HTMLCanvasElement}
 */
export function sharpenCanvas(src, strength = 0.25) {
  const w = src.width
  const h = src.height
  const ctx = src.getContext('2d')
  const imageData = ctx.getImageData(0, 0, w, h)
  const d = imageData.data
  const out = new Uint8ClampedArray(d.length)

  const kernel = [
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0,
  ]

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        let val = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const ni = ((y + ky) * w + (x + kx)) * 4
            val += d[ni + c] * kernel[(ky + 1) * 3 + (kx + 1)]
          }
        }
        out[i + c] = Math.round(d[i + c] * (1 - strength) + Math.min(255, Math.max(0, val)) * strength)
      }
      out[i + 3] = d[i + 3]
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y === 0 || y === h - 1 || x === 0 || x === w - 1) {
        const i = (y * w + x) * 4
        out[i] = d[i]
        out[i + 1] = d[i + 1]
        out[i + 2] = d[i + 2]
        out[i + 3] = d[i + 3]
      }
    }
  }

  ctx.putImageData(new ImageData(out, w, h), 0, 0)
  return src
}

/**
 * Multi-step halving until within 2× of target, then exact size.
 * @param {CanvasImageSource} source
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} targetW
 * @param {number} targetH
 */
function multiStepResize(source, srcW, srcH, targetW, targetH) {
  let curW = srcW
  let curH = srcH
  /** @type {CanvasImageSource} */
  let cur = source

  while (curW * 0.5 > targetW || curH * 0.5 > targetH) {
    const nextW = Math.max(Math.round(curW * 0.5), targetW)
    const nextH = Math.max(Math.round(curH * 0.5), targetH)
    const step = document.createElement('canvas')
    step.width = nextW
    step.height = nextH
    const sctx = step.getContext('2d')
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(cur, 0, 0, nextW, nextH)
    cur = step
    curW = nextW
    curH = nextH
  }

  const out = document.createElement('canvas')
  out.width = targetW
  out.height = targetH
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, targetW, targetH)
  return out
}

/**
 * Downscale a still-image source to a new canvas (export stills).
 * @param {CanvasImageSource} source
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} targetW
 * @param {number} targetH
 */
export function downscaleImageSourceToCanvas(source, srcW, srcH, targetW, targetH) {
  const scale = targetW > 0 && targetW < srcW ? targetW / srcW : 1
  if (scale >= 0.75) {
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, targetW, targetH)
    return canvas
  }
  const canvas = multiStepResize(source, srcW, srcH, targetW, targetH)
  const sharpenStrength = scale < 0.4 ? 0.35 : 0.22
  sharpenCanvas(canvas, sharpenStrength)
  return canvas
}

/**
 * Reusable per-output-resolution scaler for video frames (avoids reallocating step canvases every frame).
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} destW
 * @param {number} destH
 */
export function createVideoFrameScaler(srcW, srcH, destW, destH) {
  const scale = destW < srcW * 0.999 || destH < srcH * 0.999 ? destW / srcW : 1

  if (scale >= 0.75) {
    return {
      /** @param {HTMLVideoElement} video */
      draw(video, destCanvas) {
        const ctx = destCanvas.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(video, 0, 0, destW, destH)
      },
    }
  }

  const pads = []
  let cw = srcW
  let ch = srcH
  while (cw * 0.5 > destW || ch * 0.5 > destH) {
    const nextW = Math.max(Math.round(cw * 0.5), destW)
    const nextH = Math.max(Math.round(ch * 0.5), destH)
    const c = document.createElement('canvas')
    c.width = nextW
    c.height = nextH
    pads.push(c)
    cw = nextW
    ch = nextH
  }

  const sharpenStrength = scale < 0.4 ? 0.35 : 0.22

  return {
    /** @param {HTMLVideoElement} video */
    draw(video, destCanvas) {
      /** @type {CanvasImageSource} */
      let cur = video
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i]
        const pctx = pad.getContext('2d')
        pctx.imageSmoothingEnabled = true
        pctx.imageSmoothingQuality = 'high'
        pctx.drawImage(cur, 0, 0, pad.width, pad.height)
        cur = pad
      }
      const dctx = destCanvas.getContext('2d')
      dctx.imageSmoothingEnabled = true
      dctx.imageSmoothingQuality = 'high'
      dctx.drawImage(cur, 0, 0, destW, destH)
      sharpenCanvas(destCanvas, sharpenStrength)
    },
  }
}
