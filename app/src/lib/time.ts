// IST wall-clock time helpers.
// We encode Asia/Kolkata local time on the UTC time line ("IST-wall ms") so that
// getUTC*() returns IST components. This keeps day boundaries correct regardless
// of the viewer's browser timezone.

export const DAY = 86_400_000
const IST_OFFSET = 330 * 60_000

/** Excel serial date (1900 system) interpreted as IST wall time. */
export function fromExcelSerial(serial: number): number {
  return Math.round((serial - 25569) * DAY)
}

/** Parses an ISO string. Strings with an explicit offset are converted to IST wall time;
 *  strings without an offset are taken as IST wall time already. */
export function fromIsoString(s: string): number {
  const t = s.trim()
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(t)) {
    const ms = Date.parse(t)
    return Number.isNaN(ms) ? NaN : ms + IST_OFFSET
  }
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
}

export function toTime(v: unknown): number {
  if (v == null || v === '') return NaN
  if (typeof v === 'number') return fromExcelSerial(v)
  if (v instanceof Date) return v.getTime() - v.getTimezoneOffset() * 60_000 // local wall → wall ms
  return fromIsoString(String(v))
}

export const startOfDay = (t: number) => Math.floor(t / DAY) * DAY
/** End of the selected day in IST (inclusive upper bound, exclusive ms). */
export const endOfDay = (t: number) => startOfDay(t) + DAY - 1

export function dayKey(t: number): string {
  return new Date(startOfDay(t)).toISOString().slice(0, 10)
}
export function parseDayKey(k: string): number {
  return fromIsoString(k)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtDay(t: number, withYear = false): string {
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}`
}
export function fmtDateTime(t: number): string {
  const d = new Date(t)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${fmtDay(t, true)}, ${hh}:${mm} IST`
}
export function fmtRange(a: number, b: number): string {
  return `${fmtDay(a, true)} – ${fmtDay(b, true)}`
}
export function daysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY)
}
/** Today as an IST-wall day key (used for local campaign defaults). */
export function todayKey(): string {
  return dayKey(Date.now() + IST_OFFSET)
}
