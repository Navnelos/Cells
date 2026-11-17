// Seeded gradient noise (Perlin, 1985/2002) and fractal sums of it.
// Used to warp the colour patches, vary rim thickness and cell sizes.

import { mulberry32 } from "./rng"

export type Noise2 = (x: number, y: number) => number

export function makeNoise(seed: number): Noise2 {
  const rng = mulberry32(seed ^ 0x9e3779b9)
  const perm = new Uint8Array(512)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const gx = new Float64Array(256), gy = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const a = rng() * Math.PI * 2
    gx[i] = Math.cos(a)
    gy[i] = Math.sin(a)
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const X = xi & 255, Y = yi & 255
    const g = (ix: number, iy: number, dx: number, dy: number) => {
      const h = perm[perm[ix] + iy]
      return gx[h] * dx + gy[h] * dy
    }
    const n00 = g(X, Y, xf, yf)
    const n10 = g(X + 1, Y, xf - 1, yf)
    const n01 = g(X, Y + 1, xf, yf - 1)
    const n11 = g(X + 1, Y + 1, xf - 1, yf - 1)
    const u = fade(xf), v = fade(yf)
    const a = n00 + (n10 - n00) * u
    const b = n01 + (n11 - n01) * u
    return (a + (b - a) * v) * 1.414 // roughly [-1, 1]
  }
}

/** Fractal Brownian motion: octaves of noise, each twice the frequency and `gain` the amplitude. */
export function fbm(n: Noise2, x: number, y: number, octaves: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, f = 1
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * f + o * 17.3, y * f - o * 9.1)
    norm += amp
    amp *= gain
    f *= 2.03
  }
  return sum / norm
}
