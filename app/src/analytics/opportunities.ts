// Growth opportunity model. Measured inputs come from metrics.ts; every modeled
// number carries the assumption that produced it. Nothing here is an observed result.

import { safeDiv } from '../lib/format'
import type { Model } from './model'
import { attendanceQuality, campaignPerformance, engagementSegments, recoveryPools, snapshot, type CampaignPerf, type Scope } from './metrics'

export type Confidence = 'High' | 'Medium' | 'Low'
export type Effort = 'Low' | 'Medium' | 'High'

export interface Opportunity {
  id: string
  title: string
  short: string
  problem: string
  evidence: string[]
  intervention: string
  audience: string
  successMetric: string
  impact: { low: number; base: number; high: number }
  assumptions: string[]
  cost: number // assumed incremental cost, INR
  costNote: string
  confidence: Confidence
  effort: Effort
  daysToSignal: number
  experiment: string
  thresholds: { scale: string; change: string; stop: string }
  score: number
  rank: number
  campaignIds: string[]
}

export interface Bottleneck {
  stage: 'pre-registration' | 'post-registration'
  headline: string
  lost: number
  breakdown: { label: string; value: number }[]
  preRegistrationLost: number
  postRegistrationLost: number
}

const CONF_W: Record<Confidence, number> = { High: 1, Medium: 0.7, Low: 0.4 }
const EFFORT_W: Record<Effort, number> = { Low: 1, Medium: 1.5, High: 2.5 }

/** Priority = base incremental attendees × confidence weight ÷ effort weight ÷ time factor. */
export const PRIORITY_FORMULA = 'Priority = base incremental verified attendees × confidence (H 1.0 / M 0.7 / L 0.4) ÷ effort (L 1.0 / M 1.5 / H 2.5) ÷ (1 + days-to-signal ÷ 30)'

export function bottleneck(m: Model, s: Scope): Bottleneck {
  const snap = snapshot(m, s)
  const campaignIdentified = m.external.filter((p) => p.campaignId !== 'UNATTRIBUTED' && p.firstSeen <= s.end && (s.campaignIds == null || s.campaignIds.includes(p.campaignId))).length
  const pre = campaignIdentified - snap.registrations
  const noShow = snap.eventStarted ? snap.confirmed - (snap.visitorsRegistered - 0) : 0
  // visitorsRegistered can include people whose latest status isn't confirmed (none in source, but keep exact):
  const q = attendanceQuality(m, s)
  const post = snap.eventStarted ? snap.registrations - snap.visitorsRegistered : snap.cancelled + snap.waitlisted + snap.interested
  const breakdown = snap.eventStarted
    ? [
        { label: 'Confirmed but did not attend', value: q.confirmedNoShow },
        { label: 'Cancelled (latest status)', value: snap.cancelled },
        { label: 'Waitlisted, never released', value: snap.waitlisted },
        { label: 'Stuck at "interested"', value: snap.interested },
      ]
    : [
        { label: 'Cancelled (latest status)', value: snap.cancelled },
        { label: 'Waitlisted', value: snap.waitlisted },
        { label: 'Stuck at "interested"', value: snap.interested },
      ]
  void noShow
  const isPost = post >= pre
  return {
    stage: isPost ? 'post-registration' : 'pre-registration',
    headline: isPost
      ? `${post.toLocaleString('en-IN')} registered people (${(safeDiv(post, snap.registrations) * 100).toFixed(1)}%) did not become verified attendees — larger than the ${pre.toLocaleString('en-IN')} identified people who never registered.`
      : `${pre.toLocaleString('en-IN')} campaign-identified people never registered — larger than the ${post.toLocaleString('en-IN')} lost after registration.`,
    lost: Math.max(pre, post), breakdown, preRegistrationLost: pre, postRegistrationLost: post,
  }
}

export function opportunities(m: Model, s: Scope): { list: Opportunity[]; baseline: number; scenario: { low: number; base: number; high: number }; budgetPlan: { label: string; amount: number }[]; budgetRemaining: number } {
  const snap = snapshot(m, s)
  const perf = campaignPerformance(m, s)
  const q = attendanceQuality(m, s)
  const pools = recoveryPools(m, s)
  const rows = perf.rows
  const confAttTotal = rows.reduce((a, r) => a + r.confirmedAttendees, 0)
  const confTotal = rows.reduce((a, r) => a + r.confirmed, 0)
  // Before the event no attendance exists; modeled impacts then use a declared show-up assumption.
  const ASSUMED_SHOW = 0.7
  const observedConf = snap.eventStarted ? safeDiv(confAttTotal, confTotal) : NaN
  const portfolioConfShow = Number.isFinite(observedConf) ? observedConf : ASSUMED_SHOW
  const showRate = Number.isFinite(perf.portfolio.showRate) ? perf.portfolio.showRate : ASSUMED_SHOW
  const showNote = snap.eventStarted ? '' : ` (assumed ${(ASSUMED_SHOW * 100).toFixed(0)}% — no attendance observed before the event)`
  const budgetRemaining = Math.max(0, snap.gap.budgetRemaining)
  const list: Opportunity[] = []

  // ---- O1 attendance activation
  const laggards = rows.filter((r) => Number.isFinite(r.confirmedShowRate) && r.confirmedShowRate < portfolioConfShow)
  const leaders = rows.filter((r) => Number.isFinite(r.confirmedShowRate) && r.confirmedShowRate >= portfolioConfShow)
  const leaderRate = safeDiv(leaders.reduce((a, r) => a + r.confirmedAttendees, 0), leaders.reduce((a, r) => a + r.confirmed, 0))
  const gapPeople = laggards.reduce((a, r) => a + r.confirmed * Math.max(0, leaderRate - r.confirmedShowRate), 0)
  const o1Cost = Math.round(confTotal * 4)
  if (snap.eventStarted && laggards.length) {
    list.push({
      id: 'O1', title: 'Attendance activation for confirmed registrants', short: 'Convert confirmed → attended',
      problem: `${q.confirmedNoShow.toLocaleString('en-IN')} confirmed registrants never checked in (confirmed show rate ${(portfolioConfShow * 100).toFixed(1)}%).`,
      evidence: [
        ...laggards.map((r) => `${r.name}: ${(r.confirmedShowRate * 100).toFixed(1)}% of ${r.confirmed} confirmed attended`),
        `Other campaigns: ${(leaderRate * 100).toFixed(1)}% confirmed show rate`,
      ],
      intervention: 'D-7 reconfirm prompt, D-1 QR wallet pass + day-wise agenda, D-0 gate-time reminder; release seats of non-reconfirmers to waitlist.',
      audience: `Confirmed registrants, prioritising ${laggards.map((r) => r.name).join(' and ')}`,
      successMetric: 'Confirmed → verified attendance rate (per campaign)',
      impact: { low: Math.round(gapPeople * 0.25), base: Math.round(gapPeople * 0.5), high: Math.round(gapPeople * 0.75) },
      assumptions: [`Closes 25% / 50% / 75% of the gap between lagging campaigns and the ${(leaderRate * 100).toFixed(1)}% rate of the other campaigns (${Math.round(gapPeople)} people at 100%).`],
      cost: o1Cost, costNote: `Assumed ₹4 per confirmed registrant for 3 reminder messages (${confTotal.toLocaleString('en-IN')} confirmed).`,
      confidence: 'Medium', effort: 'Low', daysToSignal: 7,
      experiment: 'Randomised holdout: 80% of confirmed registrants get the reminder sequence, 20% get the standard confirmation only. Compare D-1 reconfirmation and verified attendance.',
      thresholds: { scale: 'Reconfirmation ≥ 85% and treatment − holdout attendance ≥ +5 pp → roll out to all', change: '+1 to +5 pp → change message timing / add QR wallet pass', stop: '≤ +1 pp after 7 days → stop and reallocate the message budget' },
      score: 0, rank: 0, campaignIds: laggards.map((r) => r.id),
    })
  }

  // ---- O3 registration recovery (form abandoners + stuck interested)
  const recoverable = pools.formAbandonersContactable + pools.stuckInterested
  if (recoverable > 0) {
    const sr = Number.isFinite(showRate) ? showRate : 0.65
    list.push({
      id: 'O3', title: 'Recover abandoned and stalled registrations', short: 'Finish incomplete registrations',
      problem: `${pools.formAbandoners} identified people started the form but never registered; ${pools.stuckInterested} registrations never left "interested".`,
      evidence: [
        `${pools.formAbandonersContactable} abandoners have not opted out (${pools.formAbandonOptOut} opted out — excluded)`,
        `Largest abandoner pools: ${Object.entries(pools.abandonByCampaign).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => `${m.campaignById.get(id)?.name ?? id} ${n}`).join(', ')}`,
        `${pools.leadsNoStart} further identified leads never started the form (not targeted — lower intent)`,
      ],
      intervention: 'One-tap "finish your registration" link with saved form data within 24h of abandonment; single confirmation nudge for "interested" registrations.',
      audience: 'Identified form-starters without a registration; registrations stuck at "interested"',
      successMetric: 'Abandoner → registration completion rate; then registration → attendance',
      impact: { low: Math.round(recoverable * 0.1 * sr), base: Math.round(recoverable * 0.2 * sr), high: Math.round(recoverable * 0.3 * sr) },
      assumptions: [`10% / 20% / 30% of ${recoverable} contactable people complete registration, then attend at the portfolio show rate (${(sr * 100).toFixed(1)}%)${showNote}. Recovery rate is not observed in the workbook — must be tested.`],
      cost: 2000, costNote: 'Assumed ₹2,000 for automated messaging.',
      confidence: 'Medium', effort: 'Low', daysToSignal: 3,
      experiment: 'A/B test the recovery message (saved-form link vs. generic reminder) on abandoners; 50/50 split, read completion at 72h.',
      thresholds: { scale: 'Completion ≥ 20% within 72h → automate for all new abandoners', change: '8–20% → test timing and copy', stop: '< 8% or opt-out rate > 5% → stop' },
      score: 0, rank: 0, campaignIds: Object.keys(pools.abandonByCampaign),
    })
  }

  // ---- O4 waitlist release
  if (pools.waitlisted > 0) {
    const cr = Number.isFinite(portfolioConfShow) ? portfolioConfShow : 0.75
    list.push({
      id: 'O4', title: 'Release the waitlist against forecast no-shows', short: 'Clear the waitlist',
      problem: `${pools.waitlisted} registrants stayed waitlisted; ${snap.eventStarted ? 'none of them became verified attendees' : 'they cannot attend unless released'}.`,
      evidence: [
        `Waitlisted by campaign: ${Object.entries(pools.waitByCampaign).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${m.campaignById.get(id)?.name ?? id} ${n}`).join(', ')}`,
        snap.eventStarted ? `${q.confirmedNoShow} confirmed seats went unused (no-shows), so capacity was likely available on the day` : 'No-show rate not yet observable before the event',
        'Venue capacity is not in the workbook — release must be capped by the real capacity',
      ],
      intervention: 'Overbook against the forecast no-show rate: release waitlisted registrants in waves from D-7 as non-reconfirmers drop out.',
      audience: 'Waitlisted registrants',
      successMetric: 'Waitlist → confirmed → verified attendee',
      impact: { low: Math.round(pools.waitlisted * 0.5 * cr), base: Math.round(pools.waitlisted * 0.75 * cr), high: Math.round(pools.waitlisted * cr) },
      assumptions: [`50% / 75% / 100% of waitlisted are released and attend at the confirmed show rate (${(cr * 100).toFixed(1)}%)${showNote}. Conditional on venue capacity, which the workbook does not contain.`],
      cost: 2000, costNote: 'Assumed ₹2,000 messaging + ops time.',
      confidence: 'Medium', effort: 'Low', daysToSignal: 7,
      experiment: 'Release in two waves (D-7, D-2); measure acceptance and attendance per wave against capacity.',
      thresholds: { scale: 'Acceptance ≥ 60% and no capacity breach → release the next wave', change: 'Acceptance 30–60% → release earlier', stop: 'Gate capacity alerts → stop releasing' },
      score: 0, rank: 0, campaignIds: Object.keys(pools.waitByCampaign),
    })
  }

  // ---- O5 gate friction
  if (snap.eventStarted && q.gateLost > 0) {
    list.push({
      id: 'O5', title: 'Remove gate friction for registered visitors', short: 'Fix denied / pending admissions',
      problem: `${q.gateLost} people with a denied or pending gate record never got a verified admission (${q.gateRecovered} others were recovered on a later attempt).`,
      evidence: [`${q.manualOnly} verified attendees were admitted only through manual entry`, 'Denied/pending records are all for confirmed registrants'],
      intervention: 'Pre-event QR validation, a help desk lane for failed scans, and a same-day re-verification flow for pending records.',
      audience: 'Confirmed registrants at the gate',
      successMetric: 'Share of gate attempts ending in a verified admission',
      impact: { low: Math.round(q.gateLost * 0.25), base: Math.round(q.gateLost * 0.5), high: Math.round(q.gateLost * 0.75) },
      assumptions: ['Recovers 25% / 50% / 75% of people currently lost at the gate. Some denials may be legitimate; reasons are not recorded in the workbook.'],
      cost: 5000, costNote: 'Assumed ₹5,000 for help-desk staffing and signage.',
      confidence: 'Low', effort: 'Medium', daysToSignal: 1,
      experiment: 'Track first-attempt verified admission rate by gate hour on day 1; add the help-desk lane at the worst gate and compare.',
      thresholds: { scale: 'Lost-at-gate rate < 1% on day 1 → keep setup for day 2', change: '1–3% → add staff to the worst gate', stop: 'n/a — operational hygiene' },
      score: 0, rank: 0, campaignIds: [],
    })
  }

  // ---- O2 budget reallocation toward attendance-efficient campaigns
  const donorsPause = rows.filter((r) => r.quadrant.startsWith('Pause'))
  const donorsFix = rows.filter((r) => r.quadrant.startsWith('Fix'))
  const recipients = rows.filter((r) => (r.quadrant.startsWith('Grow') || r.quadrant.startsWith('Scale')) && r.cpa < perf.portfolio.cpa)
  if (recipients.length && (donorsPause.length || donorsFix.length)) {
    const recCpa = safeDiv(recipients.reduce((a, r) => a + r.spend, 0), recipients.reduce((a, r) => a + r.attendees, 0))
    const otherCosts = list.reduce((acc, o) => acc + o.cost, 0)
    const unspent = Math.max(0, budgetRemaining - otherCosts)
    const calc = (pausePct: number, fixPct: number, diminish: number) => {
      const moved = donorsPause.reduce((a, r) => a + r.spend * pausePct, 0) + donorsFix.reduce((a, r) => a + r.spend * fixPct, 0)
      const lost = donorsPause.reduce((a, r) => a + safeDiv(r.spend * pausePct, r.cpa), 0) + donorsFix.reduce((a, r) => a + safeDiv(r.spend * fixPct, r.cpa), 0)
      const gained = (moved + unspent) / (recCpa * diminish)
      return { moved, lost, gained, net: gained - lost }
    }
    const lo = calc(0.3, 0.1, 3), ba = calc(0.5, 0.2, 2), hi = calc(0.7, 0.3, 1.5)
    const fmt = (r: CampaignPerf) => `${r.name}: ₹${Math.round(r.cpa)} per verified attendee, ${(r.showRate * 100).toFixed(0)}% show rate`
    list.push({
      id: 'O2', title: 'Shift budget to attendance-efficient campaigns', short: 'Reallocate spend by cost per attendee',
      problem: `${[...donorsPause, ...donorsFix].map((r) => r.name).join(' and ')} take ${(([...donorsPause, ...donorsFix].reduce((a, r) => a + r.spendShare, 0)) * 100).toFixed(0)}% of spend but deliver ${(([...donorsPause, ...donorsFix].reduce((a, r) => a + r.attendanceShare, 0)) * 100).toFixed(0)}% of campaign-attributed attendees.`,
      evidence: [...[...donorsPause, ...donorsFix].map(fmt), ...recipients.slice().sort((a, b) => a.cpa - b.cpa).slice(0, 3).map(fmt)],
      intervention: `Cut ${donorsPause.map((r) => r.name).join(', ') || '—'} by 50% and ${donorsFix.map((r) => r.name).join(', ') || '—'} by 20%; move funds plus unspent budget (₹${Math.round(unspent).toLocaleString('en-IN')}) into ${recipients.slice().sort((a, b) => a.cpa - b.cpa).slice(0, 3).map((r) => r.name).join(', ')}.`,
      audience: 'College clubs, referred friends, information-seekers and peer-ambassador audiences',
      successMetric: 'Cost per verified attendee (blended) and verified attendees per ₹10,000',
      impact: { low: Math.round(lo.net), base: Math.round(ba.net), high: Math.round(hi.net) },
      assumptions: [
        `Removed spend loses attendees at the donor campaign's average cost per attendee.`,
        `Added spend earns attendees at ${3}× / ${2}× / ${1.5}× the recipients' blended average cost per attendee (₹${Math.round(recCpa)}) — diminishing returns, because average cost is not marginal cost.`,
        `Base case moves ₹${Math.round(ba.moved).toLocaleString('en-IN')} plus ₹${Math.round(unspent).toLocaleString('en-IN')} unspent budget.`,
      ],
      cost: Math.round(unspent), costNote: 'Reallocation is budget-neutral; only the unspent approved budget is new money.',
      confidence: 'Low', effort: 'Medium', daysToSignal: 14,
      experiment: 'Staged shift: move 25% of the planned amount for 14 days, track marginal cost per registration and per confirmed registrant in recipient campaigns before moving the rest.',
      thresholds: { scale: 'Recipient marginal cost per confirmed registrant ≤ 2× its historical average → move the rest', change: '2–3× → cap recipient spend, test new creative/partners', stop: '> 3× or recipient show rate drops below portfolio → stop and revert' },
      score: 0, rank: 0, campaignIds: [...donorsPause, ...donorsFix, ...recipients].map((r) => r.id),
    })
  }

  for (const o of list) o.score = Math.round((o.impact.base * CONF_W[o.confidence]) / EFFORT_W[o.effort] / (1 + o.daysToSignal / 30) * 10) / 10
  list.sort((a, b) => b.score - a.score)
  list.forEach((o, i) => (o.rank = i + 1))

  const sum = (k: 'low' | 'base' | 'high') => list.reduce((a, o) => a + Math.max(0, o.impact[k]), 0)
  const budgetPlan = list.filter((o) => o.cost > 0).map((o) => ({ label: `${o.id} ${o.short}`, amount: o.cost }))
  return { list, baseline: snap.visitors, scenario: { low: snap.visitors + sum('low'), base: snap.visitors + sum('base'), high: snap.visitors + sum('high') }, budgetPlan, budgetRemaining }
}

/** Ideas we deliberately do NOT fund, derived from the same campaign evidence. */
export function deprioritized(m: Model, s: Scope): { idea: string; why: string }[] {
  const perf = campaignPerformance(m, s)
  const out: { idea: string; why: string }[] = []
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`
  for (const r of perf.rows.filter((x) => x.quadrant.startsWith('Fix'))) {
    out.push({ idea: `Scaling ${r.name} reach`, why: `${pct(r.spendShare)} of spend, ${pct(r.attendanceShare)} of attributed attendees; ${pct(r.showRate)} show rate vs ${pct(perf.portfolio.showRate)} portfolio. More impressions add registrations that do not attend.` })
  }
  for (const r of perf.rows.filter((x) => x.quadrant.startsWith('Pause'))) {
    out.push({ idea: `Re-funding ${r.name} as-is`, why: `Highest-cost attendees (₹${Math.round(r.cpa)} each vs ₹${Math.round(perf.portfolio.cpa)} portfolio) with low volume — redesign before more spend.` })
  }
  const segs = engagementSegments(m, s).filter((x) => x.segment === 'Received nurture email')
  const yes = segs.find((x) => x.group === 'Yes'), no = segs.find((x) => x.group === 'No')
  if (yes && no && yes.regRate < no.regRate) {
    out.push({ idea: 'Blanket nurture email to every lead', why: `Nurture emails went mostly to people who had not registered (recipients registered at ${pct(yes.regRate)} vs ${pct(no.regRate)} of non-recipients). That gap is selection, not lift, and there is no holdout to measure email impact — send only to form-starters, with a holdout.` })
  }
  return out
}

/** Base-case budget plan implied by O2 and the other opportunities' assumed costs.
 *  Donors: Pause quadrant −50%, Fix quadrant −20%. Freed money + unspent campaign budget goes to the
 *  three lowest-cost-per-attendee Grow/Scale campaigns, split by their verified attendees. Modeled. */
export function proposedAllocation(m: Model, s: Scope) {
  const perf = campaignPerformance(m, { ...s, campaignIds: null })
  const o = opportunities(m, s)
  const snap = snapshot(m, { ...s, campaignIds: null })
  const nonCampaign = o.list.filter((x) => x.id !== 'O2').reduce((a, x) => a + x.cost, 0)
  const unspentToCampaigns = Math.max(0, Math.max(0, snap.gap.budgetRemaining) - nonCampaign)
  const rec = perf.rows.filter((r) => (r.quadrant.startsWith('Grow') || r.quadrant.startsWith('Scale')) && r.cpa < perf.portfolio.cpa).sort((a, b) => a.cpa - b.cpa).slice(0, 3)
  const cut = (r: CampaignPerf) => (r.quadrant.startsWith('Pause') ? 0.5 : r.quadrant.startsWith('Fix') ? 0.2 : 0)
  const freed = perf.rows.reduce((a, r) => a + r.spend * cut(r), 0)
  const recAtt = rec.reduce((a, r) => a + r.attendees, 0)
  const rows = perf.rows.map((r) => {
    const add = rec.includes(r) ? ((freed + unspentToCampaigns) * r.attendees) / recAtt : 0
    const proposed = Math.round((r.spend * (1 - cut(r)) + add) / 500) * 500
    return { id: r.id, name: r.name, current: r.spend, proposed, delta: proposed - r.spend, cpa: r.cpa, quadrant: r.quadrant }
  })
  const activation = o.list.filter((x) => x.id !== 'O2').map((x) => ({ id: x.id, label: x.short, amount: x.cost }))
  const total = rows.reduce((a, r) => a + r.proposed, 0) + activation.reduce((a, x) => a + x.amount, 0)
  return { rows, activation, total, budget: snap.target.budget, freed, unspentToCampaigns }
}
