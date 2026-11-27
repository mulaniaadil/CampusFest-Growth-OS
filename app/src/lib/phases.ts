// Reporting phases derived from workbook dates (event + target versions). No hardcoded dates.
import type { Model } from '../analytics/model'
import { DAY, dayKey, startOfDay } from './time'

export interface Phase { key: string; label: string; from: string; to: string; note: string }

export function phases(m: Model): Phase[] {
  const start = dayKey(m.dayRange.start), end = dayKey(m.dayRange.end)
  const evS = startOfDay(m.raw.event.startsAt), evE = startOfDay(m.raw.event.endsAt)
  const out: Phase[] = [{ key: 'full', label: 'Full period', from: start, to: end, note: 'All workbook history' }]
  const revised = m.raw.targets[1]
  if (revised) {
    out.push({ key: 'launch', label: m.raw.targets[0].version || 'First target plan', from: start, to: dayKey(startOfDay(revised.effectiveAt) - DAY), note: 'Before the target revision' })
    out.push({ key: 'revised', label: revised.version || 'Revised plan', from: dayKey(revised.effectiveAt), to: end, note: 'After the target revision' })
  }
  out.push({ key: 'pre', label: 'Pre-event', from: start, to: dayKey(evS - DAY), note: 'Acquisition window, no attendance yet' })
  out.push({ key: 'event', label: 'Event days', from: dayKey(evS), to: dayKey(evE), note: 'Admissions happen' })
  if (evE + DAY <= m.dayRange.end) out.push({ key: 'post', label: 'Post-event', from: dayKey(evE + DAY), to: end, note: 'Ledger adjustments only' })
  return out
}

export function activePhase(m: Model, from: string, to: string): Phase | null {
  return phases(m).find((p) => p.from === from && p.to === to) ?? null
}
