// Owns the canvas, the camera and the render loop. React only pushes params in.
// Geometry is rebuilt only when a structural parameter changes; while a slider is
// being dragged a coarser grid is used, then the full-quality build follows.

import { buildGeometry, type Geometry } from "./geometry"
import { DEFAULTS, STRUCTURE_KEYS, type Params } from "./params"
import { Camera, aspectRatio, buildOps, computeFrame, paintCanvas, toSVG, type FrameBox, type M3 } from "./render"

export interface EngineStats {
  cells: number
  pores: number
  buildMs: number
  drawMs: number
}

export interface ViewState {
  rot: number[]
}

const PREVIEW_ROWS = 400
const DRAFT_ROWS = 220

// ---- 3×3 rotation helpers ------------------------------------------------------------

export const ident3 = (): M3 => Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1])

export function axisAngle3(x: number, y: number, z: number, a: number): M3 {
  const l = Math.hypot(x, y, z) || 1
  x /= l; y /= l; z /= l
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c
  return Float64Array.from([
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ])
}

export function mul3(a: M3, b: M3): M3 {
  const o = new Float64Array(9)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) o[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]
  return o
}

function orthonormalize3(m: M3): M3 {
  // Gram–Schmidt on the rows
  const r0 = [m[0], m[1], m[2]], r1 = [m[3], m[4], m[5]]
  const n0 = Math.hypot(...r0) || 1
  for (let i = 0; i < 3; i++) r0[i] /= n0
  const d = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2]
  for (let i = 0; i < 3; i++) r1[i] -= d * r0[i]
  const n1 = Math.hypot(...r1) || 1
  for (let i = 0; i < 3; i++) r1[i] /= n1
  const r2 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]]
  m.set([...r0, ...r1, ...r2])
  return m
}

export const VIEWS: Record<string, () => M3> = {
  flat: ident3,
  tilt: () => mul3(axisAngle3(1, 0, 0, -0.95), axisAngle3(0, 0, 1, -0.35)),
  iso: () => mul3(axisAngle3(1, 0, 0, -0.62), axisAngle3(0, 1, 0, 0.62)),
  low: () => mul3(axisAngle3(1, 0, 0, -1.28), axisAngle3(0, 0, 1, 0.2)),
}

export class Engine {
  private ctx: CanvasRenderingContext2D
  private p: Params = DEFAULTS
  private geom: Geometry | null = null
  private draft = false
  private rot: M3 = ident3()
  private structKey = ""
  private dirty = true
  private raf = 0
  private last = 0
  private ops = 0
  private dpr = 1
  private fullTimer = 0
  private drag: { id: number; x: number; y: number; moved: number } | null = null
  private ro: ResizeObserver
  private stats: EngineStats = { cells: 0, pores: 0, buildMs: 0, drawMs: 0 }
  private lastStatEmit = 0
  onStats?: (s: EngineStats) => void
  onZoom?: (z: number) => void

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
    canvas.addEventListener("wheel", this.onWheel, { passive: false })
    canvas.addEventListener("dblclick", this.onDbl)
    this.resize()
    this.raf = requestAnimationFrame(this.tick)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    clearTimeout(this.fullTimer)
    this.ro.disconnect()
    this.canvas.removeEventListener("pointerdown", this.onDown)
    this.canvas.removeEventListener("pointermove", this.onMove)
    this.canvas.removeEventListener("pointerup", this.onUp)
    this.canvas.removeEventListener("pointercancel", this.onUp)
    this.canvas.removeEventListener("wheel", this.onWheel)
    this.canvas.removeEventListener("dblclick", this.onDbl)
  }

  setParams(p: Params) {
    const key = JSON.stringify(STRUCTURE_KEYS.map((k) => p[k]))
    this.p = p
    if (key !== this.structKey) {
      const first = !this.structKey
      this.structKey = key
      if (first) this.rebuild(PREVIEW_ROWS)
      else {
        // quick draft now, full quality once the change settles
        this.rebuild(DRAFT_ROWS)
        clearTimeout(this.fullTimer)
        this.fullTimer = window.setTimeout(() => { this.rebuild(PREVIEW_ROWS); this.dirty = true }, 260)
      }
    }
    this.dirty = true
  }

  getView(): ViewState {
    return { rot: Array.from(this.rot, (v) => Math.round(v * 1e6) / 1e6) }
  }

  setView(v: ViewState) {
    if (v.rot?.length === 9) this.rot = orthonormalize3(Float64Array.from(v.rot))
    this.dirty = true
  }

  setViewPreset(name: keyof typeof VIEWS) {
    this.rot = VIEWS[name]()
    this.dirty = true
  }

  resetView() { this.rot = ident3(); this.dirty = true }

  // ---- export ---------------------------------------------------------------------------

  private exportDims(longEdge: number) {
    const a = aspectRatio(this.p.aspect) ?? this.canvas.width / Math.max(1, this.canvas.height)
    return a >= 1 ? { W: longEdge, H: Math.round(longEdge / a) } : { W: Math.round(longEdge * a), H: longEdge }
  }

  private exportOps(W: number, H: number, rows: number, transparent: boolean) {
    const g = buildGeometry(this.p, rows)
    const frame = computeFrame(W, H, W / H, 1)
    const cam = new Camera(this.rot, frame, this.p.zoom, this.p.perspective)
    return { ops: buildOps(g, this.p, cam, frame, transparent), frame }
  }

  exportSVG(): string {
    const { W, H } = this.exportDims(2000)
    const { ops, frame } = this.exportOps(W, H, 900, this.p.transparent)
    return toSVG(ops, frame)
  }

  exportRaster(type: "image/png" | "image/jpeg"): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const { W, H } = this.exportDims(this.p.exportSize)
      const c = document.createElement("canvas")
      c.width = W
      c.height = H
      const ctx = c.getContext("2d")
      if (!ctx) return reject(new Error("Canvas too large for this browser"))
      const transparent = type === "image/png" && this.p.transparent
      const rows = Math.min(1100, Math.max(PREVIEW_ROWS, Math.round(H / 3.2)))
      const { ops, frame } = this.exportOps(W, H, rows, transparent)
      paintCanvas(ctx, ops, frame, transparent ? null : this.p.bg)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed — try a smaller size"))), type, 0.95)
    })
  }

  // ---- internals ------------------------------------------------------------------------

  private rebuild(rows: number) {
    this.geom = buildGeometry(this.p, rows)
    this.draft = rows < PREVIEW_ROWS
    this.stats.cells = this.geom.cells
    this.stats.pores = this.geom.poreCount
    this.stats.buildMs = this.geom.buildMs
    this.onStats?.({ ...this.stats })
    this.dirty = true
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

  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000)
    this.last = now
    if (this.p.autoRotate && !this.drag) {
      // spin about the plate's own normal while the camera stays put, plus a slow wobble
      this.rot = mul3(axisAngle3(0, 1, 0, this.p.rotateSpeed * dt), this.rot)
      if (++this.ops % 64 === 0) orthonormalize3(this.rot)
      this.dirty = true
    }
    if (this.dirty) this.draw()
    this.raf = requestAnimationFrame(this.tick)
  }

  private draw() {
    if (!this.geom) return
    const t0 = performance.now()
    const { width: w, height: h } = this.canvas
    const aspect = this.p.aspect === "free" ? null : aspectRatio(this.p.aspect)
    const frame: FrameBox = computeFrame(w, h, aspect)
    const cam = new Camera(this.rot, frame, this.p.zoom, this.p.perspective)
    const ops = buildOps(this.geom, this.p, cam, frame, false)
    paintCanvas(this.ctx, ops, frame, aspect && this.p.showFrame ? "#141416" : this.p.bg)
    if (aspect && this.p.showFrame) {
      const { x, y, w: cw, h: ch } = frame.crop
      this.ctx.strokeStyle = "rgba(255,255,255,0.28)"
      this.ctx.lineWidth = this.dpr
      this.ctx.strokeRect(x - 0.5, y - 0.5, cw + 1, ch + 1)
    }
    this.dirty = false
    const end = performance.now()
    this.stats.drawMs = Math.round((end - t0) * 10) / 10
    if (end - this.lastStatEmit > 600) { this.lastStatEmit = end; this.onStats?.({ ...this.stats }) }
    void this.draft
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId)
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }
  }

  private onMove = (e: PointerEvent) => {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.x = e.clientX; d.y = e.clientY
    const len = Math.hypot(dx, dy)
    if (!len) return
    d.moved += len
    if (d.moved < 3) return
    if (e.shiftKey) {
      // shift-drag: spin the plate in its own plane
      this.rot = mul3(this.rot, axisAngle3(0, 0, 1, dx * 0.006))
    } else {
      // screen y is down, so dragging down tips the top edge away (rotation about -x)
      this.rot = mul3(axisAngle3(-dy, dx, 0, len * 0.006), this.rot)
    }
    if (++this.ops % 32 === 0) orthonormalize3(this.rot)
    this.dirty = true
  }

  private onUp = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) this.drag = null
  }

  private onDbl = () => this.resetView()

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const z = Math.min(5, Math.max(0.3, this.p.zoom * Math.exp(-e.deltaY * 0.0012)))
    this.p = { ...this.p, zoom: z }
    this.dirty = true
    this.onZoom?.(Math.round(z * 100) / 100)
  }
}
