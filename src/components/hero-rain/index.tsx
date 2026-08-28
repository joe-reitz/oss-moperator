"use client"

import { useEffect, useRef } from "react"

// Matrix-style digital rain behind the ASCII hero, rendered with WebGPU
// (vgpu). The logo casts light into it: a soft halo, and rain that brightens
// as it falls through the ring of light around the mark. The pointer carries
// a glow that brightens nearby rain. When WebGPU is unavailable or the user
// prefers reduced motion, the canvas stays black and the page looks exactly
// as it did without it.
export function HeroRain({ logoId }: { logoId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const logo = document.getElementById(logoId)
    if (!canvas || !logo) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let renderer: { dispose(): void } | undefined
    let cancelled = false
    void import("./renderer").then(({ createRenderer }) => {
      if (cancelled) return
      renderer = createRenderer({ canvas, logo })
    })
    return () => {
      cancelled = true
      renderer?.dispose()
    }
  }, [logoId])

  return (
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-6 -inset-y-8">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
    </div>
  )
}
