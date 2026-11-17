// The foam, as exact vector geometry on a flat "plate" (frame height = 2 units, y down).
//
//   Outline   smooth union of circles (the lobes you can edit).
//   Cells     a power diagram (weighted Voronoi with straight, exactly computed walls)
//             of seeds placed by Poisson darts and Lloyd relaxation. Giant bubbles are
//             seeds with a large weight. Each wall is then bowed into the smaller cell.
//   Strands   every hole is its cell inset by half the wall, corners rounded with true
//             circular-arc Béziers. The fanned junction webs are the same construction at
//             smaller insets/fillets, so the lines converge on the walls and fan at corners.
//   Foam      variable-radius circle packing inside the filled cells, coloured by a
//             domain-warped patch mosaic (lime / green / blue / white lace).
//
// No grid tracing: every curve is analytic, so edges stay smooth at any size.

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

export interface Hatch {
  angle: number
  spacing: number
  cx: number
  cy: number
  r: number
  lace: boolean
}

export interface Cell {
  pore: Curve | null
  fans: Curve[]
  hub: number // 0..1, closeness to the centre hub
  filled: boolean
  hatch: Hatch | null
}

export interface Geometry {
  flat: boolean
  outline: Float64Array // polygon, densely sampled
  edgeLines: Float64Array[] // stretches of the outline drawn as a thin strand
  overTiles: Float64Array[] // lace fragments over empty cells
  overHoles: Curve[]
  lace: Float64Array // x y r: white lace circles
  cells: Cell[]
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

function sdConvex(px: number, py: number, xs: number[], ys: number[]): number {
  // exact signed distance to a convex polygon (negative inside)
  const n = xs.length
  let d = Infinity, inside = true
  let area = 0
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += xs[i] * ys[j] - xs[j] * ys[i] }
  const s = area > 0 ? 1 : -1
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ex = xs[j] - xs[i], ey = ys[j] - ys[i]
    const wx = px - xs[i], wy = py - ys[i]
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)))
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t))
    if (s * (ex * wy - ey * wx) < 0) inside = false
  }
  return inside ? -d : d
}

/** Drop nearly-straight vertices (turn < ~14°) so tiny edges don't become curve segments. */
function simplifyPoly(q: LPoly): LPoly {
  const m = q.x.length
  if (m <= 4) return q
  const o: LPoly = { x: [], y: [], lab: [] }
  for (let k = 0; k < m; k++) {
    const a = (k - 1 + m) % m, b = (k + 1) % m
    const ux = q.x[k] - q.x[a], uy = q.y[k] - q.y[a], vx = q.x[b] - q.x[k], vy = q.y[b] - q.y[k]
    const cr = Math.abs(ux * vy - uy * vx) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1)
    if (cr > 0.3 || m - (k - o.x.length) <= 4) { o.x.push(q.x[k]); o.y.push(q.y[k]); o.lab.push(q.lab[k]) }
  }
  return o.x.length >= 3 ? o : q
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

export function buildGeometry(p: Params): Geometry {
  const t0 = performance.now()
  const lobes = p.lobes.length ? p.lobes : [{ x: 0, y: 0, r: 0.6 }]
  const B = lobeSDF(lobes)
  const rng = mulberry32(p.seed)
  const noise = makeNoise(p.seed + 7)

  // fixed sampling grid: area, centroid, extent, Lloyd samples
  const hs = 2 / 160
  const samples: number[] = []
  const depthAt: number[] = []
  let mx = 0, my = 0, maxDepth = 0
  const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (let y = -1.6 + hs / 2; y < 1.6; y += hs) {
    for (let x = -1.9 + hs / 2; x < 1.9; x += hs) {
      const b = B(x, y)
      if (b >= 0) continue
      samples.push(x, y); depthAt.push(-b)
      mx += x; my += y
      maxDepth = Math.max(maxDepth, -b)
      if (x < ext.x0) ext.x0 = x
      if (x > ext.x1) ext.x1 = x
      if (y < ext.y0) ext.y0 = y
      if (y > ext.y1) ext.y1 = y
    }
  }
  const ns = samples.length / 2
  const area = ns * hs * hs
  const hub: [number, number] = ns ? [mx / ns, my / ns] : [0, 0]
  if (!ns) { ext.x0 = ext.y0 = -0.5; ext.x1 = ext.y1 = 0.5 }

  // ---- seeds: giants first, then the rest -------------------------------------------------
  const n = Math.max(4, Math.round(p.cells))
  const d = Math.sqrt(area / n)
  const rn = 0.5 * d
  const sx: number[] = [], sy: number[] = [], sr: number[] = [], giant: boolean[] = []
  const pick = () => {
    const i = Math.floor(rng() * ns)
    return [samples[2 * i] + (rng() - 0.5) * hs, samples[2 * i + 1] + (rng() - 0.5) * hs, depthAt[i]]
  }
  const fits = (x: number, y: number, r: number, f: number) => {
    for (let k = 0; k < sx.length; k++) if (Math.hypot(sx[k] - x, sy[k] - y) < (r + sr[k]) * f) return false
    return true
  }
  const G = Math.min(Math.round(p.giants), n - 2)
  for (let g = 0; g < G; g++) {
    const r = rn * p.giantSize * (0.85 + rng() * 0.3)
    for (let t = 0; t < 600; t++) {
      const [x, y, dep] = pick()
      if (dep < r * 1.25) continue
      if (!fits(x, y, r, 0.95)) continue
      sx.push(x); sy.push(y); sr.push(r); giant.push(true)
      break
    }
  }
  for (let t = 0; t < n * 600 && sx.length < n; t++) {
    const [x, y, dep] = pick()
    const v = 0.65 * noise(x * 2.2, y * 2.2) + 0.6 * (rng() - 0.5)
    // cells get smaller towards the edge, so the outer foam reads as a ring
    const edgeScale = 0.85 + 0.15 * Math.min(1, dep / (rn * 2))
    const r = rn * Math.exp(p.variety * v) * 0.95 * edgeScale
    if (!fits(x, y, r, 0.9)) continue
    sx.push(x); sy.push(y); sr.push(r); giant.push(false)
  }
  const N = sx.length

  // weighted Lloyd relaxation (power distance)
  const w2 = sr.map((r) => r * r)
  const sampleOwner = new Int32Array(ns)
  for (let it = 0; it <= 4; it++) {
    const ax = new Float64Array(N), ay = new Float64Array(N), cnt = new Float64Array(N)
    for (let s = 0; s < ns; s++) {
      const x = samples[2 * s], y = samples[2 * s + 1]
      let best = 0, bd = Infinity
      for (let i = 0; i < N; i++) {
        const pw = (x - sx[i]) ** 2 + (y - sy[i]) ** 2 - w2[i]
        if (pw < bd) { bd = pw; best = i }
      }
      sampleOwner[s] = best
      ax[best] += x; ay[best] += y; cnt[best]++
    }
    if (it === 4) break // last pass only records owners
    for (let i = 0; i < N; i++) if (cnt[i]) { sx[i] = ax[i] / cnt[i]; sy[i] = ay[i] / cnt[i] }
  }

  // ---- outline, and the edge band: its thickness varies and drops to zero in places, where
  // a dark cell itself becomes the edge
  const rimAt = (x: number, y: number) => 0.075 * Math.max(0, Math.min(1.3, 0.12 + 1.25 * fbm(noise, x * 2.6 + 5, y * 2.6 - 2, 2)))
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
  // where the band is thin, the edge itself is drawn as a strand
  const edgeLines: Float64Array[] = []
  {
    let cur: number[] = []
    const m = outline.length / 2
    for (let k = 0; k <= m; k++) {
      const x = outline[2 * (k % m)], y = outline[2 * (k % m) + 1]
      if (rimAt(x, y) < 0.034) cur.push(x, y)
      else if (cur.length) { if (cur.length >= 8) edgeLines.push(Float64Array.from(cur)); cur = [] }
    }
    if (cur.length >= 8) edgeLines.push(Float64Array.from(cur))
  }
  // edge planes: tangent to the outline, pulled in by the band thickness there
  const edgePlanes: [number, number, number, number, number][] = [] // nx ny c px py
  for (let k = 0; k < outline.length / 2; k += 3) {
    const x = outline[2 * k], y = outline[2 * k + 1]
    const e = 1e-3
    let gx = B(x + e, y) - B(x - e, y), gy = B(x, y + e) - B(x, y - e)
    const gl = Math.hypot(gx, gy) || 1
    gx /= gl; gy /= gl
    edgePlanes.push([gx, gy, gx * x + gy * y - rimAt(x, y), x, y])
  }

  // ---- power cells ---------------------------------------------------------------------
  const pad = 0.5
  const bx0 = ext.x0 - pad, by0 = ext.y0 - pad, bx1 = ext.x1 + pad, by1 = ext.y1 + pad
  const planes: Map<number, [number, number, number]>[] = []
  const base: LPoly[] = []
  for (let i = 0; i < N; i++) {
    let q: LPoly = { x: [bx0, bx1, bx1, bx0], y: [by0, by0, by1, by1], lab: [-1, -1, -1, -1] }
    const pl = new Map<number, [number, number, number]>()
    for (let j = 0; j < N; j++) {
      if (j === i) continue
      const dx = sx[j] - sx[i], dy = sy[j] - sy[i]
      const D = Math.hypot(dx, dy) || 1e-9
      const nx = dx / D, ny = dy / D
      const c = (sx[j] ** 2 + sy[j] ** 2 - sx[i] ** 2 - sy[i] ** 2 - w2[j] + w2[i]) / (2 * D)
      q = clip(q, nx, ny, c, j)
      pl.set(j, [nx, ny, c])
    }
    // close the cell against the outline (only tangents near this cell matter)
    const pre = q
    edgePlanes.forEach(([nx, ny, c, ex, ey], k) => {
      if (pre.x.length >= 3 && sdConvex(ex, ey, pre.x, pre.y) < 0.04) {
        q = clip(q, nx, ny, c, -2 - k)
        pl.set(-2 - k, [nx, ny, c])
      }
    })
    // keep only the walls that survived
    const used = new Map<number, [number, number, number]>()
    for (const l of q.lab) if (l >= 0 || l <= -2) used.set(l, pl.get(l)!)
    planes.push(used)
    base.push(q)
  }

  // wall bow: shared by both cells, bulging into the smaller one
  const wallLen = new Map<string, number>()
  for (let i = 0; i < N; i++) {
    const q = base[i]
    for (let k = 0; k < q.x.length; k++) {
      const l = q.lab[k]
      if (l < 0) continue
      const j = (k + 1) % q.x.length
      wallLen.set(i < l ? `${i}:${l}` : `${l}:${i}`, Math.hypot(q.x[j] - q.x[k], q.y[j] - q.y[k]))
    }
  }
  const bowFor = (i: number) => (l: number): [number, number] => {
    if (l <= -2) return [0, 0]
    if (l < 0) return [0, 0]
    const len = wallLen.get(i < l ? `${i}:${l}` : `${l}:${i}`) ?? 0
    const pl = planes[i].get(l)
    if (!pl) return [0, 0]
    const s = 0.32 * len * Math.max(-0.6, Math.min(0.6, (sr[i] - sr[l]) / (sr[i] + sr[l])))
    return [pl[0] * s, pl[1] * s]
  }

  const insetPoly = (i: number, g: number): LPoly => {
    let q: LPoly = { x: [bx0, bx1, bx1, bx0], y: [by0, by0, by1, by1], lab: [-1, -1, -1, -1] }
    for (const [l, [nx, ny, c]] of planes[i]) q = clip(q, nx, ny, c - g, l)
    return q
  }

  const halfGap = 0.0012
  const FANS = 12
  const filledFrac = Math.max(0, Math.min(1, p.foamAmount))
  const cellDepth = sx.map((x, i) => Math.max(0, -B(x, sy[i])) / (maxDepth || 1))
  // rank non-giant cells by closeness to the edge (plus noise) → filled
  // smaller cells and cells nearer the edge fill first; big cells stay as dark holes
  const score = (i: number) => 0.8 * (sr[i] / rn) + 0.6 * cellDepth[i] + 0.25 * noise(sx[i] * 3, sy[i] * 3)
  const order = sx.map((_, i) => i).filter((i) => !giant[i]).sort((a, b) => score(a) - score(b))
  const filled = new Array<boolean>(N).fill(false)
  // cells that reach the outline are always foam (the edge is never an empty hole)
  for (let k = 0; k < Math.round(order.length * filledFrac); k++) filled[order[k]] = true
  // a few empty cells carry fragments of white lace
  const laceCell = sx.map((_, i) => !filled[i] && rng() < 0.35)
  const shrinkOf = sx.map((_, i) => (!giant[i] && rng() < (Math.hypot(sx[i] - hub[0], sy[i] - hub[1]) < 0.3 ? 0.7 : p.spacing * (cellDepth[i] < 0.2 ? 1.1 : cellDepth[i] < 0.6 ? 0.25 : 0.7)) ? 0.12 + rng() * 0.3 : 0))

  const cells: Cell[] = []
  const sharp: LPoly[] = []
  const poreQ: LPoly[] = []
  const hrng = mulberry32(p.seed * 7 + 3)
  let hatches = 0
  for (let i = 0; i < N; i++) {
    const q = insetPoly(i, halfGap)
    sharp.push(q)
    // inner radius of the cell → fillet size
    let cxq = 0, cyq = 0
    for (let k = 0; k < q.x.length; k++) { cxq += q.x[k]; cyq += q.y[k] }
    cxq /= q.x.length || 1; cyq /= q.y.length || 1
    // inner radius: measured from the seed (always inside) and from the vertex centroid
    const inr = q.x.length >= 3
      ? Math.min(0.6 * rn * 2.2 * (giant[i] ? p.giantSize : 1), Math.max(-sdConvex(sx[i], sy[i], q.x, q.y), -sdConvex(cxq, cyq, q.x, q.y)))
      : 0
    const fillet = Math.max(0, p.webs) * inr * 1.25
    const bow = bowFor(i)
    // some cells shrink away from their neighbours, leaving room for foam around them
    const shrink = shrinkOf[i] * inr
    const pq = shrink > 0 ? insetPoly(i, halfGap + shrink) : q
    const pore = pq.x.length >= 3 ? roundedCurve(simplifyPoly(pq), bow, fillet * (1 + shrinkOf[i])) : null
    poreQ.push(pq)
    const fans: Curve[] = []
    for (let f = 1; f <= (shrink > 0 ? 0 : FANS); f++) {
      const s = f / (FANS + 1)
      const c = roundedCurve(simplifyPoly(insetPoly(i, halfGap * s)), bow, fillet * s * s)
      if (c) fans.push(c)
    }
    const dh = Math.hypot(sx[i] - hub[0], sy[i] - hub[1])
    let hatch: Hatch | null = null
    if (!filled[i] && hatches < 3 && hrng() < 0.2 && inr > 0.04) {
      hatch = {
        angle: hrng() * Math.PI, spacing: 0.0085, lace: hrng() < 0.6,
        cx: cxq + (hrng() - 0.5) * inr, cy: cyq + (hrng() - 0.5) * inr, r: inr * (0.45 + hrng() * 0.35),
      }
      hatches++
    }
    cells.push({ pore, fans, hub: Math.exp(-(dh * dh) / (0.3 * 0.3)), filled: filled[i], hatch })
  }

  // ---- patch mosaic ---------------------------------------------------------------------
  const prng = mulberry32(p.seed * 17 + 5)
  const PN = 240
  const px: number[] = [], py: number[] = [], pst: number[] = [], ptone: number[] = []
  const wts = [p.wLime, p.wGreen, p.wBlue, p.wLace].map((v) => Math.max(0, v))
  for (let k = 0; k < PN; k++) {
    const x = ext.x0 - 0.1 + prng() * (ext.x1 - ext.x0 + 0.2)
    const y = ext.y0 - 0.1 + prng() * (ext.y1 - ext.y0 + 0.2)
    const dep = Math.max(0, -B(x, y)) / (maxDepth || 1)
    // lace prefers the inside, colour prefers the edge
    const ww = [wts[0] * (1.25 - 0.6 * dep), wts[1] * (1 - 0.4 * dep), wts[2] * (0.9 - 0.5 * dep), wts[3] * (0.3 + 0.9 * dep), 0.3 + 0.55 * dep]
      .map((v) => Math.max(0, v))
    const sum = ww.reduce((a, b) => a + b, 0)
    let st = -1
    if (sum > 0) {
      let r = prng() * sum
      st = 0
      while (st < 4 && r >= ww[st]) { r -= ww[st]; st++ }
      if (st === 4) st = -1 // an empty break inside a filled cell
    }
    px.push(x); py.push(y); pst.push(st); ptone.push(Math.floor(prng() * 3))
  }
  const styleAt = (x: number, y: number) => {
    const wx = x + 0.05 * fbm(noise, x * 5, y * 5 + 40, 3)
    const wy = y + 0.05 * fbm(noise, x * 5 + 70, y * 5, 3)
    let best = 0, bd = Infinity
    for (let k = 0; k < PN; k++) {
      const dd = (px[k] - wx) ** 2 + (py[k] - wy) ** 2
      if (dd < bd) { bd = dd; best = k }
    }
    return best
  }

  // ---- micro-foam: variable-radius circle packing in filled cells -------------------------
  const flat = p.fill === "flat"
  const rb = 0.0085 * Math.max(0.2, p.bubbleSize) * (flat ? 1.6 : 1)
  const brng = mulberry32(p.seed * 31 + 11)
  const discs: number[] = [] // x y r
  const discStyle: number[] = []
  const discPatch: number[] = []
  const cellSize = rb * 3
  const hash = new Map<number, number[]>()
  const key = (i: number, j: number) => i * 73856093 ^ j * 19349663
  const insert = (k: number) => {
    const x = discs[k], y = discs[k + 1], r = discs[k + 2]
    const i0 = Math.floor((x - r) / cellSize), i1 = Math.floor((x + r) / cellSize)
    const j0 = Math.floor((y - r) / cellSize), j1 = Math.floor((y + r) / cellSize)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const hk = key(i, j)
      const l = hash.get(hk)
      if (l) l.push(k)
      else hash.set(hk, [k])
    }
  }
  const owner = (x: number, y: number) => {
    let best = 0, bd = Infinity
    for (let i = 0; i < N; i++) {
      const pw = (x - sx[i]) ** 2 + (y - sy[i]) ** 2 - w2[i]
      if (pw < bd) { bd = pw; best = i }
    }
    return best
  }
  // every disc is registered in all hash cells it overlaps, so a query only
  // needs the cells the candidate itself overlaps
  const free = (x: number, y: number, r: number) => {
    const i0 = Math.floor((x - r) / cellSize), i1 = Math.floor((x + r) / cellSize)
    const j0 = Math.floor((y - r) / cellSize), j1 = Math.floor((y + r) / cellSize)
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = hash.get(key(i, j))
      if (!l) continue
      for (const k of l) if (Math.hypot(discs[k] - x, discs[k + 1] - y) < (r + discs[k + 2]) * 0.98) return false
    }
    return true
  }
  // the thin edge band: where the outline is within `rim` (noisy) of the point
  const inBand = (x: number, y: number) => B(x, y) > -rimAt(x, y)
  let fails = 0
  const over: boolean[] = [] // lace fragments drawn over empty cells
  for (let t = 0; ns && t < 260000 && fails < 4000; t++) {
    const s0 = Math.floor(brng() * ns)
    const x = samples[2 * s0] + (brng() - 0.5) * hs * 1.6
    const y = samples[2 * s0 + 1] + (brng() - 0.5) * hs * 1.6
    fails++
    if (B(x, y) > 0) continue
    let r = rb * Math.exp(0.5 * (brng() + brng() + brng() - 1.5) * 1.6)
    const isBig = !flat && brng() < 0.03
    if (isBig) r = rb * (2.4 + brng() * 2.2)
    const band = inBand(x, y)
    const pi = styleAt(x, y)
    let st = pst[pi]
    if (band) st = rimAt(x, y) > 0.034 ? (st >= 0 && st < 3 ? st : pi % 2) : 3 // thick band: colour; thin band: lace inside a line
    const o = owner(x, y)
    const q = poreQ[o]
    const inside = q.x.length >= 3 && sdConvex(x, y, q.x, q.y) < -r * 0.3
    if (!inside && st < 0 && (shrinkOf[o] > 0 || B(x, y) > -0.12)) st = pi % 2 // gaps around cells that sit apart, and by the edge, are foam
    // the hub: the junctions around the centre carry lime foam
    if (!inside && Math.hypot(x - hub[0], y - hub[1]) < 0.17 * (1 + 0.4 * noise(x * 6, y * 6)) * Math.sqrt(area / 2)) st = pi % 3 === 2 ? 1 : 0
    if (st < 0) continue
    let isOver = false
    if (inside && !band && !filled[o]) {
      // deep in an empty cell: only lace fragments, and only in some cells
      if (!laceCell[o] || sdConvex(x, y, q.x, q.y) < -0.04 - 0.045 * noise(x * 7 + 3, y * 7)) continue
      isOver = true
      r *= 1.1 + 1.2 * brng() * brng()
    }
    if (st === 3 && !isOver) r *= 1.1 + 1.0 * brng() * brng()
    if (!free(x, y, r)) continue
    fails = 0
    const k = discs.length
    discs.push(x, y, r)
    discStyle.push(isOver ? 3 : st)
    discPatch.push(pi)
    over.push(isOver)
    insert(k)
  }

  // ---- foam cells: local power diagram of the packed bubbles -----------------------------
  // Each bubble owns the part of the plane closer (in power distance) to it than to its
  // neighbours, bounded by a 16-gon around it. Neighbouring cells tile exactly, so the
  // colour between holes reads as thin walls with small blobs where walls meet.
  let maxR = 0
  for (let k = 2; k < discs.length; k += 3) maxR = Math.max(maxR, discs[k])
  const SIDES = 10
  const sec = 1 / Math.cos(Math.PI / SIDES)
  const halfWall = (flat ? 0 : 0.0024) * Math.sqrt(Math.max(0.3, p.bubbleSize))
  const emptyTiles = () => [[], [], []] as Float64Array[][]
  const tiles: Record<Style, Float64Array[][]> = { lime: emptyTiles(), green: emptyTiles(), blue: emptyTiles(), lace: emptyTiles() }
  const holes: Record<Style, Curve[]> = { lime: [], green: [], blue: [], lace: [] }
  const holesMid: Record<Style, Curve[]> = { lime: [], green: [], blue: [], lace: [] }
  const overTiles: Float64Array[] = [], overHoles: Curve[] = []
  const laceCircles: number[] = []
  let bubbles = 0
  const circleCurve = (x: number, y: number, r: number): Curve => {
    const kk = 0.5523 * r
    return Float64Array.from([
      x + r, y,
      x + r, y + kk, x + kk, y + r, x, y + r,
      x - kk, y + r, x - r, y + kk, x - r, y,
      x - r, y - kk, x - kk, y - r, x, y - r,
      x + kk, y - r, x + r, y - kk, x + r, y,
    ])
  }
  for (let k = 0; k < discs.length; k += 3) {
    const x = discs[k], y = discs[k + 1], r = discs[k + 2]
    const di = k / 3
    const pi = discPatch[di]
    const st = discStyle[di]
    const isOver = over[di]
    const name = STYLES[st]
    const tone = name === "lace" ? 1 : ptone[pi]
    bubbles++
    const R = r * (flat ? 2.4 : st === 3 ? 1.12 : 2.3)
    // planes: 16 tangents of the bounding circle, then power bisectors with neighbours
    const planes: number[] = []
    for (let a = 0; a < SIDES; a++) {
      const ang = ((a + 0.5) / SIDES) * Math.PI * 2
      const nx = Math.cos(ang), ny = Math.sin(ang)
      planes.push(nx, ny, nx * x + ny * y + R)
    }
    const reach = R + maxR * 1.7
    const i0 = Math.floor((x - reach) / cellSize), i1 = Math.floor((x + reach) / cellSize)
    const j0 = Math.floor((y - reach) / cellSize), j1 = Math.floor((y + reach) / cellSize)
    const seenN = new Set<number>()
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = hash.get(key(i, j))
      if (!l) continue
      for (const m of l) {
        if (m === k || seenN.has(m)) continue
        seenN.add(m)
        const dx = discs[m] - x, dy = discs[m + 1] - y
        const D = Math.hypot(dx, dy)
        if (D < 1e-9 || D > R + discs[m + 2] * (flat ? 2.4 : 2.3)) continue
        const c = (discs[m] ** 2 + discs[m + 1] ** 2 - x * x - y * y - discs[m + 2] ** 2 + r * r) / (2 * D)
        planes.push(dx / D, dy / D, c)
      }
    }
    const cellOf = (g: number): LPoly => {
      const big = R * sec * 1.05
      let q: LPoly = { x: [x - big, x + big, x + big, x - big], y: [y - big, y - big, y + big, y + big], lab: [-1, -1, -1, -1] }
      for (let t = 0; t < planes.length; t += 3) q = clip(q, planes[t], planes[t + 1], planes[t + 2] - g, -1)
      return q
    }
    const tile = cellOf(0)
    if (tile.x.length < 3) continue
    const flatTile = new Float64Array(tile.x.length * 2)
    for (let t = 0; t < tile.x.length; t++) { flatTile[2 * t] = tile.x[t]; flatTile[2 * t + 1] = tile.y[t] }
    if (isOver) {
      if (flat) continue
      laceCircles.push(x, y, r * (0.97 + 0.03 * brng()))
      continue
    }
    // lace: thin line circles only (no fill)
    if (name === "lace") {
      if (!flat) laceCircles.push(x, y, r * (0.97 + 0.03 * brng()))
      else tiles[name][tone].push(flatTile)
      continue
    }
    tiles[name][tone].push(flatTile)
    if (flat) continue
    if (name === "green") {
      // foam network: green walls around irregular dark holes
      if (brng() > p.holes) continue
      let hole: Curve | null
      if (r > rb * 2.3) hole = circleCurve(x, y, Math.min(r * 0.94, -sdConvex(x, y, tile.x, tile.y) - halfWall))
      else {
        const hq = cellOf(halfWall)
        if (hq.x.length < 3) continue
        hole = roundedCurve(simplifyPoly(hq), () => [0, 0], Math.max(0, -sdConvex(x, y, hq.x, hq.y)) * 0.55)
      }
      if (!hole) continue
      if (brng() < 0.18) holesMid[name].push(hole)
      else holes[name].push(hole)
    } else {
      // solid lime / blue: only occasional small dark specks
      const speck = name === "blue" ? 0.5 : 0.1
      if (brng() > speck) continue
      const sr = r * (0.22 + 0.3 * brng())
      const a = brng() * Math.PI * 2, d = r * 0.3 * brng()
      holes[name].push(circleCurve(x + Math.cos(a) * d, y + Math.sin(a) * d, sr))
    }
  }

  // ---- dots on junctions ----------------------------------------------------------------
  const seen = new Set<string>()
  const drng = mulberry32(p.seed * 13 + 1)
  const dots: number[] = [], rings: number[] = []
  for (const q of base) {
    for (let k = 0; k < q.x.length; k++) {
      const x = q.x[k], y = q.y[k]
      const id = `${Math.round(x * 400)}:${Math.round(y * 400)}`
      if (seen.has(id)) continue
      seen.add(id)
      if (B(x, y) > -0.02) continue
      const u = drng()
      if (u < 0.3) dots.push(x, y, 0.0055 + drng() * 0.002)
      else if (u < 0.36) rings.push(x, y, 0.007)
    }
  }

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
      if (noise(x * 2.6 + 30, y * 2.6) < 0.05 || trng() < 0.25) continue // gaps
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
    flat, outline, edgeLines, cells, overTiles, overHoles, lace: Float64Array.from(laceCircles),
    tiles, holes, holesMid,
    dots: Float64Array.from(dots), rings: Float64Array.from(rings), ticks: Float64Array.from(ticks),
    hub, extent: ext,
    stats: { cells: N, bubbles, ms: Math.round(performance.now() - t0) },
  }
}
