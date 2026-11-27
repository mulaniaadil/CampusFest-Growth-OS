// Local Growth Analyst. Every number in a response is produced by a function in
// src/analytics — the engine only routes the question, picks the analysis, and
// formats evidence. It never generates numbers by itself.

import { fmtINR, fmtInt, fmtPct, safeDiv } from '../lib/format'
import { DAY, endOfDay, fmtDay, fmtRange, parseDayKey, startOfDay } from '../lib/time'
import { campaignLabel, UNATTRIBUTED, type Model } from '../analytics/model'
import {
  attendanceQuality, campaignPerformance, channelPerformance, dailyTrend, engagementSegments, funnel,
  recoveryPools, snapshot, statusDistribution, timingSegments, type CampaignPerf, type Scope,
} from '../analytics/metrics'
import { bottleneck, deprioritized, opportunities, PRIORITY_FORMULA } from '../analytics/opportunities'
import { audienceSegments } from '../analytics/segments'
import type { CampaignStatus, LocalCampaign, Task, WorkspaceState } from '../store/workspace'

export type Confidence = 'High' | 'Medium' | 'Low'

export type AnalystAction =
  | { kind: 'create_campaign'; label: string; draft: Partial<LocalCampaign> }
  | { kind: 'create_task'; label: string; task: Omit<Task, 'id' | 'createdAt'> }
  | { kind: 'open_campaign'; label: string; campaignId: string }
  | { kind: 'set_status'; label: string; campaignId: string; isSource: boolean; status: CampaignStatus; name: string }

export interface AnalystResponse {
  intent: string
  title: string
  summary: string
  facts: { label: string; value: string; note?: string }[]
  table?: { columns: string[]; rows: (string | number)[][] }
  observed: string[]
  hypotheses: string[]
  limits: string[]
  metrics: string[]
  dateRange: string
  confidence: Confidence
  actions: AnalystAction[]
  followUps: string[]
  focusCampaigns?: string[]
}

export interface AnalystContext {
  lastIntent?: string
  campaignIds?: string[]
  lastTopic?: string
  lastResponse?: AnalystResponse
}

export const SUGGESTED_QUESTIONS = [
  'Why are we missing our registration target?',
  'Which campaign should receive more budget?',
  'Which channel produces the most verified attendees?',
  'Where are we losing people in the acquisition funnel?',
  'What should we do in the next seven days?',
  'What is our cost per verified attendee?',
  'Which campaign should we pause or redesign?',
]

// ---------------------------------------------------------------- parsing helpers

const CAMPAIGN_ALIASES: [RegExp, string][] = [
  [/\b(c0?1|campus ambassadors?|ambassadors?)\b/, 'C01'],
  [/\b(c0?2|paid social|paid[_ ]?ads?|social ads?|paid)\b/, 'C02'],
  [/\b(c0?3|creator partners?|creators?|influencers?)\b/, 'C03'],
  [/\b(c0?4|college partnerships?|college partners?|colleges? clubs?|college)\b/, 'C04'],
  [/\b(c0?5|student referrals?|referrals?|referred)\b/, 'C05'],
  [/\b(c0?6|organic search|organic|seo|search)\b/, 'C06'],
  [/\b(c0?7|community groups?|community|communities)\b/, 'C07'],
  [/\b(walk[- ]?ins?|unattributed)\b/, UNATTRIBUTED],
]

function findCampaigns(m: Model, q: string): string[] {
  const out: string[] = []
  for (const [re, id] of CAMPAIGN_ALIASES) if (re.test(q) && (id === UNATTRIBUTED || m.campaignById.has(id))) out.push(id)
  // workbook may have been replaced: also match names directly
  for (const c of m.campaigns) if (q.includes(c.name.toLowerCase()) && !out.includes(c.id)) out.push(c.id)
  return out
}

function findLocalCampaigns(ws: WorkspaceState, q: string) {
  return ws.campaigns.filter((c) => c.name.length > 2 && q.includes(c.name.toLowerCase()))
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Extracts an explicit date or month from the question. Returns a scope override or null. */
function parseDates(m: Model, q: string, base: Scope): { scope: Scope; label: string } | null {
  const year = new Date(m.raw.event.startsAt).getUTCFullYear()
  const iso = q.match(/(\d{4})-(\d{2})-(\d{2})/)
  const dm = q.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ?? null
  const md = q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/) ?? null
  let day: number | null = null
  if (iso) day = parseDayKey(iso[0])
  else if (dm) day = Date.UTC(year, MONTHS.indexOf(dm[2]), +dm[1])
  else if (md) day = Date.UTC(year, MONTHS.indexOf(md[1]), +md[2])
  if (day != null && Number.isFinite(day)) {
    const end = endOfDay(day)
    const clamped = Math.min(Math.max(end, m.dayRange.start + DAY - 1), m.dayRange.end)
    return { scope: { ...base, start: m.dayRange.start, end: clamped }, label: `as of ${fmtDay(clamped, true)}` }
  }
  const mon = q.match(/\b(?:in|during|for|of)\s+(january|february|march|april|jan|feb|mar|apr)\b/)
  if (mon) {
    const mi = MONTHS.indexOf(mon[1].slice(0, 3))
    const start = Math.max(Date.UTC(year, mi, 1), m.dayRange.start)
    const end = Math.min(endOfDay(Date.UTC(year, mi + 1, 1) - DAY), m.dayRange.end)
    if (start < end) return { scope: { ...base, start, end }, label: `${fmtRange(start, end)} (month)` }
  }
  if (/before the (event|fest)/.test(q)) {
    const end = endOfDay(startOfDay(m.raw.event.startsAt) - DAY)
    return { scope: { ...base, start: m.dayRange.start, end }, label: `as of ${fmtDay(end, true)} (day before the event)` }
  }
  if (/\b(last|past) (week|7 days|seven days)\b/.test(q)) {
    return { scope: { ...base, start: Math.max(m.dayRange.start, startOfDay(base.end) - 6 * DAY), end: base.end }, label: `last 7 days to ${fmtDay(base.end, true)}` }
  }
  return null
}


const UNSUPPORTED: { re: RegExp; topic: string; instead: string }[] = [
  { re: /\b(age|ages|gender|male|female|demograph|income|caste|religion|year of study|first[- ]year|major|department|course)\b/, topic: 'demographic attributes (age, gender, year of study, income…)', instead: 'Segments available: first-touch campaign/channel, engagement behaviour, registration status, registration timing, attendance outcome.' },
  { re: /\b(which college|college names?|universit(y|ies)|institution)\b/, topic: 'college or institution names', instead: 'The workbook has a College Partnerships campaign but no per-person college field.' },
  { re: /\b(city|cities|location|pin ?code|distance|travel|area|neighbou?rhood)\b/, topic: 'location / city of attendees', instead: 'No geography field exists; the event and people are fictional.' },
  { re: /\b(ticket price|revenue|profit|sales|ticket sales|paid tickets?|ltv|lifetime value)\b/, topic: 'ticket revenue or pricing', instead: 'The workbook covers marketing spend only; no ticket price or revenue is recorded.' },
  { re: /\b(sponsor|sponsorship)\b/, topic: 'sponsorship (Challenge B data)', instead: 'This product uses the attendee-growth dataset only.' },
  { re: /\b(satisfaction|nps|rating|feedback|sentiment|enjoy|liked)\b/, topic: 'attendee satisfaction or sentiment', instead: 'No survey or feedback data exists. Two-day attendance and re-entry are the only behavioural quality proxies.' },
  { re: /\b(weather|rain|traffic|competitor|other fests?)\b/, topic: 'external factors (weather, competitors)', instead: 'No external data is included.' },
  { re: /\b(capacity|venue size|max(imum)? attendees|seats? available)\b/, topic: 'venue capacity', instead: 'Capacity is not in the workbook. The waitlist (status "waitlisted") is the only capacity signal.' },
  { re: /\b(why did (they|people) (not|n't) (attend|come)|reason for (no[- ]?show|cancel))/, topic: 'reasons people did not attend or cancelled', instead: 'Reasons are not recorded. The data shows who did not attend, by campaign, status, timing and engagement — not why.' },
  { re: /\b(2024|2026|last year|next year|previous edition)\b/, topic: 'other editions of the festival', instead: 'Only CampusFest 2025 (15 Jan – 20 Apr 2025) is in the workbook.' },
  { re: /\b(email open rate by subject|subject line|creative|ad copy|which post|which reel)\b/, topic: 'creative-level performance', instead: 'Data is at campaign/day level; there is no creative or post identifier.' },
]

// ---------------------------------------------------------------- response builders

const pct = (v: number) => fmtPct(v)
const base = (scope: Scope, m: Model): Pick<AnalystResponse, 'dateRange' | 'observed' | 'hypotheses' | 'limits' | 'actions' | 'followUps' | 'facts'> => ({
  dateRange: scope.start <= m.dayRange.start ? `Cumulative to ${fmtDay(scope.end, true)} (IST end of day)` : fmtRange(scope.start, scope.end),
  observed: [], hypotheses: [], limits: [], actions: [], followUps: [], facts: [],
})

function perfRow(r: CampaignPerf) {
  return [r.name, fmtINR(r.spend), fmtInt(r.registrations), fmtInt(r.attendees), pct(r.showRate), fmtINR(r.cpa)]
}
const PERF_COLS = ['Campaign', 'Spend', 'Registrations', 'Verified attendees', 'Reg → attend', 'Cost / attendee']

function taskAction(title: string, owner: string, dueDays: number, scope: Scope, extra: Partial<Task> = {}): AnalystAction {
  const due = new Date(Math.max(Date.now(), scope.end) + dueDays * DAY).toISOString().slice(0, 10)
  return { kind: 'create_task', label: `Create task: ${title}`, task: { title, owner, due, status: 'todo', origin: 'analyst', ...extra } }
}

function ownerOf(m: Model, id: string) {
  return m.campaignById.get(id)?.ownerName ?? 'Growth lead'
}

function targetStatus(m: Model, scope: Scope, ws: WorkspaceState): AnalystResponse {
  const s = snapshot(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const r: AnalystResponse = { ...b, intent: 'target', title: 'Target attainment', summary: '', metrics: ['Identified external people', 'Unique external registrations', 'Verified unique external visitors', 'Net marketing spend'], confidence: 'High' }
  if (!s.targetActive) { r.summary = 'No target version was effective on this date.'; return r }
  r.facts = [
    { label: 'Target version', value: s.target.version, note: `effective ${fmtDay(s.target.effectiveAt, true)}` },
    { label: 'Identified external people', value: `${fmtInt(s.identified)} / ${fmtInt(s.target.identifiedGoal)}`, note: pct(s.attainment.identified) },
    { label: 'Registrations', value: `${fmtInt(s.registrations)} / ${fmtInt(s.target.registrationGoal)}`, note: pct(s.attainment.registrations) },
    { label: 'Verified visitors', value: `${fmtInt(s.visitors)} / ${fmtInt(s.target.visitorsGoal)}`, note: s.eventStarted ? pct(s.attainment.visitors) : 'event not started' },
    { label: 'Spend vs budget', value: `${fmtINR(s.spend)} / ${fmtINR(s.target.budget)}`, note: pct(s.attainment.budget) },
  ]
  const regGap = s.gap.registrations
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const pools = recoveryPools(m, { ...scope, campaignIds: null })
  if (s.projection) {
    const p = s.projection
    r.summary = `As of ${fmtDay(scope.end, true)} we have ${fmtInt(s.registrations)} registrations (${pct(s.attainment.registrations)} of ${fmtInt(s.target.registrationGoal)}). At the last-14-day pace of ${p.regPerDay.toFixed(1)}/day we would reach about ${fmtInt(p.projectedRegistrations)} by the event — ${p.projectedRegistrations >= s.target.registrationGoal ? 'on track' : `about ${fmtInt(s.target.registrationGoal - p.projectedRegistrations)} short`}.`
    r.hypotheses.push(`Projection is a linear run-rate (${p.method.toLowerCase()}); it is a model, not an observed result.`)
  } else {
    r.summary = `Registrations finished at ${fmtInt(s.registrations)} against the ${s.target.version.toLowerCase()} goal of ${fmtInt(s.target.registrationGoal)} — ${regGap > 0 ? `${fmtInt(regGap)} short (${pct(s.attainment.registrations)})` : 'target met'}. Verified visitors reached ${fmtInt(s.visitors)} of ${fmtInt(s.target.visitorsGoal)}.`
  }
  // why: diagnose registration gap
  const firstT = m.raw.targets[0]
  if (m.raw.targets.length > 1 && s.target !== firstT) {
    r.observed.push(`The goal was raised from ${fmtInt(firstT.registrationGoal)} (${firstT.version}) to ${fmtInt(s.target.registrationGoal)} on ${fmtDay(s.target.effectiveAt, true)}. Against the original goal attainment would be ${pct(safeDiv(s.registrations, firstT.registrationGoal))}.`)
  }
  r.observed.push(`${fmtInt(pools.formAbandoners)} identified people started the registration form but never registered (${fmtInt(pools.formAbandonOptOut)} of them later opted out); ${fmtInt(pools.leadsNoStart)} more identified leads never started it.`)
  const fix = perf.rows.filter((x) => x.quadrant.startsWith('Fix') || x.quadrant.startsWith('Pause'))
  for (const x of fix) r.observed.push(`${x.name}: ${pct(x.regRate)} of identified people registered vs ${pct(safeDiv(perf.rows.reduce((a, y) => a + y.registrations, 0), perf.rows.reduce((a, y) => a + y.identified, 0)))} across campaigns.`)
  const preEventIdent = snapshot(m, { ...scope, campaignIds: null, end: Math.min(scope.end, endOfDay(startOfDay(m.raw.event.startsAt) - DAY)) }).identified
  if (s.eventStarted && s.identified > preEventIdent) r.observed.push(`Identified-people attainment includes ${fmtInt(s.identified - preEventIdent)} walk-ins identified at the gate; before the event it was ${fmtInt(preEventIdent)} (${pct(safeDiv(preEventIdent, s.target.identifiedGoal))}).`)
  r.hypotheses.push('Low form completion in Paid Social / Creator cohorts suggests low-intent traffic rather than a broken form (other cohorts complete at higher rates). Not proven — no form-step data.')
  r.limits.push('The workbook has no form-step or error data, so form friction cannot be separated from intent.')
  r.actions.push({ kind: 'create_campaign', label: 'Draft a registration-recovery campaign', draft: { name: 'Registration recovery — form abandoners', channel: 'email_whatsapp', audienceSegment: 'form_abandoners', objective: 'Complete registrations from identified form-starters who have not opted out', budget: 2000, targetMetric: 'registrations', targetValue: Math.max(1, Math.round(pools.formAbandonersContactable * 0.2)), linkedOpportunity: 'O3' } })
  r.followUps = ['Which campaign should receive more budget?', 'Where are we losing people in the acquisition funnel?', 'What should we do in the next seven days?']
  void ws
  return r
}

function funnelAnswer(m: Model, scope: Scope): AnalystResponse {
  const f = funnel(m, scope)
  const bn = bottleneck(m, scope)
  const b = base(scope, m)
  const stages = f.people
  const drops = stages.slice(1).map((st, i) => ({ from: stages[i].label, to: st.label, lost: stages[i].value - st.value, rate: st.fromPrev ?? NaN }))
  const worst = [...drops].sort((a, c) => c.lost - a.lost)[0]
  return {
    ...b, intent: 'funnel', title: 'Where people drop off', confidence: 'High',
    summary: `${bn.headline} The single largest step loss is ${worst.from} → ${worst.to} (${fmtInt(worst.lost)} people, ${pct(1 - worst.rate)} of that stage).`,
    facts: [
      { label: 'Lost before registering', value: fmtInt(bn.preRegistrationLost) },
      { label: 'Lost after registering', value: fmtInt(bn.postRegistrationLost) },
      ...bn.breakdown.map((x) => ({ label: x.label, value: fmtInt(x.value) })),
      { label: 'Walk-in verified visitors (no campaign)', value: fmtInt(f.walkIns) },
    ],
    table: { columns: ['Stage', 'People', 'From previous'], rows: stages.map((s) => [s.label, fmtInt(s.value), s.fromPrev == null ? '—' : pct(s.fromPrev)]) },
    observed: [f.note, `Anonymous activity in range: ${fmtInt(f.anonymous[0].value)} impressions → ${fmtInt(f.anonymous[1].value)} clicks → ${fmtInt(f.anonymous[2].value)} sessions. These are events, not people, so they are not joined to the person funnel.`],
    hypotheses: ['The post-registration loss is the cheapest to recover: these people are already identified, contactable and have said yes once.'],
    limits: ['No unique-person awareness count exists; reach is platform-reported per day and cannot be summed into unique people.'],
    metrics: stages.map((s) => s.label),
    actions: [{ kind: 'create_campaign', label: 'Draft an attendance-activation campaign', draft: { name: 'Attendance activation — confirmed registrants', channel: 'email_whatsapp', audienceSegment: 'confirmed_registrants', objective: 'Raise confirmed → verified attendance with D-7 / D-1 / D-0 reminders and QR pass', budget: 10000, targetMetric: 'confirmed_show_rate', targetValue: 85, linkedOpportunity: 'O1' } }],
    followUps: ['Which campaigns have the most no-shows?', 'How many people are on the waitlist?', 'What should we do in the next seven days?'],
  }
}

function budgetAnswer(m: Model, scope: Scope, ws: WorkspaceState): AnalystResponse {
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const s = snapshot(m, { ...scope, campaignIds: null })
  const cands = perf.rows.filter((r) => Number.isFinite(r.cpa) && (r.quadrant.startsWith('Grow') || r.quadrant.startsWith('Scale'))).sort((a, c) => a.cpa - c.cpa)
  const top = cands[0]
  const paused = Object.entries(ws.overlays).filter(([, o]) => o.status === 'paused' || o.status === 'archived').map(([id]) => id)
  const r: AnalystResponse = {
    ...b, intent: 'budget', title: 'Where additional budget should go', confidence: 'Medium', metrics: ['Cost per verified attendee', 'Registration → attendance rate', 'Registrations (volume)'],
    summary: top ? `${top.name} is the strongest candidate: ${fmtINR(top.cpa)} per verified attendee (portfolio ${fmtINR(perf.portfolio.cpa)}) and ${pct(top.showRate)} of its registrants attended. ${cands[1] ? `${cands[1].name} (${fmtINR(cands[1].cpa)}) and ${cands[2]?.name ?? ''}${cands[2] ? ` (${fmtINR(cands[2].cpa)})` : ''} follow.` : ''}` : 'Attendance data is not available yet for this date, so budget cannot be ranked on cost per verified attendee.',
    table: { columns: [...PERF_COLS, 'Quadrant'], rows: [...perf.rows].sort((a, c) => a.cpa - c.cpa).map((x) => [...perfRow(x), x.quadrant.split(':')[0]]) },
  }
  if (!top) return r
  r.observed.push(`Ranking uses cost per verified attendee, but only among campaigns that are also above-average on show rate or volume (quadrant), so a cheap-but-tiny campaign is not over-rewarded.`)
  r.observed.push(`Remaining approved budget: ${fmtINR(Math.max(0, s.gap.budgetRemaining))} (${s.target.version}).`)
  r.hypotheses.push(`Average cost is not marginal cost. Scaling ${top.name} will likely cost more per attendee than ${fmtINR(top.cpa)}; the opportunity model assumes 1.5–3× the average.`)
  r.limits.push('No spend-response curve exists in the data (one spend level per campaign), so the saturation point cannot be estimated — scale in stages.')
  if (paused.length) r.observed.push(`Plan status in this app: ${paused.map((id) => campaignLabel(m, id)).join(', ')} marked paused/archived.`)
  r.actions.push({ kind: 'open_campaign', label: `Open ${top.name}`, campaignId: top.id })
  r.actions.push({ kind: 'create_campaign', label: `Draft a scale-up test for ${top.name}`, draft: { name: `${top.name} — staged scale-up`, channel: top.channel, audienceSegment: 'new_audience', basedOn: top.id, objective: `Test whether +₹ spend keeps cost per verified attendee ≤ 2× ${fmtINR(top.cpa)}`, budget: Math.min(10000, Math.max(2000, Math.round(Math.max(0, s.gap.budgetRemaining) / 2 / 1000) * 1000)), targetMetric: 'cost_per_attendee', targetValue: Math.round(top.cpa * 2), owner: top.owner, linkedOpportunity: 'O2' } })
  r.followUps = [`What if we move ₹20,000 from ${perf.rows.find((x) => x.quadrant.startsWith('Pause'))?.name ?? 'Paid Social'} to ${top.name}?`, 'Which campaign should we pause or redesign?', `Tell me about ${top.name}`]
  r.focusCampaigns = cands.slice(0, 3).map((x) => x.id)
  return r
}

function pauseAnswer(m: Model, scope: Scope): AnalystResponse {
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const worst = perf.rows.filter((r) => r.quadrant.startsWith('Pause') || r.quadrant.startsWith('Fix')).sort((a, c) => c.cpa - a.cpa)
  const r: AnalystResponse = {
    ...b, intent: 'pause', title: 'Campaigns to pause or redesign', confidence: 'Medium', metrics: ['Cost per verified attendee', 'Registration → attendance rate', 'Spend share vs attendee share'],
    summary: worst.length ? worst.map((x) => `${x.name} (${x.quadrant.split(':')[0].toLowerCase()}): ${pct(x.spendShare)} of spend for ${pct(x.attendanceShare)} of attributed attendees, ${fmtINR(x.cpa)} per attendee, ${pct(x.showRate)} show rate`).join('. ') + '.' : 'No campaign is below the portfolio on both volume and attendance quality for this date.',
    table: { columns: [...PERF_COLS, 'Spend share', 'Attendee share'], rows: perf.rows.map((x) => [...perfRow(x), pct(x.spendShare), pct(x.attendanceShare)]) },
  }
  for (const x of worst) {
    const conf = x.confirmedShowRate
    r.observed.push(`${x.name}: ${fmtInt(x.confirmed)} confirmed, ${pct(conf)} of them attended; ${fmtInt(x.optedOut)} identified people opted out; ${pct(x.regRate)} of identified registered.`)
  }
  if (worst[0]) {
    const w = worst[0]
    r.hypotheses.push(`${w.name} reaches people who register on impulse but do not plan to attend. Redesign (attendance-oriented creative, event-day hooks, follow-up) is preferable to a full stop if volume matters.`)
    r.actions.push({ kind: 'set_status', label: `Mark ${w.name} as paused in the plan`, campaignId: w.id, isSource: true, status: 'paused', name: w.name })
    r.actions.push(taskAction(`Redesign brief for ${w.name}: attendance-oriented creative + reminder flow`, ownerOf(m, w.id), 5, scope, { campaignRef: w.id, opportunityId: 'O2' }))
    r.actions.push({ kind: 'open_campaign', label: `Open ${w.name}`, campaignId: w.id })
  }
  r.limits.push('First-touch attribution records the source relationship; it does not prove that pausing a campaign removes exactly its attributed attendees.')
  r.followUps = ['Which campaign should receive more budget?', worst[0] ? `Compare ${worst[0].name} and ${perf.rows.slice().sort((a, c) => a.cpa - c.cpa)[0].name}` : 'Show campaign performance', 'Why?']
  r.focusCampaigns = worst.map((x) => x.id)
  return r
}

function channelAnswer(m: Model, scope: Scope): AnalystResponse {
  const ch = channelPerformance(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const paid = ch.filter((c) => c.channel !== 'walk_in')
  const top = paid[0]
  const eff = [...paid].filter((c) => Number.isFinite(c.cpa)).sort((a, c) => a.cpa - c.cpa)[0]
  const total = ch.reduce((a, c) => a + c.attendees, 0)
  return {
    ...b, intent: 'channel', title: 'Verified attendees by channel', confidence: 'High', metrics: ['Verified unique external attendees (first-touch channel)', 'Cost per verified attendee'],
    summary: top ? `${top.channel.replace('_', ' ')} produced the most verified attendees (${fmtInt(top.attendees)}, ${pct(safeDiv(top.attendees, total))} of all). The most cost-efficient channel is ${eff?.channel.replace('_', ' ')} at ${fmtINR(eff?.cpa)} per attendee.` : 'No attendance yet in this range.',
    table: { columns: ['Channel', 'Spend', 'Registrations', 'Verified attendees', 'Reg → attend', 'Cost / attendee'], rows: ch.map((c) => [c.channel, c.spend ? fmtINR(c.spend) : '—', fmtInt(c.registrations), fmtInt(c.attendees), pct(c.showRate), fmtINR(c.cpa)]) },
    observed: ['Each source campaign maps to exactly one channel, so channel and campaign results coincide.', ch.find((c) => c.channel === 'walk_in') ? `${fmtInt(ch.find((c) => c.channel === 'walk_in')!.attendees)} walk-ins have no channel; their acquisition cost is unknown, not zero.` : ''].filter(Boolean),
    hypotheses: [], limits: ['Attribution is first-touch; multi-touch paths are not recorded.'], actions: top ? [{ kind: 'open_campaign', label: 'Open top channel campaign', campaignId: m.campaigns.find((c) => c.channel === top.channel)?.id ?? '' }] : [],
    followUps: ['Which campaign should receive more budget?', 'What is our cost per verified attendee?'],
  }
}

function nextActions(m: Model, scope: Scope, ws: WorkspaceState): AnalystResponse {
  const s = snapshot(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const o = opportunities(m, { ...scope, campaignIds: null })
  const daysToEvent = Math.round((startOfDay(m.raw.event.startsAt) - startOfDay(scope.end)) / DAY)
  const pre = daysToEvent > 0
  const top = o.list.slice(0, 3)
  const r: AnalystResponse = {
    ...b, intent: 'next7', title: pre ? `Next 7 days (${daysToEvent} days to the event)` : 'Next 7 days — post-event playbook', confidence: 'Medium',
    metrics: ['Opportunity priority score', 'Modeled incremental verified attendees'],
    summary: pre
      ? `With ${daysToEvent} days left, prioritise people already in the funnel: ${top.map((x) => x.short.toLowerCase()).join(', ')}. ${s.gap.registrations > 0 ? `${fmtInt(s.gap.registrations)} registrations are still needed for the target.` : ''}`
      : `The event is over (${fmtInt(s.visitors)} verified visitors vs ${fmtInt(s.target.visitorsGoal)} goal). The next 7 days should lock in learning and set up the next cycle: ${top.map((x) => x.short.toLowerCase()).join('; ')}.`,
    table: { columns: ['#', 'Action', 'Modeled impact (low–high)', 'Confidence', 'Time to signal'], rows: o.list.map((x) => [x.rank, x.title, `+${x.impact.low}–${x.impact.high}`, x.confidence, `${x.daysToSignal}d`]) },
  }
  r.observed.push(`Ranked by ${PRIORITY_FORMULA}.`)
  r.hypotheses.push('Impact figures are modeled from observed rates with stated assumptions — see each opportunity in Acquisition Analytics.')
  const openTasks = ws.tasks.filter((t) => t.status !== 'done')
  if (openTasks.length) r.observed.push(`${openTasks.length} open task(s) already in the workspace.`)
  for (const x of top) {
    r.actions.push(taskAction(`${x.id}: ${x.title}`, x.campaignIds[0] ? ownerOf(m, x.campaignIds[0]) : 'Growth lead', x.daysToSignal, scope, { opportunityId: x.id, campaignRef: x.campaignIds[0] }))
  }
  r.followUps = ['Why is attendance activation ranked first?', 'How confident are these estimates?', 'What is our cost per verified attendee?']
  return r
}

function opportunitiesAnswer(m: Model, scope: Scope): AnalystResponse {
  const o = opportunities(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  return {
    ...b, intent: 'opportunities', title: 'Prioritised growth opportunities', confidence: 'Medium', metrics: ['Modeled incremental verified attendees', 'Priority score'],
    summary: `Five levers add an estimated +${o.scenario.low - o.baseline} to +${o.scenario.high - o.baseline} verified attendees (base +${o.scenario.base - o.baseline}) on top of ${fmtInt(o.baseline)} — a base case of ${fmtInt(o.scenario.base)} and a stretch of ${fmtInt(o.scenario.high)}.`,
    table: { columns: ['#', 'Opportunity', 'Low', 'Base', 'High', 'Confidence', 'Cost'], rows: o.list.map((x) => [x.rank, x.title, x.impact.low, x.impact.base, x.impact.high, x.confidence, fmtINR(x.cost)]) },
    observed: o.list.map((x) => `${x.id}: ${x.problem}`), hypotheses: o.list.flatMap((x) => x.assumptions.slice(0, 1)),
    limits: ['Estimates assume the opportunities do not overlap; O1 and O4 both act on show-up and may partly overlap.'],
    actions: o.list.slice(0, 2).map((x) => taskAction(`${x.id}: ${x.title}`, 'Growth lead', x.daysToSignal, scope, { opportunityId: x.id })),
    followUps: ['How confident are these estimates?', 'What should we not do?', 'What should we do in the next seven days?'],
  }
}

function deprioritizedAnswer(m: Model, scope: Scope): AnalystResponse {
  const d = deprioritized(m, { ...scope, campaignIds: null })
  return { ...base(scope, m), intent: 'avoid', title: 'What we would not fund', confidence: 'Medium', metrics: ['Spend share vs attendee share', 'Cost per verified attendee'], summary: d.map((x) => x.idea).join('; ') + '.', observed: d.map((x) => `${x.idea}: ${x.why}`), followUps: ['Which campaign should receive more budget?'] }
}

function compareAnswer(m: Model, scope: Scope, ids: string[]): AnalystResponse {
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const rows = ids.map((id) => perf.rows.find((r) => r.id === id)).filter(Boolean) as CampaignPerf[]
  const b = base(scope, m)
  if (rows.length < 2) return unknownAnswer(m, scope, 'compare')
  const [a, c] = rows
  const better = a.cpa <= c.cpa ? a : c
  const metricRows: [string, (r: CampaignPerf) => string][] = [
    ['Spend', (r) => fmtINR(r.spend)], ['Identified people', (r) => fmtInt(r.identified)], ['Registrations', (r) => fmtInt(r.registrations)],
    ['Identified → registered', (r) => pct(r.regRate)], ['Confirmed', (r) => fmtInt(r.confirmed)], ['Cancelled', (r) => fmtInt(r.cancelled)],
    ['Verified attendees', (r) => fmtInt(r.attendees)], ['Registered → attended', (r) => pct(r.showRate)], ['Confirmed → attended', (r) => pct(r.confirmedShowRate)],
    ['Cost / registration', (r) => fmtINR(r.cpr)], ['Cost / verified attendee', (r) => fmtINR(r.cpa)], ['CTR (anonymous)', (r) => fmtPct(r.ctr, 2)], ['Opted out', (r) => fmtInt(r.optedOut)],
  ]
  return {
    ...b, intent: 'compare', title: `${a.name} vs ${c.name}`, confidence: 'High', metrics: metricRows.map((x) => x[0]),
    summary: `${better.name} delivers verified attendees at ${fmtINR(better.cpa)} vs ${fmtINR((better === a ? c : a).cpa)}. Show rates: ${a.name} ${pct(a.showRate)}, ${c.name} ${pct(c.showRate)}. Volume: ${fmtInt(a.registrations)} vs ${fmtInt(c.registrations)} registrations.`,
    table: { columns: ['Metric', a.name, c.name], rows: metricRows.map(([l, f]) => [l, f(a), f(c)]) },
    observed: [`Quadrants: ${a.name} — ${a.quadrant}; ${c.name} — ${c.quadrant}.`],
    limits: ['Campaigns ran on different dates and audiences; the comparison is descriptive, not a controlled test.'],
    actions: [{ kind: 'open_campaign', label: `Open ${a.name}`, campaignId: a.id }, { kind: 'open_campaign', label: `Open ${c.name}`, campaignId: c.id }],
    followUps: [`Why does ${(better === a ? c : a).name} convert worse?`, 'Which campaign should receive more budget?'], focusCampaigns: [a.id, c.id],
  }
}

function campaignProfile(m: Model, scope: Scope, id: string, ws: WorkspaceState): AnalystResponse {
  const b = base(scope, m)
  if (id === UNATTRIBUTED) {
    const q = attendanceQuality(m, { ...scope, campaignIds: null })
    return { ...b, intent: 'profile', title: 'Walk-in / unattributed visitors', confidence: 'High', metrics: ['Verified unique external visitors without a campaign'], summary: `${fmtInt(q.walkIns)} verified visitors had no campaign and no registration — identified only at the gate.`, observed: ['They count toward the unique-visitor target but have no acquisition record.'], limits: ['Their acquisition source is unknown, so no cost can be assigned (unknown ≠ zero).'], followUps: ['Which channel produces the most verified attendees?'] }
  }
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const r = perf.rows.find((x) => x.id === id)
  const c = m.campaignById.get(id)!
  if (!r) return unknownAnswer(m, scope, 'campaign')
  const ov = ws.overlays[id]
  const pools = recoveryPools(m, { ...scope, campaignIds: [id] })
  return {
    ...b, intent: 'profile', title: `${c.name} (${c.id}) — ${c.channel}`, confidence: 'High',
    metrics: ['Spend', 'Registrations', 'Verified attendees', 'Cost per verified attendee', 'Show rate'],
    summary: `${c.name} spent ${fmtINR(r.spend)} and produced ${fmtInt(r.registrations)} registrations and ${fmtInt(r.attendees)} verified attendees (${fmtINR(r.cpa)} each; portfolio ${fmtINR(perf.portfolio.cpa)}). ${pct(r.showRate)} of registrants attended vs ${pct(perf.portfolio.showRate)} portfolio. Classification: ${r.quadrant}.`,
    facts: [
      { label: 'Owner', value: c.ownerName }, { label: 'Objective (plan)', value: c.objective },
      { label: 'Impressions / clicks (anon.)', value: `${fmtInt(r.impressions)} / ${fmtInt(r.clicks)}` },
      { label: 'Identified → registered', value: pct(r.regRate) }, { label: 'Confirmed → attended', value: pct(r.confirmedShowRate) },
      { label: 'Cancelled / waitlisted / stuck', value: `${r.cancelled} / ${r.waitlisted} / ${r.interested}` },
      { label: 'Form abandoners', value: fmtInt(pools.formAbandoners) }, { label: 'Opted out', value: fmtInt(r.optedOut) },
      ...(ov?.status ? [{ label: 'Plan status (this app)', value: ov.status }] : []),
      ...(ov?.proposedBudget != null ? [{ label: 'Proposed budget (this app)', value: fmtINR(ov.proposedBudget), note: `actual ${fmtINR(r.spend)}` }] : []),
    ],
    observed: [`Spend share ${pct(r.spendShare)} vs attendee share ${pct(r.attendanceShare)}.`],
    hypotheses: [], limits: ['Target audience text in the workbook is a plan description, not an observed audience.'],
    actions: [{ kind: 'open_campaign', label: `Open ${c.name} in Campaign Manager`, campaignId: id }],
    followUps: ['Why?', `Compare ${c.name} and ${perf.rows.filter((x) => x.id !== id).sort((a, d) => a.cpa - d.cpa)[0].name}`, 'Which campaign should receive more budget?'],
    focusCampaigns: [id],
  }
}

type MetricKey = 'cpa' | 'cpr' | 'cpi' | 'spend' | 'registrations' | 'identified' | 'visitors' | 'showRate' | 'confirmedShowRate' | 'cancellation' | 'regConversion' | 'ctr' | 'impressions' | 'clicks' | 'sessions' | 'budget'

const METRIC_PATTERNS: [RegExp, MetricKey][] = [
  [/cost per (verified )?(attendee|visitor|attendance)|cpa\b|cost per (verified )?attend/, 'cpa'],
  [/cost per (registration|registrant|signup|sign-up)|cpr\b/, 'cpr'],
  [/cost per (identified|lead|person|people)|cpl\b/, 'cpi'],
  [/remaining budget|budget left|budget remaining|under budget|over budget|budget/, 'budget'],
  [/spend|spent|cost\b/, 'spend'],
  [/confirmed.*(attend|show)|confirmed show/, 'confirmedShowRate'],
  [/show[- ]?rate|no[- ]?show|attendance rate|registration[- ]to[- ]attendance|reg.*attend/, 'showRate'],
  [/cancel/, 'cancellation'],
  [/registration conversion|conversion rate|convert/, 'regConversion'],
  [/ctr|click[- ]through/, 'ctr'],
  [/impression|reach|awareness/, 'impressions'],
  [/click/, 'clicks'],
  [/session|traffic|landing/, 'sessions'],
  [/registration|registered|signups?|sign-ups?/, 'registrations'],
  [/identified|leads?\b/, 'identified'],
  [/attendee|visitor|attendance|attended|footfall|turnout|showed up/, 'visitors'],
]

function metricOf(q: string): MetricKey | null {
  for (const [re, k] of METRIC_PATTERNS) if (re.test(q)) return k
  return null
}

const METRIC_DEF: Record<MetricKey, string> = {
  cpa: 'Net marketing spend ÷ verified unique external visitors (campaign view: ÷ attendees attributed to that campaign).',
  cpr: 'Net marketing spend ÷ distinct external people with a registration.',
  cpi: 'Net marketing spend ÷ distinct identified external people.',
  spend: 'Sum of net posted marketing debits less credits (whole INR) on posting date.',
  budget: 'Approved marketing budget of the target version in force, minus cumulative net spend.',
  registrations: 'Distinct external person_ids with a registration created at or before the date.',
  identified: 'Distinct external person_ids whose first_seen_at is at or before the date.',
  visitors: 'Distinct external person_ids with ≥1 admitted + verified check-in.',
  showRate: 'Registered people with a verified admission ÷ registered people.',
  confirmedShowRate: 'People whose latest status is confirmed and who were admitted ÷ confirmed.',
  cancellation: 'Registrations whose latest status at the date is cancelled ÷ registrations.',
  regConversion: 'Registrations ÷ identified external people (cumulative).',
  ctr: 'Anonymous clicks ÷ anonymous impressions (events, not people).',
  impressions: 'Anonymous impression events; not unique people.',
  clicks: 'Anonymous click events; not unique people.',
  sessions: 'Anonymous landing-page sessions incl. repeat visits.',
}

function metricAnswer(m: Model, scope: Scope, key: MetricKey, ids: string[], dateLabel?: string): AnalystResponse {
  const b = base(scope, m)
  const s = snapshot(m, { ...scope, campaignIds: ids.length ? ids : null })
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const label = ids.length ? ids.map((id) => campaignLabel(m, id)).join(' + ') : 'All campaigns + walk-ins'
  const flow = scope.start > m.dayRange.start
  const v: Record<MetricKey, () => [string, string]> = {
    cpa: () => [fmtINR(s.costPerVisitor), 'Cost per verified attendee'],
    cpr: () => [fmtINR(s.costPerRegistration), 'Cost per registration'],
    cpi: () => [fmtINR(s.costPerIdentified), 'Cost per identified person'],
    spend: () => (flow ? [fmtINR(s.spendInRange), 'Net marketing spend in range'] : [fmtINR(s.spend), 'Net marketing spend (cumulative)']),
    budget: () => [`${fmtINR(s.spend)} of ${fmtINR(s.target.budget)} (${fmtINR(s.gap.budgetRemaining)} left)`, 'Spend vs approved budget'],
    registrations: () => (flow ? [fmtInt(s.registrationsInRange), 'New unique registrations in range'] : [fmtInt(s.registrations), 'Unique registrations']),
    identified: () => (flow ? [fmtInt(s.identifiedInRange), 'Newly identified external people in range'] : [fmtInt(s.identified), 'Identified external people']),
    visitors: () => [fmtInt(s.visitors), 'Verified unique external visitors'],
    showRate: () => [pct(s.attendanceConversion), 'Registration → attendance'],
    confirmedShowRate: () => [pct(s.confirmedShowRate), 'Confirmed → attendance'],
    cancellation: () => [pct(s.cancellationRate), 'Cancellation rate (latest status)'],
    regConversion: () => [pct(s.regConversion), 'Registration conversion'],
    ctr: () => [fmtPct(safeDiv(s.clicks, s.impressions), 2), 'CTR (anonymous)'],
    impressions: () => [fmtInt(s.impressions), 'Impressions in range (anonymous)'],
    clicks: () => [fmtInt(s.clicks), 'Clicks in range (anonymous)'],
    sessions: () => [fmtInt(s.sessions), 'Landing-page sessions in range (anonymous)'],
  }
  const [value, name] = v[key]()
  const r: AnalystResponse = {
    ...b, intent: 'metric', title: name, confidence: 'High', metrics: [name],
    summary: `${name} for ${label}${dateLabel ? ` ${dateLabel}` : ''}: ${value}.`,
    facts: [{ label: 'Definition', value: METRIC_DEF[key] }],
  }
  if (flow && ['registrations', 'identified', 'spend'].includes(key)) r.facts.push({ label: 'Cumulative at range end', value: key === 'spend' ? fmtINR(s.spend) : fmtInt(key === 'registrations' ? s.registrations : s.identified) })
  if ((key === 'cpa' || key === 'showRate' || key === 'confirmedShowRate') && !s.eventStarted) {
    r.summary = `${name} cannot be measured ${dateLabel ?? 'for this date'}: the event starts ${fmtDay(m.raw.event.startsAt, true)} and no attendance exists before then.`
    r.confidence = 'High'; r.limits.push('Pick a date on or after the event to see attendance-based metrics.')
  }
  if (key === 'cpa') {
    if (!ids.length) r.facts.push({ label: 'Campaign-attributed only', value: fmtINR(perf.portfolio.cpa), note: 'spend ÷ attendees with a campaign (excludes walk-ins)' })
    r.observed.push(`Range across campaigns: ${perf.rows.filter((x) => Number.isFinite(x.cpa)).sort((a, c) => a.cpa - c.cpa).map((x) => `${x.name} ${fmtINR(x.cpa)}`).join(', ')}.`)
    r.limits.push('Walk-ins have no recorded acquisition cost; including them in the denominator lowers the blended figure.')
  }
  if (['impressions', 'clicks', 'sessions', 'ctr'].includes(key)) r.limits.push('Platform counts are anonymous events and cannot be converted into unique people.')
  if (!ids.length && ['cpa', 'cpr', 'showRate', 'registrations', 'visitors', 'spend', 'cancellation', 'confirmedShowRate', 'regConversion'].includes(key)) {
    const col: Record<string, (x: CampaignPerf) => string> = { cpa: (x) => fmtINR(x.cpa), cpr: (x) => fmtINR(x.cpr), showRate: (x) => pct(x.showRate), registrations: (x) => fmtInt(x.registrations), visitors: (x) => fmtInt(x.attendees), spend: (x) => fmtINR(x.spend), cancellation: (x) => pct(x.cancelRate), confirmedShowRate: (x) => pct(x.confirmedShowRate), regConversion: (x) => pct(x.regRate) }
    r.table = { columns: ['Campaign', name], rows: perf.rows.map((x) => [x.name, col[key](x)]) }
  }
  r.followUps = ['Break it down by campaign', 'Which campaign should receive more budget?', 'How is this calculated?']
  r.focusCampaigns = ids
  return r
}

function segmentsAnswer(m: Model, scope: Scope): AnalystResponse {
  const seg = engagementSegments(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const pairs: { name: string; yes: (typeof seg)[0]; no: (typeof seg)[0] }[] = []
  for (let i = 0; i < seg.length; i += 2) pairs.push({ name: seg[i].segment, yes: seg[i], no: seg[i + 1] })
  const best = [...pairs].filter((p) => Number.isFinite(p.yes.showRate)).sort((a, c) => (c.yes.showRate - c.no.showRate) - (a.yes.showRate - a.no.showRate))[0]
  return {
    ...b, intent: 'segments', title: 'Engagement signals associated with registration and attendance', confidence: 'Medium',
    metrics: ['Identified → registered', 'Registered → attended'],
    summary: best ? `${best.name} is the strongest attendance signal: ${pct(best.yes.showRate)} of registrants who did it attended vs ${pct(best.no.showRate)} who did not.` : 'Attendance is not yet observable for this date.',
    table: { columns: ['Signal', 'Group', 'People', 'Registered', 'Reg. rate', 'Attend rate'], rows: seg.map((x) => [x.segment, x.group, fmtInt(x.people), fmtInt(x.registered), pct(x.regRate), pct(x.showRate)]) },
    observed: ['Nurture emails were sent mostly to people who had not registered, so recipients show lower registration — this is targeting, not a negative email effect.'],
    hypotheses: ['Brochure downloads and event questions indicate planning intent; they can be used as a score to prioritise reminders.'],
    limits: ['Associations, not causal effects. No randomised holdout exists in the data.'],
    actions: [taskAction('Add brochure-download & question signals to the attendance-risk score', 'Growth lead', 7, scope)],
    followUps: ['What should we do in the next seven days?', 'Does registration timing matter?'],
  }
}

function timingAnswer(m: Model, scope: Scope): AnalystResponse {
  const t = timingSegments(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const valid = t.filter((x) => Number.isFinite(x.showRate) && x.registrations > 0)
  const lo = [...valid].sort((a, c) => a.showRate - c.showRate)[0]
  const hi = [...valid].sort((a, c) => c.showRate - a.showRate)[0]
  return {
    ...b, intent: 'timing', title: 'Registration timing vs attendance', confidence: 'Medium', metrics: ['Registered → attended by days-before-event bucket'],
    summary: lo && hi ? `People who registered ${hi.bucket.toLowerCase()} attended at ${pct(hi.showRate)}; ${lo.bucket.toLowerCase()} at ${pct(lo.showRate)} — the lowest.` : 'Attendance is not yet observable for this date.',
    table: { columns: ['Registered', 'Registrations', 'Attended', 'Show rate', 'Cancelled'], rows: t.map((x) => [x.bucket, fmtInt(x.registrations), fmtInt(x.attended), pct(x.showRate), pct(x.cancelRate)]) },
    observed: ['Days before event = event start date − registration date (IST).'], hypotheses: ['Registrants from the long middle window drift; a mid-cycle reconfirmation touch may hold them.'],
    limits: ['Timing overlaps with campaign mix (campaigns started on different dates).'], followUps: ['Which campaigns have the most no-shows?'],
  }
}

function noShowAnswer(m: Model, scope: Scope): AnalystResponse {
  const q = attendanceQuality(m, { ...scope, campaignIds: null })
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const s = snapshot(m, { ...scope, campaignIds: null })
  if (!s.eventStarted) return { ...b, intent: 'noshow', title: 'No-shows', confidence: 'High', metrics: [], summary: `Attendance cannot be measured before ${fmtDay(m.raw.event.startsAt, true)}.`, limits: ['Pick a date on or after the event.'] }
  const rows = perf.rows.map((r) => ({ r, ns: r.confirmed - r.confirmedAttendees })).sort((a, c) => c.ns - a.ns)
  return {
    ...b, intent: 'noshow', title: 'No-shows and attendance quality', confidence: 'High', metrics: ['Confirmed registrants without a verified admission', 'Gate outcomes', 'Days attended'],
    summary: `${fmtInt(q.confirmedNoShow)} confirmed registrants did not attend. ${rows[0].r.name} (${rows[0].ns}) and ${rows[1].r.name} (${rows[1].ns}) account for ${pct(safeDiv(rows[0].ns + rows[1].ns, q.confirmedNoShow))}.`,
    facts: [
      { label: 'Verified visitors', value: fmtInt(q.visitors) }, { label: 'Attended both days', value: fmtInt(q.twoDay), note: pct(safeDiv(q.twoDay, q.visitors)) },
      { label: 'Admitted only by manual entry', value: fmtInt(q.manualOnly) }, { label: 'Lost at the gate (denied/pending, never admitted)', value: fmtInt(q.gateLost) },
      { label: 'Recovered after a failed gate attempt', value: fmtInt(q.gateRecovered) }, { label: 'Attended after cancelling once', value: fmtInt(q.everCancelledAttended) },
    ],
    table: { columns: ['Campaign', 'Confirmed', 'Attended', 'No-shows', 'Confirmed → attended'], rows: rows.map(({ r, ns }) => [r.name, fmtInt(r.confirmed), fmtInt(r.confirmedAttendees), fmtInt(ns), pct(r.confirmedShowRate)]) },
    observed: [`${fmtInt(s.waitlisted)} waitlisted registrants were never released and none attended.`],
    hypotheses: ['Reminder + QR wallet pass would recover part of the no-shows; size is modeled in opportunity O1.'],
    limits: ['No-show reasons are not recorded.'],
    actions: [{ kind: 'create_campaign', label: 'Draft an attendance-activation campaign', draft: { name: 'Attendance activation — confirmed registrants', channel: 'email_whatsapp', audienceSegment: 'confirmed_registrants', objective: 'Raise confirmed → verified attendance', budget: 10000, targetMetric: 'confirmed_show_rate', targetValue: 85, linkedOpportunity: 'O1' } }],
    followUps: ['How many people are on the waitlist?', 'What should we do in the next seven days?'], focusCampaigns: rows.slice(0, 2).map((x) => x.r.id),
  }
}

function statusAnswer(m: Model, scope: Scope): AnalystResponse {
  const d = statusDistribution(m, { ...scope, campaignIds: null })
  const pools = recoveryPools(m, { ...scope, campaignIds: null })
  const b = base(scope, m)
  const tot = d.reduce((a, x) => a + x.registrations, 0)
  return {
    ...b, intent: 'status', title: 'Registration status (latest version per registration)', confidence: 'High', metrics: ['Latest status at the selected date'],
    summary: d.map((x) => `${x.status} ${fmtInt(x.registrations)} (${pct(safeDiv(x.registrations, tot))})`).join(', ') + '.',
    table: { columns: ['Status', 'Registrations', 'Attended', 'Show rate'], rows: d.map((x) => [x.status, fmtInt(x.registrations), fmtInt(x.attended), pct(x.showRate)]) },
    observed: [`Waitlisted by campaign: ${Object.entries(pools.waitByCampaign).map(([id, n]) => `${campaignLabel(m, id)} ${n}`).join(', ')}.`, 'Status at a date = latest history version effective at or before the end of that day; re-confirmation updates the same registration.'],
    actions: [taskAction('Plan waitlist release in waves against forecast no-shows', 'Growth lead', 3, scope, { opportunityId: 'O4' })],
    limits: ['Venue capacity is not in the workbook.'], followUps: ['Which campaigns have the most no-shows?', 'What should we do in the next seven days?'],
  }
}

function workspaceAnswer(m: Model, scope: Scope, ws: WorkspaceState, q: string): AnalystResponse {
  const b = base(scope, m)
  const isTask = /task|action item|to-?do|overdue|owner/.test(q)
  if (isTask) {
    const open = ws.tasks.filter((t) => t.status !== 'done')
    const today = new Date().toISOString().slice(0, 10)
    const overdue = open.filter((t) => t.due < today)
    return { ...b, dateRange: 'Current workspace state', intent: 'tasks', title: 'Tasks', confidence: 'High', metrics: ['Workspace tasks'], summary: ws.tasks.length ? `${open.length} open task(s), ${overdue.length} overdue, ${ws.tasks.length - open.length} done.` : 'No tasks yet. Ask "What should we do in the next seven days?" to generate some.', table: ws.tasks.length ? { columns: ['Task', 'Owner', 'Due', 'Status'], rows: ws.tasks.slice(0, 15).map((t) => [t.title, t.owner, t.due, t.status]) } : undefined, followUps: ['What should we do in the next seven days?'] }
  }
  const cs = ws.campaigns
  const rows = cs.map((c) => {
    const spend = c.results.reduce((a, x) => a + x.spend, 0), att = c.results.reduce((a, x) => a + x.attendees, 0), reg = c.results.reduce((a, x) => a + x.registrations, 0)
    return [c.name, c.status, fmtINR(c.budget), fmtINR(spend), fmtInt(reg), fmtInt(att), fmtINR(safeDiv(spend, att))]
  })
  const totalBudget = cs.filter((c) => c.status === 'active' || c.status === 'draft').reduce((a, c) => a + c.budget, 0)
  const s = snapshot(m, { ...scope, campaignIds: null })
  return {
    ...b, dateRange: 'Current workspace state', intent: 'local', title: 'Campaigns created in this app (local simulation)', confidence: 'High', metrics: ['Proposed budget', 'Logged simulated results'],
    summary: cs.length ? `${cs.length} local campaign(s): ${['draft', 'active', 'paused', 'archived', 'completed'].map((st) => `${cs.filter((c) => c.status === st).length} ${st}`).join(', ')}. Draft + active proposed budgets total ${fmtINR(totalBudget)} vs ${fmtINR(Math.max(0, s.gap.budgetRemaining))} unspent approved budget${totalBudget > s.gap.budgetRemaining ? ' — over the remaining budget' : ''}.` : 'No local campaigns yet. Create one in Campaign Manager or accept a draft from me.',
    table: cs.length ? { columns: ['Campaign', 'Status', 'Budget', 'Logged spend', 'Logged reg.', 'Logged attendees', 'Cost / attendee'], rows } : undefined,
    observed: ['Results on local campaigns are entered by the team (simulation); they are kept separate from the workbook\'s source data.'],
    followUps: ['Which campaign should receive more budget?'],
  }
}

function whatIfAnswer(m: Model, scope: Scope, q: string, ids: string[]): AnalystResponse {
  const b = base(scope, m)
  const amtM = q.match(/(?:₹|rs\.?|inr)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|l|lakh|lac)?/i)
  let amount = amtM ? Number(amtM[1].replace(/,/g, '')) : NaN
  if (amtM?.[2]) amount *= /k/i.test(amtM[2]) ? 1000 : 100000
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const fromM = q.match(/from ([a-z0-9 ]+?) (?:to|into|towards?) ([a-z0-9 ]+)/)
  let from: CampaignPerf | undefined, to: CampaignPerf | undefined
  if (fromM) {
    from = perf.rows.find((r) => findCampaigns(m, fromM[1]).includes(r.id))
    to = perf.rows.find((r) => findCampaigns(m, fromM[2]).includes(r.id))
  } else if (ids.length >= 2) { from = perf.rows.find((r) => r.id === ids[0]); to = perf.rows.find((r) => r.id === ids[1]) }
  const addOnly = !from && ids.length === 1 ? perf.rows.find((r) => r.id === ids[0]) : undefined
  if (!Number.isFinite(amount) || amount <= 0 || (!to && !addOnly)) {
    return { ...b, intent: 'whatif', title: 'Scenario needs an amount and campaigns', confidence: 'High', metrics: [], summary: 'I can model a budget shift if you name an amount and campaigns, e.g. "What if we move ₹20,000 from Paid Social to College Partnerships?" or "What if we add ₹10,000 to Student Referrals?"', followUps: ['What if we move ₹20,000 from Creator Partners to Student Referrals?'] }
  }
  const target = (to ?? addOnly)!
  const gain = (k: number) => amount / (target.cpa * k)
  const loss = from ? amount / from.cpa : 0
  const r: AnalystResponse = {
    ...b, intent: 'whatif', title: from ? `Scenario: move ${fmtINR(amount)} from ${from.name} to ${target.name}` : `Scenario: add ${fmtINR(amount)} to ${target.name}`, confidence: 'Low',
    metrics: ['Cost per verified attendee (observed average)', 'Modeled marginal cost'],
    summary: `Modeled net change: ${from ? `${Math.round(gain(3) - loss)} to ${Math.round(gain(1.5) - loss)} (base ${Math.round(gain(2) - loss)})` : `+${Math.round(gain(3))} to +${Math.round(gain(1.5))} (base +${Math.round(gain(2))})`} verified attendees.`,
    facts: [
      { label: `${target.name} observed cost / attendee`, value: fmtINR(target.cpa) },
      ...(from ? [{ label: `${from.name} observed cost / attendee`, value: fmtINR(from.cpa) }, { label: 'Attendees lost (at donor average)', value: `−${Math.round(loss)}` }] : []),
      { label: 'Attendees gained at 1.5× / 2× / 3× marginal cost', value: `+${Math.round(gain(1.5))} / +${Math.round(gain(2))} / +${Math.round(gain(3))}` },
    ],
    observed: [`Observed averages from ${fmtRange(scope.start, scope.end)}.`],
    hypotheses: ['Marginal cost is assumed 1.5–3× average cost (diminishing returns). The workbook has one spend level per campaign, so the true curve is unknown.'],
    limits: ['This is a model, not a forecast backed by an experiment. Validate with a staged shift (25% first).'],
    actions: [{ kind: 'create_campaign', label: `Draft staged test for ${target.name}`, draft: { name: `${target.name} — budget shift test`, channel: target.channel, basedOn: target.id, audienceSegment: 'new_audience', objective: `Validate marginal cost per verified attendee with ${fmtINR(Math.round(amount / 4))} first (25% of the shift)`, budget: Math.round(amount / 4), targetMetric: 'cost_per_attendee', targetValue: Math.round(target.cpa * 2), owner: target.owner, linkedOpportunity: 'O2' } }],
    followUps: ['How confident is this?', 'Which campaign should we pause or redesign?'], focusCampaigns: [target.id, ...(from ? [from.id] : [])],
  }
  if (from && from.id === target.id) r.summary = 'Source and destination are the same campaign — no change.'
  return r
}

function definitionAnswer(m: Model, scope: Scope, q: string): AnalystResponse {
  const k = metricOf(q)
  const b = base(scope, m)
  if (k) return { ...b, intent: 'definition', title: 'Metric definition', confidence: 'High', metrics: [k], summary: METRIC_DEF[k], observed: ['All metrics use stable IDs, deduplicated source records, external people only, and IST end-of-day snapshots.'], followUps: ['What is our cost per verified attendee?'] }
  return { ...b, intent: 'definition', title: 'Metric definitions', confidence: 'High', metrics: [], summary: 'Core definitions used everywhere in the product and deck:', table: { columns: ['Metric', 'Definition'], rows: (Object.keys(METRIC_DEF) as MetricKey[]).map((x) => [x, METRIC_DEF[x]]) } }
}

function qualityAnswer(m: Model, scope: Scope): AnalystResponse {
  return {
    ...base(scope, m), intent: 'quality', title: 'Data quality and handling', confidence: 'High', metrics: [], dateRange: 'Whole workbook',
    summary: `${m.quality.length} findings. Duplicates were removed on stable IDs; non-external people are excluded; attendance requires admitted + verified.`,
    table: { columns: ['Area', 'Finding', 'Handling'], rows: m.quality.map((x) => [x.area, x.finding, x.handling]) },
    followUps: ['How is cost per verified attendee calculated?'],
  }
}

function unknownAnswer(m: Model, scope: Scope, reason = ''): AnalystResponse {
  return {
    ...base(scope, m), intent: 'unknown', title: 'I could not map that question to the data', confidence: 'High', metrics: [],
    summary: `I answer from the workbook and workspace only, and I could not match this question to a metric, campaign, or analysis${reason ? ` (${reason})` : ''}. I won't guess a number.`,
    limits: ['Available: targets, funnel, campaigns & channels, costs, registration status, timing, engagement signals, attendance quality, opportunities, budget scenarios, local campaigns, tasks, data quality.'],
    followUps: SUGGESTED_QUESTIONS.slice(0, 4),
  }
}

function unsupportedAnswer(m: Model, scope: Scope, u: { topic: string; instead: string }): AnalystResponse {
  return {
    ...base(scope, m), intent: 'unsupported', title: 'The workbook cannot answer this', confidence: 'High', metrics: [],
    summary: `The data does not contain ${u.topic}, so I can't answer without inventing numbers.`,
    limits: [u.instead], followUps: ['Which audiences produce the most verified attendees?', 'Which engagement signals predict attendance?'],
  }
}

function explainWhy(m: Model, scope: Scope, ctx: AnalystContext, ws: WorkspaceState): AnalystResponse {
  const last = ctx.lastResponse
  if (!last) return unknownAnswer(m, scope, 'no previous answer to explain')
  if (last.intent === 'next7' || last.intent === 'opportunities') {
    const o = opportunities(m, { ...scope, campaignIds: null })
    const x = o.list[0]
    return { ...base(scope, m), intent: 'why', title: `Why ${x.title.toLowerCase()} ranks first`, confidence: 'Medium', metrics: ['Priority score'], summary: `${x.problem} It scores ${x.score} because it has the largest base impact (+${x.impact.base}) at ${x.effort.toLowerCase()} effort and a ${x.daysToSignal}-day signal.`, observed: x.evidence, hypotheses: x.assumptions, limits: [PRIORITY_FORMULA], followUps: ['How confident are these estimates?'] }
  }
  const ids = ctx.campaignIds ?? []
  if (ids.length >= 1 && ids[0] !== UNATTRIBUTED) {
    const perf = campaignPerformance(m, { ...scope, campaignIds: null })
    const r = perf.rows.find((x) => x.id === ids[0])!
    const segRows = engagementSegments(m, { ...scope, campaignIds: [ids[0]] })
    const broch = segRows.filter((x) => x.segment === 'Downloaded brochure')
    const resp = campaignProfile(m, scope, ids[0], ws)
    return {
      ...resp, intent: 'why', title: `Why ${r.name} performs this way`,
      summary: `${r.name}: ${pct(r.regRate)} of identified people registered (portfolio ${pct(safeDiv(perf.rows.reduce((a, y) => a + y.registrations, 0), perf.rows.reduce((a, y) => a + y.identified, 0)))}), ${pct(r.confirmedShowRate)} of confirmed attended, ${r.cancelled} cancelled and ${r.optedOut} opted out.`,
      observed: [`Brochure downloaders in this campaign: ${broch[0] ? `${fmtInt(broch[0].people)} people, ${pct(broch[0].showRate)} attended after registering vs ${pct(broch[1]?.showRate)} for non-downloaders` : 'n/a'}.`, `Spend ${pct(r.spendShare)} of portfolio vs ${pct(r.attendanceShare)} of attendees.`],
      hypotheses: ['Differences reflect audience intent (who the channel reaches) more than execution — the workbook has no creative-level data to separate the two.'],
      followUps: ids.length > 1 ? [`Why does ${campaignLabel(m, ids[1])} perform this way?`, 'How confident is this?'] : ['How confident is this?', 'Which campaign should receive more budget?'],
    }
  }
  return { ...last, title: `Evidence: ${last.title}`, summary: `Evidence behind the previous answer. ${last.observed.join(' ')}`, intent: 'why' }
}

function confidenceAnswer(m: Model, scope: Scope, ctx: AnalystContext): AnalystResponse {
  const last = ctx.lastResponse
  return {
    ...base(scope, m), intent: 'confidence', title: 'How confident is this?', confidence: last?.confidence ?? 'Medium', metrics: last?.metrics ?? [],
    summary: last ? `Confidence: ${last.confidence}. Observed facts (${last.observed.length}) come straight from the workbook; hypotheses (${last.hypotheses.length}) are labelled and need testing.` : 'Ask a question first.',
    observed: last?.observed ?? [], hypotheses: last?.hypotheses ?? [], limits: [...(last?.limits ?? []), 'Single edition of data; no randomised experiments; first-touch attribution only.'],
    followUps: ['What experiment would test this?'],
  }
}

function experimentAnswer(m: Model, scope: Scope): AnalystResponse {
  const o = opportunities(m, { ...scope, campaignIds: null })
  return {
    ...base(scope, m), intent: 'experiment', title: 'Experiment designs', confidence: 'Medium', metrics: o.list.map((x) => x.successMetric),
    summary: 'Each opportunity has a test with explicit scale / change / stop thresholds:',
    table: { columns: ['Opportunity', 'Experiment', 'Scale', 'Stop'], rows: o.list.map((x) => [x.title, x.experiment, x.thresholds.scale, x.thresholds.stop]) },
    followUps: ['What should we do in the next seven days?'],
  }
}


// ---------------------------------------------------------------- rankings, owners, audiences, status, ROI

const RANK_FIELD: Partial<Record<MetricKey, { f: (r: CampaignPerf) => number; fmt: (v: number) => string; lowerIsBetter?: boolean; label: string }>> = {
  cpa: { f: (r) => r.cpa, fmt: fmtINR, lowerIsBetter: true, label: 'Cost per verified attendee' },
  cpr: { f: (r) => r.cpr, fmt: fmtINR, lowerIsBetter: true, label: 'Cost per registration' },
  cpi: { f: (r) => r.cpi, fmt: fmtINR, lowerIsBetter: true, label: 'Cost per identified person' },
  spend: { f: (r) => r.spend, fmt: fmtINR, label: 'Net spend' },
  registrations: { f: (r) => r.registrations, fmt: fmtInt, label: 'Registrations' },
  identified: { f: (r) => r.identified, fmt: fmtInt, label: 'Identified people' },
  visitors: { f: (r) => r.attendees, fmt: fmtInt, label: 'Verified attendees' },
  showRate: { f: (r) => r.showRate, fmt: (v) => fmtPct(v), label: 'Registered → attended' },
  confirmedShowRate: { f: (r) => r.confirmedShowRate, fmt: (v) => fmtPct(v), label: 'Confirmed → attended' },
  cancellation: { f: (r) => r.cancelRate, fmt: (v) => fmtPct(v), lowerIsBetter: true, label: 'Cancellation rate' },
  regConversion: { f: (r) => r.regRate, fmt: (v) => fmtPct(v), label: 'Identified → registered' },
  ctr: { f: (r) => r.ctr, fmt: (v) => fmtPct(v, 2), label: 'CTR (anonymous)' },
  impressions: { f: (r) => r.impressions, fmt: fmtInt, label: 'Impressions (anonymous)' },
  clicks: { f: (r) => r.clicks, fmt: fmtInt, label: 'Clicks (anonymous)' },
  sessions: { f: (r) => r.sessions, fmt: fmtInt, label: 'Landing-page sessions (anonymous)' },
}

function rankingAnswer(m: Model, scope: Scope, key: MetricKey, q: string): AnalystResponse {
  const spec = RANK_FIELD[key]!
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const rows = perf.rows.filter((r) => Number.isFinite(spec.f(r)))
  if (!rows.length) return { ...base(scope, m), intent: 'ranking', title: `${spec.label} by campaign`, confidence: 'High', metrics: [spec.label], summary: `${spec.label} cannot be ranked for this date: there are no values yet (attendance metrics need a date on or after the event).` }
  let desc = /highest|most|largest|biggest|max/.test(q) && !/lowest|least|fewest|cheapest|min/.test(q)
  if (/\b(best|top)\b/.test(q)) desc = !spec.lowerIsBetter
  if (/\b(worst|bottom)\b/.test(q)) desc = !!spec.lowerIsBetter
  const sorted = [...rows].sort((a, b) => (desc ? spec.f(b) - spec.f(a) : spec.f(a) - spec.f(b)))
  const top = sorted[0], second = sorted[1]
  return {
    ...base(scope, m), intent: 'ranking', title: `${spec.label} by campaign`, confidence: 'High', metrics: [spec.label],
    summary: `${top.name} has the ${desc ? 'highest' : 'lowest'} ${spec.label.toLowerCase()}: ${spec.fmt(spec.f(top))}${second ? `, followed by ${second.name} (${spec.fmt(spec.f(second))})` : ''}.`,
    table: { columns: ['#', 'Campaign', spec.label, 'Registrations', 'Verified att.'], rows: sorted.map((r, i) => [i + 1, r.name, spec.fmt(spec.f(r)), fmtInt(r.registrations), fmtInt(r.attendees)]) },
    observed: [spec.lowerIsBetter ? `Lower is better for ${spec.label.toLowerCase()}.` : `Higher is better for ${spec.label.toLowerCase()}.`],
    limits: ['Campaign level only (first-touch attribution); walk-ins have no campaign.'],
    actions: [{ kind: 'open_campaign', label: `Open ${top.name}`, campaignId: top.id }],
    followUps: [`Tell me about ${top.name}`, 'Which campaign should receive more budget?'], focusCampaigns: [top.id],
  }
}

function ownerAnswer(m: Model, scope: Scope, ws: WorkspaceState): AnalystResponse {
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const by = new Map<string, { owner: string; campaigns: string[]; spend: number; reg: number; att: number }>()
  for (const r of perf.rows) {
    const o = m.campaignById.get(r.id)?.ownerName ?? '—'
    const x = by.get(o) ?? { owner: o, campaigns: [], spend: 0, reg: 0, att: 0 }
    x.campaigns.push(r.name); x.spend += r.spend; x.reg += r.registrations; x.att += r.attendees
    by.set(o, x)
  }
  const rows = [...by.values()].map((x) => ({ ...x, cpa: safeDiv(x.spend, x.att), show: safeDiv(x.att, x.reg) })).sort((a, b) => a.cpa - b.cpa)
  const openTasks = (o: string) => ws.tasks.filter((t) => t.status !== 'done' && t.owner === o).length
  const best = rows[0]
  return {
    ...base(scope, m), intent: 'owners', title: 'Performance by campaign owner', confidence: 'Medium', metrics: ['Cost per verified attendee', 'Registered → attended', 'Verified attendees'],
    summary: best && Number.isFinite(best.cpa) ? `${best.owner}'s campaigns deliver verified attendees most cheaply: ${fmtINR(best.cpa)} each (${best.campaigns.join(', ')}), with ${fmtPct(best.show)} of registrants attending.` : 'Owner results need attendance data (a date on or after the event).',
    table: { columns: ['Owner', 'Campaigns', 'Spend', 'Registrations', 'Verified att.', 'Reg → attend', 'Cost / att.', 'Open tasks'], rows: rows.map((x) => [x.owner, x.campaigns.join(', '), fmtINR(x.spend), fmtInt(x.reg), fmtInt(x.att), fmtPct(x.show), fmtINR(x.cpa), openTasks(x.owner)]) },
    observed: ['Owner = owner_name of each campaign in the workbook; results are summed across the campaigns they own.'],
    hypotheses: ['Owner results mostly reflect which channels each person was given, not individual execution quality.'],
    limits: ['The workbook has no owner-level effort or budget authority, so this is not a performance review.'],
    followUps: ['Show my tasks', 'Which campaign should we pause or redesign?'],
  }
}

function audienceAnswer(m: Model, scope: Scope): AnalystResponse {
  const segs = audienceSegments(m, { ...scope, campaignIds: null })
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const acq = perf.rows.filter((r) => Number.isFinite(r.cpa) && (r.quadrant.startsWith('Grow') || r.quadrant.startsWith('Scale'))).sort((a, b) => a.cpa - b.cpa).slice(0, 3)
  const inFunnel = segs.filter((x) => ['confirmed_registrants', 'form_abandoners', 'waitlisted', 'stuck_interested'].includes(x.key))
  return {
    ...base(scope, m), intent: 'audience', title: 'Which audiences to target next', confidence: 'Medium', metrics: ['Audience size (distinct people)', 'Cost per verified attendee', 'Registered → attended'],
    summary: `Start with people already in the funnel (${inFunnel.map((x) => `${x.label.toLowerCase()}: ${fmtInt(x.size ?? 0)}`).join('; ')})${acq.length ? `, then new reach through ${acq.map((x) => x.name).join(', ')}, the campaigns with the cheapest verified attendees` : ''}.`,
    table: { columns: ['Audience', 'Type', 'People', 'Evidence'], rows: [
      ...inFunnel.map((x) => [x.label, 'Already in funnel: convert', fmtInt(x.size ?? 0), x.definition]),
      ...acq.map((x) => [m.campaignById.get(x.id)?.audience ?? x.name, `New reach via ${x.name}`, fmtInt(x.identified), `${fmtINR(x.cpa)} per attendee, ${fmtPct(x.showRate)} attend`]),
    ] },
    observed: ['Sizes are distinct people in the workbook. Acquisition audiences are the plan descriptions of the campaigns with the lowest cost per verified attendee.'],
    hypotheses: ['In-funnel audiences should be cheaper because they are identified and contactable; their conversion rates are modeled in the opportunities, not observed.'],
    limits: ['No demographic or college fields exist, so audiences are defined by behaviour and campaign, not by who people are.'],
    actions: [{ kind: 'create_campaign', label: 'Draft a campaign for confirmed registrants', draft: { name: 'Attendance activation — confirmed registrants', channel: 'email_whatsapp', audienceSegment: 'confirmed_registrants', objective: 'Raise confirmed → verified attendance with D-7 / D-1 / D-0 reminders and QR pass', budget: 10000, targetMetric: 'confirmed_show_rate', targetValue: 85, linkedOpportunity: 'O1' } }],
    followUps: ['Which campaign should receive more budget?', 'What should we do in the next seven days?'],
  }
}

function statusQuestion(m: Model, scope: Scope, ws: WorkspaceState, ids: string[]): AnalystResponse {
  const rows = ids.filter((id) => m.campaignById.has(id)).map((id) => {
    const c = m.campaignById.get(id)!, ov = ws.overlays[id]
    const st = ov?.status ?? (c.plannedEnd < m.dayRange.end ? 'completed' : 'active')
    return [c.name, st, ov?.status ? 'set in this app' : 'from the planned end date in the workbook', ov?.proposedBudget != null ? fmtINR(ov.proposedBudget) : '—']
  })
  return {
    ...base(scope, m), dateRange: 'Current workspace state', intent: 'campaign_status', title: 'Campaign plan status', confidence: 'High', metrics: ['Plan status'],
    summary: rows.map((r) => `${r[0]} is ${r[1]} (${r[2]})`).join('. ') + '.',
    table: { columns: ['Campaign', 'Plan status', 'Where the status comes from', 'Proposed budget'], rows },
    observed: ['Plan status is a decision recorded in this app. It never changes the workbook’s historical results.'],
    actions: ids.slice(0, 1).map((id) => ({ kind: 'open_campaign' as const, label: `Open ${m.campaignById.get(id)?.name}`, campaignId: id })),
    followUps: ['Which campaign should we pause or redesign?'], focusCampaigns: ids,
  }
}

// ---------------------------------------------------------------- router

export function answer(question: string, m: Model, scope: Scope, ws: WorkspaceState, ctx: AnalystContext): { response: AnalystResponse; context: AnalystContext } {
  const q = ' ' + question.toLowerCase().replace(/[?!.]/g, ' ').replace(/\s+/g, ' ') + ' '
  const dated = parseDates(m, q, scope)
  const sc = dated?.scope ?? scope
  let ids = findCampaigns(m, q)
  const locals = findLocalCampaigns(ws, q)
  const followUp = /^\s*(why|and|what about|how about|same for|for|then|ok|okay|so)\b/.test(q) || /\b(it|that|this|them|those)\b/.test(q)
  if (!ids.length && followUp && ctx.campaignIds?.length && !/\b(all|overall|portfolio|total)\b/.test(q)) ids = ctx.campaignIds

  let r: AnalystResponse
  const unsupported = UNSUPPORTED.find((u) => u.re.test(q))
  if (unsupported && !/campaign|channel/.test(q.replace(/college partnerships?/, ''))) r = unsupportedAnswer(m, sc, unsupported)
  else if (unsupported) r = unsupportedAnswer(m, sc, unsupported)
  else if (/^\s*(why|explain|show (me )?(the )?evidence|evidence)\s*$/.test(q) || /^\s*why (is|does|did) (it|that|this)/.test(q) || /why .*rank(ed)? first/.test(q)) r = explainWhy(m, sc, ctx, ws)
  else if (/how (confident|sure|reliable)|confidence/.test(q)) r = confidenceAnswer(m, sc, ctx)
  else if (/break (it|this) down|by campaign|per campaign|each campaign/.test(q) && ctx.lastResponse?.intent === 'metric') {
    const k = metricOf(ctx.lastResponse.title.toLowerCase()) ?? metricOf(q) ?? 'cpa'
    r = metricAnswer(m, sc, k, [], dated?.label)
  }
  else if (/\bwhat if\b|\bif we (move|shift|add|put|spend|reallocate)|\b(move|shift|reallocate) ₹?\d/.test(q)) r = whatIfAnswer(m, sc, q, ids)
  else if (locals.length || /\b(my|our|local|new|draft|launched) campaigns?\b|\bdrafts?\b|\btasks?\b|action items?|to-?dos?|overdue/.test(q)) {
    if (locals.length && !/tasks?/.test(q)) {
      const c = locals[0]
      const spend = c.results.reduce((a, x) => a + x.spend, 0), att = c.results.reduce((a, x) => a + x.attendees, 0)
      r = { ...base(sc, m), dateRange: 'Current workspace state', intent: 'local', title: `${c.name} (local ${c.status})`, confidence: 'High', metrics: ['Proposed budget', 'Logged results'], summary: `${c.name} is ${c.status}, budget ${fmtINR(c.budget)}, ${c.start} → ${c.end}. Logged simulated results: ${fmtINR(spend)} spend, ${fmtInt(att)} attendees${att ? ` (${fmtINR(spend / att)} each)` : ''}. Target: ${c.targetMetric.replace(/_/g, ' ')} ${c.targetValue}.`, observed: ['Local campaign results are team-entered simulation data, not workbook records.'], actions: [{ kind: 'open_campaign', label: `Open ${c.name}`, campaignId: c.id }] }
    } else r = workspaceAnswer(m, sc, ws, q)
  }
  else if (/compare|\bvs\b|versus|better than|difference between/.test(q) && ids.length >= 2) r = compareAnswer(m, sc, ids)
  else if (ids.length && /\b(is|are|was)\b.*\b(paused|active|archived|live|running|completed)\b|\bstatus of\b|\bplan status\b/.test(q) && !/pause or|should/.test(q)) r = statusQuestion(m, sc, ws, ids)
  else if (/\broi\b|return on (investment|spend|ad spend)|\broas\b|payback/.test(q)) {
    r = metricAnswer(m, sc, 'cpa', ids, dated?.label)
    r.title = 'ROI is not computable; closest metric is cost per verified attendee'
    r.summary = `ROI needs revenue or a value per attendee, which the workbook does not contain. Closest supported measure: ${r.summary}`
    r.limits.unshift('No ticket price, revenue or attendee value is recorded, so ROI / ROAS cannot be calculated without inventing a number.')
  }
  else if (/\bowners?\b|who (owns|runs|manages)|team members?|which manager/.test(q)) r = ownerAnswer(m, sc, ws)
  else if (/\baudiences?\b|who should we target|target next|which segments?|which people/.test(q)) r = audienceAnswer(m, sc)
  else if (/\btiming\b|registration timing|days before|\bwhen\b.*\bregist|\bearly\b.*regist|\blate\b.*regist/.test(q)) r = timingAnswer(m, sc)
  else if (!ids.length && /no[- ]?shows?|didn'?t (attend|show|come)|did not (attend|show|come)/.test(q)) r = noShowAnswer(m, sc)
  else if (!ids.length && /\b(highest|lowest|most|least|fewest|largest|biggest|cheapest|best|worst|top|bottom|rank|ranking)\b/.test(q) && /campaign|channel|which|rank/.test(q) && metricOf(q) && RANK_FIELD[metricOf(q)!]) r = rankingAnswer(m, sc, metricOf(q)!, q)
  else if (/on track|target|goal|missing|behind|short of|attainment|gap/.test(q)) r = targetStatus(m, sc, ws)
  else if (/funnel|drop(ping)? ?off|drop|losing|lose|leak|bottleneck|where .* lost/.test(q)) r = funnelAnswer(m, sc)
  else if (/pause|redesign|\bcut\b|\bstop\b|worst|underperform|wast/.test(q)) r = pauseAnswer(m, sc)
  else if (/(more|additional|extra) budget|invest|double down|scale|allocate|where .* spend|best campaign|top campaign|receive more/.test(q)) r = budgetAnswer(m, sc, ws)
  else if (/channel/.test(q) && !ids.length) r = channelAnswer(m, sc)
  else if (/next (7|seven) days|next week|what should we do|plan for|priorit|this week|immediate/.test(q)) r = nextActions(m, sc, ws)
  else if (/opportunit|levers?|ideas?|biggest wins?|base case|stretch|how high/.test(q)) r = opportunitiesAnswer(m, sc)
  else if (/avoid|not (do|fund)|deprioriti|reject/.test(q)) r = deprioritizedAnswer(m, sc)
  else if (/experiment|a\/b|ab test|test (this|it)|holdout/.test(q)) r = experimentAnswer(m, sc)
  else if (/what (is|does|are) .*(mean|defin)|definition|how (is|are) .* (calculated|computed|defined)|how do you (calculate|define)/.test(q)) r = definitionAnswer(m, sc, q)
  else if (/brochure|email|engag|signal|behaviou?r|opt(ed)?[- ]?out|question submitted|predict|audiences?|segment/.test(q)) r = segmentsAnswer(m, sc)
  else if (/timing|early|late|days before|when.*regist/.test(q)) r = timingAnswer(m, sc)
  else if (/no[- ]?show|didn'?t (attend|show|come)|did not (attend|show|come)|gate|denied|pending|two days?|both days|re-?entry|walk[- ]?in quality|attendance quality/.test(q)) r = noShowAnswer(m, sc)
  else if (/waitlist|wait list|status|interested|stuck/.test(q)) r = statusAnswer(m, sc)
  else if (/data quality|duplicate|clean|assumption|limitation|missing data|null/.test(q)) r = qualityAnswer(m, sc)
  else if (metricOf(q)) r = metricAnswer(m, sc, metricOf(q)!, ids, dated?.label)
  else if (ids.length === 1) r = campaignProfile(m, sc, ids[0], ws)
  else if (ids.length >= 2) r = compareAnswer(m, sc, ids)
  else if (/trend|daily|over time|week/.test(q)) {
    const t = dailyTrend(m, { ...sc, campaignIds: ids.length ? ids : null })
    const peak = [...t].sort((a, c) => c.registrations - a.registrations)[0]
    r = { ...base(sc, m), intent: 'trend', title: 'Daily trend', confidence: 'High', metrics: ['Registrations per day', 'Identified per day'], summary: `Peak registration day: ${fmtDay(peak.day, true)} with ${peak.registrations}. Cumulative registrations at range end: ${fmtInt(t[t.length - 1].cumRegistrations)}.`, followUps: ['Are we on track?'] }
  }
  else r = unknownAnswer(m, sc)

  if (dated && !r.dateRange.includes(dated.label)) r.dateRange = `${r.dateRange} · question asked for ${dated.label}`
  const nextCtx: AnalystContext = { lastIntent: r.intent, campaignIds: r.focusCampaigns?.length ? r.focusCampaigns : ids.length ? ids : ctx.campaignIds, lastResponse: r }
  return { response: r, context: nextCtx }
}

/** Compact, number-complete data pack for the optional Gemini narrator. */
export function dataPack(m: Model, scope: Scope, ws: WorkspaceState) {
  const s = snapshot(m, { ...scope, campaignIds: null })
  const perf = campaignPerformance(m, { ...scope, campaignIds: null })
  const o = opportunities(m, { ...scope, campaignIds: null })
  const q = attendanceQuality(m, { ...scope, campaignIds: null })
  const pools = recoveryPools(m, { ...scope, campaignIds: null })
  const r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)
  return {
    as_of: fmtDay(scope.end, true), event: { name: m.raw.event.name, starts: fmtDay(m.raw.event.startsAt, true), ends: fmtDay(m.raw.event.endsAt, true) },
    target: s.target, kpis: { identified: s.identified, registrations: s.registrations, confirmed: s.confirmed, cancelled: s.cancelled, waitlisted: s.waitlisted, interested: s.interested, verified_visitors: s.visitors, walk_ins: s.visitorsWalkIn, spend_inr: s.spend, reg_conversion: r1(s.regConversion), registration_to_attendance: r1(s.attendanceConversion), cost_per_verified_attendee: r1(s.costPerVisitor), cost_per_registration: r1(s.costPerRegistration) },
    campaigns: perf.rows.map((r) => ({ id: r.id, name: r.name, channel: r.channel, spend_inr: r.spend, identified: r.identified, registrations: r.registrations, confirmed: r.confirmed, attendees: r.attendees, show_rate: r1(r.showRate), cost_per_attendee: r1(r.cpa), quadrant: r.quadrant })),
    attendance_quality: q, recovery_pools: { form_abandoners: pools.formAbandoners, contactable: pools.formAbandonersContactable, waitlisted: pools.waitlisted, stuck_interested: pools.stuckInterested },
    opportunities_modeled: o.list.map((x) => ({ id: x.id, title: x.title, impact: x.impact, confidence: x.confidence, assumption: x.assumptions[0] })),
    workspace: { local_campaigns: ws.campaigns.map((c) => ({ name: c.name, status: c.status, budget: c.budget })), open_tasks: ws.tasks.filter((t) => t.status !== 'done').length },
    not_in_data: ['demographics', 'college names', 'city/location', 'ticket revenue', 'venue capacity', 'no-show reasons', 'satisfaction'],
  }
}
