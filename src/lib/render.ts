// Geometry (flat plate) → camera → a list of screen-space draw ops, painted either to a
// canvas or written out as SVG. One list, two back-ends, identical pictures.

import { PLATE_AR, type Geometry } from "./geometry"
import type { Aspect, Params } from "./params"

export type M3 = Float64Array // row-major 3×3

export interface FrameBox {
  w: number
  h: number
  crop: { x: number; y: number; w: number; h: number }
}

export function aspectRatio(a: Aspect): number | null {
  switch (a) {
    case "7:6": return 7 / 6
    case "1:1": return 1
    case "4:5": return 4 / 5
    case "16:9": return 16 / 9
    case "9:16": return 9 / 16
    default: return null
  }
}

export function computeFrame(w: number, h: number, aspect: number | null, inset = 0.94): FrameBox {
  if (!aspect) return { w, h, crop: { x: 0, y: 0, w, h } }
  let cw = w * inset, ch = cw / aspect
  if (ch > h * inset) { ch = h * inset; cw = ch * aspect }
  return { w, h, crop: { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch } }
}

// ---- draw ops -----------------------------------------------------------------------

type Rings = Float64Array[]

export type Op =
  | { k: "rect"; x: number; y: number; w: number; h: number; fill: string; alpha?: number }
  | { k: "path"; rings: Rings; fill?: string; stroke?: string; width?: number; alpha?: number; rule?: "evenodd" | "nonzero"; dash?: number[]; closed?: boolean; join?: "round" | "miter" }
  | { k: "lines"; segs: Float64Array; stroke: string; width: number; alpha?: number; dash?: number[]; cap?: "round" | "butt" }
  | { k: "dots"; xy: Float64Array; r: Float64Array; fill: string; alpha?: number }
  | { k: "text"; x: number; y: number; text: string; size: number; fill: string; alpha?: number; weight?: number; mono?: boolean; rotate?: number; anchor?: "start" | "middle" | "end"; baseline?: "alphabetic" | "middle" | "hanging" }
  | { k: "clip"; rings: Rings; rule: "evenodd" | "nonzero" }
  | { k: "unclip" }

// ---- camera ---------------------------------------------------------------------------

export class Camera {
  unit = 1
  ox = 0
  oy = 0
  D = 1e9
  constructor(public rot: M3, frame: FrameBox, zoom: number, perspective: number) {
    const c = frame.crop
    this.unit = Math.min(c.h / 2, c.w / (2 * PLATE_AR)) * zoom
    this.ox = c.x + c.w / 2
    this.oy = c.y + c.h / 2
    this.D = perspective > 0.001 ? 2.2 / perspective : 1e9
  }
  /** plate (x, y, z) → screen; returns depth (larger = further) in the third slot */
  project(x: number, y: number, z: number, out: number[] | Float64Array, o = 0): number {
    const r = this.rot
    const X = r[0] * x + r[1] * y + r[2] * z
    const Y = r[3] * x + r[4] * y + r[5] * z
    const Z = r[6] * x + r[7] * y + r[8] * z
    const s = this.D / (this.D + Z)
    out[o] = this.ox + X * s * this.unit
    out[o + 1] = this.oy + Y * s * this.unit
    return Z
  }
  rings(rs: Rings, z = 0): Rings {
    return rs.map((r) => {
      const o = new Float64Array(r.length)
      for (let i = 0; i < r.length; i += 2) this.project(r[i], r[i + 1], z, o, i)
      return o
    })
  }
  segs(s: Float64Array, z = 0): Float64Array {
    const o = new Float64Array(s.length)
    for (let i = 0; i < s.length; i += 2) this.project(s[i], s[i + 1], z, o, i)
    return o
  }
  /** how strongly the plate faces the viewer (1 = flat on, 0 = edge on) */
  facing(): number {
    return Math.abs(this.rot[8])
  }
}

// ---- helpers ----------------------------------------------------------------------------

function shade(hex: string, f: number): string {
  const h = hex.replace("#", "")
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16)
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x * f))).toString(16).padStart(2, "0")
  return `#${c((v >> 16) & 255)}${c((v >> 8) & 255)}${c(v & 255)}`
}

// ---- the draw list ----------------------------------------------------------------------

export function buildOps(g: Geometry, p: Params, cam: Camera, frame: FrameBox, transparent: boolean): Op[] {
  const ops: Op[] = []
  const c = frame.crop
  const u = c.h / 1000 // line widths and type are specified at a 1000 px tall frame
  const ink = p.ink

  if (!transparent) ops.push({ k: "rect", x: c.x, y: c.y, w: c.w, h: c.h, fill: p.bg })
  ops.push({ k: "clip", rings: [Float64Array.from([c.x, c.y, c.x + c.w, c.y, c.x + c.w, c.y + c.h, c.x, c.y + c.h])], rule: "nonzero" })

  // grid
  if (p.grid) {
    const cols = Math.max(2, Math.round(p.gridCols))
    const segs: number[] = []
    if (p.gridOnPlate) {
      const sp = (2 * PLATE_AR) / cols
      for (let x = -PLATE_AR; x <= PLATE_AR + 1e-6; x += sp) segs.push(x, -1, x, 1)
      for (let y = -1; y <= 1 + 1e-6; y += sp) segs.push(-PLATE_AR, y, PLATE_AR, y)
      ops.push({ k: "lines", segs: cam.segs(Float64Array.from(segs)), stroke: p.gridColor, width: 1.6 * u, alpha: 0.9 })
    } else {
      const sp = c.w / (cols + 0.5)
      for (let x = c.x + sp * 0.5; x < c.x + c.w; x += sp) segs.push(x, c.y, x, c.y + c.h)
      for (let y = c.y + sp * 0.62; y < c.y + c.h; y += sp) segs.push(c.x, y, c.x + c.w, y)
      ops.push({ k: "lines", segs: Float64Array.from(segs), stroke: p.gridColor, width: 1.6 * u, alpha: 0.9 })
    }
  }

  // behind the foam: orbit arcs, rays, hairlines along the outline
  if (p.rings && g.arcs.length) {
    const arcs = g.arcs.map((a) => {
      const o = new Float64Array(65 * 2)
      for (let i = 0; i <= 64; i++) {
        const t = a.a0 + ((a.a1 - a.a0) * i) / 64
        o[2 * i] = a.cx + Math.cos(t) * a.rx
        o[2 * i + 1] = a.cy + Math.sin(t) * a.ry
      }
      return o
    })
    ops.push({ k: "path", rings: cam.rings(arcs), stroke: ink, width: 2.2 * u, alpha: 0.32, dash: [1.5 * u, 7 * u], closed: false })
  }
  if (p.rays && g.rays.length) {
    const [cx, cy] = g.center
    const segs: number[] = []
    for (const a of g.rays) segs.push(cx + Math.cos(a) * 0.04, cy + Math.sin(a) * 0.04, cx + Math.cos(a) * 3.2, cy + Math.sin(a) * 3.2)
    ops.push({ k: "lines", segs: cam.segs(Float64Array.from(segs)), stroke: ink, width: 2.4 * u, alpha: 0.6, dash: [11 * u, 9 * u] })
  }
  if (p.fringe && g.fringe.length) {
    ops.push({ k: "lines", segs: cam.segs(g.fringe), stroke: ink, width: 1.3 * u, alpha: 0.32 })
  }

  // the foam, with optional thickness
  const top = [...g.blob, ...g.pores]
  const layers = p.depth > 0.0005 ? Math.max(4, Math.min(28, Math.round((p.depth * cam.unit) / 3))) : 0
  // plate thickness runs towards +z; rot[8] says whether +z points away from the viewer
  const drawLayers = (from: number, to: number) => {
    for (let i = from; i !== to; i += from < to ? 1 : -1) {
      const z = (p.depth * (i + 1)) / layers
      const f = 0.3 + 0.38 * (1 - (i + 1) / layers)
      ops.push({ k: "path", rings: cam.rings(top, z), fill: shade(p.tissue, f), rule: "evenodd" })
    }
  }
  const topFirst = cam.rot[8] < 0 // the top is the far side: we're looking at the underside
  if (layers && !topFirst) drawLayers(layers - 1, -1)

  const topS = cam.rings(top)
  ops.push({ k: "path", rings: topS, fill: p.tissue, rule: "evenodd" })
  if (g.patches.some((r) => r.length)) {
    ops.push({ k: "clip", rings: cam.rings(g.zone), rule: "nonzero" })
    ops.push({ k: "clip", rings: topS, rule: "evenodd" })
    const cols = [p.c1, p.c2, p.c3, p.c4, p.c5]
    g.patches.forEach((rs, i) => {
      if (rs.length) ops.push({ k: "path", rings: cam.rings(rs), fill: cols[i], stroke: cols[i], width: 0.8 * u })
    })
    ops.push({ k: "unclip" }, { k: "unclip" })
  }
  const poresS = cam.rings(g.pores)
  if (p.poreOpacity > 0) ops.push({ k: "path", rings: poresS, fill: p.poreColor, alpha: p.poreOpacity })
  if (p.wallWidth > 0) ops.push({ k: "path", rings: poresS, stroke: p.wall, width: p.wallWidth * u, join: "round" })
  if (layers && topFirst) drawLayers(0, layers)

  // on top: graph, trails, nodes, labels
  if (p.graph) {
    if (g.graph.length) ops.push({ k: "lines", segs: cam.segs(g.graph), stroke: ink, width: 1.4 * u, alpha: p.graphOpacity })
    if (g.trails.length) ops.push({ k: "lines", segs: cam.segs(g.trails), stroke: ink, width: 1.2 * u, alpha: p.graphOpacity * 0.85, dash: [4 * u, 5 * u] })
  }
  if (p.nodes && g.nodes.length) {
    const m = g.nodes.length / 3
    const xy = new Float64Array(m * 2), r = new Float64Array(m)
    for (let i = 0; i < m; i++) {
      cam.project(g.nodes[3 * i], g.nodes[3 * i + 1], 0, xy, 2 * i)
      r[i] = g.nodes[3 * i + 2] * 4.2 * u * p.nodeSize * Math.sqrt(cam.unit / (c.h / 2))
    }
    ops.push({ k: "dots", xy, r, fill: ink, alpha: 0.95 })
  }
  ops.push({ k: "unclip" })
  return ops
}

// ---- canvas ---------------------------------------------------------------------------------

const SANS = "Geist, ui-sans-serif, system-ui, -apple-system, Helvetica, Arial, sans-serif"
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

function ringsPath(ctx: CanvasRenderingContext2D, rings: Rings, closed = true) {
  ctx.beginPath()
  for (const r of rings) {
    if (r.length < 4) continue
    ctx.moveTo(r[0], r[1])
    for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1])
    if (closed) ctx.closePath()
  }
}

export function paintCanvas(ctx: CanvasRenderingContext2D, ops: Op[], frame: FrameBox, clearColor: string | null) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  if (clearColor) { ctx.fillStyle = clearColor; ctx.fillRect(0, 0, frame.w, frame.h) } else ctx.clearRect(0, 0, frame.w, frame.h)
  ctx.lineJoin = "round"
  for (const op of ops) {
    ctx.globalAlpha = "alpha" in op && op.alpha !== undefined ? op.alpha : 1
    switch (op.k) {
      case "rect":
        ctx.fillStyle = op.fill
        ctx.fillRect(op.x, op.y, op.w, op.h)
        break
      case "path":
        ringsPath(ctx, op.rings, op.closed !== false)
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(op.rule ?? "nonzero") }
        if (op.stroke) {
          ctx.strokeStyle = op.stroke
          ctx.lineWidth = op.width ?? 1
          ctx.setLineDash(op.dash ?? [])
          ctx.lineCap = op.dash ? "round" : "butt"
          ctx.stroke()
          ctx.setLineDash([])
        }
        break
      case "lines": {
        const s = op.segs
        ctx.beginPath()
        for (let i = 0; i < s.length; i += 4) { ctx.moveTo(s[i], s[i + 1]); ctx.lineTo(s[i + 2], s[i + 3]) }
        ctx.strokeStyle = op.stroke
        ctx.lineWidth = op.width
        ctx.lineCap = op.cap ?? "round"
        ctx.setLineDash(op.dash ?? [])
        ctx.stroke()
        ctx.setLineDash([])
        break
      }
      case "dots":
        ctx.beginPath()
        for (let i = 0; i < op.r.length; i++) {
          ctx.moveTo(op.xy[2 * i] + op.r[i], op.xy[2 * i + 1])
          ctx.arc(op.xy[2 * i], op.xy[2 * i + 1], op.r[i], 0, Math.PI * 2)
        }
        ctx.fillStyle = op.fill
        ctx.fill()
        break
      case "text":
        ctx.save()
        ctx.translate(op.x, op.y)
        if (op.rotate) ctx.rotate(op.rotate)
        ctx.font = `${op.weight ?? 400} ${op.size}px ${op.mono ? MONO : SANS}`
        ctx.textAlign = op.anchor === "middle" ? "center" : op.anchor === "end" ? "right" : "left"
        ctx.textBaseline = op.baseline ?? "alphabetic"
        ctx.fillStyle = op.fill
        ctx.fillText(op.text, 0, 0)
        ctx.restore()
        break
      case "clip":
        ctx.save()
        ringsPath(ctx, op.rings)
        ctx.clip(op.rule)
        break
      case "unclip":
        ctx.restore()
        ctx.lineJoin = "round"
        break
    }
  }
  ctx.globalAlpha = 1
}

// ---- SVG -------------------------------------------------------------------------------------

const f1 = (v: number) => (Math.round(v * 10) / 10).toString()
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

function ringsD(rings: Rings, closed = true): string {
  let d = ""
  for (const r of rings) {
    if (r.length < 4) continue
    d += `M${f1(r[0])} ${f1(r[1])}`
    for (let i = 2; i < r.length; i += 2) d += `L${f1(r[i])} ${f1(r[i + 1])}`
    if (closed) d += "Z"
  }
  return d
}

export function toSVG(ops: Op[], frame: FrameBox): string {
  const { x, y, w, h } = frame.crop
  const out: string[] = []
  const defs: string[] = []
  let clipId = 0
  let open = 0
  const a = (v?: number) => (v !== undefined && v < 1 ? ` opacity="${Math.round(v * 1000) / 1000}"` : "")
  for (const op of ops) {
    switch (op.k) {
      case "rect":
        out.push(`<rect x="${f1(op.x)}" y="${f1(op.y)}" width="${f1(op.w)}" height="${f1(op.h)}" fill="${op.fill}"${a(op.alpha)}/>`)
        break
      case "path": {
        const d = ringsD(op.rings, op.closed !== false)
        if (!d) break
        const fill = op.fill ? `fill="${op.fill}"${op.rule === "evenodd" ? ' fill-rule="evenodd"' : ""}` : 'fill="none"'
        const stroke = op.stroke
          ? ` stroke="${op.stroke}" stroke-width="${f1(op.width ?? 1)}" stroke-linejoin="round"${op.dash ? ` stroke-dasharray="${op.dash.map(f1).join(" ")}" stroke-linecap="round"` : ""}`
          : ""
        out.push(`<path d="${d}" ${fill}${stroke}${a(op.alpha)}/>`)
        break
      }
      case "lines": {
        let d = ""
        const s = op.segs
        for (let i = 0; i < s.length; i += 4) d += `M${f1(s[i])} ${f1(s[i + 1])}L${f1(s[i + 2])} ${f1(s[i + 3])}`
        if (!d) break
        out.push(`<path d="${d}" fill="none" stroke="${op.stroke}" stroke-width="${f1(op.width)}" stroke-linecap="${op.cap ?? "round"}"${op.dash ? ` stroke-dasharray="${op.dash.map(f1).join(" ")}"` : ""}${a(op.alpha)}/>`)
        break
      }
      case "dots": {
        const parts: string[] = []
        for (let i = 0; i < op.r.length; i++) parts.push(`<circle cx="${f1(op.xy[2 * i])}" cy="${f1(op.xy[2 * i + 1])}" r="${f1(op.r[i])}"/>`)
        out.push(`<g fill="${op.fill}"${a(op.alpha)}>${parts.join("")}</g>`)
        break
      }
      case "text": {
        const tr = `translate(${f1(op.x)} ${f1(op.y)})${op.rotate ? ` rotate(${f1((op.rotate * 180) / Math.PI)})` : ""}`
        const anchor = op.anchor && op.anchor !== "start" ? ` text-anchor="${op.anchor}"` : ""
        const base = op.baseline === "middle" ? ' dominant-baseline="central"' : op.baseline === "hanging" ? ' dominant-baseline="hanging"' : ""
        out.push(`<text transform="${tr}" font-family="${op.mono ? MONO.replace(/'/g, "") : SANS}" font-size="${f1(op.size)}" font-weight="${op.weight ?? 400}" fill="${op.fill}"${anchor}${base}${a(op.alpha)}>${esc(op.text)}</text>`)
        break
      }
      case "clip": {
        const id = `c${clipId++}`
        defs.push(`<clipPath id="${id}"><path d="${ringsD(op.rings)}" clip-rule="${op.rule}"/></clipPath>`)
        out.push(`<g clip-path="url(#${id})">`)
        open++
        break
      }
      case "unclip":
        if (open > 0) { out.push("</g>"); open-- }
        break
    }
  }
  while (open-- > 0) out.push("</g>")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(x)} ${f1(y)} ${f1(w)} ${f1(h)}" width="${Math.round(w)}" height="${Math.round(h)}"><defs>${defs.join("")}</defs>${out.join("")}</svg>`
}
