// Runs the Growth Analyst against a battery of questions (incl. follow-ups and unanswerable ones).
import { readFileSync } from 'node:fs'
import { parseWorkbook } from '../src/data/loadWorkbook'
import { buildModel } from '../src/analytics/model'
import { fullScope } from '../src/analytics/metrics'
import { answer, SUGGESTED_QUESTIONS, type AnalystContext } from '../src/analyst/engine'
import type { WorkspaceState } from '../src/store/workspace'

const buf = readFileSync(process.argv[2] ?? 'public/data/Attendee Dataset.xlsx')
const m = buildModel(parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'x'))
const ws: WorkspaceState = { version: 1, campaigns: [], overlays: {}, experiments: [], tasks: [], activity: [], updatedAt: 0 }
let ctx: AnalystContext = {}
const qs = [...SUGGESTED_QUESTIONS, 'Why?', 'Tell me about paid social', 'why?', 'and creator partners?', 'Compare referrals vs paid social',
  'What was our cost per registration as of 31 March?', 'Are we on track as of 20 March?', 'What if we move ₹20,000 from creator partners to college partnerships?',
  'Which age group attends most?', 'What was ticket revenue?', 'How many registrations in February?', 'Do brochure downloads predict attendance?',
  'How many people are on the waitlist?', 'Which campaigns have the most no-shows?', 'How confident is this?', 'What should we not do?', 'blorf the snarg', 'what is the CTR for organic search', 'show my tasks', 'how is show rate calculated?']
for (const q of qs) {
  const { response: r, context } = answer(q, m, fullScope(m), ws, ctx)
  ctx = context
  console.log(`\nQ: ${q}\n  [${r.intent}] ${r.title} | ${r.dateRange} | conf ${r.confidence}\n  ${r.summary}${r.actions.length ? `\n  actions: ${r.actions.map((a) => a.label).join(' ; ')}` : ''}${r.limits.length ? `\n  limits: ${r.limits[0]}` : ''}`)
}
