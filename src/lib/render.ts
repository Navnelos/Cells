// Geometry → draw list (in plate units) → canvas or SVG. One list, two back-ends.

import { PLATE_AR, STYLES, type Curve, type Geometry } from "./geometry"
import type { Aspect, Params } from "./params"

export interface FrameBox {
  w: number
  h: number
  crop: { x: number; y: number; w: number; h: number }
}

/** Plate → screen: screen = (ox + x·unit, oy + y·unit). */
export interface View {
  unit: number
  ox: number
  oy: number
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

export function viewFor(frame: FrameBox): View {
  const c = frame.crop
  return { unit: Math.min(c.h / 2, c.w / (2 * PLATE_AR)), ox: c.x + c.w / 2, oy: c.y + c.h / 2 }
}

// ---- ops ---------------------------------------------------------------------------------

export type Op =
  | { k: "rect"; x: number; y: number; w: number; h: number; fill: string }
  | { k: "curves"; c: Curve[]; fill?: string; stroke?: string; width?: number; alpha?: number }
  | { k: "poly"; p: Float64Array; fill?: string; alpha?: number }
  | { k: "polys"; p: Float64Array[]; fill: string; stroke?: string; width?: number; alpha?: number }
  | { k: "lines"; s: Float64Array; stroke: string; width: number; alpha?: number }
  | { k: "discs"; d: Float64Array; fill?: string; stroke?: string; width?: number; alpha?: number }
  | { k: "radial"; x: number; y: number; r: number; color: string; alpha: number }
  | { k: "clipPoly"; p: Float64Array }
  | { k: "clipCurves"; c: Curve[] }
  | { k: "clipRings"; r: Float64Array[] }
  | { k: "unclip" }

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b)
  const c = (i: number) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, "0")
  return `#${c(0)}${c(1)}${c(2)}`
}

export function buildOps(g: Geometry, p: Params, frame: FrameBox, transparent: boolean): Op[] {
  const ops: Op[] = []
  const v = viewFor(frame)
  const c = frame.crop
  const px = c.h / 1000 / v.unit // one "px at a 1000 px tall frame", in plate units
  // the frame in plate coordinates
  const fx0 = (c.x - v.ox) / v.unit, fy0 = (c.y - v.oy) / v.unit
  const fx1 = (c.x + c.w - v.ox) / v.unit, fy1 = (c.y + c.h - v.oy) / v.unit

  if (!transparent) ops.push({ k: "rect", x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0, fill: p.bg })
  ops.push({ k: "clipPoly", p: Float64Array.from([fx0, fy0, fx1, fy0, fx1, fy1, fx0, fy1]) })

  // grid: faint lines, dots on the crossings
  if (p.grid) {
    const sp = (fy1 - fy0) / 11
    const gx0 = (fx0 + fx1) / 2 - Math.ceil((fx1 - fx0) / 2 / sp) * sp
    const gy0 = (fy0 + fy1) / 2 - Math.ceil((fy1 - fy0) / 2 / sp) * sp
    const segs: number[] = [], dots: number[] = []
    for (let x = gx0; x <= fx1; x += sp) segs.push(x, fy0, x, fy1)
    for (let y = gy0; y <= fy1; y += sp) segs.push(fx0, y, fx1, y)
    for (let x = gx0; x <= fx1; x += sp) for (let y = gy0; y <= fy1; y += sp) dots.push(x, y, 1.5 * px)
    ops.push({ k: "lines", s: Float64Array.from(segs), stroke: p.gridColor, width: 1 * px, alpha: 0.28 })
    ops.push({ k: "discs", d: Float64Array.from(dots), fill: p.gridColor, alpha: 0.95 })
  }

  if (p.ticks && g.ticks.length) ops.push({ k: "lines", s: g.ticks, stroke: p.lace, width: 0.9 * px, alpha: 0.32 })

  // ---- the shape -------------------------------------------------------------------------
  ops.push({ k: "clipPoly", p: g.outline })
  // junction webs: a dark, slightly tinted base under everything
  ops.push({ k: "poly", p: g.outline, fill: mix(mix(p.bg, p.blue, 0.22), p.strand, 0.06) })
  if (p.glow > 0) ops.push({ k: "radial", x: g.hub[0], y: g.hub[1], r: 0.45, color: p.hub, alpha: 0.4 * p.glow })

  // junction webs: a soft lime haze of very fine lines converging on the walls
  for (const cell of g.cells) {
    if (!cell.fans.length) continue
    const t = Math.min(1, p.glow * cell.hub)
    ops.push({ k: "curves", c: cell.fans, stroke: mix(p.strand, p.hub, t), width: 0.42 * px, alpha: Math.min(0.85, 0.22 + 0.4 * t) })
  }

  const pores = g.cells.map((cl) => cl.pore).filter((x): x is Curve => !!x)
  const emptyPores = g.cells.filter((cl) => cl.pore && !cl.filled).map((cl) => cl.pore!) as Curve[]
  // all cells dark (inside the edge band)
  ops.push({ k: "clipRings", r: g.inner })
  ops.push({ k: "curves", c: pores, fill: p.bg })
  ops.push({ k: "unclip" })

  // foam: between cells, along the edge band, and in the cells that carry it
  const colors: Record<(typeof STYLES)[number], string> = { lime: p.lime, green: p.green, blue: p.blue, lace: p.lace }
  for (const s of STYLES) {
    const base = s === "lace" && g.flat ? mix(p.green, p.bg, 0.55) : colors[s]
    const tones = [mix(base, p.bg, 0.06), base, mix(base, "#ffffff", 0.18)]
    g.tiles[s].forEach((polys, i) => {
      if (polys.length) ops.push({ k: "polys", p: polys, fill: tones[i], alpha: s === "lace" && !g.flat ? 0.82 : 1 })
    })
    const holeCol = s === "lace" ? p.bg : mix(colors[s], p.bg, 0.74)
    if (g.holes[s].length) ops.push({ k: "curves", c: g.holes[s], fill: holeCol })
    if (g.holesMid[s].length) ops.push({ k: "curves", c: g.holesMid[s], fill: mix(colors[s], p.bg, 0.55) })
  }

  // empty cells cut back to dark, then lace fragments and faint hatching inside some of them
  ops.push({ k: "clipRings", r: g.inner })
  ops.push({ k: "curves", c: emptyPores, fill: p.bg })
  ops.push({ k: "clipCurves", c: emptyPores })
  if (g.overTiles.length) {
    ops.push({ k: "polys", p: g.overTiles, fill: p.lace, alpha: 0.78 })
    ops.push({ k: "curves", c: g.overHoles, fill: p.bg })
  }
  if (p.hatching) {
    for (const cell of g.cells) {
      const h = cell.hatch
      if (!h) continue
      const segs: number[] = []
      const ca = Math.cos(h.angle), sa = Math.sin(h.angle)
      for (let o = -h.r; o <= h.r; o += h.spacing) {
        const half = Math.sqrt(Math.max(0, h.r * h.r - o * o)) * 1.6
        const mx = h.cx - sa * o, my = h.cy + ca * o
        segs.push(mx - ca * half, my - sa * half, mx + ca * half, my + sa * half)
      }
      ops.push({ k: "lines", s: Float64Array.from(segs), stroke: h.lace ? p.lace : p.strand, width: 0.5 * px, alpha: 0.16 })
    }
  }
  ops.push({ k: "unclip" })

  // strands: a soft glow pass, then the thin line; brighter towards the hub (stop at the edge band)
  for (const cell of g.cells) {
    if (!cell.pore) continue
    const t = Math.min(1, p.glow * cell.hub)
    const col = mix(p.strand, p.hub, t)
    ops.push({ k: "curves", c: [cell.pore], stroke: col, width: p.strandWidth * (3.2 + 2 * t) * px, alpha: 0.08 + 0.12 * t })
    ops.push({ k: "curves", c: [cell.pore], stroke: col, width: p.strandWidth * (1 + 0.7 * t) * px, alpha: 0.95 })
  }
  ops.push({ k: "unclip" }) // inner

  if (p.dots) {
    if (g.dots.length) ops.push({ k: "discs", d: g.dots, fill: p.lace })
    if (g.rings.length) {
      ops.push({ k: "discs", d: g.rings, stroke: p.lace, width: 1.3 * px })
      ops.push({ k: "discs", d: scaleR(g.rings, 0.32), fill: p.lace })
    }
  }
  ops.push({ k: "unclip" }) // outline
  ops.push({ k: "unclip" }) // frame
  return ops
}

function scaleR(d: Float64Array, f: number): Float64Array {
  const o = Float64Array.from(d)
  for (let i = 2; i < o.length; i += 3) o[i] *= f
  return o
}

// ---- canvas ----------------------------------------------------------------------------------

function curvePath(ctx: CanvasRenderingContext2D | Path2D, c: Curve) {
  ctx.moveTo(c[0], c[1])
  for (let i = 2; i + 5 < c.length; i += 6) ctx.bezierCurveTo(c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5])
  ctx.closePath()
}

function polyPath(ctx: CanvasRenderingContext2D, p: Float64Array) {
  ctx.moveTo(p[0], p[1])
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1])
  ctx.closePath()
}

export function paintCanvas(ctx: CanvasRenderingContext2D, ops: Op[], frame: FrameBox, clear: string | null) {
  const v = viewFor(frame)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  if (clear) { ctx.fillStyle = clear; ctx.fillRect(0, 0, frame.w, frame.h) } else ctx.clearRect(0, 0, frame.w, frame.h)
  ctx.setTransform(v.unit, 0, 0, v.unit, v.ox, v.oy)
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  for (const op of ops) {
    ctx.globalAlpha = "alpha" in op && op.alpha !== undefined ? op.alpha : 1
    switch (op.k) {
      case "rect":
        ctx.fillStyle = op.fill
        ctx.fillRect(op.x, op.y, op.w, op.h)
        break
      case "poly":
        ctx.beginPath(); polyPath(ctx, op.p)
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill() }
        break
      case "polys":
        ctx.beginPath()
        for (const q of op.p) polyPath(ctx, q)
        ctx.fillStyle = op.fill; ctx.fill()
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.width ?? 0.001; ctx.stroke() }
        break
      case "curves":
        ctx.beginPath()
        for (const c of op.c) curvePath(ctx, c)
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill("nonzero") }
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.width ?? 0.001; ctx.stroke() }
        break
      case "lines": {
        ctx.beginPath()
        const s = op.s
        for (let i = 0; i < s.length; i += 4) { ctx.moveTo(s[i], s[i + 1]); ctx.lineTo(s[i + 2], s[i + 3]) }
        ctx.strokeStyle = op.stroke; ctx.lineWidth = op.width; ctx.stroke()
        break
      }
      case "discs": {
        const d = op.d
        ctx.beginPath()
        for (let i = 0; i < d.length; i += 3) { ctx.moveTo(d[i] + d[i + 2], d[i + 1]); ctx.arc(d[i], d[i + 1], d[i + 2], 0, Math.PI * 2) }
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill() }
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.width ?? 0.001; ctx.stroke() }
        break
      }
      case "radial": {
        const gr = ctx.createRadialGradient(op.x, op.y, 0, op.x, op.y, op.r)
        gr.addColorStop(0, op.color); gr.addColorStop(1, op.color + "00")
        ctx.fillStyle = gr
        ctx.beginPath(); ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2); ctx.fill()
        break
      }
      case "clipPoly":
        ctx.save(); ctx.beginPath(); polyPath(ctx, op.p); ctx.clip()
        break
      case "clipCurves":
        ctx.save(); ctx.beginPath(); for (const c of op.c) curvePath(ctx, c); ctx.clip("nonzero")
        break
      case "clipRings":
        ctx.save(); ctx.beginPath(); for (const r of op.r) polyPath(ctx, r); ctx.clip("evenodd")
        break
      case "unclip":
        ctx.restore(); ctx.lineJoin = "round"; ctx.lineCap = "round"
        break
    }
  }
  ctx.globalAlpha = 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

// ---- SVG -----------------------------------------------------------------------------------

const n4 = (v: number) => (Math.round(v * 10000) / 10000).toString()

function curveD(c: Curve): string {
  let d = `M${n4(c[0])} ${n4(c[1])}`
  for (let i = 2; i + 5 < c.length; i += 6) d += `C${n4(c[i])} ${n4(c[i + 1])} ${n4(c[i + 2])} ${n4(c[i + 3])} ${n4(c[i + 4])} ${n4(c[i + 5])}`
  return d + "Z"
}

function polyD(p: Float64Array): string {
  let d = `M${n4(p[0])} ${n4(p[1])}`
  for (let i = 2; i < p.length; i += 2) d += `L${n4(p[i])} ${n4(p[i + 1])}`
  return d + "Z"
}

export function toSVG(ops: Op[], frame: FrameBox): string {
  const v = viewFor(frame)
  const { x, y, w, h } = frame.crop
  const out: string[] = []
  const defs: string[] = []
  let id = 0, open = 0
  const a = (al?: number) => (al !== undefined && al < 1 ? ` opacity="${Math.round(al * 1000) / 1000}"` : "")
  for (const op of ops) {
    switch (op.k) {
      case "rect":
        out.push(`<rect x="${n4(op.x)}" y="${n4(op.y)}" width="${n4(op.w)}" height="${n4(op.h)}" fill="${op.fill}"/>`)
        break
      case "poly":
        out.push(`<path d="${polyD(op.p)}" fill="${op.fill ?? "none"}"${a(op.alpha)}/>`)
        break
      case "polys": {
        const d = op.p.map(polyD).join("")
        if (d) out.push(`<path d="${d}" fill="${op.fill}"${op.stroke ? ` stroke="${op.stroke}" stroke-width="${n4(op.width ?? 0.001)}" stroke-linejoin="round"` : ""}${a(op.alpha)}/>`)
        break
      }
      case "curves": {
        const d = op.c.map(curveD).join("")
        if (!d) break
        out.push(`<path d="${d}" fill="${op.fill ?? "none"}"${op.stroke ? ` stroke="${op.stroke}" stroke-width="${n4(op.width ?? 0.001)}" stroke-linejoin="round"` : ""}${a(op.alpha)}/>`)
        break
      }
      case "lines": {
        let d = ""
        for (let i = 0; i < op.s.length; i += 4) d += `M${n4(op.s[i])} ${n4(op.s[i + 1])}L${n4(op.s[i + 2])} ${n4(op.s[i + 3])}`
        if (d) out.push(`<path d="${d}" fill="none" stroke="${op.stroke}" stroke-width="${n4(op.width)}" stroke-linecap="round"${a(op.alpha)}/>`)
        break
      }
      case "discs": {
        const parts: string[] = []
        for (let i = 0; i < op.d.length; i += 3) parts.push(`<circle cx="${n4(op.d[i])}" cy="${n4(op.d[i + 1])}" r="${n4(op.d[i + 2])}"/>`)
        if (!parts.length) break
        const paint = op.fill ? `fill="${op.fill}"` : `fill="none" stroke="${op.stroke}" stroke-width="${n4(op.width ?? 0.001)}"`
        out.push(`<g ${paint}${a(op.alpha)}>${parts.join("")}</g>`)
        break
      }
      case "radial": {
        const gid = `g${id++}`
        defs.push(`<radialGradient id="${gid}" cx="${n4(op.x)}" cy="${n4(op.y)}" r="${n4(op.r)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${op.color}"/><stop offset="1" stop-color="${op.color}" stop-opacity="0"/></radialGradient>`)
        out.push(`<circle cx="${n4(op.x)}" cy="${n4(op.y)}" r="${n4(op.r)}" fill="url(#${gid})"${a(op.alpha)}/>`)
        break
      }
      case "clipPoly":
      case "clipRings":
      case "clipCurves": {
        const cid = `c${id++}`
        const d = op.k === "clipPoly" ? polyD(op.p) : op.k === "clipRings" ? op.r.map(polyD).join("") : op.c.map(curveD).join("")
        defs.push(`<clipPath id="${cid}"><path d="${d}"${op.k === "clipRings" ? ' clip-rule="evenodd"' : ""}/></clipPath>`)
        out.push(`<g clip-path="url(#${cid})">`)
        open++
        break
      }
      case "unclip":
        if (open > 0) { out.push("</g>"); open-- }
        break
    }
  }
  while (open-- > 0) out.push("</g>")
  const m = `matrix(${n4(v.unit)} 0 0 ${n4(v.unit)} ${n4(v.ox)} ${n4(v.oy)})`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n4(x)} ${n4(y)} ${n4(w)} ${n4(h)}" width="${Math.round(w)}" height="${Math.round(h)}"><defs>${defs.join("")}</defs><g transform="${m}">${out.join("")}</g></svg>`
}
