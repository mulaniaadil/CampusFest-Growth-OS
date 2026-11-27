// Builds the joined, person-level analytical model from the cleaned source records.
// Joins use stable IDs only (person_id, registration_id, campaign_id) — never names.

import type { Campaign, Person, RawWorkbook, RegStatus } from '../data/types'
import { DAY, endOfDay, startOfDay } from '../lib/time'

export const UNATTRIBUTED = 'UNATTRIBUTED'

export interface RegFact {
  id: string
  at: number
  campaignId: string
  history: { at: number; status: RegStatus }[] // sorted ascending, deduplicated
}

export interface PersonFact {
  id: string
  name: string
  firstSeen: number
  firstTouch: string
  campaignId: string // first-touch campaign, or UNATTRIBUTED
  reg: RegFact | null
  firstVerifiedAdmit: number | null // earliest admitted+verified check-in
  admitEvents: number // admitted+verified admission events (deduplicated by event_id)
  admitDays: number // distinct IST days with a verified admission
  manualOnly: boolean // all verified admissions were manual entries
  gateIssueAt: number | null // earliest denied / pending check-in observation
  firstAt: Record<string, number> // earliest occurrence of each identified interaction type
}

export interface CampaignInfo extends Campaign {
  isSource: true
}

export interface DQIssue {
  severity: 'info' | 'warning'
  area: string
  finding: string
  handling: string
  count?: number
}

export interface Model {
  raw: RawWorkbook
  campaigns: CampaignInfo[]
  campaignById: Map<string, CampaignInfo>
  external: PersonFact[]
  externalById: Map<string, PersonFact>
  nonExternal: { type: string; people: number; registrations: number; verifiedAdmits: number }[]
  dailyByCampaign: Map<string, Map<number, { impressions: number; clicks: number; reach: number; sessions: number; regStarts: number; spend: number }>>
  dayRange: { start: number; end: number }
  quality: DQIssue[]
  interactionTypes: string[]
}

export function statusAt(reg: RegFact, t: number): RegStatus | null {
  let s: RegStatus | null = null
  for (const h of reg.history) {
    if (h.at <= t) s = h.status
    else break
  }
  return s
}

export function campaignLabel(m: Model, id: string): string {
  if (id === UNATTRIBUTED) return 'Walk-in / unattributed'
  return m.campaignById.get(id)?.name ?? id
}
export function channelOf(m: Model, id: string): string {
  if (id === UNATTRIBUTED) return 'walk_in'
  return m.campaignById.get(id)?.channel ?? 'unknown'
}

export function buildModel(raw: RawWorkbook): Model {
  const quality: DQIssue[] = []
  const campaigns: CampaignInfo[] = raw.campaigns.map((c) => ({ ...c, isSource: true as const }))
  const campaignById = new Map(campaigns.map((c) => [c.id, c]))

  for (const a of raw.audits) {
    if (a.duplicateIdsRemoved) quality.push({ severity: 'info', area: a.sheet, count: a.duplicateIdsRemoved, finding: `${a.duplicateIdsRemoved} exact repeated source IDs (import retries).`, handling: 'Counted once (deduplicated on the stable ID).' })
    if (a.conflictingDuplicates) quality.push({ severity: 'warning', area: a.sheet, count: a.conflictingDuplicates, finding: `${a.conflictingDuplicates} repeated IDs with different content.`, handling: 'First occurrence kept; flagged for review.' })
    if (a.missingRequired) quality.push({ severity: 'warning', area: a.sheet, count: a.missingRequired, finding: `${a.missingRequired} rows missing a required ID or timestamp.`, handling: 'Excluded from metrics; not imputed.' })
    for (const note of a.notes) quality.push({ severity: 'info', area: a.sheet, finding: note, handling: 'Included in net spend.' })
  }

  const peopleById = new Map<string, Person>(raw.people.map((p) => [p.id, p]))

  // Name collisions (names are display labels only)
  const nameCount = new Map<string, Set<string>>()
  for (const p of raw.people) {
    if (!nameCount.has(p.name)) nameCount.set(p.name, new Set())
    nameCount.get(p.name)!.add(p.id)
  }
  const sharedNames = [...nameCount.values()].filter((s) => s.size > 1).length
  if (sharedNames) quality.push({ severity: 'info', area: 'People', count: sharedNames, finding: `${sharedNames} display names are shared by more than one person_id.`, handling: 'All joins use person_id; names are display only.' })

  // Registrations + history
  const histByReg = new Map<string, { at: number; status: RegStatus }[]>()
  for (const h of raw.history) {
    if (!histByReg.has(h.registrationId)) histByReg.set(h.registrationId, [])
    histByReg.get(h.registrationId)!.push({ at: h.at, status: h.status })
  }
  const regIds = new Set(raw.registrations.map((r) => r.id))
  const orphanHist = raw.history.filter((h) => !regIds.has(h.registrationId)).length
  if (orphanHist) quality.push({ severity: 'warning', area: 'Registration History', count: orphanHist, finding: `${orphanHist} status versions reference an unknown registration_id.`, handling: 'Excluded.' })

  const regByPerson = new Map<string, RegFact>()
  let multiReg = 0, noHist = 0, histBeforeReg = 0, ties = 0, regCampaignMismatch = 0, regOrphan = 0
  for (const r of raw.registrations) {
    const h = (histByReg.get(r.id) ?? []).sort((a, b) => a.at - b.at)
    if (!h.length) noHist++
    for (let i = 1; i < h.length; i++) if (h[i].at === h[i - 1].at) ties++
    if (h.length && h[0].at < r.at) histBeforeReg++
    const p = peopleById.get(r.personId)
    if (!p) { regOrphan++; continue }
    if (p.firstCampaignId && p.firstCampaignId !== r.campaignId) regCampaignMismatch++
    const prev = regByPerson.get(r.personId)
    if (prev) { multiReg++; if (prev.at <= r.at) continue }
    regByPerson.set(r.personId, { id: r.id, at: r.at, campaignId: r.campaignId, history: h })
  }
  if (multiReg) quality.push({ severity: 'warning', area: 'Registrations', count: multiReg, finding: `${multiReg} people hold more than one registration.`, handling: 'Earliest registration used; a person counts once.' })
  else quality.push({ severity: 'info', area: 'Registrations', finding: 'Every registration belongs to a distinct person_id (no person holds two registrations).', handling: 'Unique registrations = distinct external person_ids with a registration.' })
  if (noHist) quality.push({ severity: 'warning', area: 'Registration History', count: noHist, finding: `${noHist} registrations have no status history.`, handling: 'Counted as registered with unknown status.' })
  if (histBeforeReg) quality.push({ severity: 'warning', area: 'Registration History', count: histBeforeReg, finding: `${histBeforeReg} registrations have a status version earlier than registered_at.`, handling: 'Status versions used as recorded.' })
  if (ties) quality.push({ severity: 'warning', area: 'Registration History', count: ties, finding: `${ties} status versions share a timestamp with another version of the same registration.`, handling: 'Ordered by source order; review.' })
  if (regOrphan) quality.push({ severity: 'warning', area: 'Registrations', count: regOrphan, finding: `${regOrphan} registrations reference an unknown person_id.`, handling: 'Excluded.' })
  if (regCampaignMismatch) quality.push({ severity: 'info', area: 'Registrations', count: regCampaignMismatch, finding: `${regCampaignMismatch} registrations record a different campaign than the person's first touch.`, handling: 'First-touch campaign (People sheet) used for attribution.' })
  else quality.push({ severity: 'info', area: 'Attribution', finding: 'Registration campaign_id equals the person\'s first_campaign_id for every registration.', handling: 'First-touch attribution and registration-source attribution give identical results.' })
  const reconfirmed = [...regByPerson.values()].filter((r) => r.history.some((h, i) => h.status === 'confirmed' && r.history.slice(0, i).some((x) => x.status === 'cancelled'))).length
  if (reconfirmed) quality.push({ severity: 'info', area: 'Registration History', count: reconfirmed, finding: `${reconfirmed} registrations were cancelled and later re-confirmed.`, handling: 'Status at any date = latest version effective at or before that date; re-confirmation is not a new person.' })

  // Check-ins
  const adm = new Map<string, { first: number; events: number; days: Set<number>; manual: number }>()
  const gate = new Map<string, number>()
  let outside = 0, ckOrphan = 0, ckRegMismatch = 0
  const regById = new Map(raw.registrations.map((r) => [r.id, r]))
  for (const c of raw.checkins) {
    if (!peopleById.has(c.personId)) { ckOrphan++; continue }
    if (c.at < startOfDay(raw.event.startsAt) || c.at > endOfDay(raw.event.endsAt)) outside++
    if (c.registrationId && regById.get(c.registrationId)?.personId !== c.personId) ckRegMismatch++
    if (c.result === 'admitted' && c.verification === 'verified') {
      const a = adm.get(c.personId) ?? { first: Infinity, events: 0, days: new Set<number>(), manual: 0 }
      a.first = Math.min(a.first, c.at); a.events++; a.days.add(startOfDay(c.at)); if (c.source === 'manual') a.manual++
      adm.set(c.personId, a)
    } else {
      gate.set(c.personId, Math.min(gate.get(c.personId) ?? Infinity, c.at))
    }
  }
  if (ckOrphan) quality.push({ severity: 'warning', area: 'Check-ins', count: ckOrphan, finding: `${ckOrphan} check-ins reference an unknown person_id.`, handling: 'Excluded.' })
  if (outside) quality.push({ severity: 'warning', area: 'Check-ins', count: outside, finding: `${outside} check-ins fall outside the event days.`, handling: 'Kept; review.' })
  if (ckRegMismatch) quality.push({ severity: 'warning', area: 'Check-ins', count: ckRegMismatch, finding: `${ckRegMismatch} check-ins point to a registration owned by another person.`, handling: 'person_id used.' })
  const verifiedEvents = raw.checkins.filter((c) => c.result === 'admitted' && c.verification === 'verified').length
  quality.push({ severity: 'info', area: 'Check-ins', count: verifiedEvents, finding: `${verifiedEvents.toLocaleString('en-IN')} admitted+verified admission events belong to ${adm.size.toLocaleString('en-IN')} distinct people (re-entry and two-day attendance).`, handling: 'Verified attendee = distinct person_id with ≥1 admitted + verified check-in.' })
  const nonVerified = raw.checkins.filter((c) => !(c.result === 'admitted' && c.verification === 'verified')).length
  if (nonVerified) quality.push({ severity: 'info', area: 'Check-ins', count: nonVerified, finding: `${nonVerified} denied or pending/unverified admission observations.`, handling: 'Do not establish attendance on their own.' })

  // Interactions
  const firstAt = new Map<string, Record<string, number>>()
  const types = new Set<string>()
  let intOrphan = 0
  for (const i of raw.interactions) {
    if (!peopleById.has(i.personId)) { intOrphan++; continue }
    types.add(i.type)
    const rec = firstAt.get(i.personId) ?? {}
    if (rec[i.type] == null || i.at < rec[i.type]) rec[i.type] = i.at
    firstAt.set(i.personId, rec)
  }
  if (intOrphan) quality.push({ severity: 'warning', area: 'Interest and Engagement', count: intOrphan, finding: `${intOrphan} interactions reference an unknown person_id.`, handling: 'Excluded.' })

  // Person facts (external only for acquisition metrics)
  const external: PersonFact[] = []
  const nonExt = new Map<string, { type: string; people: number; registrations: number; verifiedAdmits: number }>()
  for (const p of raw.people) {
    const a = adm.get(p.id)
    if (p.type !== 'external') {
      const s = nonExt.get(p.type) ?? { type: p.type, people: 0, registrations: 0, verifiedAdmits: 0 }
      s.people++; if (regByPerson.has(p.id)) s.registrations++; if (a) s.verifiedAdmits++
      nonExt.set(p.type, s)
      continue
    }
    external.push({
      id: p.id, name: p.name, firstSeen: p.firstSeen, firstTouch: p.firstTouch,
      campaignId: p.firstCampaignId ?? UNATTRIBUTED,
      reg: regByPerson.get(p.id) ?? null,
      firstVerifiedAdmit: a ? a.first : null, admitEvents: a?.events ?? 0, admitDays: a?.days.size ?? 0,
      manualOnly: !!a && a.manual === a.events, gateIssueAt: gate.has(p.id) ? gate.get(p.id)! : null,
      firstAt: firstAt.get(p.id) ?? {},
    })
  }
  const nonExternal = [...nonExt.values()]
  if (nonExternal.length) {
    const txt = nonExternal.map((s) => `${s.type} ${s.people} (${s.registrations} registered, ${s.verifiedAdmits} admitted)`).join('; ')
    quality.push({ severity: 'info', area: 'People', finding: `Non-external records excluded from acquisition metrics: ${txt}.`, handling: 'Targets apply to external people only.' })
  }
  const walkIns = external.filter((p) => p.campaignId === UNATTRIBUTED).length
  if (walkIns) quality.push({ severity: 'info', area: 'Attribution', count: walkIns, finding: `${walkIns} external people have no campaign (walk-ins identified at event access).`, handling: 'Shown as "Walk-in / unattributed". Empty campaign ≠ zero acquisition cost.' })

  // Daily marketing, by campaign & day
  const dailyByCampaign: Model['dailyByCampaign'] = new Map()
  for (const d of raw.daily) {
    if (!dailyByCampaign.has(d.campaignId)) dailyByCampaign.set(d.campaignId, new Map())
    const m = dailyByCampaign.get(d.campaignId)!
    const cur = m.get(d.day) ?? { impressions: 0, clicks: 0, reach: 0, sessions: 0, regStarts: 0, spend: 0 }
    cur.impressions += d.impressions; cur.clicks += d.clicks; cur.reach += d.reach; cur.sessions += d.sessions; cur.regStarts += d.regStarts; cur.spend += d.spend
    m.set(d.day, cur)
  }
  const unknownCampaign = raw.daily.filter((d) => !campaignById.has(d.campaignId)).length
  if (unknownCampaign) quality.push({ severity: 'warning', area: 'Daily Marketing', count: unknownCampaign, finding: `${unknownCampaign} daily rows reference an unknown campaign_id.`, handling: 'Included in totals; not attributable to a listed campaign.' })
  const postEvent = raw.daily.filter((d) => d.day > raw.event.endsAt).reduce((s, d) => s + d.spend, 0)
  if (postEvent) quality.push({ severity: 'info', area: 'Daily Marketing', finding: `Net spend posted after the event: ₹${postEvent.toLocaleString('en-IN')}.`, handling: 'Spend is counted on its posting date; cumulative spend can fall after the event.' })
  quality.push({ severity: 'info', area: 'Daily Marketing', finding: 'Impressions, clicks, reach, sessions and form starts are anonymous event counts, not unique people.', handling: 'Shown as awareness/activity volume only; never added to person counts.' })

  const start = startOfDay(raw.event.historyStart)
  const end = endOfDay(raw.event.historyEnd)

  return {
    raw, campaigns, campaignById, external, externalById: new Map(external.map((p) => [p.id, p])), nonExternal,
    dailyByCampaign, dayRange: { start, end }, quality, interactionTypes: [...types].sort(),
  }
}

export function listDays(start: number, end: number): number[] {
  const out: number[] = []
  for (let t = startOfDay(start); t <= end; t += DAY) out.push(t)
  return out
}
