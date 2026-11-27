const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export const fmtInt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : num.format(Math.round(v)))
export const fmtINR = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `₹${inr.format(Math.round(v))}`)
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
export const fmtPp = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)} pp`
export const fmtSigned = (v: number) => `${v >= 0 ? '+' : '−'}${num.format(Math.abs(Math.round(v)))}`
export const fmtCompact = (v: number) => {
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e5) return `${(v / 1e5).toFixed(v >= 1e6 ? 1 : 2)}L`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(Math.round(v))
}
export const safeDiv = (a: number, b: number) => (b > 0 ? a / b : NaN)
