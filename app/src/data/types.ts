// Source-record types. Every timestamp is stored as "IST wall-clock milliseconds":
// the Asia/Kolkata local time encoded on a UTC time line, so day boundaries and
// formatting never depend on the browser's own timezone. See lib/time.ts.

export type PersonType = 'external' | 'internal' | 'staff' | 'test'
export type RegStatus = 'interested' | 'confirmed' | 'cancelled' | 'waitlisted'

export interface EventInfo {
  name: string
  historyStart: number
  historyEnd: number
  startsAt: number
  endsAt: number
  timezone: string
  currency: string
  fictional: boolean
}

export interface TargetVersion {
  effectiveAt: number
  identifiedGoal: number
  registrationGoal: number
  visitorsGoal: number
  budget: number
  version: string
}

export interface Campaign {
  id: string
  name: string
  channel: string
  audience: string
  objective: string
  ownerId: string
  ownerName: string
  createdAt: number
  plannedStart: number
  plannedEnd: number
}

export interface DailyRow {
  activityId: string
  campaignId: string
  day: number // IST midnight of the activity date
  impressions: number
  clicks: number
  reach: number
  sessions: number
  regStarts: number
  spend: number
  platform: string
}

export interface Person {
  id: string
  name: string
  type: PersonType
  firstSeen: number
  firstTouch: string
  firstCampaignId: string | null
  ownerId: string
}

export interface Interaction {
  id: string
  personId: string
  campaignId: string
  at: number
  type: string
}

export interface Registration {
  id: string
  personId: string
  campaignId: string
  at: number
}

export interface HistoryRow {
  id: string
  registrationId: string
  personId: string
  campaignId: string
  at: number
  status: RegStatus
}

export interface Checkin {
  id: string
  personId: string
  registrationId: string | null
  campaignId: string | null
  at: number
  result: 'admitted' | 'denied' | 'pending'
  verification: 'verified' | 'unverified'
  source: 'scanner' | 'manual'
}

export interface SheetAudit {
  sheet: string
  rowsRead: number
  rowsKept: number
  duplicateIdsRemoved: number
  conflictingDuplicates: number
  missingRequired: number
  notes: string[]
}

export interface RawWorkbook {
  event: EventInfo
  targets: TargetVersion[]
  campaigns: Campaign[]
  daily: DailyRow[]
  people: Person[]
  interactions: Interaction[]
  registrations: Registration[]
  history: HistoryRow[]
  checkins: Checkin[]
  readMe: { topic: string; description: string }[]
  fieldGuide: { table: string; field: string; type: string; meaning: string }[]
  audits: SheetAudit[]
  sourceName: string
  loadedAt: number
}
