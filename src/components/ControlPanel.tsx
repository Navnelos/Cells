import { useState } from "react"
import { Dices, FileCode2, ImageDown, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react"
import { toast } from "sonner"

import { ColorField, Section, SegmentField, SelectField, SliderField, SwitchField } from "@/components/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { Engine, EngineStats } from "@/lib/engine"
import { DEFAULTS, PRESETS, applyPreset, type Aspect, type Params, type PoreShape, type Seeding, type Silhouette } from "@/lib/params"
import { decodeRecipe, encodeRecipe, loadSaved, storeSaved, type SavedLook } from "@/lib/recipe"
import { randomSeed } from "@/lib/rng"

const SIZES = [
  { value: "2048", label: "2048 px" },
  { value: "4096", label: "4096 px" },
  { value: "8192", label: "8192 px" },
]

const PATCH_KEYS = [
  ["c1", "w1", "Lime"],
  ["c2", "w2", "Light green"],
  ["c3", "w3", "Green"],
  ["c4", "w4", "Dark green"],
  ["c5", "w5", "Blue"],
] as const

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
  stats,
}: {
  p: Params
  set: (patch: Partial<Params>) => void
  replace: (p: Params) => void
  engine: Engine | null
  stats: EngineStats | null
}) {
  const [recipeText, setRecipeText] = useState("")
  const [saved, setSaved] = useState<SavedLook[]>(() => loadSaved())
  const [lookName, setLookName] = useState("")
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileBase = `cells-${p.seed}`

  const exportFile = async (kind: "svg" | "png" | "jpg") => {
    if (!engine) return
    setBusy(true)
    await new Promise((r) => setTimeout(r, 30)) // let the button state paint first
    try {
      if (kind === "svg") {
        const svg = engine.exportSVG()
        download(new Blob([svg], { type: "image/svg+xml" }), `${fileBase}.svg`)
        toast.success(`SVG exported · ${Math.round(svg.length / 1024)} KB`)
      } else {
        const blob = await engine.exportRaster(kind === "png" ? "image/png" : "image/jpeg")
        download(blob, `${fileBase}.${kind}`)
        toast.success(`${kind.toUpperCase()} exported · ${(blob.size / 1048576).toFixed(1)} MB`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed")
    } finally {
      setBusy(false)
    }
  }

  const copyRecipe = async () => {
    const r = encodeRecipe(p, engine?.getView())
    try {
      await navigator.clipboard.writeText(r)
      toast.success("Recipe copied")
    } catch {
      setRecipeText(r)
      toast("Clipboard blocked — recipe placed in the field below")
    }
  }

  const loadRecipe = (text: string) => {
    const r = decodeRecipe(text)
    if (!r) return toast.error("That doesn't look like a recipe")
    replace(r.p)
    if (r.view) setTimeout(() => engine?.setView(r.view!), 0)
    toast.success("Recipe loaded")
  }

  const resetAll = () => {
    replace({ ...DEFAULTS })
    engine?.resetView()
    toast("Reset to the reference")
  }

  const saveLook = () => {
    const n = lookName.trim() || `Cells ${p.seed}`
    const next = [{ name: n, recipe: encodeRecipe(p, engine?.getView()), at: Date.now() }, ...saved.filter((s) => s.name !== n)]
    setSaved(next)
    storeSaved(next)
    setLookName("")
    setSaving(false)
    toast.success(`Saved preset “${n}”`)
  }

  const removeLook = (n: string) => {
    const next = saved.filter((s) => s.name !== n)
    setSaved(next)
    storeSaved(next)
  }

  return (
    <aside className="flex h-[48dvh] w-full shrink-0 flex-col border-t bg-card md:h-full md:w-[360px] md:border-t-0 md:border-l">
      <header className="space-y-3 border-b px-4 py-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-base font-semibold tracking-tight">Cells</h1>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {stats ? `${stats.cells} cells · ${stats.pores} pores` : "—"}
          </span>
        </div>
        <div className="flex gap-2">
          <Select
            value=""
            onValueChange={(v) => {
              if (v.startsWith("saved:")) {
                const look = saved.find((x) => x.name === v.slice(6))
                if (look) loadRecipe(look.recipe)
                return
              }
              const pr = PRESETS.find((x) => x.name === v)
              if (pr) { replace(applyPreset(p, pr)); engine?.resetView() }
            }}
          >
            <SelectTrigger size="sm" className="min-w-0 flex-1">
              <SelectValue placeholder="Presets" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PRESETS.map((pr) => (
                  <SelectItem key={pr.name} value={pr.name}>{pr.name}</SelectItem>
                ))}
              </SelectGroup>
              {saved.length > 0 && (
                <SelectGroup>
                  <SelectLabel>My presets</SelectLabel>
                  {saved.map((s) => (
                    <SelectItem key={s.name} value={`saved:${s.name}`}>{s.name}</SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setSaving((v) => !v)} title="Save current settings as a preset" aria-expanded={saving}>
            <Save /> Save
          </Button>
          <Button size="sm" variant="outline" onClick={resetAll} title="Back to the reference">
            <Undo2 /> Reset
          </Button>
        </div>
        {saving && (
          <div className="flex gap-2">
            <Input
              autoFocus
              value={lookName}
              onChange={(e) => setLookName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveLook(); if (e.key === "Escape") setSaving(false) }}
              placeholder={`Cells ${p.seed}`}
              className="h-8 text-sm"
              aria-label="Preset name"
            />
            <Button size="sm" onClick={saveLook}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setSaving(false)} aria-label="Cancel"><X /></Button>
          </div>
        )}
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
          <Button size="sm" variant="outline" onClick={() => set({ seed: randomSeed() })} title="New seed (R)">
            <Dices /> New
          </Button>
        </div>
      </header>

      <Tabs defaultValue="cells" className="min-h-0 flex-1 gap-0">
        <div className="border-b px-4 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="cells">Cells</TabsTrigger>
            <TabsTrigger value="colour">Colour</TabsTrigger>
            <TabsTrigger value="map">Details</TabsTrigger>
            <TabsTrigger value="view">3D</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>
        </div>

        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">
          {/* ---------------- CELLS ---------------- */}
          <TabsContent value="cells">
            <Section title="Cells">
              <SliderField label="Number of cells" value={p.cells} min={6} max={160} step={1} onChange={(v) => set({ cells: v })} />
              <SliderField label="Size mix" value={p.sizeVariance} min={0} max={1.5} onChange={(v) => set({ sizeVariance: v })} hint="0 = all cells similar, higher = big cells next to small ones" />
              <SliderField label="Bubble walls" value={p.bubble} min={0} max={1.5} onChange={(v) => set({ bubble: v })} hint="0 = straight walls, higher = curved walls where big cells push into small ones" />
              <SliderField label="Evenness" value={p.lloyd} min={0} max={20} step={1} onChange={(v) => set({ lloyd: v })} hint="Lloyd relaxation steps: each step moves every cell to the centre of its area" />
              <SelectField<Seeding>
                label="Placement"
                value={p.seeding}
                onChange={(v) => set({ seeding: v })}
                options={[
                  { value: "poisson", label: "Scattered" },
                  { value: "clusters", label: "Clusters" },
                  { value: "hex", label: "Honeycomb" },
                  { value: "phyllotaxis", label: "Sunflower spiral" },
                ]}
              />
            </Section>
            <Section title="Holes">
              <SegmentField<PoreShape>
                value={p.shape}
                onChange={(v) => set({ shape: v })}
                options={[
                  { value: "rounded", label: "Rounded" },
                  { value: "worley", label: "Organic" },
                  { value: "polygon", label: "Sharp" },
                  { value: "circle", label: "Circle" },
                ]}
              />
              <SliderField label="Wall thickness" value={p.gap} min={0} max={0.06} step={0.001} format={(v) => v.toFixed(3)} onChange={(v) => set({ gap: v })} />
              <SliderField label="Corner fillets" value={p.roundness} min={0} max={1.5} disabled={p.shape !== "rounded"} onChange={(v) => set({ roundness: v })} />
              <SliderField label="Irregularity" value={p.irregularity} min={0} max={1.5} onChange={(v) => set({ irregularity: v })} hint="Varies fillets and wall thickness from cell to cell" />
              <SliderField label="Filled cells" value={p.solid} min={0} max={0.6} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ solid: v })} hint="Share of inner cells left solid and coloured" />
            </Section>
            <Section title="Outline">
              <SelectField<Silhouette>
                label="Shape"
                value={p.silhouette}
                onChange={(v) => set({ silhouette: v })}
                options={[
                  { value: "reference", label: "Reference" },
                  { value: "metaballs", label: "Random lobes" },
                  { value: "superformula", label: "Superformula" },
                  { value: "circle", label: "Circle" },
                ]}
              />
              {p.silhouette === "metaballs" && (
                <>
                  <SliderField label="Lobes" value={p.lobes} min={1} max={10} step={1} onChange={(v) => set({ lobes: v })} />
                  <SliderField label="Spread" value={p.lobeSpread} min={0} max={1} onChange={(v) => set({ lobeSpread: v })} />
                </>
              )}
              {p.silhouette === "superformula" && (
                <>
                  <SliderField label="Symmetry" value={p.sfM} min={1} max={12} step={1} onChange={(v) => set({ sfM: v })} />
                  <SliderField label="Pinch" value={p.sfN} min={0.5} max={12} step={0.1} onChange={(v) => set({ sfN: v })} />
                </>
              )}
              <SliderField label="Size" value={p.size} min={0.5} max={1.3} onChange={(v) => set({ size: v })} />
              <SliderField label="Border band" value={p.rim} min={0} max={0.2} step={0.005} format={(v) => v.toFixed(3)} onChange={(v) => set({ rim: v })} />
              <SliderField label="Band variation" value={p.rimVariance} min={0} max={1.5} onChange={(v) => set({ rimVariance: v })} />
            </Section>
          </TabsContent>

          {/* ---------------- COLOUR ---------------- */}
          <TabsContent value="colour">
            <Section title="Base">
              <ColorField label="Background" value={p.bg} onChange={(v) => set({ bg: v, poreColor: p.poreColor === p.bg ? v : p.poreColor })} />
              <ColorField label="Holes" value={p.poreColor} onChange={(v) => set({ poreColor: v })} />
              <ColorField label="Walls (lines)" value={p.wall} onChange={(v) => set({ wall: v })} />
              <SliderField label="Line width" value={p.wallWidth} min={0} max={10} step={0.1} onChange={(v) => set({ wallWidth: v })} />
              <ColorField label="Tissue" value={p.tissue} onChange={(v) => set({ tissue: v })} />
            </Section>
            <Section title="Patches">
              <p className="text-xs leading-relaxed text-muted-foreground">Colour and amount of each patch colour on the border band and filled cells.</p>
              {PATCH_KEYS.map(([ck, wk, label]) => (
                <div key={ck} className="space-y-2">
                  <ColorField label={label} value={p[ck]} onChange={(v) => set({ [ck]: v } as Partial<Params>)} />
                  <Slider min={0} max={3} step={0.05} value={[p[wk]]} onValueChange={(v) => set({ [wk]: v[0] } as Partial<Params>)} aria-label={`${label} amount`} />
                </div>
              ))}
              <SliderField label="Patch count" value={p.patchCount} min={10} max={400} step={1} onChange={(v) => set({ patchCount: v })} />
              <SliderField label="Ragged edges" value={p.patchWarp} min={0} max={2} onChange={(v) => set({ patchWarp: v })} />
            </Section>
            <Section title="Details">
              <ColorField label="Dots and fine lines" value={p.ink} onChange={(v) => set({ ink: v })} />
              <ColorField label="Grid" value={p.gridColor} onChange={(v) => set({ gridColor: v })} />
            </Section>
          </TabsContent>

          {/* ---------------- DETAILS ---------------- */}
          <TabsContent value="map">
            <Section title="Fine detail">
              <SwitchField label="Network lines" checked={p.graph} onChange={(v) => set({ graph: v })} />
              <SliderField label="Line amount" value={p.graphDensity} min={0} max={1} disabled={!p.graph} onChange={(v) => set({ graphDensity: v })} />
              <SwitchField label="Dots" checked={p.nodes} onChange={(v) => set({ nodes: v })} />
              <SliderField label="Dot size" value={p.nodeSize} min={0.2} max={3} disabled={!p.nodes} onChange={(v) => set({ nodeSize: v })} />
              <SwitchField label="Edge hairlines" checked={p.fringe} onChange={(v) => set({ fringe: v })} />
              <SliderField label="Hairline amount" value={p.fringeDensity} min={0} max={1} disabled={!p.fringe} onChange={(v) => set({ fringeDensity: v })} />
              <SwitchField label="Dotted orbits" checked={p.rings} onChange={(v) => set({ rings: v })} />
              <SwitchField label="Dashed rays" checked={p.rays} onChange={(v) => set({ rays: v })} />
              <SliderField label="Rays" value={p.rayCount} min={1} max={16} step={1} disabled={!p.rays} onChange={(v) => set({ rayCount: v })} />
            </Section>
            <Section title="Grid">
              <SwitchField label="Grid" checked={p.grid} onChange={(v) => set({ grid: v })} />
              <SliderField label="Columns" value={p.gridCols} min={2} max={24} step={1} disabled={!p.grid} onChange={(v) => set({ gridCols: v })} />
              <SwitchField label="Tilts with the shape" checked={p.gridOnPlate} disabled={!p.grid} onChange={(v) => set({ gridOnPlate: v })} hint="In 3D, the grid lies on the shape's plane instead of staying flat" />
            </Section>
          </TabsContent>

          {/* ---------------- 3D ---------------- */}
          <TabsContent value="view">
            <Section title="Camera">
              <div className="grid grid-cols-4 gap-2">
                <Button size="sm" variant="outline" onClick={() => engine?.setViewPreset("flat")}>Flat</Button>
                <Button size="sm" variant="outline" onClick={() => engine?.setViewPreset("tilt")}>Tilt</Button>
                <Button size="sm" variant="outline" onClick={() => engine?.setViewPreset("iso")}>Iso</Button>
                <Button size="sm" variant="outline" onClick={() => engine?.setViewPreset("low")}>Low</Button>
              </div>
              <SliderField label="Thickness" value={p.depth} min={0} max={0.3} step={0.005} format={(v) => v.toFixed(3)} onChange={(v) => set({ depth: v })} hint="Extrudes the shape into a slab; visible once tilted" />
              <SliderField label="See-through holes" value={1 - p.poreOpacity} min={0} max={1} onChange={(v) => set({ poreOpacity: 1 - v })} hint="Lets the slab's inner walls show through the holes" />
              <SliderField label="Perspective" value={p.perspective} min={0} max={1} onChange={(v) => set({ perspective: v })} />
            </Section>
            <Section title="Motion">
              <SwitchField label="Auto-rotate" checked={p.autoRotate} onChange={(v) => set({ autoRotate: v })} hint="Space" />
              <SliderField label="Speed" value={p.rotateSpeed} min={-1} max={1} disabled={!p.autoRotate} onChange={(v) => set({ rotateSpeed: v })} />
              <SliderField label="Zoom" value={p.zoom} min={0.3} max={5} onChange={(v) => set({ zoom: v })} />
              <Button size="sm" variant="outline" className="w-full" onClick={() => engine?.resetView()}>
                <RotateCcw /> Back to flat
              </Button>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <dt className="font-medium text-foreground">Drag</dt><dd>Rotate in 3D</dd>
                <dt className="font-medium text-foreground">Shift-drag</dt><dd>Spin flat</dd>
                <dt className="font-medium text-foreground">Double-click</dt><dd>Back to flat</dd>
                <dt className="font-medium text-foreground">Scroll</dt><dd>Zoom</dd>
                <dt className="font-medium text-foreground">R · Space</dt><dd>New seed · rotation on/off</dd>
                <dt className="font-medium text-foreground">⌘Z · ⇧⌘Z</dt><dd>Undo · redo (Ctrl on Windows)</dd>
              </dl>
            </Section>
          </TabsContent>

          {/* ---------------- EXPORT ---------------- */}
          <TabsContent value="export">
            <Section title="Frame">
              <SegmentField<Aspect>
                value={p.aspect}
                onChange={(v) => set({ aspect: v })}
                options={[
                  { value: "7:6", label: "7:6" },
                  { value: "1:1", label: "1:1" },
                  { value: "4:5", label: "4:5" },
                  { value: "16:9", label: "16:9" },
                  { value: "9:16", label: "9:16" },
                  { value: "free", label: "Free" },
                ]}
              />
              <SwitchField label="Transparent background" checked={p.transparent} onChange={(v) => set({ transparent: v })} hint="PNG and SVG only" />
            </Section>
            <Section title="Download">
              <SelectField label="PNG / JPEG size" value={String(p.exportSize)} onChange={(v) => set({ exportSize: Number(v) })} options={SIZES} />
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" disabled={busy} onClick={() => exportFile("svg")}><FileCode2 /> SVG</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => exportFile("png")}><ImageDown /> PNG</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => exportFile("jpg")}><ImageDown /> JPEG</Button>
              </div>
              {p.exportSize > 4096 && <p className="text-xs text-muted-foreground">8192 px can exceed Safari's canvas limit; Chrome handles it.</p>}
            </Section>
            <Section title="Recipe">
              <p className="text-xs leading-relaxed text-muted-foreground">A recipe stores every setting plus the camera angle. Paste one back to reproduce an image.</p>
              <Button size="sm" variant="outline" className="w-full" onClick={copyRecipe}>Copy recipe</Button>
              <Textarea value={recipeText} onChange={(e) => setRecipeText(e.target.value)} placeholder="Paste a recipe (cells.…)" className="max-h-32 font-mono text-xs break-all" />
              <Button size="sm" variant="secondary" className="w-full" disabled={!recipeText.trim()} onClick={() => loadRecipe(recipeText)}>Load recipe</Button>
            </Section>
            <Section title="My presets">
              {saved.length === 0 ? (
                <p className="text-xs text-muted-foreground">No presets yet. Use Save at the top of the panel. Presets are kept in this browser.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {saved.map((s) => (
                    <li key={s.name} className="flex items-center gap-1 py-1 pr-1 pl-3">
                      <button className="flex-1 truncate text-left text-sm hover:underline" onClick={() => loadRecipe(s.recipe)}>{s.name}</button>
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => removeLook(s.name)} aria-label={`Delete ${s.name}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  )
}
