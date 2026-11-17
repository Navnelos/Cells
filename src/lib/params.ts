export type Silhouette = "reference" | "metaballs" | "superformula" | "circle"
export type Seeding = "poisson" | "clusters" | "phyllotaxis" | "hex"
export type PoreShape = "rounded" | "worley" | "polygon" | "circle"
export type Aspect = "free" | "7:6" | "1:1" | "4:5" | "16:9" | "9:16"

export interface Params {
  // ---- structure
  seed: number
  silhouette: Silhouette
  lobes: number // metaballs: number of lobes
  lobeSpread: number // metaballs: how far lobes wander from the centre
  sfM: number // superformula symmetry
  sfN: number // superformula shape exponent
  size: number // overall silhouette scale
  seeding: Seeding
  cells: number // target number of cells
  sizeVariance: number // 0 = even cells, 1 = strongly mixed big/small
  bubble: number // 0 = straight walls, 1 = curved (weighted) walls
  lloyd: number // Lloyd relaxation iterations (k-means steps)
  shape: PoreShape
  gap: number // wall thickness between pores
  roundness: number // corner rounding (junction fillets)
  irregularity: number // varies fillets per cell and wall thickness along the walls
  rim: number // band of tissue along the outline
  rimVariance: number
  solid: number // share of interior cells that stay filled
  patchCount: number
  patchWarp: number // domain-warp amount → torn patch edges
  // ---- colour
  bg: string
  tissue: string
  c1: string; w1: number
  c2: string; w2: number
  c3: string; w3: number
  c4: string; w4: number
  c5: string; w5: number
  wall: string
  wallWidth: number
  poreColor: string
  poreOpacity: number
  ink: string // dots and hairlines
  gridColor: string
  // ---- overlay (on the plate)
  graph: boolean
  graphDensity: number
  graphOpacity: number
  nodes: boolean
  nodeSize: number
  fringe: boolean
  fringeLength: number
  fringeDensity: number
  rings: boolean // dotted orbit arcs
  rays: boolean // dashed lines from the centre
  rayCount: number
  grid: boolean
  gridCols: number
  gridOnPlate: boolean
  // ---- 3D & view
  depth: number
  perspective: number
  autoRotate: boolean
  rotateSpeed: number
  zoom: number
  // ---- export
  aspect: Aspect
  showFrame: boolean
  transparent: boolean
  exportSize: number
}

export const DEFAULTS: Params = {
  seed: 4127,
  silhouette: "reference",
  lobes: 5,
  lobeSpread: 0.5,
  sfM: 5,
  sfN: 4,
  size: 1,
  seeding: "poisson",
  cells: 38,
  sizeVariance: 0.9,
  bubble: 1,
  lloyd: 3,
  shape: "rounded",
  gap: 0.0045,
  roundness: 0.5,
  irregularity: 0.7,
  rim: 0.065,
  rimVariance: 0.6,
  solid: 0.12,
  patchCount: 190,
  patchWarp: 0.6,
  bg: "#0a1a33",
  tissue: "#2b5a2d",
  c1: "#cfe24c", w1: 1.05,
  c2: "#8fbe5a", w2: 1,
  c3: "#4f8a45", w3: 1,
  c4: "#2f6a35", w4: 0.5,
  c5: "#3a5fb5", w5: 0.5,
  wall: "#e2ec4a",
  wallWidth: 2.2,
  poreColor: "#0a1a33",
  poreOpacity: 1,
  ink: "#f2f4ee",
  gridColor: "#22365e",
  graph: true,
  graphDensity: 0.14,
  graphOpacity: 0.35,
  nodes: true,
  nodeSize: 1,
  fringe: true,
  fringeLength: 0.07,
  fringeDensity: 0.5,
  rings: true,
  rays: true,
  rayCount: 8,
  grid: true,
  gridCols: 8,
  gridOnPlate: false,
  depth: 0,
  perspective: 0.35,
  autoRotate: false,
  rotateSpeed: 0.25,
  zoom: 1,
  aspect: "7:6",
  showFrame: true,
  transparent: false,
  exportSize: 4096,
}

/** Parameters that change the geometry. Anything else is paint and is cheap to change. */
export const STRUCTURE_KEYS: (keyof Params)[] = [
  "seed", "silhouette", "lobes", "lobeSpread", "sfM", "sfN", "size", "seeding", "cells", "sizeVariance", "bubble", "lloyd",
  "shape", "gap", "roundness", "irregularity", "rim", "rimVariance", "solid", "patchCount", "patchWarp",
  "w1", "w2", "w3", "w4", "w5", "graphDensity", "fringeDensity", "fringeLength", "rayCount"
]

export interface Preset {
  name: string
  description: string
  params: Partial<Params>
}

export const PRESETS: Preset[] = [
  { name: "Reference", description: "The reference map", params: {} },
]

export function applyPreset(base: Params, preset: Preset): Params {
  return { ...DEFAULTS, aspect: base.aspect, showFrame: base.showFrame, exportSize: base.exportSize, ...preset.params }
}
