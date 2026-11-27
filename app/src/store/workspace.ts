// Workspace state = everything the team creates in the product (local campaigns, plan overlays
// on source campaigns, experiments, tasks, activity log). Source workbook data is never mutated.
// Persistence: localStorage always; Supabase (free tier) additionally when configured.

import { useSyncExternalStore } from 'react'
import { loadRemote, remoteEnabled, saveRemote } from './supabase'

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'archived' | 'completed'
export type TargetMetric = 'verified_attendees' | 'registrations' | 'confirmed_show_rate' | 'cost_per_attendee'

export const TARGET_METRIC_LABEL: Record<TargetMetric, string> = {
  verified_attendees: 'Verified attendees',
  registrations: 'Registrations',
  confirmed_show_rate: 'Confirmed → attended rate (%)',
  cost_per_attendee: 'Cost per verified attendee (₹, max)',
}

/** Experiment plan attached to a campaign (local or source plan overlay). */
export interface ExperimentPlan {
  hypothesis?: string
  leadingIndicator?: string
  scaleRule?: string
  stopRule?: string
}

export interface ResultEntry {
  id: string
  date: string
  spend: number
  registrations: number
  attendees: number
  note: string
}

export interface LocalCampaign extends ExperimentPlan {
  id: string
  name: string
  channel: string
  audienceSegment: string
  objective: string
  owner: string
  budget: number
  start: string
  end: string
  targetMetric: TargetMetric
  targetValue: number
  status: CampaignStatus
  notes: string
  origin: 'manual' | 'analyst'
  linkedOpportunity?: string
  basedOn?: string // source campaign id this draft extends
  results: ResultEntry[]
  createdAt: number
  updatedAt: number
}

export interface SourceOverlay extends ExperimentPlan {
  status?: CampaignStatus
  proposedBudget?: number
  notes?: string
  updatedAt: number
}

export interface Experiment {
  id: string
  campaignRef: string // source campaign id or local campaign id
  name: string
  hypothesis: string
  metric: string
  control: string
  variant: string
  start: string
  end: string
  status: 'planned' | 'running' | 'concluded'
  controlValue?: number
  variantValue?: number
  decision?: 'scale' | 'change' | 'stop' | ''
  learning?: string
  createdAt: number
}

export interface Task {
  id: string
  title: string
  owner: string
  due: string
  status: 'todo' | 'doing' | 'done'
  campaignRef?: string
  opportunityId?: string
  origin: 'manual' | 'analyst'
  createdAt: number
}

export interface ActivityEntry {
  at: number
  text: string
}

export interface WorkspaceState {
  version: 1
  campaigns: LocalCampaign[]
  overlays: Record<string, SourceOverlay>
  experiments: Experiment[]
  tasks: Task[]
  activity: ActivityEntry[]
  updatedAt: number
}

const KEY = 'campusfest-growth-os:workspace:v1'
const empty = (): WorkspaceState => ({ version: 1, campaigns: [], overlays: {}, experiments: [], tasks: [], activity: [], updatedAt: 0 })

function read(): WorkspaceState {
  try {
    const s = localStorage.getItem(KEY)
    if (!s) return empty()
    const parsed = JSON.parse(s) as WorkspaceState
    return { ...empty(), ...parsed }
  } catch {
    return empty()
  }
}

let state: WorkspaceState = typeof localStorage !== 'undefined' ? read() : empty()
const listeners = new Set<() => void>()
export type SyncStatus = 'local' | 'syncing' | 'synced' | 'error'
let syncStatus: SyncStatus = remoteEnabled ? 'syncing' : 'local'
let syncError = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

function emit() {
  for (const l of listeners) l()
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage full / disabled — state stays in memory */
  }
  if (remoteEnabled) {
    if (saveTimer) clearTimeout(saveTimer)
    syncStatus = 'syncing'
    saveTimer = setTimeout(async () => {
      try {
        await saveRemote(state)
        syncStatus = 'synced'; syncError = ''
      } catch (e) {
        syncStatus = 'error'; syncError = (e as Error).message
      }
      emit()
    }, 600)
  }
}

export function update(mutator: (s: WorkspaceState) => void, log?: string) {
  const next: WorkspaceState = structuredClone(state)
  mutator(next)
  next.updatedAt = Date.now()
  if (log) next.activity = [{ at: next.updatedAt, text: log }, ...next.activity].slice(0, 200)
  state = next
  persist()
  emit()
}

export function getState() {
  return state
}

export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state, () => state)
}
export function useSyncStatus(): { status: SyncStatus; error: string } {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => syncStatus + '|' + syncError, () => syncStatus)
  const [status, error] = s.split('|')
  return { status: status as SyncStatus, error: error ?? '' }
}

/** Pulls the Supabase copy once at start-up; newer copy wins. */
export async function initRemoteSync() {
  if (!remoteEnabled) return
  try {
    const remote = await loadRemote()
    if (remote && remote.updatedAt > state.updatedAt) {
      state = { ...empty(), ...remote }
      try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
    } else if (state.updatedAt > 0) {
      await saveRemote(state)
    }
    syncStatus = 'synced'
  } catch (e) {
    syncStatus = 'error'; syncError = (e as Error).message
  }
  emit()
}

export function resetWorkspace() {
  state = empty()
  persist()
  emit()
}

export const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

// ---- domain helpers
export function upsertCampaign(c: LocalCampaign, log: string) {
  update((s) => {
    const i = s.campaigns.findIndex((x) => x.id === c.id)
    const v = { ...c, updatedAt: Date.now() }
    if (i >= 0) s.campaigns[i] = v
    else s.campaigns.unshift(v)
  }, log)
}
export function setCampaignStatus(id: string, status: CampaignStatus, isSource: boolean, name: string) {
  update((s) => {
    if (isSource) s.overlays[id] = { ...(s.overlays[id] ?? { updatedAt: 0 }), status, updatedAt: Date.now() }
    else {
      const c = s.campaigns.find((x) => x.id === id)
      if (c) { c.status = status; c.updatedAt = Date.now() }
    }
  }, `${name}: status → ${status}${isSource ? ' (plan status in this app; source data unchanged)' : ' (local simulation)'}`)
}
export function setOverlay(id: string, patch: Partial<SourceOverlay>, log: string) {
  update((s) => { s.overlays[id] = { ...(s.overlays[id] ?? { updatedAt: 0 }), ...patch, updatedAt: Date.now() } }, log)
}
export function addTask(t: Omit<Task, 'id' | 'createdAt'>) {
  update((s) => { s.tasks.unshift({ ...t, id: uid('T'), createdAt: Date.now() }) }, `Task added: ${t.title}`)
}
export function upsertExperiment(e: Experiment, log: string) {
  update((s) => {
    const i = s.experiments.findIndex((x) => x.id === e.id)
    if (i >= 0) s.experiments[i] = e
    else s.experiments.unshift(e)
  }, log)
}
