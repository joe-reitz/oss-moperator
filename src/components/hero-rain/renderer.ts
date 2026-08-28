import type { Gpu } from "vgpu"
import { buildLightField, LIGHT_SIZE } from "./light-field"
import rainWgsl from "./rain.wgsl"

interface RendererOptions {
  canvas: HTMLCanvasElement
  logo: HTMLElement
}

export function createRenderer(options: RendererOptions) {
  const { canvas, logo } = options
  let disposed = false
  let cleanup: (() => void) | undefined

  const initialize = async () => {
    const { init, surface, effect, storage, frameLoop } = await import("vgpu")
    const gpu: Gpu = await init()
    if (disposed) {
      gpu.dispose()
      return
    }
    try {
      const output = surface(gpu, canvas, { dpr: [1, 1.5] })
      const light = storage(gpu, LIGHT_SIZE[0] * LIGHT_SIZE[1] * 4, "read")
      const rain = effect(gpu, rainWgsl, { set: { light } })

      const uploadLight = () => {
        if (disposed) return
        light.write(buildLightField(canvas.getBoundingClientRect(), logo))
      }
      uploadLight()
      output.onResize(uploadLight)
      // The monospace font can swap in after first paint and shift the logo rect.
      void document.fonts?.ready.then(uploadLight)

      const mouse = { x: 0.5, y: 0.5, target: 0 }
      let glow = 0
      const onMove = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect()
        mouse.x = (e.clientX - rect.left) / Math.max(1, rect.width)
        mouse.y = (e.clientY - rect.top) / Math.max(1, rect.height)
        mouse.target = 1
      }
      const onLeave = () => {
        mouse.target = 0
      }
      window.addEventListener("pointermove", onMove)
      document.documentElement.addEventListener("mouseleave", onLeave)

      const t0 = performance.now()
      const start = () =>
        frameLoop(
          gpu,
          (frame) => {
            glow += (mouse.target - glow) * 0.06
            rain.set({
              params: {
                time: (performance.now() - t0) / 1000,
                aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
                mouse: [mouse.x, mouse.y],
                glow,
              },
            })
            frame.pass(output, rain)
          },
          { fps: 30 },
        )

      // Only render while the hero is on screen.
      let handle: { stop(): void } | null = null
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !handle) {
          handle = start()
        } else if (!entry.isIntersecting && handle) {
          handle.stop()
          handle = null
        }
      })
      observer.observe(canvas)

      cleanup = () => {
        observer.disconnect()
        window.removeEventListener("pointermove", onMove)
        document.documentElement.removeEventListener("mouseleave", onLeave)
        handle?.stop()
        gpu.dispose()
      }
      if (disposed) cleanup()
    } catch (error) {
      gpu.dispose()
      throw error
    }
  }

  void initialize().catch(() => undefined)

  return {
    dispose() {
      disposed = true
      cleanup?.()
    },
  }
}
