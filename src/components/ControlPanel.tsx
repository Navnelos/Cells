import { useState } from "react"
import { Dices, FileCode2, ImageDown, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { ColorField, Section, SegmentField, SelectField, SliderField, SwitchField } from "@/components/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Engine } from "@/lib/engine"
import { DEFAULTS, DEFAULT_LOBES, type Aspect, type FillMode, type Params } from "@/lib/params"
import { randomSeed } from "@/lib/rng"

function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function ControlPanel({
  p,
  set,
  replace,
  engine,
}: {
  p: Params
  set: (patch: Partial<Params>) => void
  replace: (p: Params) => void
  engine: Engine | null
}) {
  const [busy, setBusy] = useState(false)
  const foam = p.fill === "foam"

  const exportFile = async (kind: "svg" | "png" | "jpg") => {
    if (!engine) return
    setBusy(true)
    await new Promise((r) => setTimeout(r, 30))
    try {
      if (kind === "svg") {
        const svg = engine.exportSVG()
        download(new Blob([svg], { type: "image/svg+xml" }), `cells-${p.seed}.svg`)
        toast.success(`SVG exported · ${Math.round(svg.length / 1024)} KB`)
      } else {
        const blob = await engine.exportRaster(kind === "png" ? "image/png" : "image/jpeg")
        download(blob, `cells-${p.seed}.${kind}`)
        toast.success(`${kind.toUpperCase()} exported · ${(blob.size / 1048576).toFixed(1)} MB`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex h-[48dvh] w-full shrink-0 flex-col border-t bg-card md:h-full md:w-[340px] md:border-t-0 md:border-l">
      <header className="space-y-3 border-b px-4 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold tracking-tight">Cells</h1>
          <Button size="sm" variant="outline" onClick={() => { replace({ ...DEFAULTS }); toast("Reset") }} title="Back to the default (⌘Z undoes)">
            <Undo2 /> Reset
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-[13px] font-normal text-muted-foreground">Seed</Label>
          <Input
            type="number"
            value={p.seed}
            min={1}
            onChange={(e) => set({ seed: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            className="h-8 flex-1 font-mono text-xs"
            aria-label="Seed"
          />
          <Button size="sm" variant="outline" onClick={() => set({ seed: randomSeed() })} title="New arrangement (R)">
            <Dices /> New
          </Button>
        </div>
      </header>

      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
        <Section title="Shape" aside={<Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => set({ lobes: DEFAULT_LOBES })}>Reset shape</Button>}>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The outline is made of {p.lobes.length} circles. Press <b className="text-foreground">Edit shape</b> on the canvas (or E) to move, resize, add or remove them.
          </p>
        </Section>

        <Section title="Cells">
          <SliderField label="Large cavities" value={p.cells} min={10} max={120} step={1} onChange={(v) => set({ cells: v })} hint="Roughly how many big dark bubbles" />
          <SliderField label="Giant bubbles" value={p.giants} min={0} max={20} step={1} onChange={(v) => set({ giants: v })} />
          <SliderField label="Giant size" value={p.giantSize} min={1} max={3.5} onChange={(v) => set({ giantSize: v })} />
          <SliderField label="Size variety" value={p.variety} min={0} max={1.2} onChange={(v) => set({ variety: v })} />
          <SliderField label="Nesting" value={p.spacing} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ spacing: v })} hint="Clusters of smaller bubbles nested between the large cavities" />
        </Section>

        <Section title="Strands">
          <SliderField label="Thickness" value={p.strandWidth} min={0.3} max={5} step={0.1} onChange={(v) => set({ strandWidth: v })} />
          <SliderField label="Junction webs" value={p.webs} min={0} max={2} onChange={(v) => set({ webs: v })} hint="How far the fine web lines reach into the gaps between bubbles" />
          <SliderField label="Centre glow" value={p.glow} min={0} max={1.5} onChange={(v) => set({ glow: v })} />
        </Section>

        <Section title="Fill">
          <SegmentField<FillMode>
            value={p.fill}
            onChange={(v) => set({ fill: v })}
            options={[
              { value: "foam", label: "Foam" },
              { value: "flat", label: "Flat colour" },
            ]}
          />
          <SliderField label="Foam depth" value={p.foamAmount} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ foamAmount: v })} hint="How far the fine foam reaches in from the edge" />
          <SliderField label="Bubble size" value={p.bubbleSize} min={0.3} max={2.5} onChange={(v) => set({ bubbleSize: v })} />
          <SliderField label="Open bubbles" value={p.holes} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} disabled={!foam} onChange={(v) => set({ holes: v })} />
          <div className="space-y-3 pt-1">
            <Label className="text-[13px] font-normal text-muted-foreground">Mix</Label>
            <SliderField label="Lime" value={p.wLime} min={0} max={3} onChange={(v) => set({ wLime: v })} />
            <SliderField label="Green" value={p.wGreen} min={0} max={3} onChange={(v) => set({ wGreen: v })} />
            <SliderField label="Blue" value={p.wBlue} min={0} max={3} onChange={(v) => set({ wBlue: v })} />
            <SliderField label={foam ? "White lace" : "Dark green"} value={p.wLace} min={0} max={3} onChange={(v) => set({ wLace: v })} />
          </div>
        </Section>

        <Section title="Colours">
          <ColorField label="Background" value={p.bg} onChange={(v) => set({ bg: v })} />
          <ColorField label="Strands" value={p.strand} onChange={(v) => set({ strand: v })} />
          <ColorField label="Centre glow" value={p.hub} onChange={(v) => set({ hub: v })} />
          <ColorField label="Lime" value={p.lime} onChange={(v) => set({ lime: v })} />
          <ColorField label="Green" value={p.green} onChange={(v) => set({ green: v })} />
          <ColorField label="Blue" value={p.blue} onChange={(v) => set({ blue: v })} />
          <ColorField label="White lace, dots" value={p.lace} onChange={(v) => set({ lace: v })} />
          <ColorField label="Grid" value={p.gridColor} onChange={(v) => set({ gridColor: v })} />
        </Section>

        <Section title="Details">
          <SwitchField label="Grid" checked={p.grid} onChange={(v) => set({ grid: v })} />
          <SwitchField label="Edge ticks" checked={p.ticks} onChange={(v) => set({ ticks: v })} />
          <SwitchField label="Junction dots" checked={p.dots} onChange={(v) => set({ dots: v })} />
        </Section>

        <Section title="Export">
          <SegmentField<Aspect>
            value={p.aspect}
            onChange={(v) => set({ aspect: v })}
            options={[
              { value: "7:6", label: "7:6" },
              { value: "1:1", label: "1:1" },
              { value: "4:5", label: "4:5" },
              { value: "16:9", label: "16:9" },
              { value: "9:16", label: "9:16" },
            ]}
          />
          <SwitchField label="Transparent background" checked={p.transparent} onChange={(v) => set({ transparent: v })} hint="PNG and SVG only" />
          <SelectField
            label="PNG / JPEG size"
            value={String(p.exportSize)}
            onChange={(v) => set({ exportSize: Number(v) })}
            options={[
              { value: "2048", label: "2048 px" },
              { value: "4096", label: "4096 px" },
              { value: "8192", label: "8192 px" },
            ]}
          />
          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" disabled={busy} onClick={() => exportFile("svg")}><FileCode2 /> SVG</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => exportFile("png")}><ImageDown /> PNG</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => exportFile("jpg")}><ImageDown /> JPEG</Button>
          </div>
        </Section>
      </div>
    </aside>
  )
}
