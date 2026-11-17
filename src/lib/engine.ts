// Owns the canvas. React pushes params in; geometry is rebuilt only when a structural
// parameter changes. In shape-edit mode the outline circles can be dragged on the canvas.

import { buildGeometry, type Geometry } from "./geometry"
import { DEFAULTS, STRUCTURE_KEYS, type Lobe, type Params } from "./params"
import { aspectRatio, buildOps, computeFrame, paintCanvas, toSVG, viewFor, type FrameBox } from "./render"

export interface EngineStats {
  cells: number
  bubbles: number
  buildMs: number
}

export class Engine {
  private ctx: CanvasRenderingContext2D
  private p: Params = DEFAULTS
  private geom: Geometry | null = null
  private structKey = ""
  private dirty = true
  private raf = 0
  private dpr = 1
  private frame: FrameBox | null = null
  private ro: ResizeObserver
  private editing = false
  private lobes: Lobe[] = []
  private drag: { id: number; i: number; mode: "move" | "size"; ox: number; oy: number } | null = null
  private hover = -1
  private lastBuild = 0
  private pendingBuild = 0
  onStats?: (s: EngineStats) => void
  onLobes?: (l: Lobe[]) => void

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D not available")
    this.ctx = ctx
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(canvas)
    canvas.addEventListener("pointerdown", this.onDown)
    canvas.addEventListener("pointermove", this.onMove)
    canvas.addEventListener("pointerup", this.onUp)
    canvas.addEventListener("pointercancel", this.onUp)
    canvas.addEventListener("dblclick", this.onDbl)
    canvas.addEventListener("contextmenu", this.onContext)
    this.resize()
    this.raf = requestAnimationFrame(this.tick)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    clearTimeout(this.pendingBuild)
    this.ro.disconnect()
    this.canvas.removeEventListener("pointerdown", this.onDown)
    this.canvas.removeEventListener("pointermove", this.onMove)
    this.canvas.removeEventListener("pointerup", this.onUp)
    this.canvas.removeEventListener("pointercancel", this.onUp)
    this.canvas.removeEventListener("dblclick", this.onDbl)
    this.canvas.removeEventListener("contextmenu", this.onContext)
  }

  setParams(p: Params) {
    this.p = p
    if (!this.drag) this.lobes = p.lobes.map((l) => ({ ...l }))
    const key = JSON.stringify(STRUCTURE_KEYS.map((k) => p[k]))
    if (key !== this.structKey) {
      const first = !this.structKey
      this.structKey = key
      // coalesce rapid slider changes into one rebuild per frame or so
      if (first) this.rebuild()
      else { clearTimeout(this.pendingBuild); this.pendingBuild = window.setTimeout(() => this.rebuild(), 40) }
    }
    this.dirty = true
  }

  setEditing(on: boolean) {
    this.editing = on
    this.canvas.style.cursor = on ? "crosshair" : "default"
    this.dirty = true
  }

  // ---- export -----------------------------------------------------------------------------

  private exportFrame(longEdge: number) {
    const a = aspectRatio(this.p.aspect)
    const W = a >= 1 ? longEdge : Math.round(longEdge * a)
    const H = a >= 1 ? Math.round(longEdge / a) : longEdge
    return computeFrame(W, H, a, 1)
  }

  exportSVG(): string {
    if (!this.geom) return ""
    const frame = this.exportFrame(2000)
    return toSVG(buildOps(this.geom, this.p, frame, this.p.transparent), frame)
  }

  exportRaster(type: "image/png" | "image/jpeg"): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.geom) return reject(new Error("Nothing to export"))
      const frame = this.exportFrame(this.p.exportSize)
      const c = document.createElement("canvas")
      c.width = frame.w
      c.height = frame.h
      const ctx = c.getContext("2d")
      if (!ctx) return reject(new Error("Canvas too large for this browser"))
      const transparent = type === "image/png" && this.p.transparent
      paintCanvas(ctx, buildOps(this.geom, this.p, frame, transparent), frame, transparent ? null : this.p.bg)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed — try a smaller size"))), type, 0.95)
    })
  }

  // ---- internals ----------------------------------------------------------------------------

  private rebuild() {
    this.geom = buildGeometry({ ...this.p, lobes: this.lobes })
    this.lastBuild = performance.now()
    this.onStats?.({ cells: this.geom.stats.cells, bubbles: this.geom.stats.bubbles, buildMs: this.geom.stats.ms })
    this.dirty = true
  }

  /** while dragging, rebuild at most every ~90 ms */
  private rebuildSoon() {
    const wait = 90 - (performance.now() - this.lastBuild)
    clearTimeout(this.pendingBuild)
    if (wait <= 0) this.rebuild()
    else this.pendingBuild = window.setTimeout(() => this.rebuild(), wait)
  }

  private resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.dirty = true
  }

  private tick = () => {
    if (this.dirty) this.draw()
    this.raf = requestAnimationFrame(this.tick)
  }

  private draw() {
    if (!this.geom) return
    const { width: w, height: h } = this.canvas
    this.frame = computeFrame(w, h, aspectRatio(this.p.aspect))
    paintCanvas(this.ctx, buildOps(this.geom, this.p, this.frame, false), this.frame, "#0c0c0e")
    if (this.editing) this.drawLobes()
    this.dirty = false
  }

  private drawLobes() {
    const v = viewFor(this.frame!)
    const ctx = this.ctx
    ctx.save()
    ctx.lineWidth = 1.2 * this.dpr
    this.lobes.forEach((l, i) => {
      const x = v.ox + l.x * v.unit, y = v.oy + l.y * v.unit, r = l.r * v.unit
      ctx.strokeStyle = i === this.hover || this.drag?.i === i ? "rgba(255,80,200,0.95)" : "rgba(255,80,200,0.55)"
      ctx.setLineDash([6 * this.dpr, 5 * this.dpr])
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = "rgba(255,80,200,0.95)"
      ctx.beginPath(); ctx.arc(x, y, 3.5 * this.dpr, 0, Math.PI * 2); ctx.fill()
    })
    ctx.restore()
  }

  private toPlate(e: PointerEvent | MouseEvent) {
    const rect = this.canvas.getBoundingClientRect()
    const v = viewFor(this.frame!)
    const sx = (e.clientX - rect.left) * this.dpr, sy = (e.clientY - rect.top) * this.dpr
    return { x: (sx - v.ox) / v.unit, y: (sy - v.oy) / v.unit, tol: (9 * this.dpr) / v.unit }
  }

  /** which lobe is under the pointer, and whether it's on its rim (resize) or inside (move) */
  private hit(x: number, y: number, tol: number): { i: number; mode: "move" | "size" } | null {
    let best: { i: number; mode: "move" | "size"; d: number } | null = null
    this.lobes.forEach((l, i) => {
      const d = Math.hypot(x - l.x, y - l.y)
      if (Math.abs(d - l.r) < tol) {
        if (!best || Math.abs(d - l.r) < best.d) best = { i, mode: "size", d: Math.abs(d - l.r) }
      } else if (d < l.r && (!best || (best.mode === "move" && d < best.d))) {
        best = { i, mode: "move", d }
      }
    })
    return best
  }

  private onDown = (e: PointerEvent) => {
    if (!this.editing || !this.frame || e.button !== 0) return
    const { x, y, tol } = this.toPlate(e)
    const h = this.hit(x, y, tol)
    if (!h) return
    if (e.altKey) { this.removeLobe(h.i); return }
    this.canvas.setPointerCapture(e.pointerId)
    const l = this.lobes[h.i]
    this.drag = { id: e.pointerId, i: h.i, mode: h.mode, ox: x - l.x, oy: y - l.y }
  }

  private onMove = (e: PointerEvent) => {
    if (!this.editing || !this.frame) return
    const { x, y, tol } = this.toPlate(e)
    const d = this.drag
    if (!d || d.id !== e.pointerId) {
      const h = this.hit(x, y, tol)
      const hv = h ? h.i : -1
      this.canvas.style.cursor = h ? (h.mode === "size" ? "ew-resize" : "move") : "crosshair"
      if (hv !== this.hover) { this.hover = hv; this.dirty = true }
      return
    }
    const l = this.lobes[d.i]
    if (d.mode === "move") { l.x = x - d.ox; l.y = y - d.oy }
    else l.r = Math.max(0.04, Math.hypot(x - l.x, y - l.y))
    this.dirty = true
    this.rebuildSoon()
  }

  private onUp = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) return
    this.drag = null
    this.commitLobes()
  }

  private onDbl = (e: MouseEvent) => {
    if (!this.editing || !this.frame) return
    const { x, y } = this.toPlate(e)
    this.lobes.push({ x, y, r: 0.22 })
    this.commitLobes()
  }

  private onContext = (e: MouseEvent) => {
    if (!this.editing || !this.frame) return
    e.preventDefault()
    const { x, y, tol } = this.toPlate(e)
    const h = this.hit(x, y, tol)
    if (h) this.removeLobe(h.i)
  }

  private removeLobe(i: number) {
    if (this.lobes.length <= 1) return
    this.lobes.splice(i, 1)
    this.hover = -1
    this.commitLobes()
  }

  private commitLobes() {
    const r = (v: number) => Math.round(v * 1000) / 1000
    this.onLobes?.(this.lobes.map((l) => ({ x: r(l.x), y: r(l.y), r: r(l.r) })))
  }
}
