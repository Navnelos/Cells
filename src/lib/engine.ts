// GPU engine. The structure (a few hundred seeds) is rebuilt on the CPU in milliseconds;
// the picture is drawn by a fragment shader, so paint-only changes are instant.
// A 2D overlay canvas carries the edge filaments, junction dots and the shape editor.

import { DEFAULTS, STRUCTURE_KEYS, type Aspect, type Lobe, type Params } from "./params"
import { FRAG, VERT } from "./shader"
import { MAX_SEEDS, PLATE_AR, buildStructure, type Structure } from "./structure"

export interface EngineStats {
  cells: number
  buildMs: number
  drawMs: number
}

export interface FrameBox {
  w: number
  h: number
  crop: { x: number; y: number; w: number; h: number }
}

export function aspectRatio(a: Aspect): number {
  switch (a) {
    case "1:1": return 1
    case "4:5": return 4 / 5
    case "16:9": return 16 / 9
    case "9:16": return 9 / 16
    default: return 7 / 6
  }
}

export function computeFrame(w: number, h: number, aspect: number, inset = 0.94): FrameBox {
  let cw = w * inset, ch = cw / aspect
  if (ch > h * inset) { ch = h * inset; cw = ch * aspect }
  return { w, h, crop: { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch } }
}

const viewFor = (f: FrameBox) => {
  const c = f.crop
  return { unit: Math.min(c.h / 2, c.w / (2 * PLATE_AR)), ox: c.x + c.w / 2, oy: c.y + c.h / 2 }
}

const rgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.replace("#", "").slice(0, 6), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

// ---- WebGL renderer (one per canvas) ---------------------------------------------------------

export class Renderer {
  gl: WebGL2RenderingContext
  prog: WebGLProgram
  tex: WebGLTexture
  loc = new Map<string, WebGLUniformLocation | null>()

  constructor(canvas: HTMLCanvasElement, preserve = false) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: preserve })
    if (!gl) throw new Error("WebGL2 is not available in this browser")
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error")
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error")
    this.prog = prog
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const a = gl.getAttribLocation(prog, "aPos")
    gl.enableVertexAttribArray(a)
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  }

  u(name: string) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name))
    return this.loc.get(name)!
  }

  setSeeds(s: Structure) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_SEEDS, 1, 0, gl.RGBA, gl.FLOAT, s.seeds)
  }

  draw(p: Params, s: Structure, frame: FrameBox, transparent: boolean) {
    const gl = this.gl
    const v = viewFor(frame)
    gl.viewport(0, 0, frame.w, frame.h)
    gl.useProgram(this.prog)
    gl.uniform1i(this.u("uSeeds"), 0)
    gl.uniform1i(this.u("uCount"), s.count)
    const lob = new Float32Array(24 * 3)
    p.lobes.slice(0, 24).forEach((l, i) => lob.set([l.x, l.y, l.r], i * 3))
    gl.uniform3fv(this.u("uLobes"), lob)
    gl.uniform1i(this.u("uLobeN"), Math.min(24, p.lobes.length))
    gl.uniform2f(this.u("uRes"), frame.w, frame.h)
    gl.uniform3f(this.u("uView"), v.unit, v.ox, v.oy)
    gl.uniform4f(this.u("uCrop"), frame.crop.x, frame.crop.y, frame.crop.w, frame.crop.h)
    gl.uniform1f(this.u("uPx"), frame.crop.h / 1000 / v.unit)
    gl.uniform1f(this.u("uDevPx"), 1 / v.unit)
    gl.uniform2f(this.u("uHub"), s.hub[0], s.hub[1])
    gl.uniform1f(this.u("uSeed"), (p.seed % 1000) * 0.37)
    gl.uniform1f(this.u("uStrand"), p.strandWidth)
    gl.uniform1f(this.u("uWebs"), p.webs)
    gl.uniform1f(this.u("uGlow"), p.glow)
    gl.uniform1f(this.u("uFoamScale"), 0.014 * Math.max(0.2, p.bubbleSize))
    gl.uniform1f(this.u("uOpen"), p.holes)
    gl.uniform4f(this.u("uMix"), p.wLime, p.wGreen, p.wBlue, p.wLace)
    gl.uniform1f(this.u("uFlat"), p.fill === "flat" ? 1 : 0)
    gl.uniform1f(this.u("uBand"), 0.0035)
    gl.uniform1f(this.u("uGrid"), p.grid ? 1 : 0)
    gl.uniform1f(this.u("uTransparent"), transparent ? 1 : 0)
    const colors: [string, string][] = [["cBg", p.bg], ["cStrand", p.strand], ["cHub", p.hub], ["cLime", p.lime], ["cGreen", p.green], ["cBlue", p.blue], ["cLace", p.lace], ["cGrid", p.gridColor]]
    for (const [n, c] of colors) gl.uniform3f(this.u(n), ...rgb(c))
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}

// ---- overlay (filaments, dots) -----------------------------------------------------------------

export function paintOverlay(ctx: CanvasRenderingContext2D, p: Params, s: Structure, frame: FrameBox) {
  const v = viewFor(frame)
  const px = frame.crop.h / 1000
  ctx.save()
  ctx.beginPath()
  ctx.rect(frame.crop.x, frame.crop.y, frame.crop.w, frame.crop.h)
  ctx.clip()
  ctx.setTransform(v.unit, 0, 0, v.unit, v.ox, v.oy)
  ctx.lineCap = "round"
  if (p.ticks) {
    ;[0.07, 0.14, 0.24].forEach((al, i) => {
      const t = s.ticks[i]
      if (!t.length) return
      ctx.globalAlpha = al
      ctx.strokeStyle = p.lace
      ctx.lineWidth = (0.6 * px) / v.unit
      ctx.beginPath()
      for (let k = 0; k < t.length; k += 4) { ctx.moveTo(t[k], t[k + 1]); ctx.lineTo(t[k + 2], t[k + 3]) }
      ctx.stroke()
    })
  }
  if (p.dots && s.dots.length) {
    ctx.globalAlpha = 1
    ctx.fillStyle = p.lace
    ctx.beginPath()
    for (let k = 0; k < s.dots.length; k += 3) { ctx.moveTo(s.dots[k] + s.dots[k + 2], s.dots[k + 1]); ctx.arc(s.dots[k], s.dots[k + 1], s.dots[k + 2], 0, Math.PI * 2) }
    ctx.fill()
  }
  ctx.restore()
}

// ---- engine ---------------------------------------------------------------------------------------

export class Engine {
  private r: Renderer
  private overlay: HTMLCanvasElement
  private octx: CanvasRenderingContext2D
  private p: Params = DEFAULTS
  private s: Structure | null = null
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
  private pending = 0
  private stats: EngineStats = { cells: 0, buildMs: 0, drawMs: 0 }
  onStats?: (s: EngineStats) => void
  onLobes?: (l: Lobe[]) => void

  constructor(private canvas: HTMLCanvasElement) {
    this.r = new Renderer(canvas)
    this.overlay = document.createElement("canvas")
    this.overlay.className = canvas.className
    this.overlay.style.pointerEvents = "none"
    canvas.parentElement?.insertBefore(this.overlay, canvas.nextSibling)
    this.octx = this.overlay.getContext("2d")!
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
    clearTimeout(this.pending)
    this.ro.disconnect()
    this.overlay.remove()
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
    if (key !== this.structKey) { this.structKey = key; this.rebuild() }
    this.dirty = true
  }

  setEditing(on: boolean) {
    this.editing = on
    this.canvas.style.cursor = on ? "crosshair" : "default"
    this.dirty = true
  }

  async exportRaster(type: "image/png" | "image/jpeg"): Promise<Blob> {
    if (!this.s) throw new Error("Nothing to export")
    const a = aspectRatio(this.p.aspect)
    const L = Math.min(this.p.exportSize, 8192)
    const W = a >= 1 ? L : Math.round(L * a), H = a >= 1 ? Math.round(L / a) : L
    const frame = computeFrame(W, H, a, 1)
    const gc = document.createElement("canvas")
    gc.width = W; gc.height = H
    const r = new Renderer(gc, true)
    r.setSeeds(this.s)
    const transparent = type === "image/png" && this.p.transparent
    r.draw({ ...this.p, lobes: this.lobes }, this.s, frame, transparent)
    const out = document.createElement("canvas")
    out.width = W; out.height = H
    const ctx = out.getContext("2d")
    if (!ctx) throw new Error("Canvas too large for this browser")
    ctx.drawImage(gc, 0, 0)
    paintOverlay(ctx, this.p, this.s, frame)
    r.gl.getExtension("WEBGL_lose_context")?.loseContext()
    return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("Export failed — try a smaller size"))), type, 0.95))
  }

  private rebuild() {
    this.s = buildStructure({ ...this.p, lobes: this.lobes })
    this.r.setSeeds(this.s)
    this.stats.cells = this.s.count
    this.stats.buildMs = this.s.ms
    this.onStats?.({ ...this.stats })
    this.dirty = true
  }

  private resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr))
    for (const c of [this.canvas, this.overlay]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    this.dirty = true
  }

  private tick = () => {
    if (this.dirty && this.s) this.draw()
    this.raf = requestAnimationFrame(this.tick)
  }

  private draw() {
    const t0 = performance.now()
    this.frame = computeFrame(this.canvas.width, this.canvas.height, aspectRatio(this.p.aspect))
    this.r.draw({ ...this.p, lobes: this.lobes }, this.s!, this.frame, false)
    this.octx.setTransform(1, 0, 0, 1, 0, 0)
    this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    paintOverlay(this.octx, this.p, this.s!, this.frame)
    if (this.editing) this.drawLobes()
    this.dirty = false
    this.stats.drawMs = Math.round((performance.now() - t0) * 10) / 10
  }

  private drawLobes() {
    const v = viewFor(this.frame!)
    const ctx = this.octx
    ctx.save()
    ctx.lineWidth = 1.2 * this.dpr
    this.lobes.forEach((l, i) => {
      const x = v.ox + l.x * v.unit, y = v.oy + l.y * v.unit
      ctx.strokeStyle = i === this.hover || this.drag?.i === i ? "rgba(255,80,200,0.95)" : "rgba(255,80,200,0.55)"
      ctx.setLineDash([6 * this.dpr, 5 * this.dpr])
      ctx.beginPath(); ctx.arc(x, y, l.r * v.unit, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = "rgba(255,80,200,0.95)"
      ctx.beginPath(); ctx.arc(x, y, 3.5 * this.dpr, 0, Math.PI * 2); ctx.fill()
    })
    ctx.restore()
  }

  private toPlate(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect()
    const v = viewFor(this.frame!)
    const sx = (e.clientX - rect.left) * this.dpr, sy = (e.clientY - rect.top) * this.dpr
    return { x: (sx - v.ox) / v.unit, y: (sy - v.oy) / v.unit, tol: (9 * this.dpr) / v.unit }
  }

  private hit(x: number, y: number, tol: number): { i: number; mode: "move" | "size" } | null {
    let best: { i: number; mode: "move" | "size"; d: number } | null = null
    this.lobes.forEach((l, i) => {
      const d = Math.hypot(x - l.x, y - l.y)
      if (Math.abs(d - l.r) < tol) {
        if (!best || Math.abs(d - l.r) < best.d) best = { i, mode: "size", d: Math.abs(d - l.r) }
      } else if (d < l.r && (!best || (best.mode === "move" && d < best.d))) best = { i, mode: "move", d }
    })
    return best
  }

  private onDown = (e: PointerEvent) => {
    if (!this.editing || !this.frame || e.button !== 0) return
    const { x, y, tol } = this.toPlate(e)
    const h = this.hit(x, y, tol)
    if (!h) return
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
      this.canvas.style.cursor = h ? (h.mode === "size" ? "ew-resize" : "move") : "crosshair"
      const hv = h ? h.i : -1
      if (hv !== this.hover) { this.hover = hv; this.dirty = true }
      return
    }
    const l = this.lobes[d.i]
    if (d.mode === "move") { l.x = x - d.ox; l.y = y - d.oy } else l.r = Math.max(0.04, Math.hypot(x - l.x, y - l.y))
    this.dirty = true
    clearTimeout(this.pending)
    this.pending = window.setTimeout(() => this.rebuild(), 30)
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
    if (h && this.lobes.length > 1) { this.lobes.splice(h.i, 1); this.hover = -1; this.commitLobes() }
  }

  private commitLobes() {
    const r = (v: number) => Math.round(v * 1000) / 1000
    this.onLobes?.(this.lobes.map((l) => ({ x: r(l.x), y: r(l.y), r: r(l.r) })))
  }
}
