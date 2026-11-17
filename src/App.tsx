import { useCallback, useEffect, useState } from "react"
import { Check, Shapes } from "lucide-react"

import { ControlPanel } from "@/components/ControlPanel"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { Viewport } from "@/components/Viewport"
import type { Engine, EngineStats } from "@/lib/engine"
import type { Lobe, Params } from "@/lib/params"
import { loadLast, storeLast } from "@/lib/recipe"
import { randomSeed } from "@/lib/rng"
import { useParamHistory } from "@/lib/useHistory"

export default function App() {
  const [p, setP] = useState<Params>(() => loadLast())
  const [engine, setEngine] = useState<Engine | null>(null)
  const [stats, setStats] = useState<EngineStats | null>(null)
  const [editing, setEditing] = useState(false)

  const set = useCallback((patch: Partial<Params>) => setP((prev) => ({ ...prev, ...patch })), [])
  const onLobes = useCallback((lobes: Lobe[]) => set({ lobes }), [set])
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
        if (el.closest("textarea, input:not([type=range]):not([type=color])")) return
        e.preventDefault()
        if (k === "y" || e.shiftKey) redo()
        else undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, [role=slider], [role=combobox], [role=listbox]")) return
      if (k === "r") set({ seed: randomSeed() })
      else if (k === "e") setEditing((v) => !v)
      else if (e.key === "Escape") setEditing(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [set, undo, redo])

  return (
    <div className="dark flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
      <main className="relative min-h-0 min-w-0 flex-1 bg-[#0c0c0e]">
        <Viewport params={p} editing={editing} onReady={setEngine} onStats={setStats} onLobes={onLobes} />
        <Button
          size="sm"
          variant="secondary"
          className="absolute top-3 left-3 bg-black/55 text-white backdrop-blur hover:bg-black/70"
          onClick={() => setEditing((v) => !v)}
          aria-pressed={editing}
          title="Edit the outline circles (E)"
        >
          {editing ? <Check /> : <Shapes />}
          {editing ? "Done" : "Edit shape"}
        </Button>
        {editing && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white/85 backdrop-blur">
            drag inside a circle to move · drag its edge to resize · double-click to add · right-click to remove
          </div>
        )}
        <div className="pointer-events-none absolute bottom-3 left-4 font-mono text-[11px] text-white/40">
          {stats ? `${stats.cells} cells · ${stats.buildMs} ms build` : ""}
        </div>
      </main>
      <ControlPanel p={p} set={set} replace={setP} engine={engine} />
      <Toaster position="bottom-center" />
    </div>
  )
}
