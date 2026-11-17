import { useCallback, useEffect, useState } from "react"
import { Pause, Play } from "lucide-react"

import { ControlPanel } from "@/components/ControlPanel"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { Viewport } from "@/components/Viewport"
import type { Engine, EngineStats } from "@/lib/engine"
import type { Params } from "@/lib/params"
import { loadLast, storeLast } from "@/lib/recipe"
import { randomSeed } from "@/lib/rng"
import { useParamHistory } from "@/lib/useHistory"

export default function App() {
  const [p, setP] = useState<Params>(() => loadLast())
  const [engine, setEngine] = useState<Engine | null>(null)
  const [stats, setStats] = useState<EngineStats | null>(null)

  const set = useCallback((patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch })), [])
  const onZoom = useCallback((zoom: number) => set({ zoom }), [set])
  const { undo, redo } = useParamHistory(p, setP)

  useEffect(() => {
    const t = setTimeout(() => storeLast(p), 300)
    return () => clearTimeout(t)
  }, [p])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && (k === "z" || k === "y")) {
        // leave text fields their own native undo
        if (el.closest("textarea, input:not([type=range]):not([type=color])")) return
        e.preventDefault()
        if (k === "y" || e.shiftKey) redo()
        else undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, [role=slider], [role=combobox], [role=listbox]")) return
      if (e.key === "r") set({ seed: randomSeed() })
      else if (e.key === " " && el === document.body) {
        e.preventDefault()
        setP((prev) => ({ ...prev, autoRotate: !prev.autoRotate }))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [engine, set, undo, redo])

  return (
    <div className="dark flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
      <main className="relative min-h-0 min-w-0 flex-1" style={{ background: p.bg }}>
        <Viewport params={p} onReady={setEngine} onStats={setStats} onZoom={onZoom} />
        <Button
          size="sm"
          variant="secondary"
          className="absolute top-3 left-3 bg-black/55 text-white backdrop-blur hover:bg-black/70"
          onClick={() => set({ autoRotate: !p.autoRotate })}
          title="Toggle rotation (Space)"
          aria-pressed={p.autoRotate}
        >
          {p.autoRotate ? <Pause /> : <Play />}
          {p.autoRotate ? "Pause" : "Rotate"}
        </Button>
        <div className="pointer-events-none absolute bottom-3 left-4 font-mono text-[11px] text-white/45 mix-blend-difference">
          {stats ? `${stats.cells} cells · ${stats.buildMs} ms build · ${stats.drawMs} ms frame` : ""}
        </div>
        <div className="pointer-events-none absolute right-4 bottom-3 hidden font-mono text-[11px] text-white/45 mix-blend-difference sm:block">
          drag rotate · shift-drag spin · double-click flat · scroll zoom
        </div>
      </main>
      <ControlPanel p={p} set={set} replace={setP} engine={engine} stats={stats} />
      <Toaster position="bottom-center" />
    </div>
  )
}
