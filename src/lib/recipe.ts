// A recipe is the full description of one visual: every parameter plus camera and focus.
// Paste it back in and the exact same image comes out.

import type { ViewState } from "./engine"
import { DEFAULTS, type Params } from "./params"

export interface Recipe {
  v: 1
  p: Params
  view?: ViewState
}

const PREFIX = "cells."

export function encodeRecipe(p: Params, view?: ViewState): string {
  const json = JSON.stringify({ v: 1, p, view } satisfies Recipe)
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
  return PREFIX + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function decodeRecipe(text: string): Recipe | null {
  try {
    let s = text.trim()
    if (s.startsWith("{")) {
      const r = JSON.parse(s)
      return { v: 1, p: { ...DEFAULTS, ...(r.p ?? r) }, view: r.view }
    }
    if (s.startsWith(PREFIX)) s = s.slice(PREFIX.length)
    s = s.replace(/-/g, "+").replace(/_/g, "/")
    while (s.length % 4) s += "="
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
    const r = JSON.parse(new TextDecoder().decode(bytes))
    if (!r || typeof r !== "object" || !r.p) return null
    return { v: 1, p: { ...DEFAULTS, ...r.p }, view: r.view }
  } catch {
    return null
  }
}

// ---- local persistence (best effort; storage can be unavailable) ------------

const LAST = "cells:last"
const SAVED = "cells:saved"

export interface SavedLook {
  name: string
  recipe: string
  at: number
}

export function loadLast(): Params {
  try {
    const raw = localStorage.getItem(LAST)
    // always open still; rotation is opt-in per session
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), autoRotate: false }
  } catch { /* ignore */ }
  return DEFAULTS
}

export function storeLast(p: Params) {
  try { localStorage.setItem(LAST, JSON.stringify(p)) } catch { /* ignore */ }
}

export function loadSaved(): SavedLook[] {
  try {
    const raw = localStorage.getItem(SAVED)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function storeSaved(list: SavedLook[]) {
  try { localStorage.setItem(SAVED, JSON.stringify(list)) } catch { /* ignore */ }
}
