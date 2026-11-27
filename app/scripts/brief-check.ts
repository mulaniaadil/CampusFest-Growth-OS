// Checks the Growth Analyst against the assignment brief, requirement by requirement.
import { readFileSync } from 'node:fs'
import { parseWorkbook } from '../src/data/loadWorkbook'
import { buildModel } from '../src/analytics/model'
import { fullScope } from '../src/analytics/metrics'
import { answer, type AnalystContext } from '../src/analyst/engine'
import type { WorkspaceState } from '../src/store/workspace'

const load = (p: string) => { const b = readFileSync(p); return buildModel(parseWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, p)) }
const m = load(process.argv[2] ?? 'public/data/Attendee Dataset.xlsx')
const ws: WorkspaceState = {
  version: 1, overlays: { C03: { status: 'paused', proposedBudget: 30000, updatedAt: 1 } }, experiments: [], activity: [], updatedAt: 1,
  campaigns: [{ id: 'L1', name: 'Reminder blitz', channel: 'email_whatsapp', audienceSegment: 'confirmed_registrants', objective: 'x', owner: 'Meera Iyer', budget: 8000, start: '2026-01-01', end: '2026-01-14', targetMetric: 'verified_attendees', targetValue: 100, status: 'active', notes: '', origin: 'manual', results: [{ id: 'r', date: '2026-01-05', spend: 3000, registrations: 40, attendees: 25, note: '' }], createdAt: 1, updatedAt: 1 }],
  tasks: [{ id: 'T1', title: 'Send D-1 QR pass', owner: 'Dev Malhotra', due: '2020-01-01', status: 'todo', origin: 'manual', createdAt: 1 }],
}
let ctx: AnalystContext = {}
const qs = process.argv.slice(3).length ? process.argv.slice(3) : [
  'How much budget is left?', 'Which campaign has the highest cancellation rate?', 'Which owner performs best?', 'How many walk-ins attended?',
  'Show my tasks', 'How is my Reminder blitz campaign doing?', 'Is Creator Partners paused?', 'What is the trend in March?',
  'Which campaign should we pause or redesign?', 'why?', 'and paid social?', 'how confident is this?', 'What was the weather on event day?',
  'Which audience should we target next?', 'What is the ROI of paid social?',
]
for (const q of qs) {
  const { response: r, context } = answer(q, m, fullScope(m), ws, ctx); ctx = context
  console.log(`\nQ: ${q}\n  [${r.intent}] ${r.summary.slice(0, 260)}${r.actions.length ? `\n  actions: ${r.actions.map((a) => a.label).join(' ; ')}` : ''}`)
}
