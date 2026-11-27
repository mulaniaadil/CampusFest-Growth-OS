import { useRef, useState } from 'react'
import { Upload, RotateCcw, Database } from 'lucide-react'
import { useData } from '../data/DataContext'
import { Badge, Button, Card, Modal, Notice, Table } from '../components/ui'
import { fmtDateTime, fmtDay } from '../lib/time'
import { fmtINR, fmtInt } from '../lib/format'
import { resetWorkspace, useSyncStatus } from '../store/workspace'
import { remoteLabel } from '../store/supabase'

const DEFINITIONS: [string, string][] = [
  ['Identified external people', 'Distinct person_id with person_type = external and first_seen_at ≤ selected end of day (IST). Includes walk-ins identified at the gate.'],
  ['Unique registration', 'Distinct external person_id with a registration created ≤ end of day. A status change, cancellation or re-confirmation is not a new registration.'],
  ['Registration status at a date', 'Latest Registration History version (deduplicated by history_id) with effective_at ≤ end of day, per registration_id.'],
  ['Confirmed registration', 'Registration whose latest status at the date is "confirmed".'],
  ['Cancellation rate', 'Registrations whose latest status is "cancelled" ÷ registrations.'],
  ['Verified unique attendee / visitor', 'Distinct external person_id with ≥1 check-in where result = admitted and verification = verified (deduplicated by event_id). Re-entry and second-day admissions do not add people.'],
  ['Registration conversion', 'Registrations ÷ identified external people (cumulative).'],
  ['Registration → attendance', 'Registered people with a verified admission ÷ registered people.'],
  ['Net marketing spend', 'Sum of marketing_spend_inr (debits less credits, deduplicated by activity_id) with activity_date ≤ end of day.'],
  ['Cost per identified / registration / verified attendee', 'Cumulative net spend ÷ the matching distinct-person count. Campaign view divides campaign spend by people whose first-touch campaign is that campaign.'],
  ['Target in force', 'Targets row with the latest effective_at ≤ end of day. Before 15 Mar 2025 09:00 IST the launch plan applies; from then the revised plan.'],
  ['Attribution', 'First touch: People.first_campaign_id (identical to Registrations.campaign_id for every registration). Records a source relationship, not causal impact.'],
  ['Anonymous activity', 'Impressions, clicks, reach, sessions and form starts are platform event counts. Never added to person counts; reach is not summed into unique people.'],
  ['Cohort views (funnel, campaign table)', 'People first identified inside the selected range, with outcomes measured at the range end.'],
]

export function DataQuality() {
  const { model, loadFile, resetToBundled, isCustomWorkbook, loading } = useData()
  const sync = useSyncStatus()
  const file = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  if (!model) return null
  const raw = model.raw
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card title={<span className="flex items-center gap-1.5"><Database size={14} className="text-blue" />Source workbook</span>} className="lg:col-span-2"
          right={<><input ref={file} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />
            <Button size="sm" variant="secondary" disabled={loading} onClick={() => file.current?.click()}><Upload size={12} />Load another workbook</Button>
            {isCustomWorkbook && <Button size="sm" variant="ghost" onClick={resetToBundled}><RotateCcw size={12} />Use bundled workbook</Button>}</>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
            {[['File', raw.sourceName], ['Event', `${raw.event.name} · ${fmtDay(raw.event.startsAt, true)}–${fmtDay(raw.event.endsAt, true)}`], ['History', `${fmtDay(raw.event.historyStart, true)} – ${fmtDay(raw.event.historyEnd, true)}`], ['Timezone / currency', `${raw.event.timezone} · ${raw.event.currency}${raw.event.fictional ? ' · fictional' : ''}`]].map(([l, v]) => (
              <div key={l} className="border border-line rounded px-2 py-1.5"><div className="label-caps !text-[9.5px]">{l}</div><div className="font-medium">{v}</div></div>
            ))}
          </div>
          <p className="text-[11.5px] text-muted mt-2">Loading another workbook with the same sheets and columns recomputes every KPI, chart, opportunity and analyst answer. The original file is never modified. A replacement is kept in this browser (IndexedDB) until you switch back.</p>
          <div className="mt-3"><Table dense columns={['Sheet', 'Rows read', 'Rows used', 'Exact repeats removed', 'Conflicting IDs', 'Missing required']} align={['l', 'r', 'r', 'r', 'r', 'r']}
            rows={raw.audits.map((a) => [a.sheet, fmtInt(a.rowsRead), fmtInt(a.rowsKept), a.duplicateIdsRemoved ? <Badge tone="blue">{a.duplicateIdsRemoved}</Badge> : 0, a.conflictingDuplicates ? <Badge tone="coral">{a.conflictingDuplicates}</Badge> : 0, a.missingRequired ? <Badge tone="coral">{a.missingRequired}</Badge> : 0])} /></div>
        </Card>
        <Card title="Targets (dated versions)">
          <Table dense columns={['Version', 'From', 'Ident.', 'Reg.', 'Visitors', 'Budget']} align={['l', 'l', 'r', 'r', 'r', 'r']} rows={raw.targets.map((t) => [t.version, fmtDateTime(t.effectiveAt), fmtInt(t.identifiedGoal), fmtInt(t.registrationGoal), fmtInt(t.visitorsGoal), fmtINR(t.budget)])} />
          <div className="mt-3 text-[12px]">
            <div className="label-caps mb-1">Workspace storage</div>
            <div>{remoteLabel} · <Badge tone={sync.status === 'error' ? 'coral' : 'blue'}>{sync.status}</Badge></div>
            {sync.error && <p className="text-coral-ink text-[11px] mt-1">{sync.error}</p>}
            <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>Reset workspace…</Button></div>
          </div>
        </Card>
      </div>
      <Card title="Data-quality findings and handling" subtitle="Generated by the loader and model on every load">
        <Table columns={['', 'Area', 'Finding', 'Handling']} rows={model.quality.map((q) => [q.severity === 'warning' ? <Badge tone="coral">check</Badge> : <Badge tone="blue">info</Badge>, q.area, q.finding, q.handling])} />
      </Card>
      <Card title="Metric definitions" subtitle="Used identically in the dashboard, analyst, and strategy deck">
        <Table columns={['Metric', 'Definition']} rows={DEFINITIONS.map(([a, b]) => [<b>{a}</b>, b])} />
      </Card>
      <Card title="Read me (from the workbook)">
        <Table dense columns={['Topic', 'Description']} rows={raw.readMe.map((r) => [r.topic, r.description])} />
      </Card>
      {confirmReset && (
        <Modal title="Reset workspace?" onClose={() => setConfirmReset(false)} footer={<><Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="accent" onClick={() => { resetWorkspace(); setConfirmReset(false) }}>Delete local campaigns, tasks & experiments</Button></>}>
          <Notice tone="coral">This permanently removes every local campaign, plan status, proposed budget, experiment, task and activity entry{remoteLabel.startsWith('Supabase') ? ' in this browser and in Supabase' : ' stored in this browser'}. Workbook data is not affected.</Notice>
        </Modal>
      )}
    </div>
  )
}
