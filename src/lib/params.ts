export type FillMode = "foam" | "flat"
export type Aspect = "7:6" | "1:1" | "4:5" | "16:9" | "9:16"

/** One circle of the outline. The shape is the smooth union of all of them. */
export interface Lobe {
  x: number
  y: number
  r: number
}

export interface Params {
  // shape
  lobes: Lobe[]
  // layout
  seed: number
  cells: number // total number of cells
  giants: number // how many giant bubbles
  giantSize: number // giant bubble size, relative to a normal cell
  variety: number // size variety among normal cells
  // strands
  strandWidth: number // px at a 1000 px tall frame
  webs: number // size of the fanned junction webs (corner rounding)
  glow: number // brightness/thickness boost towards the centre hub
  // fill
  fill: FillMode
  foamAmount: number // how much of the shape is filled (vs empty dark cells)
  bubbleSize: number
  holes: number // share of bubbles that are open (foam mode)
  wLime: number
  wGreen: number
  wBlue: number
  wLace: number
  // colour
  bg: string
  strand: string
  hub: string
  lime: string
  green: string
  blue: string
  lace: string
  // extras
  grid: boolean
  gridColor: string
  ticks: boolean
  dots: boolean
  hatching: boolean
  // export
  aspect: Aspect
  transparent: boolean
  exportSize: number
}

/** Circles fitted to the reference outline (96% overlap). Plate units: frame height = 2, y down. */
export const DEFAULT_LOBES: Lobe[] = [
  { x: -0.442, y: -0.424, r: 0.382 },
  { x: -0.29, y: -0.137, r: 0.398 },
  { x: -0.689, y: 0.254, r: 0.293 },
  { x: -0.228, y: 0.488, r: 0.295 },
  { x: 0.316, y: -0.062, r: 0.457 },
  { x: 0.53, y: -0.049, r: 0.468 },
  { x: 0.72, y: 0.071, r: 0.318 },
  { x: -0.281, y: 0.195, r: 0.45 },
]

export const DEFAULTS: Params = {
  lobes: DEFAULT_LOBES,
  seed: 202,
  cells: 70,
  giants: 7,
  giantSize: 1.6,
  variety: 0.45,
  strandWidth: 1.6,
  webs: 0.8,
  glow: 0.7,
  fill: "foam",
  foamAmount: 0.3,
  bubbleSize: 0.7,
  holes: 0.85,
  wLime: 1,
  wGreen: 0.8,
  wBlue: 0.15,
  wLace: 0.7,
  bg: "#01142b",
  strand: "#d4e62c",
  hub: "#fff200",
  lime: "#cfe02a",
  green: "#8db43a",
  blue: "#2f58c4",
  lace: "#e9eef7",
  grid: true,
  gridColor: "#5b6f93",
  ticks: true,
  dots: true,
  hatching: true,
  aspect: "7:6",
  transparent: false,
  exportSize: 4096,
}

/** Parameters that change the geometry. Everything else is paint. */
export const STRUCTURE_KEYS: (keyof Params)[] = [
  "lobes", "seed", "cells", "giants", "giantSize", "variety", "webs", "fill", "foamAmount", "bubbleSize", "holes",
  "wLime", "wGreen", "wBlue", "wLace",
]
