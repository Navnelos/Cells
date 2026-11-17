// The foam. Everything here is plain maths on a flat "plate" (x right, y down,
// height 2 units, width 2·PLATE_AR units). Rendering and 3D happen elsewhere.
//
//   1. Silhouette   signed distance field B(x): smooth union of circles (metaballs),
//                   a superformula (Gielis 2003) or a circle. Negative inside.
//   2. Seeds        Poisson-disk darts / Gaussian clusters / Vogel phyllotaxis / hex,
//                   then Lloyd relaxation (Lloyd 1982 — the k-means step).
//   3. Cells        multiplicatively weighted Voronoi cells (walls are Apollonius-circle
//                   arcs, so big cells bulge into small ones like soap bubbles). A pore is
//                   its cell shrunk by half the wall, corners filleted with a smooth min;
//                   or the Worley (1996) F2 − F1 iso-line; or the inscribed circle.
//   4. Rim          pores are cut back from the outline by a noisy band (smooth max).
//   5. Patches      a second, domain-warped Voronoi coloured from the palette, shown on
//                   the rim band and on the cells left solid.
//   6. Overlay      Delaunay graph, nodes, hairlines along the outline.
//
// Every field is sampled on a grid and traced with marching squares (d3-contour), so
// the output is vector paths — the same geometry drives canvas and SVG.

import { contours } from "d3-contour"
import { Delaunay } from "d3-delaunay"

import { fbm, makeNoise } from "./noise"
import type { Params } from "./params"
import { gauss, mulberry32 } from "./rng"

export const PLATE_AR = 7 / 6

export interface Arc {
  cx: number
  cy: number
  rx: number
  ry: number
  a0: number
  a1: number
}

export interface Geometry {
  blob: Float64Array[]
  pores: Float64Array[]
  zone: Float64Array[]
  patches: Float64Array[][] // one list of rings per palette colour
  graph: Float64Array // segments x0 y0 x1 y1
  trails: Float64Array // long hairlines, segments
  nodes: Float64Array // x y size
  fringe: Float64Array // segments
  arcs: Arc[]
  rays: number[] // angles of the dashed rays from the centre
  center: [number, number]
  extent: { x0: number; y0: number; x1: number; y1: number }
  cells: number
  poreCount: number
  buildMs: number
}

// ---- small math helpers --------------------------------------------------------

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k)

// ---- silhouettes ---------------------------------------------------------------

type SDF = (x: number, y: number) => number

// Lobes fitted to the reference image's outline (least squares on the mask, IoU 0.93) (centre x, centre y, radius) in plate units.
const REFERENCE_LOBES: [number, number, number][] = [
  [-0.578, -0.252, 0.297],
  [-0.39, -0.538, 0.166],
  [-0.391, 0.271, 0.456],
  [0.186, -0.034, 0.422],
  [0.371, -0.188, 0.292],
  [0.521, 0.078, 0.328],
  [-0.338, 0.462, 0.301],
  [-0.254, -0.041, 0.242],
]

function silhouette(p: Params): { sdf: SDF; k: number } {
  const s = p.size
  if (p.silhouette === "circle") return { sdf: (x, y) => Math.hypot(x, y) - 0.8 * s, k: 0 }
  if (p.silhouette === "superformula") {
    const m = p.sfM, n = Math.max(0.3, p.sfN)
    const sf = (t: number) => {
      const a = Math.abs(Math.cos((m * t) / 4)) ** n + Math.abs(Math.sin((m * t) / 4)) ** n
      return a ** (-1 / n)
    }
    let mx = 0
    for (let i = 0; i < 720; i++) mx = Math.max(mx, sf((i / 720) * Math.PI * 2))
    const R = 0.82 * s
    // radial distance is a good-enough SDF for a star-shaped outline
    return { sdf: (x, y) => (Math.hypot(x, y) - (R * sf(Math.atan2(y, x))) / mx) * 0.8, k: 0 }
  }
  let lobes: [number, number, number][]
  let k = 0.08
  if (p.silhouette === "reference") {
    lobes = REFERENCE_LOBES
  } else {
    const r = mulberry32(p.seed * 31 + 7)
    lobes = [[0, 0, 0.4]]
    for (let i = 1; i < Math.max(1, p.lobes); i++) {
      const a = r() * Math.PI * 2
      const d = (0.25 + r() * 0.55) * p.lobeSpread * 1.3
      lobes.push([Math.cos(a) * d * 1.25, Math.sin(a) * d * 0.85, 0.2 + r() * 0.2])
    }
    // fit into the plate
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const [cx, cy, rr] of lobes) {
      x0 = Math.min(x0, cx - rr); x1 = Math.max(x1, cx + rr)
      y0 = Math.min(y0, cy - rr); y1 = Math.max(y1, cy + rr)
    }
    const sc = Math.min((1.62 * PLATE_AR) / (x1 - x0), 1.5 / (y1 - y0))
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
    lobes = lobes.map(([cx, cy, rr]) => [(cx - mx) * sc, (cy - my) * sc, rr * sc])
    k = 0.1 * sc
  }
  lobes = lobes.map(([cx, cy, rr]) => [cx * s, cy * s, rr * s])
  const kk = k * s
  return {
    sdf: (x, y) => {
      let d = Infinity
      for (const [cx, cy, rr] of lobes) d = smin(d, Math.hypot(x - cx, y - cy) - rr, kk)
      return d
    },
    k: kk,
  }
}

// ---- seeds ---------------------------------------------------------------------

function makeSeeds(p: Params, B: SDF, area: number, cx: number, cy: number, ext: Geometry["extent"]): number[] {
  const rng = mulberry32(p.seed)
  const noise = makeNoise(p.seed + 101)
  const n = Math.max(3, Math.round(p.cells))
  const d = Math.sqrt((area / n) * 1.0) // mean spacing
  const pts: number[] = []
  const inside = (x: number, y: number) => B(x, y) < -d * 0.15
  const rand = () => [ext.x0 + rng() * (ext.x1 - ext.x0), ext.y0 + rng() * (ext.y1 - ext.y0)]

  if (p.seeding === "hex") {
    const h = d * 1.07
    for (let row = -40; row <= 40; row++) {
      for (let col = -40; col <= 40; col++) {
        const x = cx + (col + (row & 1 ? 0.5 : 0)) * h + gauss(rng) * p.sizeVariance * 0.12 * h
        const y = cy + row * h * 0.866 + gauss(rng) * p.sizeVariance * 0.12 * h
        if (x < ext.x0 || x > ext.x1 || y < ext.y0 || y > ext.y1) continue
        if (inside(x, y)) pts.push(x, y)
      }
    }
    return pts
  }
  if (p.seeding === "phyllotaxis") {
    const golden = Math.PI * (3 - Math.sqrt(5))
    const c = d * 0.56
    for (let i = 1; i < n * 6 && pts.length / 2 < n * 1.6; i++) {
      const r = c * Math.sqrt(i)
      if (r > 2.5) break
      const x = cx + r * Math.cos(i * golden), y = cy + r * Math.sin(i * golden)
      if (inside(x, y)) pts.push(x, y)
    }
    return pts
  }
  // poisson darts (optionally pulled towards clusters)
  const centres: [number, number, number][] = []
  if (p.seeding === "clusters") {
    for (let i = 0; i < 5; i++) {
      for (let t = 0; t < 200; t++) {
        const [x, y] = rand()
        if (inside(x, y)) { centres.push([x, y, 0.15 + rng() * 0.25]); break }
      }
    }
  }
  const radius = (x: number, y: number) => d * 0.86 * Math.exp(p.sizeVariance * 0.75 * fbm(noise, x * 1.7 + 3, y * 1.7, 2))
  const radii: number[] = []
  for (let t = 0; t < n * 400 && pts.length / 2 < n; t++) {
    let x: number, y: number
    if (centres.length && rng() < 0.65) {
      const c = centres[Math.floor(rng() * centres.length)]
      x = c[0] + gauss(rng) * c[2]
      y = c[1] + gauss(rng) * c[2]
    } else {
      ;[x, y] = rand()
    }
    if (!inside(x, y)) continue
    let r = radius(x, y)
    if (centres.length) r *= 0.75
    let ok = true
    for (let i = 0; i < radii.length; i++) {
      const rr = (r + radii[i]) / 2
      const dx = pts[2 * i] - x, dy = pts[2 * i + 1] - y
      if (dx * dx + dy * dy < rr * rr) { ok = false; break }
    }
    if (ok) { pts.push(x, y); radii.push(r) }
  }
  return pts
}

/** Lloyd relaxation over the silhouette: move every seed to the centroid of its
 *  (weighted) region — one k-means step per iteration. */
function relax(pts: number[], w: Float64Array, samples: Float64Array, iterations: number): number[] {
  const n = pts.length / 2
  if (!iterations || n < 2) return pts
  const out = pts.slice()
  const sx = new Float64Array(n), sy = new Float64Array(n), cnt = new Float64Array(n)
  for (let it = 0; it < iterations; it++) {
    sx.fill(0); sy.fill(0); cnt.fill(0)
    for (let s = 0; s < samples.length; s += 2) {
      const x = samples[s], y = samples[s + 1]
      let best = 0, bd = Infinity
      for (let i = 0; i < n; i++) {
        const d = ((out[2 * i] - x) ** 2 + (out[2 * i + 1] - y) ** 2) / (w[i] * w[i])
        if (d < bd) { bd = d; best = i }
      }
      sx[best] += x; sy[best] += y; cnt[best]++
    }
    for (let i = 0; i < n; i++) if (cnt[i]) { out[2 * i] = sx[i] / cnt[i]; out[2 * i + 1] = sy[i] / cnt[i] }
  }
  return out
}

// ---- contour tracing --------------------------------------------------------------

/** Drop points that sit within `tol` of the line through their neighbours (closed ring). */
function simplify(r: Float64Array, tol: number): Float64Array {
  const m = r.length / 2
  if (m < 8) return r
  const keep: number[] = []
  let px = r[2 * (m - 1)], py = r[2 * (m - 1) + 1]
  for (let i = 0; i < m; i++) {
    const x = r[2 * i], y = r[2 * i + 1]
    const k = (i + 1) % m
    const nx = r[2 * k], ny = r[2 * k + 1]
    const dx = nx - px, dy = ny - py
    const L = Math.hypot(dx, dy) || 1e-12
    const d = Math.abs((x - px) * dy - (y - py) * dx) / L
    if (d > tol || Math.hypot(x - px, y - py) > tol * 40) { keep.push(x, y); px = x; py = y }
  }
  return keep.length >= 6 ? Float64Array.from(keep) : r
}

function trace(values: Float64Array, nx: number, ny: number, x0: number, y0: number, h: number, minArea = 0): Float64Array[] {
  const mp = contours().size([nx, ny]).smooth(true).contour(values as unknown as number[], 0)
  const rings: Float64Array[] = []
  for (const poly of mp.coordinates) {
    for (const ring of poly) {
      const m = ring.length - 1 // last point repeats the first
      if (m < 3) continue
      const f = new Float64Array(m * 2)
      let a = 0
      for (let i = 0; i < m; i++) {
        f[2 * i] = x0 + ring[i][0] * h
        f[2 * i + 1] = y0 + ring[i][1] * h
      }
      for (let i = 0, j = m - 1; i < m; j = i, i++) a += f[2 * j] * f[2 * i + 1] - f[2 * i] * f[2 * j + 1]
      if (Math.abs(a / 2) < minArea) continue
      rings.push(simplify(f, h * 0.08))
    }
  }
  return rings
}

// ---- build ---------------------------------------------------------------------------

export function buildGeometry(p: Params, rows = 380): Geometry {
  const t0 = performance.now()
  const { sdf: B } = silhouette(p)
  const noise = makeNoise(p.seed + 7)
  const rng = mulberry32(p.seed * 3 + 1)

  // sampling grid over the whole plate
  const X0 = -PLATE_AR, Y0 = -1
  const h = 2 / rows
  const nx = Math.round((2 * PLATE_AR) / h), ny = rows
  const N = nx * ny

  // silhouette field at render resolution
  const Bf = new Float64Array(N)
  for (let j = 0; j < ny; j++) {
    const y = Y0 + (j + 0.5) * h
    for (let i = 0; i < nx; i++) Bf[j * nx + i] = B(X0 + (i + 0.5) * h, y)
  }
  // area, centroid, extent and Lloyd samples on a fixed grid, so the layout is
  // identical whatever resolution it is drawn at (preview, PNG, SVG)
  const hs = 2 / 150
  let area = 0, mx = 0, my = 0
  const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const lloydSamples: number[] = []
  for (let y = Y0 + hs / 2; y < 1; y += hs) {
    for (let x = X0 + hs / 2; x < PLATE_AR; x += hs) {
      if (B(x, y) >= 0) continue
      area += hs * hs; mx += x; my += y
      if (x < ext.x0) ext.x0 = x
      if (x > ext.x1) ext.x1 = x
      if (y < ext.y0) ext.y0 = y
      if (y > ext.y1) ext.y1 = y
      lloydSamples.push(x, y)
    }
  }
  const inCount = lloydSamples.length / 2
  const cx = inCount ? mx / inCount : 0, cy = inCount ? my / inCount : 0
  if (!inCount) { ext.x0 = ext.y0 = -0.5; ext.x1 = ext.y1 = 0.5 }

  // seeds and their weights. A weight > 1 makes a cell claim more space; with
  // multiplicative weights the walls become circular arcs (Apollonius circles),
  // which is what gives the soap-bubble look.
  let seeds = makeSeeds(p, B, Math.max(area, 0.01), cx, cy, ext)
  while (seeds.length < 6) seeds.push(cx + (rng() - 0.5) * 0.2, cy + (rng() - 0.5) * 0.2)
  const n = seeds.length / 2
  const spacing = Math.sqrt(Math.max(area, 0.01) / n)
  const wnoise = makeNoise(p.seed + 101)
  const wt = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const v = fbm(wnoise, seeds[2 * i] * 1.7 + 3, seeds[2 * i + 1] * 1.7, 2) + (rng() - 0.5) * 0.5
    wt[i] = Math.exp(p.bubble * p.sizeVariance * 0.55 * v)
  }
  seeds = relax(seeds, wt, Float64Array.from(lloydSamples), Math.round(p.lloyd))
  const del = new Delaunay(Float64Array.from(seeds))

  const halfGap = p.gap / 2
  const solid = new Uint8Array(n)
  // filled cells are picked away from the rim, where they read as islands of colour
  for (let i = 0; i < n; i++) if (B(seeds[2 * i], seeds[2 * i + 1]) < -p.rim * 1.6 && rng() < p.solid) solid[i] = 1
  // inscribed radius along each seed-to-seed line (for circle pores)
  const crad = new Float64Array(n).fill(Infinity)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const L = Math.hypot(seeds[2 * j] - seeds[2 * i], seeds[2 * j + 1] - seeds[2 * i + 1])
      crad[i] = Math.min(crad[i], (L * wt[i]) / (wt[i] + wt[j]))
    }
    crad[i] -= halfGap
  }
  const roundK = Math.max(1e-4, p.roundness * spacing * 0.55)
  // irregularity: per-cell fillet size and a slowly varying wall thickness
  const cellK = new Float64Array(n)
  for (let i = 0; i < n; i++) cellK[i] = roundK * Math.max(0.15, 1 + p.irregularity * (rng() - 0.5) * 1.6)

  // colour patches: domain-warped Voronoi over the extent
  const prng = mulberry32(p.seed * 17 + 5)
  const pn = Math.max(3, Math.round(p.patchCount))
  const ppts = new Float64Array(pn * 2)
  const pad = 0.15
  for (let k = 0; k < pn; k++) {
    ppts[2 * k] = ext.x0 - pad + prng() * (ext.x1 - ext.x0 + 2 * pad)
    ppts[2 * k + 1] = ext.y0 - pad + prng() * (ext.y1 - ext.y0 + 2 * pad)
  }
  const pdel = new Delaunay(ppts)
  const weights = [p.w1, p.w2, p.w3, p.w4, p.w5].map((w) => Math.max(0, w))
  const wsum = weights.reduce((a, b) => a + b, 0)
  const pcol = new Uint8Array(pn).fill(255)
  for (let k = 0; k < pn; k++) {
    if (wsum <= 0) break
    let r = prng() * wsum
    let c = 0
    while (c < 4 && r >= weights[c]) { r -= weights[c]; c++ }
    pcol[k] = c
  }
  const pAdjStart = new Int32Array(pn + 1)
  const pAdj: number[] = []
  for (let k = 0; k < pn; k++) {
    pAdjStart[k] = pAdj.length
    for (const j of pdel.neighbors(k)) pAdj.push(j)
  }
  pAdjStart[pn] = pAdj.length

  // the per-pixel pass
  const poreF = new Float64Array(N).fill(-1)
  const zoneF = new Float64Array(N).fill(-1)
  const patchF = Array.from({ length: 5 }, () => new Float64Array(N).fill(-1))
  const poreArea = new Float64Array(n), poreX = new Float64Array(n), poreY = new Float64Array(n)
  const owner = new Int32Array(N).fill(-1)
  const wallF = new Float64Array(N)
  const bx0 = new Int32Array(n).fill(nx), bx1 = new Int32Array(n).fill(-1)
  const by0 = new Int32Array(n).fill(ny), by1 = new Int32Array(n).fill(-1)
  const warp = p.patchWarp * 0.09
  const rimK = 0.03
  let plast = 0
  const margin = 0.03
  for (let j = 0; j < ny; j++) {
    const y = Y0 + (j + 0.5) * h
    for (let i = 0; i < nx; i++) {
      const x = X0 + (i + 0.5) * h
      const idx = j * nx + i
      const b = Bf[idx]
      if (b > margin) continue
      // nearest three cells under the weighted distance f_i = |x − s_i| / w_i
      let i1 = 0, i2 = 0, i3 = 0, f1 = Infinity, f2 = Infinity, f3 = Infinity
      for (let k = 0; k < n; k++) {
        const f = Math.hypot(x - seeds[2 * k], y - seeds[2 * k + 1]) / wt[k]
        if (f < f3) {
          if (f < f2) {
            f3 = f2; i3 = i2
            if (f < f1) { f2 = f1; i2 = i1; f1 = f; i1 = k } else { f2 = f; i2 = k }
          } else { f3 = f; i3 = k }
        }
      }
      const a = i1
      // distance to the wall with cell j: (f_j − f_a) / |∇(f_j − f_a)| (first order)
      const ax = x - seeds[2 * a], ay = y - seeds[2 * a + 1]
      const al = Math.hypot(ax, ay) || 1e-9
      const wallTo = (j: number, fj: number) => {
        const bx = x - seeds[2 * j], by = y - seeds[2 * j + 1]
        const bl = Math.hypot(bx, by) || 1e-9
        const gx = bx / (bl * wt[j]) - ax / (al * wt[a])
        const gy = by / (bl * wt[j]) - ay / (al * wt[a])
        return (fj - f1) / (Math.hypot(gx, gy) || 1e-9)
      }
      const wall = wallTo(i2, f2)

      // pore signed distance (negative inside)
      let sd = 1
      if (!solid[a]) {
        if (p.shape === "worley") {
          const d1 = Math.hypot(ax, ay), d2 = Math.hypot(x - seeds[2 * i2], y - seeds[2 * i2 + 1])
          sd = (p.gap * 1.2 - (d2 - d1)) * 0.5 + p.roundness * 0.004
        } else if (p.shape === "circle") {
          sd = al - crad[a] * 0.97
        } else {
          const w3 = wallTo(i3, f3)
          const k = p.shape === "polygon" ? 1e-4 : cellK[a]
          const g = halfGap * Math.max(0.3, 1 + p.irregularity * 1.4 * noise(x * 4.3 - 7, y * 4.3 + 2))
          sd = g - smin(wall, w3, k)
        }
      }
      const rim = p.rim * (1 + p.rimVariance * fbm(noise, x * 2.1 + 11, y * 2.1 - 4, 3))
      const pore = smax(sd, b + rim, rimK)
      poreF[idx] = -pore
      owner[idx] = a
      wallF[idx] = wall
      if (pore < 0) {
        poreArea[a]++; poreX[a] += x; poreY[a] += y
        if (i < bx0[a]) bx0[a] = i
        if (i > bx1[a]) bx1[a] = i
        if (j < by0[a]) by0[a] = j
        if (j > by1[a]) by1[a] = j
      }

      // where patches show: the rim band and solid cells
      zoneF[idx] = Math.max(b + rim + 0.006, solid[a] ? wall : -wall)

      // patch colour (warped coordinates give torn edges)
      if (wsum > 0) {
        const wx = x + warp * fbm(noise, x * 3.1, y * 3.1 + 40, 4) + warp * 0.35 * noise(x * 19, y * 19)
        const wy = y + warp * fbm(noise, x * 3.1 + 70, y * 3.1, 4) + warp * 0.35 * noise(x * 19 + 9, y * 19)
        let pa = plast
        let dpa = (ppts[2 * pa] - wx) ** 2 + (ppts[2 * pa + 1] - wy) ** 2
        for (;;) {
          let moved = false
          for (let k = pAdjStart[pa]; k < pAdjStart[pa + 1]; k++) {
            const c = pAdj[k]
            const dc = (ppts[2 * c] - wx) ** 2 + (ppts[2 * c + 1] - wy) ** 2
            if (dc < dpa) { dpa = dc; pa = c; moved = true }
          }
          if (!moved) break
        }
        plast = pa
        let dpb = Infinity, pb = -1
        for (let k = pAdjStart[pa]; k < pAdjStart[pa + 1]; k++) {
          const c = pAdj[k]
          const dc = (ppts[2 * c] - wx) ** 2 + (ppts[2 * c + 1] - wy) ** 2
          if (dc < dpb) { dpb = dc; pb = c }
        }
        const psep = pb >= 0 ? Math.hypot(ppts[2 * pb] - ppts[2 * pa], ppts[2 * pb + 1] - ppts[2 * pa + 1]) : 1
        const pw = pb >= 0 ? (dpb - dpa) / (2 * psep) : 1
        const col = pcol[pa]
        for (let c = 0; c < 5; c++) patchF[c][idx] = c === col ? pw : -Math.max(pw, 1e-4)
        // neighbouring patches of the same colour merge
        if (pb >= 0 && pcol[pb] === col) patchF[col][idx] = Math.max(pw, 0.004)
      }
    }
  }

  const blobF = new Float64Array(N)
  for (let k = 0; k < N; k++) blobF[k] = -Bf[k]
  const minA = h * h * 6
  const blob = trace(blobF, nx, ny, X0, Y0, h)
  // each pore is traced inside its own cell, so pores never merge however thin the wall
  const pores: Float64Array[] = []
  for (let a = 0; a < n; a++) {
    if (bx1[a] < 0) continue
    const i0 = Math.max(0, bx0[a] - 2), i1 = Math.min(nx - 1, bx1[a] + 2)
    const j0 = Math.max(0, by0[a] - 2), j1 = Math.min(ny - 1, by1[a] + 2)
    const w = i1 - i0 + 1, hh = j1 - j0 + 1
    const sub = new Float64Array(w * hh)
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < w; i++) {
        const idx = (j + j0) * nx + (i + i0)
        // outside the cell: negative, meeting the pore field at the wall
        sub[j * w + i] = owner[idx] === a ? poreF[idx] : owner[idx] >= 0 ? -wallF[idx] - halfGap : -1
      }
    }
    for (const r of trace(sub, w, hh, X0 + i0 * h, Y0 + j0 * h, h, minA)) pores.push(r)
  }
  const zone = trace(zoneF, nx, ny, X0, Y0, h, minA)
  const patches = patchF.map((f, c) => (weights[c] > 0 ? trace(f, nx, ny, X0, Y0, h, minA) : []))

  // ---- overlay geometry ----------------------------------------------------------
  const orng = mulberry32(p.seed * 101 + 3)
  const graph: number[] = []
  const nodes: number[] = []
  const nodeSet = new Set<number>()
  const { halfedges, triangles } = del
  for (let e = 0; e < halfedges.length; e++) {
    if (halfedges[e] > e) continue // each edge once
    const a = triangles[e], b = triangles[e % 3 === 2 ? e - 2 : e + 1]
    const ax = seeds[2 * a], ay = seeds[2 * a + 1], bx = seeds[2 * b], by = seeds[2 * b + 1]
    if (B(ax, ay) > -0.03 || B(bx, by) > -0.03) continue
    if (orng() > p.graphDensity) continue
    graph.push(ax, ay, bx, by)
    nodeSet.add(a); nodeSet.add(b)
  }
  for (const a of nodeSet) if (orng() < 0.4) nodes.push(seeds[2 * a], seeds[2 * a + 1], 0.8 + orng() * 0.5)
  // junction dots: Voronoi vertices (circumcentres) inside the outline
  const tri = triangles.length / 3
  for (let t = 0; t < tri; t++) {
    if (orng() > p.graphDensity * 1.4) continue
    const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2]
    const ax = seeds[2 * a], ay = seeds[2 * a + 1], bx = seeds[2 * b], by = seeds[2 * b + 1], qx = seeds[2 * c], qy = seeds[2 * c + 1]
    const d = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by))
    if (Math.abs(d) < 1e-12) continue
    const ux = ((ax * ax + ay * ay) * (by - qy) + (bx * bx + by * by) * (qy - ay) + (qx * qx + qy * qy) * (ay - by)) / d
    const uy = ((ax * ax + ay * ay) * (qx - bx) + (bx * bx + by * by) * (ax - qx) + (qx * qx + qy * qy) * (bx - ax)) / d
    if (B(ux, uy) < -0.01) nodes.push(ux, uy, 1.15)
  }
  // long trails: straight hairlines through pairs of distant seeds
  const trails: number[] = []
  for (let t = 0; t < 4; t++) {
    const a = Math.floor(orng() * n), b = Math.floor(orng() * n)
    const ax = seeds[2 * a], ay = seeds[2 * a + 1], bx = seeds[2 * b], by = seeds[2 * b + 1]
    const L = Math.hypot(bx - ax, by - ay)
    if (L < 0.5) continue
    const ux = (bx - ax) / L, uy = (by - ay) / L
    trails.push(ax - ux * 0.35, ay - uy * 0.35, bx + ux * 0.35, by + uy * 0.35)
    nodes.push(ax, ay, 1, bx, by, 1)
  }

  // outline: fringe hairlines along the outward normal, plus dots on the edge
  const fringe: number[] = []
  const outer = blob.slice().sort((r1, r2) => r2.length - r1.length)[0]
  if (outer) {
    const m = outer.length / 2
    let acc = 0
    const spacing = 0.016 / Math.max(0.15, p.fringeDensity)
    for (let k = 0; k < m; k++) {
      const x = outer[2 * k], y = outer[2 * k + 1]
      const k2 = (k + 1) % m
      acc += Math.hypot(outer[2 * k2] - x, outer[2 * k2 + 1] - y)
      if (acc < spacing) continue
      acc = 0
      const e = 1e-3
      let gx = B(x + e, y) - B(x - e, y), gy = B(x, y + e) - B(x, y - e)
      const gl = Math.hypot(gx, gy) || 1
      gx /= gl; gy /= gl
      const gate = noise(x * 2.3 + 50, y * 2.3 - 20)
      if (gate > 0.42 - p.fringeDensity * 0.9) {
        const L = p.fringeLength * (0.45 + 0.55 * (0.5 + 0.5 * noise(x * 9, y * 9)))
        fringe.push(x + gx * 0.012, y + gy * 0.012, x + gx * (0.012 + L), y + gy * (0.012 + L))
      }
      if (orng() < 0.07) nodes.push(x, y, 1.1)
    }
  }

  // dotted orbit arcs and dashed rays around the centre
  const arcs: Arc[] = []
  const halfW = (ext.x1 - ext.x0) / 2, halfH = (ext.y1 - ext.y0) / 2
  for (let k = 0; k < 4; k++) {
    const s = 0.72 + k * 0.1 + orng() * 0.05
    const a0 = orng() * Math.PI * 2
    arcs.push({ cx: cx - 0.1 + orng() * 0.2, cy: cy + orng() * 0.1, rx: halfW * s, ry: halfH * s * 1.05, a0, a1: a0 + 0.9 + orng() * 1.6 })
  }
  const rays: number[] = []
  const rc = Math.max(0, Math.round(p.rayCount))
  for (let k = 0; k < rc; k++) rays.push(((k + 0.5 + (orng() - 0.5) * 0.7) / rc) * Math.PI * 2 - Math.PI)

  return {
    arcs, rays,
    blob, pores, zone, patches,
    graph: Float64Array.from(graph),
    trails: Float64Array.from(trails),
    nodes: Float64Array.from(nodes),
    fringe: Float64Array.from(fringe),
    center: [cx, cy],
    extent: ext,
    cells: n,
    poreCount: pores.length,
    buildMs: Math.round(performance.now() - t0),
  }
}
