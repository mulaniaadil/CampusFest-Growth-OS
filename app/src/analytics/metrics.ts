// Metric calculations. Pure functions of (Model, Scope). No presentation code here.
//
// Conventions
//  - Scope.end is the END of the selected day in IST. "As of" metrics include everything at or before it.
//  - Stock metrics (identified, registrations, verified visitors, spend) are CUMULATIVE as of scope.end.
//  - Flow metrics ("in range") count events between scope.start and scope.end.
//  - Cohort funnel / campaign table: people first identified inside the range; outcomes measured as of scope.end.
//  - Target = the target version whose effective_at is at or before scope.end.

import { safeDiv } from '../lib/format'
import { DAY, endOfDay, startOfDay } from '../lib/time'
import type { TargetVersion } from '../data/types'
import { campaignLabel, channelOf, listDays, statusAt, UNATTRIBUTED, type Model, type PersonFact } from './model'

export interface Scope {
  start: number
  end: number
  campaignIds: string[] | null // null = all campaigns + unattributed
}

export const fullScope = (m: Model): Scope => ({ start: m.dayRange.start, end: m.dayRange.end, campaignIds: null })

export function inScope(scope: Scope, campaignId: string) {
  return scope.campaignIds == null || scope.campaignIds.includes(campaignId)
}
export const isFiltered = (s: Scope) => s.campaignIds != null

export function targetAt(m: Model, t: number): TargetVersion {
  const ts = m.raw.targets
  let cur = ts[0]
  for (const v of ts) if (v.effectiveAt <= t) cur = v
  return cur
}
export function targetIsActive(m: Model, t: number) {
  return m.raw.targets[0].effectiveAt <= t
}

export interface Snapshot {
  scope: Scope
  target: TargetVersion
  targetActive: boolean
  eventStarted: boolean
  eventOver: boolean
  // cumulative as of end
  identified: number
  registrations: number
  confirmed: number
  cancelled: number
  waitlisted: number
  interested: number
  everCancelled: number
  visitors: number // verified unique external visitors
  visitorsRegistered: number
  visitorsWalkIn: number
  spend: number
  // in range (flow)
  identifiedInRange: number
  registrationsInRange: number
  spendInRange: number
  impressions: number
  clicks: number
  sessions: number
  anonRegStarts: number
  // rates
  regConversion: number // registrations / identified (cumulative)
  attendanceConversion: number // registered verified visitors / registrations
  confirmedShowRate: number
  cancellationRate: number
  costPerIdentified: number
  costPerRegistration: number
  costPerVisitor: number
  // targets
  attainment: { identified: number; registrations: number; visitors: number; budget: number }
  gap: { identified: number; registrations: number; visitors: number; budgetRemaining: number }
  projection: Projection | null
}

export interface Projection {
  method: string
  window: number
  regPerDay: number
  identPerDay: number
  daysLeft: number
  projectedRegistrations: number
  projectedIdentified: number
  projectedVisitors: number
  showRateUsed: number
  showRateSource: string
}

const scoped = (m: Model, s: Scope) => m.external.filter((p) => inScope(s, p.campaignId))

function spendBetween(m: Model, s: Scope, from: number, to: number) {
  const out = { spend: 0, impressions: 0, clicks: 0, sessions: 0, regStarts: 0, reach: 0 }
  for (const [cid, days] of m.dailyByCampaign) {
    if (!inScope(s, cid)) continue
    for (const [day, v] of days) {
      if (day < from || day > to) continue
      out.spend += v.spend; out.impressions += v.impressions; out.clicks += v.clicks; out.sessions += v.sessions; out.regStarts += v.regStarts; out.reach += v.reach
    }
  }
  return out
}

export function attendedBy(p: PersonFact, t: number) {
  return p.firstVerifiedAdmit != null && p.firstVerifiedAdmit <= t
}
export function registeredBy(p: PersonFact, t: number) {
  return p.reg != null && p.reg.at <= t
}

export function snapshot(m: Model, s: Scope): Snapshot {
  const E = s.end
  const ppl = scoped(m, s)
  let identified = 0, identifiedInRange = 0, registrations = 0, registrationsInRange = 0
  let confirmed = 0, cancelled = 0, waitlisted = 0, interested = 0, everCancelled = 0
  let visitors = 0, visitorsRegistered = 0, visitorsWalkIn = 0, confirmedAttended = 0
  for (const p of ppl) {
    if (p.firstSeen <= E) { identified++; if (p.firstSeen >= s.start) identifiedInRange++ }
    const reg = registeredBy(p, E)
    if (reg) {
      registrations++
      if (p.reg!.at >= s.start) registrationsInRange++
      const st = statusAt(p.reg!, E)
      if (st === 'confirmed') confirmed++
      else if (st === 'cancelled') cancelled++
      else if (st === 'waitlisted') waitlisted++
      else interested++
      if (p.reg!.history.some((h) => h.status === 'cancelled' && h.at <= E)) everCancelled++
    }
    if (attendedBy(p, E)) {
      visitors++
      if (reg) { visitorsRegistered++; if (statusAt(p.reg!, E) === 'confirmed') confirmedAttended++ } else visitorsWalkIn++
    }
  }
  const cum = spendBetween(m, s, -Infinity, E)
  const rng = spendBetween(m, s, s.start, E)
  const target = targetAt(m, E)
  const eventStarted = E >= m.raw.event.startsAt
  const eventOver = E >= m.raw.event.endsAt
  const snap: Snapshot = {
    scope: s, target, targetActive: targetIsActive(m, E), eventStarted, eventOver,
    identified, registrations, confirmed, cancelled, waitlisted, interested, everCancelled,
    visitors, visitorsRegistered, visitorsWalkIn, spend: cum.spend,
    identifiedInRange, registrationsInRange, spendInRange: rng.spend,
    impressions: rng.impressions, clicks: rng.clicks, sessions: rng.sessions, anonRegStarts: rng.regStarts,
    regConversion: safeDiv(registrations, identified),
    attendanceConversion: eventStarted ? safeDiv(visitorsRegistered, registrations) : NaN,
    confirmedShowRate: eventStarted ? safeDiv(confirmedAttended, confirmed) : NaN,
    cancellationRate: safeDiv(cancelled, registrations),
    costPerIdentified: safeDiv(cum.spend, identified),
    costPerRegistration: safeDiv(cum.spend, registrations),
    costPerVisitor: eventStarted ? safeDiv(cum.spend, visitors) : NaN,
    attainment: {
      identified: safeDiv(identified, target.identifiedGoal), registrations: safeDiv(registrations, target.registrationGoal),
      visitors: safeDiv(visitors, target.visitorsGoal), budget: safeDiv(cum.spend, target.budget),
    },
    gap: {
      identified: target.identifiedGoal - identified, registrations: target.registrationGoal - registrations,
      visitors: target.visitorsGoal - visitors, budgetRemaining: target.budget - cum.spend,
    },
    projection: null,
  }
  if (!eventStarted) snap.projection = project(m, s, snap)
  return snap
}

/** Run-rate projection to the event (modeled, not observed). */
function project(m: Model, s: Scope, snap: Snapshot): Projection {
  const window = 14
  const E = s.end
  const from = E - window * DAY
  const ppl = scoped(m, s)
  const regs = ppl.filter((p) => p.reg && p.reg.at > from && p.reg.at <= E).length
  const ids = ppl.filter((p) => p.firstSeen > from && p.firstSeen <= E).length
  const lastRegDay = startOfDay(m.raw.event.startsAt) - 1
  const daysLeft = Math.max(0, Math.round((lastRegDay - E) / DAY))
  const projectedRegistrations = snap.registrations + (regs / window) * daysLeft
  const projectedIdentified = snap.identified + (ids / window) * daysLeft
  // show-rate assumption: earlier edition not available, so use the registered→confirmed share as-of-date
  // multiplied by a declared assumption. We use the confirmed share only (no attendance data before the event).
  const confirmedShare = safeDiv(snap.confirmed, snap.registrations)
  const showRateUsed = Number.isFinite(confirmedShare) ? confirmedShare * 0.8 : 0.6
  return {
    method: `Linear run-rate of the last ${window} days, extended to the day before the event`,
    window, regPerDay: regs / window, identPerDay: ids / window, daysLeft,
    projectedRegistrations, projectedIdentified, projectedVisitors: projectedRegistrations * showRateUsed,
    showRateUsed,
    showRateSource: 'Assumption: confirmed share as of date × 80% show-up (no pre-event attendance evidence exists)',
  }
}

// ---------------------------------------------------------------- funnel

export interface FunnelStage {
  key: string
  label: string
  value: number
  kind: 'anonymous' | 'person'
  definition: string
  fromPrev?: number
}

export function funnel(m: Model, s: Scope): { anonymous: FunnelStage[]; people: FunnelStage[]; walkIns: number; note: string } {
  const E = s.end
  const rng = spendBetween(m, s, s.start, E)
  const cohort = scoped(m, s).filter((p) => p.firstSeen >= s.start && p.firstSeen <= E)
  const campaignCohort = cohort.filter((p) => p.campaignId !== UNATTRIBUTED)
  const engaged = campaignCohort.filter((p) => Object.entries(p.firstAt).some(([, t]) => t <= E)).length
  const started = campaignCohort.filter((p) => (p.firstAt['registration_start'] ?? Infinity) <= E).length
  const reg = campaignCohort.filter((p) => registeredBy(p, E))
  const conf = reg.filter((p) => statusAt(p.reg!, E) === 'confirmed').length
  const att = reg.filter((p) => attendedBy(p, E)).length
  const walkIns = cohort.filter((p) => p.campaignId === UNATTRIBUTED && attendedBy(p, E)).length
  const anonymous: FunnelStage[] = [
    { key: 'impressions', label: 'Impressions', value: rng.impressions, kind: 'anonymous', definition: 'Anonymous platform impression events in range. Not people.' },
    { key: 'clicks', label: 'Clicks', value: rng.clicks, kind: 'anonymous', definition: 'Anonymous click events in range. Not people, not registrations.' },
    { key: 'sessions', label: 'Landing-page sessions', value: rng.sessions, kind: 'anonymous', definition: 'Anonymous sessions incl. repeat and unidentified traffic.' },
    { key: 'regStarts', label: 'Form starts (anon.)', value: rng.regStarts, kind: 'anonymous', definition: 'Anonymous registration-form start events.' },
  ]
  const people: FunnelStage[] = [
    { key: 'identified', label: 'Identified (campaign)', value: campaignCohort.length, kind: 'person', definition: 'Distinct external people first identified in range via a campaign.' },
    { key: 'engaged', label: 'Engaged', value: engaged, kind: 'person', definition: 'Of those, people with ≥1 identified interaction (page visit, download, email, question…) by range end.' },
    { key: 'started', label: 'Started registration', value: started, kind: 'person', definition: 'People with an identified registration_start interaction by range end.' },
    { key: 'registered', label: 'Registered', value: reg.length, kind: 'person', definition: 'Distinct people with a registration created by range end.' },
    { key: 'confirmed', label: 'Confirmed', value: conf, kind: 'person', definition: 'Registrations whose latest status at range end is "confirmed".' },
    { key: 'attended', label: 'Verified attendee', value: att, kind: 'person', definition: 'Registered people with ≥1 admitted + verified check-in by range end.' },
  ]
  for (let i = 1; i < anonymous.length; i++) anonymous[i].fromPrev = safeDiv(anonymous[i].value, anonymous[i - 1].value)
  for (let i = 1; i < people.length; i++) people[i].fromPrev = safeDiv(people[i].value, people[i - 1].value)
  return {
    anonymous, people, walkIns,
    note: 'Cohort = external people first identified in the selected range; outcomes measured as of range end. Anonymous platform counts are shown separately because they cannot be de-duplicated into people.',
  }
}

// ---------------------------------------------------------------- campaigns

export interface CampaignPerf {
  id: string
  name: string
  channel: string
  owner: string
  spend: number
  impressions: number
  clicks: number
  sessions: number
  anonRegStarts: number
  identified: number
  engaged: number
  identifiedStarts: number
  registrations: number
  confirmed: number
  cancelled: number
  waitlisted: number
  interested: number
  attendees: number
  confirmedAttendees: number
  optedOut: number
  ctr: number
  regRate: number // registrations / identified
  showRate: number // attendees / registrations
  confirmedShowRate: number
  identToAttend: number
  cancelRate: number
  cpi: number
  cpr: number
  cpa: number // spend / verified attendees
  attendanceShare: number
  spendShare: number
  quadrant: Quadrant
}

export type Quadrant = 'Scale: high volume, high conversion' | 'Fix: high volume, low conversion' | 'Grow: low volume, high quality' | 'Pause or redesign: low volume, low conversion' | 'Not classified'

export function campaignPerformance(m: Model, s: Scope): { rows: CampaignPerf[]; portfolio: { avgRegistrations: number; showRate: number; cpa: number }; walkIns: number } {
  const E = s.end
  const ids = [...m.campaigns.map((c) => c.id)].filter((id) => inScope(s, id))
  const rows: CampaignPerf[] = ids.map((id) => {
    const sc: Scope = { ...s, campaignIds: [id] }
    const act = spendBetween(m, sc, s.start, E)
    const cohort = m.external.filter((p) => p.campaignId === id && p.firstSeen >= s.start && p.firstSeen <= E)
    const reg = cohort.filter((p) => registeredBy(p, E))
    const st = reg.map((p) => statusAt(p.reg!, E))
    const att = reg.filter((p) => attendedBy(p, E))
    const confAtt = reg.filter((p) => attendedBy(p, E) && statusAt(p.reg!, E) === 'confirmed').length
    const confirmed = st.filter((x) => x === 'confirmed').length
    const c = m.campaignById.get(id)!
    return {
      id, name: c.name, channel: c.channel, owner: c.ownerName,
      spend: act.spend, impressions: act.impressions, clicks: act.clicks, sessions: act.sessions, anonRegStarts: act.regStarts,
      identified: cohort.length,
      engaged: cohort.filter((p) => Object.values(p.firstAt).some((t) => t <= E)).length,
      identifiedStarts: cohort.filter((p) => (p.firstAt['registration_start'] ?? Infinity) <= E).length,
      registrations: reg.length, confirmed, cancelled: st.filter((x) => x === 'cancelled').length,
      waitlisted: st.filter((x) => x === 'waitlisted').length, interested: st.filter((x) => x === 'interested').length,
      attendees: att.length, confirmedAttendees: confAtt,
      optedOut: cohort.filter((p) => (p.firstAt['opted_out'] ?? Infinity) <= E).length,
      ctr: safeDiv(act.clicks, act.impressions), regRate: safeDiv(reg.length, cohort.length),
      showRate: E >= m.raw.event.startsAt ? safeDiv(att.length, reg.length) : NaN,
      confirmedShowRate: E >= m.raw.event.startsAt ? safeDiv(confAtt, confirmed) : NaN,
      identToAttend: safeDiv(att.length, cohort.length), cancelRate: safeDiv(st.filter((x) => x === 'cancelled').length, reg.length),
      cpi: safeDiv(act.spend, cohort.length), cpr: safeDiv(act.spend, reg.length), cpa: safeDiv(act.spend, att.length),
      attendanceShare: 0, spendShare: 0, quadrant: 'Not classified' as Quadrant,
    }
  })
  const totAtt = rows.reduce((a, r) => a + r.attendees, 0)
  const totSpend = rows.reduce((a, r) => a + r.spend, 0)
  const totReg = rows.reduce((a, r) => a + r.registrations, 0)
  const avgRegistrations = rows.length ? totReg / rows.length : NaN
  const showRate = E >= m.raw.event.startsAt ? safeDiv(totAtt, totReg) : NaN
  for (const r of rows) {
    r.attendanceShare = safeDiv(r.attendees, totAtt)
    r.spendShare = safeDiv(r.spend, totSpend)
    if (!Number.isFinite(r.showRate) || rows.length < 2) { r.quadrant = 'Not classified'; continue }
    const hiVol = r.registrations >= avgRegistrations
    const hiQ = r.showRate >= showRate
    r.quadrant = hiVol && hiQ ? 'Scale: high volume, high conversion' : hiVol ? 'Fix: high volume, low conversion' : hiQ ? 'Grow: low volume, high quality' : 'Pause or redesign: low volume, low conversion'
  }
  const walkIns = inScope(s, UNATTRIBUTED) ? m.external.filter((p) => p.campaignId === UNATTRIBUTED && p.firstSeen >= s.start && attendedBy(p, E)).length : 0
  return { rows, portfolio: { avgRegistrations, showRate, cpa: safeDiv(totSpend, totAtt) }, walkIns }
}

export function channelPerformance(m: Model, s: Scope) {
  const { rows, walkIns } = campaignPerformance(m, s)
  const byCh = new Map<string, { channel: string; spend: number; identified: number; registrations: number; attendees: number; campaigns: string[] }>()
  for (const r of rows) {
    const c = byCh.get(r.channel) ?? { channel: r.channel, spend: 0, identified: 0, registrations: 0, attendees: 0, campaigns: [] }
    c.spend += r.spend; c.identified += r.identified; c.registrations += r.registrations; c.attendees += r.attendees; c.campaigns.push(r.name)
    byCh.set(r.channel, c)
  }
  const out = [...byCh.values()].map((c) => ({ ...c, showRate: safeDiv(c.attendees, c.registrations), cpa: safeDiv(c.spend, c.attendees), regRate: safeDiv(c.registrations, c.identified) }))
  if (walkIns) out.push({ channel: 'walk_in', spend: 0, identified: walkIns, registrations: 0, attendees: walkIns, campaigns: ['Walk-in / unattributed'], showRate: NaN, cpa: NaN, regRate: NaN })
  return out.sort((a, b) => b.attendees - a.attendees)
}

// ---------------------------------------------------------------- daily trend

export interface DayPoint {
  day: number
  identified: number
  registrations: number
  spend: number
  cumIdentified: number
  cumRegistrations: number
  cumSpend: number
  cumVisitors: number
  registrationGoal: number
  identifiedGoal: number
  cancellations: number
  confirmations: number
}

export function dailyTrend(m: Model, s: Scope): DayPoint[] {
  const days = listDays(s.start, s.end)
  const ppl = scoped(m, s)
  const idx = (t: number) => Math.floor((startOfDay(t) - startOfDay(s.start)) / DAY)
  const n = days.length
  const ident = new Array(n).fill(0), regs = new Array(n).fill(0), spend = new Array(n).fill(0), vis = new Array(n).fill(0), canc = new Array(n).fill(0), conf = new Array(n).fill(0)
  let baseIdent = 0, baseReg = 0, baseSpend = 0, baseVis = 0
  for (const p of ppl) {
    const i = idx(p.firstSeen); if (p.firstSeen < s.start) baseIdent++; else if (i < n) ident[i]++
    if (p.reg) {
      const j = idx(p.reg.at); if (p.reg.at < s.start) baseReg++; else if (j < n) regs[j]++
      for (const h of p.reg.history) {
        const k = idx(h.at)
        if (h.at >= s.start && k < n) { if (h.status === 'cancelled') canc[k]++; if (h.status === 'confirmed') conf[k]++ }
      }
    }
    if (p.firstVerifiedAdmit != null) { const k = idx(p.firstVerifiedAdmit); if (p.firstVerifiedAdmit < s.start) baseVis++; else if (k < n) vis[k]++ }
  }
  for (const [cid, dd] of m.dailyByCampaign) {
    if (!inScope(s, cid)) continue
    for (const [day, v] of dd) { if (day < s.start) baseSpend += v.spend; else { const i = idx(day); if (i < n) spend[i] += v.spend } }
  }
  let ci = baseIdent, cr = baseReg, cs = baseSpend, cv = baseVis
  return days.map((d, i) => {
    ci += ident[i]; cr += regs[i]; cs += spend[i]; cv += vis[i]
    const t = targetAt(m, endOfDay(d))
    const active = targetIsActive(m, endOfDay(d))
    return {
      day: d, identified: ident[i], registrations: regs[i], spend: spend[i], cumIdentified: ci, cumRegistrations: cr, cumSpend: cs, cumVisitors: cv,
      registrationGoal: active ? t.registrationGoal : NaN, identifiedGoal: active ? t.identifiedGoal : NaN, cancellations: canc[i], confirmations: conf[i],
    }
  })
}

// ---------------------------------------------------------------- segments

export interface SegmentRow {
  segment: string
  group: string
  people: number
  registered: number
  attended: number
  regRate: number
  showRate: number // attended / registered
  note?: string
}

const SIGNAL_LABEL: Record<string, string> = {
  brochure_download: 'Downloaded brochure', event_question_submitted: 'Asked an event question', nurture_email_opened: 'Opened nurture email',
  nurture_email_clicked: 'Clicked nurture email', nurture_email_sent: 'Received nurture email', opted_out: 'Opted out of contact',
  page_visit: 'Visited info page', registration_start: 'Started registration form',
}
export const signalLabel = (k: string) => SIGNAL_LABEL[k] ?? k

/** Engagement behaviour segments: people with vs without each identified action (campaign-sourced people). */
export function engagementSegments(m: Model, s: Scope): SegmentRow[] {
  const E = s.end
  const ppl = scoped(m, s).filter((p) => p.campaignId !== UNATTRIBUTED && p.firstSeen >= s.start && p.firstSeen <= E)
  const out: SegmentRow[] = []
  for (const t of ['brochure_download', 'event_question_submitted', 'nurture_email_clicked', 'nurture_email_opened', 'nurture_email_sent', 'opted_out']) {
    for (const has of [true, false]) {
      const g = ppl.filter((p) => ((p.firstAt[t] ?? Infinity) <= E) === has)
      const reg = g.filter((p) => registeredBy(p, E))
      const att = reg.filter((p) => attendedBy(p, E))
      out.push({ segment: signalLabel(t), group: has ? 'Yes' : 'No', people: g.length, registered: reg.length, attended: att.length, regRate: safeDiv(reg.length, g.length), showRate: E >= m.raw.event.startsAt ? safeDiv(att.length, reg.length) : NaN })
    }
  }
  return out
}

export const TIMING_BUCKETS = [
  { label: '>60 days before', min: 61, max: 9999 },
  { label: '31–60 days', min: 31, max: 60 },
  { label: '15–30 days', min: 15, max: 30 },
  { label: '8–14 days', min: 8, max: 14 },
  { label: '0–7 days', min: 0, max: 7 },
]

export function timingSegments(m: Model, s: Scope) {
  const E = s.end
  const ev = startOfDay(m.raw.event.startsAt)
  const reg = scoped(m, s).filter((p) => p.reg && p.reg.at >= s.start && p.reg.at <= E)
  return TIMING_BUCKETS.map((b) => {
    const g = reg.filter((p) => { const d = Math.round((ev - startOfDay(p.reg!.at)) / DAY); return d >= b.min && d <= b.max })
    const att = g.filter((p) => attendedBy(p, E)).length
    const canc = g.filter((p) => statusAt(p.reg!, E) === 'cancelled').length
    const conf = g.filter((p) => statusAt(p.reg!, E) === 'confirmed').length
    return { bucket: b.label, registrations: g.length, attended: att, showRate: E >= m.raw.event.startsAt ? safeDiv(att, g.length) : NaN, cancelRate: safeDiv(canc, g.length), confirmedShare: safeDiv(conf, g.length) }
  })
}

export function statusDistribution(m: Model, s: Scope) {
  const E = s.end
  const reg = scoped(m, s).filter((p) => p.reg && p.reg.at <= E)
  const statuses = ['confirmed', 'cancelled', 'waitlisted', 'interested'] as const
  return statuses.map((st) => {
    const g = reg.filter((p) => statusAt(p.reg!, E) === st)
    const att = g.filter((p) => attendedBy(p, E)).length
    return { status: st, registrations: g.length, attended: att, noShow: g.length - att, showRate: E >= m.raw.event.startsAt ? safeDiv(att, g.length) : NaN }
  })
}

export function attendanceQuality(m: Model, s: Scope) {
  const E = s.end
  const att = scoped(m, s).filter((p) => attendedBy(p, E))
  const regd = att.filter((p) => p.reg)
  const confirmedNoShow = scoped(m, s).filter((p) => p.reg && p.reg.at <= E && statusAt(p.reg, E) === 'confirmed' && !attendedBy(p, E))
  const gateLost = scoped(m, s).filter((p) => p.gateIssueAt != null && p.gateIssueAt <= E && !attendedBy(p, E))
  const gateRecovered = scoped(m, s).filter((p) => p.gateIssueAt != null && p.gateIssueAt <= E && attendedBy(p, E))
  const day1 = startOfDay(m.raw.event.startsAt)
  return {
    visitors: att.length,
    registered: regd.length,
    walkIns: att.length - regd.length,
    twoDay: att.filter((p) => p.admitDays >= 2).length,
    oneDay: att.filter((p) => p.admitDays === 1).length,
    firstDay1: att.filter((p) => startOfDay(p.firstVerifiedAdmit!) === day1).length,
    manualOnly: att.filter((p) => p.manualOnly).length,
    avgAdmitEvents: safeDiv(att.reduce((a, p) => a + p.admitEvents, 0), att.length),
    confirmedNoShow: confirmedNoShow.length,
    gateLost: gateLost.length,
    gateRecovered: gateRecovered.length,
    everCancelledAttended: att.filter((p) => p.reg?.history.some((h) => h.status === 'cancelled')).length,
  }
}

/** People who are recoverable at scope.end: identified form-starters without registration, waitlisted, stuck "interested". */
export function recoveryPools(m: Model, s: Scope) {
  const E = s.end
  const ppl = scoped(m, s).filter((p) => p.firstSeen <= E)
  const abandon = ppl.filter((p) => !registeredBy(p, E) && (p.firstAt['registration_start'] ?? Infinity) <= E)
  const abandonOptOut = abandon.filter((p) => (p.firstAt['opted_out'] ?? Infinity) <= E).length
  const leadsNoStart = ppl.filter((p) => p.campaignId !== UNATTRIBUTED && !registeredBy(p, E) && !((p.firstAt['registration_start'] ?? Infinity) <= E))
  const wait = ppl.filter((p) => registeredBy(p, E) && statusAt(p.reg!, E) === 'waitlisted')
  const stuck = ppl.filter((p) => registeredBy(p, E) && statusAt(p.reg!, E) === 'interested')
  const canc = ppl.filter((p) => registeredBy(p, E) && statusAt(p.reg!, E) === 'cancelled')
  const byCampaign = (arr: PersonFact[]) => {
    const o: Record<string, number> = {}
    for (const p of arr) o[p.campaignId] = (o[p.campaignId] ?? 0) + 1
    return o
  }
  return {
    formAbandoners: abandon.length, formAbandonersContactable: abandon.length - abandonOptOut, formAbandonOptOut: abandonOptOut,
    leadsNoStart: leadsNoStart.length, waitlisted: wait.length, stuckInterested: stuck.length, cancelled: canc.length,
    abandonByCampaign: byCampaign(abandon), waitByCampaign: byCampaign(wait),
  }
}

export function labelFor(m: Model, id: string) {
  return { name: campaignLabel(m, id), channel: channelOf(m, id) }
}
