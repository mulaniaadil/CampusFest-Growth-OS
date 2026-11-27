// Client-side exports (real downloads generated from computed data).
import type { Model } from '../analytics/model'
import { campaignPerformance, snapshot, type Scope } from '../analytics/metrics'
import { fmtRange } from './time'
import type { WorkspaceState } from '../store/workspace'

function download(name: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const csvCell = (v: unknown) => {
  const s = v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCampaignCsv(m: Model, s: Scope) {
  const { rows } = campaignPerformance(m, s)
  const snap = snapshot(m, s)
  const head = ['campaign_id', 'campaign', 'channel', 'spend_inr', 'impressions', 'clicks', 'identified', 'registrations', 'confirmed', 'cancelled', 'waitlisted', 'verified_attendees', 'reg_rate', 'reg_to_attend', 'confirmed_to_attend', 'cost_per_registration', 'cost_per_verified_attendee', 'quadrant']
  const lines = [
    `# CampusFest Growth OS export · ${fmtRange(s.start, s.end)} (IST) · target version: ${snap.target.version} · source: ${m.raw.sourceName}`,
    head.join(','),
    ...rows.map((r) => [r.id, r.name, r.channel, r.spend, r.impressions, r.clicks, r.identified, r.registrations, r.confirmed, r.cancelled, r.waitlisted, r.attendees, r.regRate, r.showRate, r.confirmedShowRate, r.cpr, r.cpa, r.quadrant].map(csvCell).join(',')),
  ]
  download('campusfest-campaign-performance.csv', 'text/csv;charset=utf-8', '﻿' + lines.join('\n'))
}

export function exportWorkspaceJson(ws: WorkspaceState) {
  download('campusfest-workspace.json', 'application/json', JSON.stringify({ exportedAt: new Date().toISOString(), note: 'Local campaigns, plan overlays, experiments, tasks and activity. Simulated results are team-entered, not workbook data.', workspace: ws }, null, 2))
}
