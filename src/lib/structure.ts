// The cell structure: a few hundred weighted seeds that the GPU turns into the picture.
//
//   Primary cells    large cavities, Poisson-placed and Lloyd-relaxed inside the outline.
//   Secondary cells  medium cells in the transitional zones, between cavities and foam.
//   Foam cells       cells that the shader fills with micro-foam (tertiary scale).
//
// A density field decides, before any cell exists, where the structure is calm (cavities),
// transitional (secondary cells) and intricate (foam). All cells share one weighted
// partition, so neighbours always share their walls.

import { fbm, makeNoise } from "./noise"
import type { Lobe, Params } from "./params"
import { mulberry32 } from "./rng"

export const PLATE_AR = 7 / 6
export const LOBE_K = 0.08
export const MAX_SEEDS = 640

/** seed kinds */
export const CAVITY = 0
export const FOAM = 1

export interface Structure {
  /** x, y, radius (power weight), kind — 4 floats per seed */
  seeds: Float32Array
  count: number
  hub: [number, number]
  maxDepth: number
  outline: Float64Array
  ticks: Float64Array[] // segments, three visibility levels
  dots: Float64Array // x y r
  ms: number
}

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

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function buildStructure(p: Params): Structure {
  const t0 = performance.now()
  const lobes = p.lobes.length ? p.lobes : [{ x: 0, y: 0, r: 0.6 }]
  const B = lobeSDF(lobes)
  const rng = mulberry32(p.seed)
  const noise = makeNoise(p.seed + 7)

  // samples of the interior
  const hs = 2 / 130
  const sx: number[] = [], sy: number[] = [], sd: number[] = []
  let maxDepth = 0, mx = 0, my = 0
  for (let y = -1.2 + hs / 2; y < 1.2; y += hs) {
    for (let x = -1.6 + hs / 2; x < 1.6; x += hs) {
      const b = B(x, y)
      if (b >= 0) continue
      sx.push(x); sy.push(y); sd.push(-b)
      maxDepth = Math.max(maxDepth, -b)
      mx += x; my += y
    }
  }
  const ns = sx.length
  const area = ns * hs * hs
  const hub: [number, number] = ns ? [mx / ns, my / ns] : [0, 0]
  maxDepth = maxDepth || 0.5

  // density field: 0 = calm (cavities), 1 = intricate (foam)
  const band = (x: number, y: number) => 0.06 + 0.8 * Math.max(0, p.foamAmount) * Math.max(0.1, 1 + 1.3 * fbm(noise, x * 2.2 + 5, y * 2.2 - 2, 2))
  const density = (x: number, y: number, depth: number) => {
    const edge = 1 - smooth(0, band(x, y), depth / maxDepth)
    const islands = Math.min(1, Math.max(0, p.spacing) * 1.8 * smooth(0.05, 0.45, noise(x * 2.9 + 9, y * 2.9 - 4)))
    return Math.min(1, Math.max(edge, islands))
  }

  // ---- seeds: Poisson darts with a radius set by the density field --------------------------
  const nPrim = Math.max(6, Math.round(p.cells))
  const Rp = Math.sqrt((0.7 * area) / (nPrim * Math.PI)) // primary cavity radius
  const seeds: number[] = [] // x y r kind
  const fits = (x: number, y: number, r: number, f: number) => {
    for (let k = 0; k < seeds.length; k += 4) if (Math.hypot(seeds[k] - x, seeds[k + 1] - y) < (r + seeds[k + 2]) * f) return false
    return true
  }
  const pick = () => {
    const i = Math.floor(rng() * ns)
    return [sx[i] + (rng() - 0.5) * hs, sy[i] + (rng() - 0.5) * hs, sd[i]]
  }
  // giant cavities first
  for (let g = 0; g < Math.round(p.giants); g++) {
    const r = Rp * p.giantSize * (0.85 + rng() * 0.3)
    for (let t = 0; t < 600; t++) {
      const [x, y, d] = pick()
      if (d < r * 0.9 || density(x, y, d) > 0.5 || !fits(x, y, r, 1)) continue
      seeds.push(x, y, r, CAVITY)
      break
    }
  }
  // then cells at their local size: cavities → secondary → foam cells
  for (let t = 0; t < 40000 && seeds.length / 4 < MAX_SEEDS; t++) {
    const [x, y, d] = pick()
    const dn = density(x, y, d)
    const scale = Math.exp(-2.1 * dn) // calm: full size; intricate: small cells
    const r = Rp * scale * Math.exp(Math.max(0, p.variety) * 0.5 * (rng() + rng() - 1))
    if (!fits(x, y, r, 0.92)) continue
    seeds.push(x, y, r, dn > 0.55 ? FOAM : CAVITY)
  }

  // weighted Lloyd relaxation: compresses cells against each other like a real foam
  const n = seeds.length / 4
  for (let it = 0; it < 3; it++) {
    const ax = new Float64Array(n), ay = new Float64Array(n), c = new Float64Array(n)
    for (let s = 0; s < ns; s += 3) {
      let best = 0, bd = Infinity
      for (let i = 0; i < n; i++) {
        const k = 4 * i
        const pd = (sx[s] - seeds[k]) ** 2 + (sy[s] - seeds[k + 1]) ** 2 - seeds[k + 2] ** 2
        if (pd < bd) { bd = pd; best = i }
      }
      ax[best] += sx[s]; ay[best] += sy[s]; c[best]++
    }
    for (let i = 0; i < n; i++) if (c[i]) { seeds[4 * i] = 0.5 * seeds[4 * i] + 0.5 * ax[i] / c[i]; seeds[4 * i + 1] = 0.5 * seeds[4 * i + 1] + 0.5 * ay[i] / c[i] }
  }

  // ---- outline polyline (for ticks) ----------------------------------------------------------
  const outline: number[] = []
  {
    // march around the shape: angular scan from the hub, refined by bisection on B
    const steps = 720
    for (let a = 0; a < steps; a++) {
      const ang = (a / steps) * Math.PI * 2
      const dx = Math.cos(ang), dy = Math.sin(ang)
      let lo = 0, hi = 2
      // the outermost crossing along the ray
      let last = -1
      for (let r = 0.01; r < 2; r += 0.01) if (B(hub[0] + dx * r, hub[1] + dy * r) < 0) last = r
      if (last < 0) continue
      lo = last; hi = last + 0.01
      for (let k = 0; k < 18; k++) {
        const m = (lo + hi) / 2
        if (B(hub[0] + dx * m, hub[1] + dy * m) < 0) lo = m
        else hi = m
      }
      outline.push(hub[0] + dx * lo, hub[1] + dy * lo)
    }
  }

  // ---- edge filaments: placed and directed by the boundary normal ------------------------------
  const ticks: number[][] = [[], [], []]
  const trng = mulberry32(p.seed * 5 + 9)
  {
    const m = outline.length / 2
    let acc = 0, gap = 0.012
    for (let k = 0; k < m; k++) {
      const x = outline[2 * k], y = outline[2 * k + 1]
      const j = (k + 1) % m
      acc += Math.hypot(outline[2 * j] - x, outline[2 * j + 1] - y)
      if (acc < gap) continue
      acc = 0
      const dens = noise(x * 2.2 + 30, y * 2.2)
      gap = 0.007 + 0.02 * trng() * (1 - Math.max(0, dens))
      if (dens < -0.2 || trng() < 0.2) continue
      const e = 1e-3
      let gx = B(x + e, y) - B(x - e, y), gy = B(x, y + e) - B(x, y - e)
      const gl = Math.hypot(gx, gy) || 1
      gx /= gl; gy /= gl
      const L = 0.012 + 0.05 * trng() ** 2 + 0.025 * Math.max(0, dens)
      const s0 = 0.01 + trng() * 0.012
      ticks[Math.min(2, Math.floor(trng() * 3))].push(x + gx * s0, y + gy * s0, x + gx * (s0 + L), y + gy * (s0 + L))
    }
  }

  // ---- white dots on cavity junctions (approximate: midpoints of close cavity pairs) ------------
  const dots: number[] = []
  const drng = mulberry32(p.seed * 13 + 1)
  for (let i = 0; i < n; i++) {
    if (seeds[4 * i + 3] !== CAVITY) continue
    for (let j = i + 1; j < n; j++) {
      if (seeds[4 * j + 3] !== CAVITY) continue
      const dx = seeds[4 * j] - seeds[4 * i], dy = seeds[4 * j + 1] - seeds[4 * i + 1]
      const D = Math.hypot(dx, dy), ri = seeds[4 * i + 2], rj = seeds[4 * j + 2]
      if (D > (ri + rj) * 1.15 || drng() > 0.12) continue
      // the point on the power bisector
      const t = (D * D + ri * ri - rj * rj) / (2 * D * D)
      const x = seeds[4 * i] + dx * t, y = seeds[4 * i + 1] + dy * t
      if (B(x, y) < -0.03) dots.push(x, y, 0.0055 + drng() * 0.002)
    }
  }

  const out = new Float32Array(MAX_SEEDS * 4)
  out.set(seeds.slice(0, MAX_SEEDS * 4))
  return {
    seeds: out, count: Math.min(MAX_SEEDS, n), hub, maxDepth,
    outline: Float64Array.from(outline),
    ticks: ticks.map((t) => Float64Array.from(t)),
    dots: Float64Array.from(dots),
    ms: Math.round(performance.now() - t0),
  }
}
