import { useCallback, useEffect, useRef } from "react"

import type { Params } from "./params"

// Undo/redo over settings. Rapid changes (a slider drag) settle into one step after
// a short pause.

const LIMIT = 150
const SETTLE_MS = 350

const key = (p: Params) => JSON.stringify(p)

export function useParamHistory(p: Params, setP: (p: Params) => void) {
  const past = useRef<Params[]>([])
  const future = useRef<Params[]>([])
  const committed = useRef<Params>(p)
  const current = useRef<Params>(p)
  const restoring = useRef(false)
  current.current = p

  useEffect(() => {
    if (restoring.current) {
      restoring.current = false
      return
    }
    const t = setTimeout(() => {
      if (key(p) === key(committed.current)) return
      past.current.push(committed.current)
      if (past.current.length > LIMIT) past.current.shift()
      future.current = []
      committed.current = p
    }, SETTLE_MS)
    return () => clearTimeout(t)
  }, [p])

  const restore = (target: Params) => {
    restoring.current = true
    setP(target)
  }

  const undo = useCallback(() => {
    const cur = current.current
    if (key(cur) !== key(committed.current)) {
      // an edit still settling: step back to the last settled state
      future.current.push(cur)
      restore(committed.current)
      return true
    }
    const prev = past.current.pop()
    if (!prev) return false
    future.current.push(committed.current)
    committed.current = prev
    restore(prev)
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return false
    past.current.push(committed.current)
    committed.current = next
    restore(next)
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { undo, redo }
}
