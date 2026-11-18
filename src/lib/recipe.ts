// Remembers the last settings in this browser (best effort; storage can be unavailable).

import { DEFAULTS, type Params } from "./params"

const LAST = "cells:v2:last"

export function loadLast(): Params {
  try {
    const raw = localStorage.getItem(LAST)
    if (raw) {
      const p = { ...DEFAULTS, ...JSON.parse(raw) } as Params
      if (!Array.isArray(p.lobes) || !p.lobes.every((l) => [l?.x, l?.y, l?.r].every(Number.isFinite))) p.lobes = DEFAULTS.lobes
      return p
    }
  } catch { /* ignore */ }
  return DEFAULTS
}

export function storeLast(p: Params) {
  try { localStorage.setItem(LAST, JSON.stringify(p)) } catch { /* ignore */ }
}

// ---- saved presets (kept in this browser) ---------------------------------------------------

const SAVED = "cells:v2:saved"

export interface SavedPreset {
  name: string
  params: Params
  at: number
}

export function loadSaved(): SavedPreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED) ?? "[]")
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === "string" && s.params) : []
  } catch {
    return []
  }
}

export function storeSaved(list: SavedPreset[]) {
  try { localStorage.setItem(SAVED, JSON.stringify(list)) } catch { /* ignore */ }
}
