export const LIGHT_SIZE = [512, 288] as const

// Rasterizes the on-screen ASCII logo into a wide-blurred scalar field — the
// light the logo casts. Screen orientation (top-origin), matching effect() uv.
export function buildLightField(
  canvasRect: DOMRect,
  logo: HTMLElement,
): Float32Array<ArrayBuffer> {
  const [w, h] = LIGHT_SIZE
  const mask = new Float32Array(w * h)

  const off = document.createElement("canvas")
  off.width = w
  off.height = h
  const ctx = off.getContext("2d", { willReadFrequently: true })
  const lines = (logo.textContent ?? "").split("\n").filter((l) => l.length > 0)
  const rect = logo.getBoundingClientRect()
  if (ctx && lines.length > 0 && rect.width > 0 && canvasRect.width > 0) {
    const x0 = ((rect.left - canvasRect.left) / canvasRect.width) * w
    const y0 = ((rect.top - canvasRect.top) / canvasRect.height) * h
    const targetW = (rect.width / canvasRect.width) * w
    const targetH = (rect.height / canvasRect.height) * h

    // Draw the block at a comfortable font size, scaled to the on-screen rect.
    const fontPx = 10
    ctx.font = `${fontPx}px monospace`
    const blockW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
    const blockH = lines.length * fontPx
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    ctx.translate(x0, y0)
    ctx.scale(targetW / blockW, targetH / blockH)
    ctx.fillStyle = "#fff"
    ctx.textBaseline = "top"
    lines.forEach((line, i) => ctx.fillText(line, 0, i * fontPx))
    ctx.restore()

    const img = ctx.getImageData(0, 0, w, h).data
    for (let i = 0; i < mask.length; i++) {
      mask[i] = img[i * 4] / 255
    }
  }

  let light: Float32Array<ArrayBuffer> = Float32Array.from(mask)
  for (const radius of [3, 6, 12, 24]) {
    light = boxBlur(light, w, h, radius)
  }
  let max = 0
  for (const v of light) if (v > max) max = v
  if (max > 1e-6) for (let i = 0; i < light.length; i++) light[i] /= max
  return light
}

// Separable box blur (horizontal then vertical) with running sums.
function boxBlur(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array<ArrayBuffer> {
  const tmp = new Float32Array(src.length)
  const dst = new Float32Array(src.length)
  const span = radius * 2 + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = -radius; x <= radius; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / span
      sum += src[row + Math.min(w - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / span
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x]
    }
  }
  return dst
}
