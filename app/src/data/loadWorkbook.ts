import * as XLSX from 'xlsx'
import type {
  Campaign, Checkin, DailyRow, EventInfo, HistoryRow, Interaction, Person, RawWorkbook,
  Registration, RegStatus, SheetAudit, TargetVersion,
} from './types'
import { toTime } from '../lib/time'

export const BUNDLED_WORKBOOK_URL = './data/Attendee Dataset.xlsx'

export const REQUIRED_SHEETS = [
  'Read me', 'Field guide', 'Event', 'Targets', 'Campaigns', 'Daily Marketing', 'People',
  'Interest and Engagement', 'Registrations', 'Registration History', 'Check-ins',
] as const

type Row = Record<string, unknown>

export class WorkbookError extends Error {}

const str = (v: unknown): string => (v == null ? '' : String(v).trim())
const optStr = (v: unknown): string | null => (str(v) === '' ? null : str(v))
const n = (v: unknown): number => {
  if (typeof v === 'number') return v
  const x = Number(str(v).replace(/,/g, ''))
  return Number.isFinite(x) ? x : NaN
}
const bool = (v: unknown) => v === true || /^true$/i.test(str(v))

function rows(wb: XLSX.WorkBook, sheet: string, required: string[]): Row[] {
  const ws = wb.Sheets[sheet]
  if (!ws) throw new WorkbookError(`Sheet "${sheet}" is missing from the workbook.`)
  const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true })
  const cols = new Set(Object.keys(data[0] ?? {}))
  const missing = required.filter((c) => !cols.has(c))
  if (data.length && missing.length) {
    throw new WorkbookError(`Sheet "${sheet}" is missing column(s): ${missing.join(', ')}.`)
  }
  return data
}

/** Deduplicates on a stable source ID. Exact repeats (import retries) count once.
 *  Same ID with different content is kept once (first occurrence) and reported. */
function dedupe<T>(
  sheet: string, data: Row[], idCol: string, map: (r: Row) => T | null, requiredCols: string[],
): { items: T[]; audit: SheetAudit } {
  const seen = new Map<string, string>()
  const items: T[] = []
  let dup = 0, conflict = 0, missing = 0
  for (const r of data) {
    const id = str(r[idCol])
    if (!id || requiredCols.some((c) => r[c] == null || str(r[c]) === '')) { missing++; continue }
    const sig = JSON.stringify(r)
    const prev = seen.get(id)
    if (prev !== undefined) { if (prev === sig) dup++; else conflict++; continue }
    seen.set(id, sig)
    const m = map(r)
    if (m == null) { missing++; continue }
    items.push(m)
  }
  return {
    items,
    audit: { sheet, rowsRead: data.length, rowsKept: items.length, duplicateIdsRemoved: dup, conflictingDuplicates: conflict, missingRequired: missing, notes: [] },
  }
}

export function parseWorkbook(buf: ArrayBuffer, sourceName: string): RawWorkbook {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'array', cellDates: false })
  } catch (e) {
    throw new WorkbookError(`Could not read the file as an Excel workbook (${(e as Error).message}).`)
  }
  const missingSheets = REQUIRED_SHEETS.filter((s) => !wb.SheetNames.includes(s))
  if (missingSheets.length) throw new WorkbookError(`Workbook is missing sheet(s): ${missingSheets.join(', ')}.`)

  const audits: SheetAudit[] = []

  const readMe = rows(wb, 'Read me', ['topic', 'description']).map((r) => ({ topic: str(r.topic), description: str(r.description) }))
  const fieldGuide = rows(wb, 'Field guide', ['source_table', 'field', 'data_type', 'meaning']).map((r) => ({
    table: str(r.source_table), field: str(r.field), type: str(r.data_type), meaning: str(r.meaning),
  }))

  const ev = rows(wb, 'Event', ['event_name', 'history_start', 'history_end', 'event_starts_at', 'event_ends_at', 'timezone', 'currency'])[0]
  if (!ev) throw new WorkbookError('Event sheet has no rows.')
  const event: EventInfo = {
    name: str(ev.event_name), historyStart: toTime(ev.history_start), historyEnd: toTime(ev.history_end),
    startsAt: toTime(ev.event_starts_at), endsAt: toTime(ev.event_ends_at), timezone: str(ev.timezone),
    currency: str(ev.currency), fictional: bool(ev.fictional),
  }

  const targets: TargetVersion[] = rows(wb, 'Targets', ['effective_at', 'identified_external_people_goal', 'registration_goal', 'unique_external_visitors_goal', 'marketing_budget_inr'])
    .map((r) => ({
      effectiveAt: toTime(r.effective_at), identifiedGoal: n(r.identified_external_people_goal), registrationGoal: n(r.registration_goal),
      visitorsGoal: n(r.unique_external_visitors_goal), budget: n(r.marketing_budget_inr), version: str(r.target_version),
    }))
    .filter((t) => Number.isFinite(t.effectiveAt))
    .sort((a, b) => a.effectiveAt - b.effectiveAt)
  if (!targets.length) throw new WorkbookError('Targets sheet has no valid rows.')

  const camp = dedupe<Campaign>('Campaigns', rows(wb, 'Campaigns', ['campaign_id', 'campaign_name', 'channel']), 'campaign_id', (r) => ({
    id: str(r.campaign_id), name: str(r.campaign_name), channel: str(r.channel), audience: str(r.target_audience), objective: str(r.objective),
    ownerId: str(r.owner_id), ownerName: str(r.owner_name), createdAt: toTime(r.created_at), plannedStart: toTime(r.planned_start_at), plannedEnd: toTime(r.planned_end_at),
  }), ['campaign_name'])
  audits.push(camp.audit)

  const daily = dedupe<DailyRow>('Daily Marketing', rows(wb, 'Daily Marketing', ['activity_id', 'campaign_id', 'activity_date', 'marketing_spend_inr']), 'activity_id', (r) => {
    const day = toTime(r.activity_date)
    if (!Number.isFinite(day)) return null
    return {
      activityId: str(r.activity_id), campaignId: str(r.campaign_id), day,
      impressions: n(r.impressions) || 0, clicks: n(r.clicks) || 0, reach: n(r.reported_reach) || 0,
      sessions: n(r.landing_page_sessions) || 0, regStarts: n(r.registration_starts) || 0,
      spend: n(r.marketing_spend_inr) || 0, platform: str(r.platform),
    }
  }, ['campaign_id', 'activity_date'])
  const negatives = daily.items.filter((d) => d.spend < 0)
  if (negatives.length) daily.audit.notes.push(`${negatives.length} rows carry negative spend (vendor credits / ledger adjustments, total ₹${negatives.reduce((s, d) => s + d.spend, 0).toLocaleString('en-IN')}). Kept as net debits less credits, per the field guide.`)
  audits.push(daily.audit)

  const ppl = dedupe<Person>('People', rows(wb, 'People', ['person_id', 'person_type', 'first_seen_at']), 'person_id', (r) => ({
    id: str(r.person_id), name: str(r.person_name), type: str(r.person_type) as Person['type'], firstSeen: toTime(r.first_seen_at),
    firstTouch: str(r.first_touch_source), firstCampaignId: optStr(r.first_campaign_id), ownerId: str(r.owner_id),
  }), ['person_type', 'first_seen_at'])
  audits.push(ppl.audit)

  const ints = dedupe<Interaction>('Interest and Engagement', rows(wb, 'Interest and Engagement', ['interaction_id', 'person_id', 'event_type', 'occurred_at']), 'interaction_id', (r) => ({
    id: str(r.interaction_id), personId: str(r.person_id), campaignId: str(r.campaign_id), at: toTime(r.occurred_at), type: str(r.event_type),
  }), ['person_id', 'occurred_at', 'event_type'])
  audits.push(ints.audit)

  const regs = dedupe<Registration>('Registrations', rows(wb, 'Registrations', ['registration_id', 'person_id', 'registered_at']), 'registration_id', (r) => ({
    id: str(r.registration_id), personId: str(r.person_id), campaignId: str(r.campaign_id), at: toTime(r.registered_at),
  }), ['person_id', 'registered_at'])
  audits.push(regs.audit)

  const hist = dedupe<HistoryRow>('Registration History', rows(wb, 'Registration History', ['history_id', 'registration_id', 'status', 'effective_at']), 'history_id', (r) => ({
    id: str(r.history_id), registrationId: str(r.registration_id), personId: str(r.person_id), campaignId: str(r.campaign_id),
    at: toTime(r.effective_at), status: str(r.status) as RegStatus,
  }), ['registration_id', 'status', 'effective_at'])
  audits.push(hist.audit)

  const chk = dedupe<Checkin>('Check-ins', rows(wb, 'Check-ins', ['event_id', 'person_id', 'result', 'verification', 'occurred_at']), 'event_id', (r) => ({
    id: str(r.event_id), personId: str(r.person_id), registrationId: optStr(r.registration_id), campaignId: optStr(r.campaign_id),
    at: toTime(r.occurred_at), result: str(r.result) as Checkin['result'], verification: str(r.verification) as Checkin['verification'],
    source: str(r.source) as Checkin['source'],
  }), ['person_id', 'occurred_at', 'result'])
  audits.push(chk.audit)

  return {
    event, targets, campaigns: camp.items, daily: daily.items, people: ppl.items, interactions: ints.items,
    registrations: regs.items, history: hist.items, checkins: chk.items, readMe, fieldGuide, audits,
    sourceName, loadedAt: Date.now(),
  }
}

export async function fetchBundledWorkbook(): Promise<RawWorkbook> {
  const res = await fetch(BUNDLED_WORKBOOK_URL)
  if (!res.ok) throw new WorkbookError(`Could not load the bundled workbook (HTTP ${res.status}).`)
  return parseWorkbook(await res.arrayBuffer(), 'Attendee Dataset.xlsx (bundled)')
}
