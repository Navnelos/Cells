import { useEffect, useRef } from "react"

import { Engine, type EngineStats } from "@/lib/engine"
import type { Params } from "@/lib/params"

export function Viewport({
  params,
  onReady,
  onStats,
  onZoom,
}: {
  params: Params
  onReady: (e: Engine | null) => void
  onStats: (s: EngineStats) => void
  onZoom: (z: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const engine = useRef<Engine | null>(null)

  useEffect(() => {
    const e = new Engine(ref.current!)
    engine.current = e
    onReady(e)
    return () => {
      e.destroy()
      engine.current = null
      onReady(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!engine.current) return
    engine.current.onStats = onStats
    engine.current.onZoom = onZoom
  })

  useEffect(() => {
    engine.current?.setParams(params)
  }, [params])

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 block size-full cursor-grab touch-none active:cursor-grabbing"
      aria-label="Cell map. Drag to rotate in 3D, shift-drag to spin, double-click to reset the view."
    />
  )
}
