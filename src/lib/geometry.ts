// One cellular system at every scale, on a flat "plate" (frame height = 2 units, y down).
//
//   Outline   smooth union of circles (the lobes you can edit).
//   Size      a size field sets how big a cell wants to be at each point: large cavities
//             inside, shrinking smoothly through medium cells to micro-cells towards the
//             edge, with clusters of smaller cells nested between the cavities.
//   Cells     variable-radius Poisson darts in that field; every cell is its power-diagram
//             region (weighted Voronoi, exact straight walls) — the same rule at all sizes.
//   Look      a cell's wall thickness grows relative to its size as it gets smaller, so
//             dense regions read as coloured foam and big cells as dark cavities with
//             hair-thin strands and fanned junctions. Patches colour the foam walls.
//
// Every curve is analytic (circular-arc Béziers), so edges stay smooth at any size.

import { contours } from "d3-contour"

import { fbm, makeNoise } from "./noise"
import type { Lobe, Params } from "./params"
import { mulberry32 } from "./rng"

export const PLATE_AR = 7 / 6
const LOBE_K = 0.08 // smoothness of the union of lobes

/** Closed cubic Bézier path: x0 y0, then (c1x c1y c2x c2y x y) per segment. */
export type Curve = Float64Array

export const STYLES = ["lime", "green", "blue", "lace"] as const
export type Style = (typeof STYLES)[number]

export interface Cavity {
  pore: Curve
  fans: Curve[]
  size: number // 0..1, relative to the largest cavity
  hub: number // 0..1, closeness to the centre hub
}

export interface Geometry {
  flat: boolean
  outline: Float64Array
  cavities: Cavity[]
  tiles: Record<Style, Float64Array[][]> // per style, three tones of polygons
  holes: Record<Style, Curve[]>
  holesMid: Record<Style, Curve[]>
  dots: Float64Array // x y r
  rings: Float64Array // x y r
  ticks: Float64Array // segments x0 y0 x1 y1
  hub: [number, number]
  extent: { x0: number; y0: number; x1: number; y1: number }
  stats: { cells: number; bubbles: number; ms: number }
}

// ---- helpers -----------------------------------------------------------------------------

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export function lobeSDF(lobes: Lobe[]) {
  return (x: number, y: number) => {
    let d = Infinity
    for (const l of lobes) d = smin(d, Math.hypot(x - l.x, y - l.y) - l.r, LOBE_K)
    return d
  }
}

/** Convex polygon as parallel arrays; lab[k] labels the edge from vertex k to k+1. */
interface LPoly {
  x: number[]
  y: number[]
  lab: number[]
}

/** Clip to the half-plane n·p ≤ c; new edges along the clip line get label `cl`. */
function clip(p: LPoly, nx: number, ny: number, c: number, cl: number): LPoly {
  const o: LPoly = { x: [], y: [], lab: [] }
  const m = p.x.length
  for (let k = 0; k < m; k++) {
    const j = (k + 1) % m
    const ax = p.x[k], ay = p.y[k], bx = p.x[j], by = p.y[j]
    const da = nx * ax + ny * ay - c, db = nx * bx + ny * by - c
    const ain = da <= 0, bin = db <= 0
    if (ain) { o.x.push(ax); o.y.push(ay); o.lab.push(p.lab[k]) }
    if (ain !== bin) {
      const t = da / (da - db)
      o.x.push(ax + (bx - ax) * t); o.y.push(ay + (by - ay) * t)
      o.lab.push(ain ? cl : p.lab[k])
    }
  }
  return o
}



// ---- rounded, bowed polygon → cubic Bézier curve ---------------------------------------

/**
 * Build the closed curve of polygon `q` whose edges are quadratic arcs (each edge bowed
 * by `bow(label)`), with every corner replaced by a circular-arc fillet of tangent length
 * up to `t`.
 */
function roundedCurve(q: LPoly, bow: (lab: number) => [number, number], t: number): Curve | null {
  const m = q.x.length
  if (m < 3) return null
  // edges as quadratics A → C → B
  const A: number[] = [], C: number[] = [], B: number[] = [], L: number[] = []
  for (let k = 0; k < m; k++) {
    const j = (k + 1) % m
    const [dx, dy] = bow(q.lab[k])
    A.push(q.x[k], q.y[k]); B.push(q.x[j], q.y[j])
    C.push((q.x[k] + q.x[j]) / 2 + dx, (q.y[k] + q.y[j]) / 2 + dy)
    L.push(Math.hypot(q.x[j] - q.x[k], q.y[j] - q.y[k]))
  }
  const tk: number[] = []
  for (let k = 0; k < m; k++) {
    const prev = (k - 1 + m) % m
    tk.push(Math.max(0, Math.min(t, 0.46 * L[prev], 0.46 * L[k])))
  }
  const Q = (k: number, s: number) => {
    const u = 1 - s
    return [
      u * u * A[2 * k] + 2 * s * u * C[2 * k] + s * s * B[2 * k],
      u * u * A[2 * k + 1] + 2 * s * u * C[2 * k + 1] + s * s * B[2 * k + 1],
    ]
  }
  const dQ = (k: number, s: number) => [
    2 * (1 - s) * (C[2 * k] - A[2 * k]) + 2 * s * (B[2 * k] - C[2 * k]),
    2 * (1 - s) * (C[2 * k + 1] - A[2 * k + 1]) + 2 * s * (B[2 * k + 1] - C[2 * k + 1]),
  ]
  const out: number[] = []
  const a0 = L[0] > 1e-9 ? tk[0] / L[0] : 0
  const s0 = Q(0, a0)
  out.push(s0[0], s0[1])
  for (let k = 0; k < m; k++) {
    if (L[k] < 1e-9) continue
    const a = tk[k] / L[k]
    const nk = (k + 1) % m
    const b = 1 - tk[nk] / L[k]
    // straight-ish middle of the edge: exact sub-quadratic, elevated to a cubic
    const P0 = Q(k, a), P2 = Q(k, b), d0 = dQ(k, a)
    const P1 = [P0[0] + ((b - a) / 2) * d0[0], P0[1] + ((b - a) / 2) * d0[1]]
    out.push(
      P0[0] + (2 / 3) * (P1[0] - P0[0]), P0[1] + (2 / 3) * (P1[1] - P0[1]),
      P2[0] + (2 / 3) * (P1[0] - P2[0]), P2[1] + (2 / 3) * (P1[1] - P2[1]),
      P2[0], P2[1],
    )
    // fillet at the next corner: circular-arc cubic between the two tangents
    let nn = nk
    while (L[nn] < 1e-9 && nn !== k) nn = (nn + 1) % m
    const a2 = tk[nn] / L[nn]
    const S = Q(nn, a2)
    const T1 = dQ(k, b), T2 = dQ(nn, a2)
    const l1 = Math.hypot(T1[0], T1[1]) || 1, l2 = Math.hypot(T2[0], T2[1]) || 1
    const u1 = [T1[0] / l1, T1[1] / l1], u2 = [T2[0] / l2, T2[1] / l2]
    const cosPhi = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))
    const phi = Math.acos(cosPhi) // turning angle
    const chord = Math.hypot(S[0] - P2[0], S[1] - P2[1])
    // handle length of a circular arc spanning `phi` with this chord
    const h = phi > 1e-4 ? ((4 / 3) * Math.tan(phi / 4) * (chord / 2)) / Math.sin(phi / 2) : chord / 3
    out.push(P2[0] + u1[0] * h, P2[1] + u1[1] * h, S[0] - u2[0] * h, S[1] - u2[1] * h, S[0], S[1])
  }
  return Float64Array.from(out)
}

// ---- build ---------------------------------------------------------------------------------

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function buildGeometry(p: Params): Geometry {
  const t0 = performance.now()
  const lobes = p.lobes.length ? p.lobes : [{ x: 0, y: 0, r: 0.6 }]
  const B = lobeSDF(lobes)
  const rng = mulberry32(p.seed)
  const noise = makeNoise(p.seed + 7)
  const flat = p.fill === "flat"

  // ---- extent, area, depth --------------------------------------------------------------
  const hs = 2 / 160
  let area = 0, mx = 0, my = 0, maxDepth = 0, ns = 0
  const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (let y = -1.6 + hs / 2; y < 1.6; y += hs) {
    for (let x = -1.9 + hs / 2; x < 1.9; x += hs) {
      const b = B(x, y)
      if (b >= 0) continue
      ns++; area += hs * hs; mx += x; my += y
      maxDepth = Math.max(maxDepth, -b)
      if (x < ext.x0) ext.x0 = x
      if (x > ext.x1) ext.x1 = x
      if (y < ext.y0) ext.y0 = y
      if (y > ext.y1) ext.y1 = y
    }
  }
  const hub: [number, number] = ns ? [mx / ns, my / ns] : [0, 0]
  if (!ns) { ext.x0 = ext.y0 = -0.5; ext.x1 = ext.y1 = 0.5; maxDepth = 0.5 }

  // ---- outline ----------------------------------------------------------------------------
  const oh = 2 / 700
  const ox0 = ext.x0 - 0.05, oy0 = ext.y0 - 0.05
  const onx = Math.ceil((ext.x1 - ext.x0 + 0.1) / oh), ony = Math.ceil((ext.y1 - ext.y0 + 0.1) / oh)
  const vals = new Float64Array(onx * ony)
  for (let j = 0; j < ony; j++) for (let i = 0; i < onx; i++) vals[j * onx + i] = -B(ox0 + (i + 0.5) * oh, oy0 + (j + 0.5) * oh)
  const mp = contours().size([onx, ony]).contour(vals as unknown as number[], 0)
  let outline = new Float64Array(0)
  for (const poly of mp.coordinates) {
    const ring = poly[0]
    if (ring.length * 2 > outline.length) {
      outline = new Float64Array((ring.length - 1) * 2)
      for (let k = 0; k < ring.length - 1; k++) { outline[2 * k] = ox0 + ring[k][0] * oh; outline[2 * k + 1] = oy0 + ring[k][1] * oh }
    }
  }

  // ---- the size field ---------------------------------------------------------------------
  const nCav = Math.max(4, Math.round(p.cells))
  const Rmax = Math.sqrt((0.62 * area) / (nCav * Math.PI))
  const Rmin = 0.0062 * Math.max(0.3, p.bubbleSize)
  const ratio = Math.log(Rmax / Rmin)
  const zone = 0.1 + 1.0 * Math.max(0, p.foamAmount) // how deep the dense outer foam reaches
  const sizeAt = (x: number, y: number) => {
    const d = Math.max(0, -B(x, y)) / maxDepth
    // the dense zone's depth wanders along the edge: thick in places, nearly gone in others
    const z = zone * Math.max(0.12, 1 + 1.1 * fbm(noise, x * 2.3 + 5, y * 2.3 - 2, 2))
    const s = smooth(0, z, d)
    // nested clusters of smaller cells between the cavities
    const c = Math.min(1, Math.max(0, p.spacing) * 1.6 * smooth(0.0, 0.4, noise(x * 3.4 + 9, y * 3.4 - 4)))
    return Rmin * Math.exp(ratio * s * (1 - 0.85 * c))
  }

  // ---- variable-radius Poisson darts ---------------------------------------------------------
  const sx: number[] = [], sy: number[] = [], sr: number[] = []
  const hc = Rmin * 3
  const hash = new Map<number, number[]>()
  const key = (i: number, j: number) => i * 73856093 ^ j * 19349663
  const cellsOver = (x: number, y: number, r: number, f: (k: number) => boolean | void) => {
    const i0 = Math.floor((x - r) / hc), i1 = Math.floor((x + r) / hc)
    const j0 = Math.floor((y - r) / hc), j1 = Math.floor((y + r) / hc)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (f(key(i, j)) === false) return false
    return true
  }
  const fits = (x: number, y: number, r: number) =>
    cellsOver(x, y, r, (hk) => {
      const l = hash.get(hk)
      if (l) for (const k of l) if (Math.hypot(sx[k] - x, sy[k] - y) < (r + sr[k]) * 0.94) return false
    })
  const add = (x: number, y: number, r: number) => {
    const k = sx.length
    sx.push(x); sy.push(y); sr.push(r)
    cellsOver(x, y, r, (hk) => { const l = hash.get(hk); if (l) l.push(k); else hash.set(hk, [k]) })
  }
  const randIn = () => [ext.x0 + rng() * (ext.x1 - ext.x0), ext.y0 + rng() * (ext.y1 - ext.y0)]
  // giant cavities first, deep inside
  for (let g = 0; g < Math.round(p.giants); g++) {
    const r = Rmax * p.giantSize * (0.85 + rng() * 0.3)
    for (let t = 0; t < 800; t++) {
      const [x, y] = randIn()
      if (-B(x, y) < r * 1.05 || !fits(x, y, r)) continue
      add(x, y, r)
      break
    }
  }
  // then the field, coarse to fine so the cavities claim their space first
  for (const pass of [0.5, 0.25, 0]) {
    let fails = 0
    for (let t = 0; t < 900000 && fails < 40000 && sx.length < 16000; t++) {
      fails++
      const [x, y] = randIn()
      const b = B(x, y)
      let r = sizeAt(x, y) * Math.exp(Math.max(0, p.variety) * 1.1 * (rng() + rng() - 1))
      if (r / Rmax < pass) continue
      if (b > r * 0.35) continue
      r = Math.max(Rmin * 0.6, r)
      if (!fits(x, y, r)) continue
      add(x, y, r)
      fails = 0
    }
  }
  const N = sx.length
  // let the packing settle: every bubble grows until it touches its neighbours
  for (let it = 0; it < 8; it++) {
    const nr = sr.slice()
    for (let i = 0; i < N; i++) {
      let lim = sr[i] * 1.12
      cellsOver(sx[i], sy[i], sr[i] * 2.2, (hk) => {
        const l = hash.get(hk)
        if (l) for (const m of l) if (m !== i) lim = Math.min(lim, Math.hypot(sx[m] - sx[i], sy[m] - sy[i]) - sr[m] * 0.97)
      })
      nr[i] = Math.max(sr[i] * 0.85, lim)
    }
    for (let i = 0; i < N; i++) sr[i] = nr[i]
  }

  // ---- power cells (local) ------------------------------------------------------------------
  // edge tangents close the big cells against the outline
  const edgePlanes: [number, number, number, number, number][] = []
  for (let k = 0; k < outline.length / 2; k += 3) {
    const x = outline[2 * k], y = outline[2 * k + 1], e = 1e-3
    let gx = B(x + e, y) - B(x - e, y), gy = B(x, y + e) - B(x, y - e)
    const gl = Math.hypot(gx, gy) || 1
    gx /= gl; gy /= gl
    edgePlanes.push([gx, gy, gx * x + gy * y - 0.004, x, y])
  }
  const Rbig = 0.3 * Rmax
  const Rlace = 0.11 * Rmax // medium cells (between this and Rbig) are white lace
  const SIDES = 12
  const cellPlanes = (i: number) => {
    const x = sx[i], y = sy[i], r = sr[i]
    const R = r * 1.7
    const planes: number[] = []
    for (let a = 0; a < SIDES; a++) {
      const ang = ((a + 0.5) / SIDES) * Math.PI * 2
      const nx = Math.cos(ang), ny = Math.sin(ang)
      planes.push(nx, ny, nx * x + ny * y + R)
    }
    const seen = new Set<number>()
    cellsOver(x, y, R, (hk) => {
      const l = hash.get(hk)
      if (!l) return
      for (const m of l) {
        if (m === i || seen.has(m)) continue
        seen.add(m)
        const dx = sx[m] - x, dy = sy[m] - y
        const D = Math.hypot(dx, dy)
        if (D < 1e-9 || D > (r + sr[m]) * 1.7) continue
        const c = (sx[m] ** 2 + sy[m] ** 2 - x * x - y * y - sr[m] ** 2 + r * r) / (2 * D)
        planes.push(dx / D, dy / D, c)
      }
    })
    if (r > Rbig || (r > Rlace && crng() < 0.25)) {
      for (const [nx, ny, c, ex, ey] of edgePlanes) if (Math.hypot(ex - x, ey - y) < R + 0.02) planes.push(nx, ny, c)
    }
    return planes
  }
  const CIRC = 40
  const polyOf = (x: number, y: number, R: number, planes: number[], g: number, circle = 0): LPoly => {
    const big = R * 1.2
    let q: LPoly = { x: [x - big, x + big, x + big, x - big], y: [y - big, y - big, y + big, y + big], lab: [-1, -1, -1, -1] }
    for (let t = 0; t < planes.length; t += 3) q = clip(q, planes[t], planes[t + 1], planes[t + 2] - g, -1)
    if (circle > 0) {
      // the bubble itself: round, flattened only where it presses against a neighbour
      for (let a = 0; a < CIRC; a++) {
        const ang = (a / CIRC) * Math.PI * 2
        const nx = Math.cos(ang), ny = Math.sin(ang)
        q = clip(q, nx, ny, nx * x + ny * y + circle, -1)
      }
    }
    return q
  }

  // ---- patches (colour of the foam walls) -------------------------------------------------------
  const prng = mulberry32(p.seed * 17 + 5)
  const PN = 260
  const px: number[] = [], py: number[] = [], pst: number[] = [], ptone: number[] = []
  const wts = [p.wLime, p.wGreen, p.wBlue, p.wLace].map((v) => Math.max(0, v))
  for (let k = 0; k < PN; k++) {
    const x = ext.x0 - 0.1 + prng() * (ext.x1 - ext.x0 + 0.2)
    const y = ext.y0 - 0.1 + prng() * (ext.y1 - ext.y0 + 0.2)
    const dep = Math.max(0, -B(x, y)) / maxDepth
    const ww = [wts[0] * (1.2 - 0.6 * dep), wts[1] * (1 - 0.3 * dep), wts[2] * (0.9 - 0.4 * dep), wts[3] * (0.25 + 1.3 * dep)].map((v) => Math.max(0, v))
    const sum = ww.reduce((a, b) => a + b, 0)
    let st = 1
    if (sum > 0) {
      let r = prng() * sum
      st = 0
      while (st < 3 && r >= ww[st]) { r -= ww[st]; st++ }
    }
    px.push(x); py.push(y); pst.push(st); ptone.push(Math.floor(prng() * 3))
  }
  const patchAt = (x: number, y: number) => {
    const wx = x + 0.05 * fbm(noise, x * 5, y * 5 + 40, 3)
    const wy = y + 0.05 * fbm(noise, x * 5 + 70, y * 5, 3)
    let best = 0, bd = Infinity
    for (let k = 0; k < PN; k++) {
      const dd = (px[k] - wx) ** 2 + (py[k] - wy) ** 2
      if (dd < bd) { bd = dd; best = k }
    }
    return best
  }

  // ---- build every cell with the same rule ------------------------------------------------------
  const emptyTiles = () => [[], [], []] as Float64Array[][]
  const tiles: Record<Style, Float64Array[][]> = { lime: emptyTiles(), green: emptyTiles(), blue: emptyTiles(), lace: emptyTiles() }
  const holes: Record<Style, Curve[]> = { lime: [], green: [], blue: [], lace: [] }
  const holesMid: Record<Style, Curve[]> = { lime: [], green: [], blue: [], lace: [] }
  const cavities: Cavity[] = []
  const crng = mulberry32(p.seed * 31 + 11)
  const vertices: number[] = []
  const FANS = 10
  let foamCells = 0
  for (let i = 0; i < N; i++) {
    const x = sx[i], y = sy[i], r = sr[i]
    const planes = cellPlanes(i)
    const R = r * 1.7
    const tile = polyOf(x, y, R, planes, 0)
    if (tile.x.length < 3) continue
    if (r > Rbig) {
      // a cavity: dark, outlined by a thin strand, fanned webs at its corners
      const hw = 0.0011
      const q = polyOf(x, y, R, planes, hw, r * 1.22 - hw)
      if (q.x.length < 3) continue
      const fil = r * 0.38
      const pore = roundedCurve(q, () => [0, 0], fil)
      if (!pore) continue
      // web lines: the bubble grown step by step into the gaps between bubbles
      const fans: Curve[] = []
      const grow = r * 0.45 * Math.max(0, p.webs)
      for (let f = 1; f <= FANS; f++) {
        const s = f / (FANS + 1)
        const c = roundedCurve(polyOf(x, y, R, planes, hw * (1 - s), r * 1.22 - hw + grow * s * s), () => [0, 0], fil * (1 - s))
        if (c) fans.push(c)
      }
      const dh = Math.hypot(x - hub[0], y - hub[1])
      cavities.push({ pore, fans, size: Math.min(1, r / Rmax), hub: Math.exp(-(dh * dh) / (0.3 * 0.3)) })
      for (let k = 0; k < tile.x.length; k++) vertices.push(tile.x[k], tile.y[k])
      continue
    }
    // foam cell: coloured walls (relatively thicker the smaller the cell), dark hole
    foamCells++
    const pi = patchAt(x, y)
    const st = r > Rlace && crng() < 0.35 ? 3 : pst[pi]
    const name = STYLES[st]
    const btile = polyOf(x, y, R, planes, 0, r * 1.35)
    const flatTile = new Float64Array(btile.x.length * 2)
    for (let k = 0; k < btile.x.length; k++) { flatTile[2 * k] = btile.x[k]; flatTile[2 * k + 1] = btile.y[k] }
    tiles[name][name === "lace" ? 1 : ptone[pi]].push(flatTile)
    if (flat) continue
    // lime and blue are mostly solid, green is open foam, lace is a fine white network
    const open = name === "green" ? p.holes : name === "lace" ? 1 : name === "blue" ? 0.6 * p.holes : 0.35 * p.holes
    if (crng() > open) continue
    const rel = r / Rbig // 0 (tiny) .. 1 (nearly a cavity)
    const hw = Math.max(0.0005, Math.min(0.0035, r * (name === "lace" ? 0.07 : 0.17 - 0.08 * rel)))
    const hq = polyOf(x, y, R, planes, hw, r * 1.15 - hw)
    if (hq.x.length < 3) continue
    const hole = roundedCurve(hq, () => [0, 0], r * 0.22)
    if (!hole) continue
    if (name !== "lace" && crng() < 0.16) holesMid[name].push(hole)
    else holes[name].push(hole)
  }

  // ---- dots on cavity junctions -------------------------------------------------------------
  const seen = new Set<string>()
  const drng = mulberry32(p.seed * 13 + 1)
  const dots: number[] = [], rings: number[] = []
  for (let k = 0; k < vertices.length; k += 2) {
    const x = vertices[k], y = vertices[k + 1]
    const id = `${Math.round(x * 300)}:${Math.round(y * 300)}`
    if (seen.has(id)) continue
    seen.add(id)
    if (B(x, y) > -0.02) continue
    const u = drng()
    if (u < 0.12) dots.push(x, y, 0.005 + drng() * 0.002)
    else if (u < 0.15) rings.push(x, y, 0.0065)
  }

  // ---- edge ticks ----------------------------------------------------------------------------
  const ticks: number[] = []
  const trng = mulberry32(p.seed * 5 + 9)
  {
    const m = outline.length / 2
    let acc = 0
    for (let k = 0; k < m; k++) {
      const x = outline[2 * k], y = outline[2 * k + 1]
      const j = (k + 1) % m
      acc += Math.hypot(outline[2 * j] - x, outline[2 * j + 1] - y)
      if (acc < 0.016) continue
      acc = 0
      if (noise(x * 2.6 + 30, y * 2.6) < 0.05 || trng() < 0.25) continue
      const e = 1e-3
      let gx = B(x + e, y) - B(x - e, y), gy = B(x, y + e) - B(x, y - e)
      const gl = Math.hypot(gx, gy) || 1
      gx /= gl; gy /= gl
      const L = 0.022 + 0.06 * Math.max(0, 0.5 + 0.5 * noise(x * 7, y * 7)) * (0.6 + 0.4 * trng())
      const s = 0.014 + trng() * 0.008
      ticks.push(x + gx * s, y + gy * s, x + gx * (s + L), y + gy * (s + L))
    }
  }

  return {
    flat, outline, cavities, tiles, holes, holesMid,
    dots: Float64Array.from(dots), rings: Float64Array.from(rings), ticks: Float64Array.from(ticks),
    hub, extent: ext,
    stats: { cells: N, bubbles: foamCells, ms: Math.round(performance.now() - t0) },
  }
}
