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
  spacing: number // share of cells that sit apart from their neighbours, with foam between
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
  cells: 32,
  giants: 3,
  giantSize: 1.3,
  variety: 0.45,
  spacing: 0.9,
  strandWidth: 1.4,
  webs: 1.1,
  glow: 0.3,
  fill: "foam",
  foamAmount: 0.5,
  bubbleSize: 1,
  holes: 0.85,
  wLime: 1,
  wGreen: 1.1,
  wBlue: 0.6,
  wLace: 0.9,
  bg: "#081528",
  strand: "#cfe03c",
  hub: "#f4ef1c",
  lime: "#cde03b",
  green: "#8fc23e",
  blue: "#1d4cc1",
  lace: "#e8eef8",
  grid: true,
  gridColor: "#5b6f93",
  ticks: true,
  dots: true,
  aspect: "7:6",
  transparent: false,
  exportSize: 4096,
}

/** Parameters that change the geometry. Everything else is paint. */
export const STRUCTURE_KEYS: (keyof Params)[] = [
  "lobes", "seed", "cells", "giants", "giantSize", "variety", "spacing", "foamAmount",
]
