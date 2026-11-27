import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchBundledWorkbook, parseWorkbook } from './loadWorkbook'
import { buildModel, UNATTRIBUTED, type Model } from '../analytics/model'
import type { Scope } from '../analytics/metrics'
import { endOfDay, parseDayKey, dayKey } from '../lib/time'
import { toast } from '../lib/toast'

// Uploaded replacement workbooks are kept in IndexedDB so a reload keeps the same data.
const DB = 'campusfest-growth-os', STORE = 'files', KEY = 'workbook'
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function idbGet(): Promise<{ name: string; buf: ArrayBuffer } | null> {
  try {
    const db = await idb()
    return await new Promise((res) => { const g = db.transaction(STORE).objectStore(STORE).get(KEY); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null) })
  } catch { return null }
}
async function idbPut(v: { name: string; buf: ArrayBuffer } | null) {
  try {
    const db = await idb()
    await new Promise<void>((res) => { const tx = db.transaction(STORE, 'readwrite'); if (v) tx.objectStore(STORE).put(v, KEY); else tx.objectStore(STORE).delete(KEY); tx.oncomplete = () => res(); tx.onerror = () => res() })
  } catch { /* ignore */ }
}

export interface Filters {
  from: string // YYYY-MM-DD
  to: string
  campaign: string // 'all' or campaign id or UNATTRIBUTED
  channel: string // 'all' or channel
}

interface Ctx {
  model: Model | null
  error: string | null
  loading: boolean
  filters: Filters
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void
  scope: Scope | null
  loadFile: (f: File) => Promise<void>
  resetToBundled: () => Promise<void>
  isCustomWorkbook: boolean
}

const DataCtx = createContext<Ctx | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<Model | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [custom, setCustom] = useState(false)
  const [filters, setF] = useState<Filters>({ from: '', to: '', campaign: 'all', channel: 'all' })

  const applyModel = useCallback((m: Model) => {
    setModel(m)
    setF({ from: dayKey(m.dayRange.start), to: dayKey(m.dayRange.end), campaign: 'all', channel: 'all' })
    setError(null)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const stored = await idbGet()
        if (stored) {
          try {
            const m = buildModel(parseWorkbook(stored.buf, stored.name))
            if (alive) { applyModel(m); setCustom(true) }
            return
          } catch { await idbPut(null) }
        }
        const raw = await fetchBundledWorkbook()
        if (alive) applyModel(buildModel(raw))
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [applyModel])

  const loadFile = useCallback(async (f: File) => {
    setLoading(true)
    try {
      const buf = await f.arrayBuffer()
      const m = buildModel(parseWorkbook(buf, f.name))
      await idbPut({ name: f.name, buf })
      applyModel(m); setCustom(true)
      toast(`Loaded ${f.name}: ${m.external.length.toLocaleString('en-IN')} external people, ${m.campaigns.length} campaigns. All views recomputed.`)
    } catch (e) {
      const msg = `Could not use "${f.name}": ${(e as Error).message} The previous data is still loaded.`
      setError(msg); toast(msg, 'error')
    } finally { setLoading(false) }
  }, [applyModel])

  const resetToBundled = useCallback(async () => {
    setLoading(true)
    try {
      await idbPut(null)
      applyModel(buildModel(await fetchBundledWorkbook())); setCustom(false)
      toast('Switched back to the bundled workbook.')
    } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [applyModel])

  const scope = useMemo<Scope | null>(() => {
    if (!model || !filters.from || !filters.to) return null
    let start = parseDayKey(filters.from), end = endOfDay(parseDayKey(filters.to))
    if (!Number.isFinite(start)) start = model.dayRange.start
    if (!Number.isFinite(end)) end = model.dayRange.end
    start = Math.max(start, model.dayRange.start); end = Math.min(end, model.dayRange.end)
    if (start > end) start = model.dayRange.start
    let ids: string[] | null = null
    const all = [...model.campaigns.map((c) => c.id), UNATTRIBUTED]
    if (filters.channel !== 'all') ids = all.filter((id) => (id === UNATTRIBUTED ? 'walk_in' : model.campaignById.get(id)?.channel) === filters.channel)
    if (filters.campaign !== 'all') ids = (ids ?? all).filter((id) => id === filters.campaign)
    return { start, end, campaignIds: ids }
  }, [model, filters])

  const value: Ctx = {
    model, error, loading, filters, scope, loadFile, resetToBundled, isCustomWorkbook: custom,
    setFilters: (f) => setF((p) => ({ ...p, ...f })),
    resetFilters: () => model && setF({ from: dayKey(model.dayRange.start), to: dayKey(model.dayRange.end), campaign: 'all', channel: 'all' }),
  }
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}

export function useData() {
  const c = useContext(DataCtx)
  if (!c) throw new Error('useData outside provider')
  return c
}
