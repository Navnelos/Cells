import { useEffect, useRef } from "react"

import { Engine, type EngineStats } from "@/lib/engine"
import type { Lobe, Params } from "@/lib/params"

export function Viewport({
  params,
  editing,
  onReady,
  onStats,
  onLobes,
}: {
  params: Params
  editing: boolean
  onReady: (e: Engine | null) => void
  onStats: (s: EngineStats) => void
  onLobes: (l: Lobe[]) => void
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
    engine.current.onLobes = onLobes
  })

  useEffect(() => {
    engine.current?.setParams(params)
  }, [params])

  useEffect(() => {
    engine.current?.setEditing(editing)
  }, [editing])

  return <canvas ref={ref} className="absolute inset-0 block size-full touch-none" aria-label="Cell foam illustration" />
}
