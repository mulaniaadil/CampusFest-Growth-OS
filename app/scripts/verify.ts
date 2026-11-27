// Prints the key KPIs computed by the app's own analytics modules, straight from the workbook.
// Run: npm run verify   (compare against scripts/validate_workbook.py, an independent pandas check)
import { readFileSync } from 'node:fs'
import { parseWorkbook } from '../src/data/loadWorkbook'
import { buildModel } from '../src/analytics/model'
import { campaignPerformance, fullScope, funnel, snapshot, attendanceQuality, recoveryPools } from '../src/analytics/metrics'
import { bottleneck, opportunities, deprioritized } from '../src/analytics/opportunities'
import { parseDayKey, endOfDay } from '../src/lib/time'

const path = process.argv[2] ?? 'public/data/Attendee Dataset.xlsx'
const buf = readFileSync(path)
const raw = parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, path)
const m = buildModel(raw)
const s = fullScope(m)
const snap = snapshot(m, s)
const pick = (o: Record<string, unknown>, ks: string[]) => Object.fromEntries(ks.map((k) => [k, o[k]]))
console.log('audits', raw.audits.map((a) => `${a.sheet}: read ${a.rowsRead}, kept ${a.rowsKept}, dupes ${a.duplicateIdsRemoved}`))
console.log('SNAPSHOT', pick(snap as never, ['identified','registrations','confirmed','cancelled','waitlisted','interested','everCancelled','visitors','visitorsRegistered','visitorsWalkIn','spend','regConversion','attendanceConversion','confirmedShowRate','cancellationRate','costPerIdentified','costPerRegistration','costPerVisitor']))
console.log('target', snap.target.version, snap.attainment, snap.gap)
console.log('funnel', funnel(m, s).people.map((x) => `${x.label}=${x.value}`).join(' | '), funnel(m, s).anonymous.map((x) => `${x.label}=${x.value}`).join(' | '))
for (const r of campaignPerformance(m, s).rows) console.log(r.id, r.name.padEnd(22), r.spend, r.identified, r.registrations, r.attendees, (r.showRate*100).toFixed(1), Math.round(r.cpa), r.quadrant)
console.log('quality', attendanceQuality(m, s))
console.log('pools', recoveryPools(m, s))
console.log('bottleneck', bottleneck(m, s))
const o = opportunities(m, s)
for (const x of o.list) console.log(x.rank, x.id, x.title, x.impact, x.score, x.cost)
console.log('scenario', o.scenario, o.budgetPlan, o.budgetRemaining)
console.log('deprioritized', deprioritized(m, s))
for (const d of ['2025-03-14', '2025-03-15', '2025-03-31']) {
  const sn = snapshot(m, { ...s, end: endOfDay(parseDayKey(d)) })
  console.log(d, sn.target.version, sn.identified, sn.registrations, sn.spend, sn.projection && { reg: Math.round(sn.projection.projectedRegistrations), ident: Math.round(sn.projection.projectedIdentified) })
}
import { proposedAllocation } from '../src/analytics/opportunities'
console.log('allocation', proposedAllocation(m, s))
