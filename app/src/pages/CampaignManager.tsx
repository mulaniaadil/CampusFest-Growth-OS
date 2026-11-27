import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, CheckCircle2, Edit3, FlaskConical, Pause, Play, Plus, Rocket, Save, Search, Trash2, Bot, Copy } from 'lucide-react'
import { useData } from '../data/DataContext'
import { Badge, Button, Card, Empty, Field, Modal, Notice, Table, inputCls } from '../components/ui'
import { campaignPerformance, fullScope, snapshot, type CampaignPerf } from '../analytics/metrics'
import { opportunities } from '../analytics/opportunities'
import { audienceSegments } from '../analytics/segments'
import { fmtINR, fmtInt, fmtPct, safeDiv } from '../lib/format'
import { fmtDay, todayKey } from '../lib/time'
import { navigate, useRoute } from '../lib/router'
import { toast } from '../lib/toast'
import {
  addTask, getState, setCampaignStatus, setOverlay, TARGET_METRIC_LABEL, uid, update, upsertCampaign, upsertExperiment, useWorkspace,
  type CampaignStatus, type Experiment, type ExperimentPlan, type LocalCampaign, type TargetMetric, type Task,
} from '../store/workspace'
import { remoteLabel } from '../store/supabase'

const STATUS_TONE: Record<CampaignStatus, 'blue' | 'coral' | 'neutral' | 'outline'> = { draft: 'outline', active: 'blue', paused: 'coral', archived: 'neutral', completed: 'neutral' }
const LOCAL_CHANNELS = ['email_whatsapp', 'sms', 'on_campus_activation', 'other']

export function blankCampaign(): LocalCampaign {
  const t = todayKey()
  const end = new Date(Date.parse(t) + 14 * 86400000).toISOString().slice(0, 10)
  return { id: uid('L'), name: '', channel: 'referrals', audienceSegment: 'confirmed_registrants', objective: '', owner: '', budget: 5000, start: t, end, targetMetric: 'verified_attendees', targetValue: 50, status: 'draft', notes: '', origin: 'manual', results: [], createdAt: Date.now(), updatedAt: Date.now() }
}

function PlanFields({ v, set }: { v: ExperimentPlan; set: (p: Partial<ExperimentPlan>) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="md:col-span-2"><Field label="Experiment hypothesis"><input className={inputCls} value={v.hypothesis ?? ''} onChange={(e) => set({ hypothesis: e.target.value })} placeholder="If we …, then … will rise because …" /></Field></div>
      <div className="md:col-span-2"><Field label="Leading indicator"><input className={inputCls} value={v.leadingIndicator ?? ''} onChange={(e) => set({ leadingIndicator: e.target.value })} placeholder="e.g. D-7 reconfirmation rate" /></Field></div>
      <Field label="Scale rule"><input className={inputCls} value={v.scaleRule ?? ''} onChange={(e) => set({ scaleRule: e.target.value })} placeholder="e.g. reconfirmation ≥ 85% → roll out" /></Field>
      <Field label="Stop rule"><input className={inputCls} value={v.stopRule ?? ''} onChange={(e) => set({ stopRule: e.target.value })} placeholder="e.g. ≤ +1 pp after 7 days → stop" /></Field>
    </div>
  )
}

export function CampaignForm({ initial, onClose, onSaved, channels, owners }: { initial: LocalCampaign; onClose: () => void; onSaved?: (c: LocalCampaign) => void; channels: string[]; owners: string[] }) {
  const { model } = useData()
  const [c, setC] = useState<LocalCampaign>(initial)
  const [err, setErr] = useState('')
  const segs = useMemo(() => (model ? audienceSegments(model, fullScope(model)) : []), [model])
  const set = <K extends keyof LocalCampaign>(k: K, v: LocalCampaign[K]) => setC((p) => ({ ...p, [k]: v }))
  const exists = getState().campaigns.some((x) => x.id === initial.id)
  const save = (status?: CampaignStatus) => {
    if (!c.name.trim()) return setErr('Name is required.')
    if (!(c.budget >= 0)) return setErr('Proposed budget must be zero or more.')
    if (c.end < c.start) return setErr('End date must be on or after the start date.')
    if (!(c.targetValue > 0)) return setErr('Target value must be greater than zero.')
    const next = { ...c, status: status ?? c.status }
    upsertCampaign(next, `${exists ? 'Edited' : initial.origin === 'analyst' ? 'Created from analyst draft:' : 'Created'} local campaign "${next.name}" (${next.status})`)
    toast(exists ? `Saved "${next.name}".` : `Created "${next.name}" as ${next.status === 'active' ? 'an active simulation' : 'a draft'}.`)
    onSaved?.(next)
    onClose()
  }
  const seg = segs.find((s) => s.key === c.audienceSegment)
  const title = exists ? `Edit · ${initial.name}` : initial.origin === 'analyst' ? 'Review campaign draft proposed by the analyst' : 'New local campaign'
  return (
    <Modal wide title={title} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" onClick={() => save(!exists ? 'draft' : c.status)}><Save size={13} />{exists && c.status !== 'draft' ? 'Save changes' : 'Save draft'}</Button>
        {(!exists || c.status === 'draft') && <Button onClick={() => save('active')}><Rocket size={13} />Save & launch simulation</Button>}
      </>}>
      <div className="flex flex-col gap-4">
        <Notice>This is a local simulation. Launching changes its status in this app only. It does not send emails, posts or ads, and its budget is a proposal, not spend.</Notice>
        {err && <Notice tone="coral">{err}</Notice>}
        <section>
          <div className="label-caps !text-blue mb-2">Campaign</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name"><input className={inputCls} value={c.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Attendance activation, confirmed" /></Field>
            <Field label="Owner"><input className={inputCls} list="owners" value={c.owner} onChange={(e) => set('owner', e.target.value)} placeholder="Owner name" /><datalist id="owners">{owners.map((o) => <option key={o} value={o} />)}</datalist></Field>
            <Field label="Channel">
              <select className={inputCls} value={c.channel} onChange={(e) => set('channel', e.target.value)}>
                <optgroup label="Source channels">{channels.map((ch) => <option key={ch} value={ch}>{ch}</option>)}</optgroup>
                <optgroup label="New channels">{LOCAL_CHANNELS.map((ch) => <option key={ch} value={ch}>{ch}</option>)}</optgroup>
              </select>
            </Field>
            <Field label="Audience segment" hint={seg ? `${seg.definition} · ${seg.size == null ? 'size unknown (not in workbook)' : `${fmtInt(seg.size)} people at history end`}` : ''}>
              <select className={inputCls} value={c.audienceSegment} onChange={(e) => set('audienceSegment', e.target.value)}>
                {segs.map((s) => <option key={s.key} value={s.key}>{s.label}{s.size != null ? ` (${fmtInt(s.size)})` : ''}</option>)}
              </select>
            </Field>
            <div className="md:col-span-2"><Field label="Objective"><textarea className={`${inputCls} h-16 py-1.5`} value={c.objective} onChange={(e) => set('objective', e.target.value)} placeholder="Which outcome should this campaign change?" /></Field></div>
          </div>
        </section>
        <section>
          <div className="label-caps !text-blue mb-2">Budget, window and target</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Proposed budget (₹)"><input type="number" min={0} step={500} className={`${inputCls} tnum`} value={c.budget} onChange={(e) => set('budget', Number(e.target.value))} /></Field>
            <Field label="Start"><input type="date" className={inputCls} value={c.start} onChange={(e) => set('start', e.target.value)} /></Field>
            <Field label="End"><input type="date" className={inputCls} value={c.end} onChange={(e) => set('end', e.target.value)} /></Field>
            <div className="md:col-span-2"><Field label="Target metric"><select className={inputCls} value={c.targetMetric} onChange={(e) => set('targetMetric', e.target.value as TargetMetric)}>{Object.entries(TARGET_METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
            <Field label="Target value"><input type="number" min={0} className={`${inputCls} tnum`} value={c.targetValue} onChange={(e) => set('targetValue', Number(e.target.value))} /></Field>
          </div>
        </section>
        <section>
          <div className="label-caps !text-blue mb-2">Experiment plan</div>
          <PlanFields v={c} set={(p) => setC((x) => ({ ...x, ...p }))} />
          <div className="mt-3"><Field label="Notes"><input className={inputCls} value={c.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
        </section>
      </div>
    </Modal>
  )
}

function SourcePlanForm({ id, name, actual, onClose }: { id: string; name: string; actual: number; onClose: () => void }) {
  const ov = getState().overlays[id]
  const [v, setV] = useState({ proposedBudget: ov?.proposedBudget ?? actual, notes: ov?.notes ?? '', hypothesis: ov?.hypothesis ?? '', leadingIndicator: ov?.leadingIndicator ?? '', scaleRule: ov?.scaleRule ?? '', stopRule: ov?.stopRule ?? '' })
  return (
    <Modal wide title={`Edit plan · ${name}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!(v.proposedBudget >= 0)} onClick={() => { setOverlay(id, v, `${name}: plan updated (proposed budget ${fmtINR(v.proposedBudget)})`); toast(`Plan saved for ${name}.`); onClose() }}><Save size={13} />Save plan</Button></>}>
      <Notice>Plan fields live in this app only. The workbook's historical spend and results for {name} do not change.</Notice>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <Field label="Proposed budget (₹)" hint={`Actual net spend in the workbook: ${fmtINR(actual)}`}><input type="number" min={0} step={1000} className={`${inputCls} tnum`} value={v.proposedBudget} onChange={(e) => setV({ ...v, proposedBudget: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-3"><PlanFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} /></div>
      <div className="mt-3"><Field label="Plan notes"><textarea className={`${inputCls} h-16 py-1.5`} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field></div>
    </Modal>
  )
}

function ResultForm({ c, onClose }: { c: LocalCampaign; onClose: () => void }) {
  const [r, setR] = useState({ date: todayKey(), spend: 0, registrations: 0, attendees: 0, note: '' })
  return (
    <Modal title={`Log simulated result · ${c.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => { upsertCampaign({ ...c, results: [...c.results, { id: uid('R'), ...r }] }, `Logged simulated result on "${c.name}": ${fmtINR(r.spend)}, ${r.registrations} reg., ${r.attendees} att.`); toast('Simulated result logged.'); onClose() }}>Save result</Button></>}>
      <Notice>Entered by the team for a simulated campaign. These figures are never mixed into workbook metrics.</Notice>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Date"><input type="date" className={inputCls} value={r.date} onChange={(e) => setR({ ...r, date: e.target.value })} /></Field>
        <Field label="Simulated spend (₹)"><input type="number" className={`${inputCls} tnum`} value={r.spend} onChange={(e) => setR({ ...r, spend: Number(e.target.value) })} /></Field>
        <Field label="Registrations"><input type="number" min={0} className={`${inputCls} tnum`} value={r.registrations} onChange={(e) => setR({ ...r, registrations: Number(e.target.value) })} /></Field>
        <Field label="Verified attendees"><input type="number" min={0} className={`${inputCls} tnum`} value={r.attendees} onChange={(e) => setR({ ...r, attendees: Number(e.target.value) })} /></Field>
        <div className="col-span-2"><Field label="Note"><input className={inputCls} value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} /></Field></div>
      </div>
    </Modal>
  )
}

function ExperimentForm({ initial, refs, onClose }: { initial: Experiment; refs: { id: string; name: string }[]; onClose: () => void }) {
  const [e, setE] = useState<Experiment>(initial)
  const set = <K extends keyof Experiment>(k: K, v: Experiment[K]) => setE((p) => ({ ...p, [k]: v }))
  const lift = e.controlValue != null && e.variantValue != null ? e.variantValue - e.controlValue : null
  return (
    <Modal wide title={initial.name ? `Experiment · ${initial.name}` : 'Record an experiment'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!e.name.trim()} onClick={() => { upsertExperiment(e, `Experiment "${e.name}" saved (${e.status}${e.decision ? `, decision: ${e.decision}` : ''})`); toast(`Experiment "${e.name}" saved.`); onClose() }}>Save experiment</Button></>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Name"><input className={inputCls} value={e.name} onChange={(x) => set('name', x.target.value)} /></Field>
        <Field label="Campaign"><select className={inputCls} value={e.campaignRef} onChange={(x) => set('campaignRef', x.target.value)}>{refs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <div className="md:col-span-2"><Field label="Hypothesis"><input className={inputCls} value={e.hypothesis} onChange={(x) => set('hypothesis', x.target.value)} placeholder="If we …, then … will rise because …" /></Field></div>
        <Field label="Primary metric"><input className={inputCls} value={e.metric} onChange={(x) => set('metric', x.target.value)} placeholder="Confirmed → attended rate (%)" /></Field>
        <Field label="Status"><select className={inputCls} value={e.status} onChange={(x) => set('status', x.target.value as Experiment['status'])}><option value="planned">planned</option><option value="running">running</option><option value="concluded">concluded</option></select></Field>
        <Field label="Control"><input className={inputCls} value={e.control} onChange={(x) => set('control', x.target.value)} /></Field>
        <Field label="Variant"><input className={inputCls} value={e.variant} onChange={(x) => set('variant', x.target.value)} /></Field>
        <Field label="Start"><input type="date" className={inputCls} value={e.start} onChange={(x) => set('start', x.target.value)} /></Field>
        <Field label="End"><input type="date" className={inputCls} value={e.end} onChange={(x) => set('end', x.target.value)} /></Field>
        <Field label="Control result"><input type="number" className={`${inputCls} tnum`} value={e.controlValue ?? ''} onChange={(x) => set('controlValue', x.target.value === '' ? undefined : Number(x.target.value))} /></Field>
        <Field label="Variant result" hint={lift != null ? `Difference: ${lift >= 0 ? '+' : ''}${lift.toFixed(2)}` : ''}><input type="number" className={`${inputCls} tnum`} value={e.variantValue ?? ''} onChange={(x) => set('variantValue', x.target.value === '' ? undefined : Number(x.target.value))} /></Field>
        <Field label="Decision"><select className={inputCls} value={e.decision ?? ''} onChange={(x) => set('decision', x.target.value as Experiment['decision'])}><option value="">—</option><option value="scale">scale</option><option value="change">change</option><option value="stop">stop</option></select></Field>
        <Field label="Learning"><input className={inputCls} value={e.learning ?? ''} onChange={(x) => set('learning', x.target.value)} /></Field>
      </div>
    </Modal>
  )
}

interface Confirm { title: string; body: ReactNode; label: string; tone?: 'accent' | 'primary'; run: () => void }

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="px-4 py-3 border-t border-line">
      <div className="flex items-center justify-between mb-2 gap-2"><h4 className="label-caps !text-blue">{title}</h4>{right}</div>
      {children}
    </section>
  )
}
function Kv({ k, v, hot }: { k: string; v: ReactNode; hot?: boolean }) {
  return <div className="flex justify-between gap-3 py-1 border-b border-line/60 last:border-0 text-[12.5px]"><span className="text-muted shrink-0">{k}</span><span className={`text-right tnum ${hot ? 'text-coral-ink font-semibold' : 'text-ink'}`}>{v}</span></div>
}

type Row = { id: string; kind: 'source' | 'local'; name: string; sub: string; status: CampaignStatus; proposed: number | null; spend: number | null; signal: ReactNode; signalHot: boolean; search: string }

export function CampaignManager() {
  const { model } = useData()
  const ws = useWorkspace()
  const { params } = useRoute()
  const [selected, setSelected] = useState<string | null>(params.get('c'))
  const [form, setForm] = useState<LocalCampaign | null>(null)
  const [planFor, setPlanFor] = useState<{ id: string; name: string; actual: number } | null>(null)
  const [resultFor, setResultFor] = useState<LocalCampaign | null>(null)
  const [exp, setExp] = useState<Experiment | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [tab, setTab] = useState<'campaigns' | 'experiments' | 'tasks' | 'activity'>((params.get('tab') as 'tasks') ?? 'campaigns')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'source' | 'local'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [newTask, setNewTask] = useState<Omit<Task, 'id' | 'createdAt'>>({ title: '', owner: '', due: todayKey(), status: 'todo', origin: 'manual' })
  useEffect(() => { const c = params.get('c'); if (c) { setSelected(c); setTab('campaigns') } const t = params.get('tab'); if (t) setTab(t as 'tasks') }, [params])

  const perf = useMemo(() => (model ? campaignPerformance(model, fullScope(model)) : null), [model])
  const snap = useMemo(() => (model ? snapshot(model, fullScope(model)) : null), [model])
  const opp = useMemo(() => (model ? opportunities(model, fullScope(model)) : null), [model])
  if (!model || !perf || !snap || !opp) return null
  const perfById = new Map<string, CampaignPerf>(perf.rows.map((r) => [r.id, r]))
  const owners = [...new Set(model.campaigns.map((c) => c.ownerName))]
  const channels = [...new Set(model.campaigns.map((c) => c.channel))]
  const refs = [...model.campaigns.map((c) => ({ id: c.id, name: `${c.name} (source)` })), ...ws.campaigns.map((c) => ({ id: c.id, name: `${c.name} (simulation)` }))]
  const refName = (id?: string) => refs.find((r) => r.id === id)?.name.replace(/ \((source|simulation)\)$/, '') ?? '—'
  const today = todayKey()
  const remaining = Math.max(0, snap.gap.budgetRemaining)
  const proposedLocal = ws.campaigns.filter((c) => c.status === 'draft' || c.status === 'active').reduce((a, c) => a + c.budget, 0)
  const sourceStatus = (id: string): CampaignStatus => ws.overlays[id]?.status ?? (model.campaignById.get(id)!.plannedEnd < model.dayRange.end ? 'completed' : 'active')

  const rows: Row[] = [
    ...model.campaigns.map((c) => {
      const r = perfById.get(c.id)!
      const bad = r.quadrant.startsWith('Fix') || r.quadrant.startsWith('Pause')
      return { id: c.id, kind: 'source' as const, name: c.name, sub: `${c.id} · ${c.channel} · ${c.ownerName}`, status: sourceStatus(c.id), proposed: ws.overlays[c.id]?.proposedBudget ?? null, spend: r.spend,
        signal: <>{fmtINR(r.cpa)}/att. · {fmtPct(r.showRate, 0)} attend</>, signalHot: bad, search: `${c.name} ${c.id} ${c.channel} ${c.ownerName}`.toLowerCase() }
    }),
    ...ws.campaigns.map((c) => {
      const sp = c.results.reduce((a, x) => a + x.spend, 0), att = c.results.reduce((a, x) => a + x.attendees, 0)
      return { id: c.id, kind: 'local' as const, name: c.name, sub: `${c.channel} · ${c.audienceSegment.replace(/_/g, ' ')}${c.owner ? ` · ${c.owner}` : ''}`, status: c.status, proposed: c.budget, spend: c.results.length ? sp : null,
        signal: c.results.length ? <>{fmtINR(safeDiv(sp, att))}/att. (simulated)</> : <span className="text-muted">No results logged</span>, signalHot: false, search: `${c.name} ${c.channel} ${c.owner} ${c.audienceSegment}`.toLowerCase() }
    }),
  ].filter((r) => (kind === 'all' || r.kind === kind) && (showArchived || r.status !== 'archived') && (!q.trim() || r.search.includes(q.trim().toLowerCase())))

  const sel = selected ? (model.campaignById.get(selected) ? { kind: 'source' as const, id: selected } : ws.campaigns.find((c) => c.id === selected) ? { kind: 'local' as const, id: selected } : null) : null
  const experimentsFor = (id: string) => ws.experiments.filter((e) => e.campaignRef === id)
  const newExp = (ref: string, metric = '') => setExp({ id: uid('X'), campaignRef: ref, name: '', hypothesis: '', metric, control: 'Current flow', variant: '', start: today, end: today, status: 'planned', createdAt: Date.now() })
  const ask = (c: Confirm) => setConfirm(c)
  const pick = (id: string) => { setSelected(id); if (window.innerWidth < 1280) setTimeout(() => document.getElementById('campaign-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30) }

  const expList = (id: string, plan?: ExperimentPlan) => {
    const list = experimentsFor(id)
    const hasPlan = plan && (plan.hypothesis || plan.leadingIndicator || plan.scaleRule || plan.stopRule)
    return (
      <>
        {hasPlan ? (
          <div>
            <Kv k="Hypothesis" v={<span className="block max-w-[300px]">{plan!.hypothesis || '—'}</span>} />
            <Kv k="Leading indicator" v={plan!.leadingIndicator || '—'} />
            <Kv k="Scale rule" v={<span className="text-blue">{plan!.scaleRule || '—'}</span>} />
            <Kv k="Stop rule" v={<span className="text-coral-ink">{plan!.stopRule || '—'}</span>} />
          </div>
        ) : <p className="text-[12px] text-muted">No experiment plan yet. Add a hypothesis, leading indicator and scale / stop rules via Edit.</p>}
        {list.length > 0 && (
          <div className="mt-2">
            {list.map((e) => <button key={e.id} onClick={() => setExp(e)} className="w-full text-left flex justify-between gap-2 py-1.5 border-t border-line/60 text-[12px] hover:text-blue"><span>{e.name}<span className="text-muted"> · {e.metric || 'no metric'}</span></span><span className="flex gap-1 shrink-0"><Badge tone={e.status === 'running' ? 'blue' : 'outline'}>{e.status}</Badge>{e.decision && <Badge tone={e.decision === 'stop' ? 'coral' : 'blue'}>{e.decision}</Badge>}</span></button>)}
          </div>
        )}
      </>
    )
  }

  const detail = (() => {
    if (!sel) return <div className="surface"><Empty title="Select a campaign" text="Open a row to see status, budget vs spend, target, experiment plan and actions." /></div>
    if (sel.kind === 'source') {
      const c = model.campaignById.get(sel.id)!, r = perfById.get(sel.id)!, ov = ws.overlays[sel.id], st = sourceStatus(sel.id)
      const bad = r.quadrant.startsWith('Fix') || r.quadrant.startsWith('Pause')
      const linked = opp.list.filter((o) => o.campaignIds.includes(sel.id))
      return (
        <div className="surface">
          <div className="px-4 pt-3 pb-3">
            <div className="flex flex-wrap items-center gap-1.5"><Badge>Workbook source</Badge><Badge tone={STATUS_TONE[st]}>plan: {st}</Badge>{r.quadrant !== 'Not classified' && <Badge tone={bad ? 'coral' : 'blue'}>{r.quadrant.split(':')[0]}</Badge>}</div>
            <h3 className="text-[16px] font-semibold mt-1.5">{c.name}</h3>
            <p className="text-[12px] text-muted">{c.id} · {c.channel} · owner {c.ownerName} · planned {fmtDay(c.plannedStart, true)} – {fmtDay(c.plannedEnd, true)}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Button size="sm" variant="secondary" onClick={() => setPlanFor({ id: c.id, name: c.name, actual: r.spend })}><Edit3 size={12} />Edit plan</Button>
              {st !== 'active' && st !== 'archived' && <Button size="sm" variant="secondary" onClick={() => ask({ title: `Activate ${c.name} in the plan?`, body: 'Sets the plan status to active. Historical results are unchanged and nothing is sent to an ad platform.', label: 'Activate in plan', tone: 'primary', run: () => setCampaignStatus(c.id, 'active', true, c.name) })}><Play size={12} />Activate</Button>}
              {st === 'active' && <Button size="sm" variant="secondary" onClick={() => ask({ title: `Pause ${c.name} in the plan?`, body: 'Sets the plan status to paused. This records a decision; it does not stop any real campaign.', label: 'Pause in plan', tone: 'accent', run: () => setCampaignStatus(c.id, 'paused', true, c.name) })}><Pause size={12} />Pause</Button>}
              {st !== 'archived' ? <Button size="sm" variant="ghost" onClick={() => ask({ title: `Archive ${c.name}?`, body: 'Hides the campaign from the default list. Workbook results stay in all analytics. You can restore it later.', label: 'Archive', tone: 'accent', run: () => setCampaignStatus(c.id, 'archived', true, c.name) })}><Archive size={12} />Archive</Button>
                : <Button size="sm" variant="ghost" onClick={() => setCampaignStatus(c.id, 'completed', true, c.name)}>Restore</Button>}
            </div>
          </div>
          <Section title="Observed performance (workbook)">
            <div className="grid grid-cols-3 gap-px bg-line border border-line rounded overflow-hidden [&>div]:bg-white">
              {([['Spend', fmtINR(r.spend)], ['Registrations', fmtInt(r.registrations)], ['Verified att.', fmtInt(r.attendees)], ['Reg → attend', fmtPct(r.showRate)], ['Cost / att.', fmtINR(r.cpa)], ['Cost / reg.', fmtINR(r.cpr)]] as [string, string][]).map(([l, v], i) => (
                <div key={l} className="px-2.5 py-1.5"><div className="text-[11px] text-muted">{l}</div><div className={`text-[14px] font-semibold tnum ${bad && (i === 3 || i === 4) ? 'text-coral-ink' : ''}`}>{v}</div></div>
              ))}
            </div>
            <p className="text-[11.5px] text-muted mt-1.5">Portfolio: {fmtPct(perf.portfolio.showRate)} attend · {fmtINR(perf.portfolio.cpa)} per attendee. Objective (plan text): {c.objective}</p>
          </Section>
          <Section title="Budget">
            <Kv k="Actual net spend (workbook)" v={fmtINR(r.spend)} />
            <Kv k="Proposed budget (plan)" v={ov?.proposedBudget != null ? fmtINR(ov.proposedBudget) : <span className="text-muted">not set</span>} />
            {ov?.proposedBudget != null && <Kv k="Proposed − actual" v={`${ov.proposedBudget - r.spend >= 0 ? '+' : '−'}${fmtINR(Math.abs(ov.proposedBudget - r.spend))}`} hot={ov.proposedBudget < r.spend} />}
            <Kv k="Share of spend / attendees" v={`${fmtPct(r.spendShare)} / ${fmtPct(r.attendanceShare)}`} hot={r.spendShare - r.attendanceShare > 0.05} />
          </Section>
          <Section title="Experiment plan" right={<Button size="sm" variant="ghost" onClick={() => newExp(c.id, 'Confirmed → attended rate (%)')}><FlaskConical size={12} />Record experiment</Button>}>
            {expList(c.id, ov)}
            {linked.length > 0 && <p className="text-[11.5px] text-muted mt-2">Linked opportunities: {linked.map((o) => `${o.id} ${o.short}`).join(' · ')}. Thresholds in Acquisition Analytics → Prioritized Strategy.</p>}
          </Section>
          {ov?.notes && <Section title="Plan notes"><p className="text-[12.5px] whitespace-pre-wrap">{ov.notes}</p></Section>}
          <div className="px-4 py-3 border-t border-line flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setForm({ ...blankCampaign(), name: `${c.name}, next iteration`, channel: c.channel, owner: c.ownerName, basedOn: c.id, objective: c.objective, budget: Math.round(r.spend / 1000) * 1000, targetMetric: 'cost_per_attendee', targetValue: Math.round(r.cpa) })}><Copy size={12} />Draft follow-up simulation</Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('analyst', { q: `Tell me about ${c.name}` })}><Bot size={12} />Ask analyst</Button>
          </div>
        </div>
      )
    }
    const c = ws.campaigns.find((x) => x.id === sel.id)!
    const sp = c.results.reduce((a, x) => a + x.spend, 0), reg = c.results.reduce((a, x) => a + x.registrations, 0), att = c.results.reduce((a, x) => a + x.attendees, 0)
    const actual = { verified_attendees: fmtInt(att), registrations: fmtInt(reg), confirmed_show_rate: 'record via an experiment', cost_per_attendee: fmtINR(safeDiv(sp, att)) }[c.targetMetric]
    return (
      <div className="surface">
        <div className="px-4 pt-3 pb-3">
          <div className="flex flex-wrap items-center gap-1.5"><Badge tone="blue">Local simulation</Badge><Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>{c.origin === 'analyst' && <Badge>from analyst</Badge>}</div>
          <h3 className="text-[16px] font-semibold mt-1.5">{c.name}</h3>
          <p className="text-[12px] text-muted">{c.channel} · {c.audienceSegment.replace(/_/g, ' ')} · owner {c.owner || '—'} · {c.start} → {c.end}{c.basedOn ? ` · extends ${model.campaignById.get(c.basedOn)?.name}` : ''}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <Button size="sm" variant="secondary" onClick={() => setForm(c)}><Edit3 size={12} />Edit</Button>
            {c.status === 'draft' && <Button size="sm" onClick={() => ask({ title: `Launch simulation "${c.name}"?`, body: 'Marks this campaign active inside the app. No emails, posts or ads are sent and no money is spent.', label: 'Launch simulation', tone: 'primary', run: () => setCampaignStatus(c.id, 'active', false, c.name) })}><Rocket size={12} />Launch simulation</Button>}
            {c.status === 'active' && <Button size="sm" variant="secondary" onClick={() => ask({ title: `Pause "${c.name}"?`, body: 'The simulation stops accepting new result entries until resumed.', label: 'Pause', tone: 'accent', run: () => setCampaignStatus(c.id, 'paused', false, c.name) })}><Pause size={12} />Pause</Button>}
            {c.status === 'paused' && <Button size="sm" variant="secondary" onClick={() => setCampaignStatus(c.id, 'active', false, c.name)}><Play size={12} />Resume</Button>}
            {(c.status === 'active' || c.status === 'paused') && <Button size="sm" variant="secondary" onClick={() => ask({ title: `Complete "${c.name}"?`, body: 'Closes the simulation. Logged results are kept.', label: 'Complete', tone: 'primary', run: () => setCampaignStatus(c.id, 'completed', false, c.name) })}><CheckCircle2 size={12} />Complete</Button>}
            {c.status !== 'archived' ? <Button size="sm" variant="ghost" onClick={() => ask({ title: `Archive "${c.name}"?`, body: 'Hides it from the default list and removes its proposed budget from the headroom check. You can restore it as a draft.', label: 'Archive', tone: 'accent', run: () => setCampaignStatus(c.id, 'archived', false, c.name) })}><Archive size={12} />Archive</Button>
              : <Button size="sm" variant="ghost" onClick={() => setCampaignStatus(c.id, 'draft', false, c.name)}>Restore as draft</Button>}
          </div>
        </div>
        <Section title="Budget (proposal vs simulated spend)">
          <Kv k="Proposed budget" v={fmtINR(c.budget)} />
          <Kv k="Simulated spend logged" v={fmtINR(sp)} hot={sp > c.budget} />
          <div className="h-1.5 bg-blue-50 rounded-full overflow-hidden mt-1.5"><div className={`h-full ${sp > c.budget ? 'bg-coral' : 'bg-blue'}`} style={{ width: `${Math.min(100, safeDiv(sp, c.budget) * 100 || 0)}%` }} /></div>
          <p className="text-[11.5px] text-muted mt-1">{fmtPct(safeDiv(sp, c.budget))} of proposal used · simulated, not real spend</p>
        </Section>
        <Section title="Target">
          <Kv k={TARGET_METRIC_LABEL[c.targetMetric]} v={`target ${c.targetValue}`} />
          <Kv k="Simulated result so far" v={actual} />
          <Kv k="Registrations / attendees logged" v={`${fmtInt(reg)} / ${fmtInt(att)}`} />
          {c.objective && <p className="text-[12px] text-ink-2 mt-1.5">{c.objective}</p>}
        </Section>
        <Section title="Experiment plan" right={<Button size="sm" variant="ghost" onClick={() => newExp(c.id, TARGET_METRIC_LABEL[c.targetMetric])}><FlaskConical size={12} />Record experiment</Button>}>
          {expList(c.id, c)}
        </Section>
        <Section title="Simulated results" right={c.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => setResultFor(c)}><Plus size={12} />Log result</Button> : <span className="text-[11px] text-muted">{c.status === 'draft' ? 'Launch to log results' : `Status: ${c.status}`}</span>}>
          {c.results.length ? <Table dense columns={['Date', 'Spend', 'Reg.', 'Att.', 'Note', '']} align={['l', 'r', 'r', 'r', 'l', 'r']} rows={c.results.map((x) => [x.date, fmtINR(x.spend), fmtInt(x.registrations), fmtInt(x.attendees), x.note, <button aria-label="Delete result" className="text-muted hover:text-coral-ink" onClick={() => ask({ title: 'Delete this result entry?', body: `${x.date}: ${fmtINR(x.spend)}, ${x.registrations} registrations, ${x.attendees} attendees. This cannot be undone.`, label: 'Delete entry', tone: 'accent', run: () => upsertCampaign({ ...c, results: c.results.filter((y) => y.id !== x.id) }, `Removed a result entry from "${c.name}"`) })}><Trash2 size={12} /></button>])} /> : <p className="text-[12px] text-muted">No simulated results logged.</p>}
        </Section>
        {c.notes && <Section title="Notes"><p className="text-[12.5px]">{c.notes}</p></Section>}
      </div>
    )
  })()

  const tabs = [['campaigns', 'Campaigns', model.campaigns.length + ws.campaigns.length], ['experiments', 'Experiments', ws.experiments.length], ['tasks', 'Open tasks', ws.tasks.filter((t) => t.status !== 'done').length], ['activity', 'Activity log', null]] as const

  return (
    <div className="flex flex-col gap-4">
      <section className="surface overflow-hidden !bg-line" aria-label="Budget summary">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px [&>div]:bg-blue-25">
          <div className="px-4 py-2.5"><div className="text-[11.5px] text-muted">Approved budget · {snap.target.version}</div><div className="text-[17px] font-semibold tnum">{fmtINR(snap.target.budget)}</div></div>
          <div className="px-4 py-2.5"><div className="text-[11.5px] text-muted">Actual net spend (workbook)</div><div className="text-[17px] font-semibold tnum">{fmtINR(snap.spend)}</div></div>
          <div className="px-4 py-2.5"><div className="text-[11.5px] text-muted">Unspent approved budget</div><div className="text-[17px] font-semibold tnum">{fmtINR(remaining)}</div></div>
          <div className="px-4 py-2.5"><div className="text-[11.5px] text-muted">Proposed in simulations (draft + active)</div><div className={`text-[17px] font-semibold tnum ${proposedLocal > remaining ? 'text-coral-ink' : ''}`}>{fmtINR(proposedLocal)} <span className="text-[12px] font-normal text-muted">{proposedLocal > remaining ? `${fmtINR(proposedLocal - remaining)} over headroom` : `${fmtINR(remaining - proposedLocal)} headroom`}</span></div></div>
        </div>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line">
        <div className="flex flex-wrap gap-x-1" role="tablist">
          {tabs.map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3.5 py-2 -mb-px border-b-2 text-[13px] font-semibold whitespace-nowrap ${tab === k ? 'border-blue text-blue' : 'border-transparent text-ink-2 hover:text-ink'}`}>
              {l}{n != null && <span className={`ml-1.5 text-[11px] tnum rounded px-1.5 py-px ${tab === k ? 'bg-blue-50' : 'bg-canvas text-muted'}`}>{n}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-1.5 text-[11.5px] text-muted">
          <span className="hidden md:inline">Saved to {remoteLabel}</span>
          <Button size="sm" onClick={() => setForm(blankCampaign())}><Plus size={13} />New simulation</Button>
        </div>
      </div>

      {tab === 'campaigns' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_480px] gap-4 items-start">
          <div className="surface min-w-0">
            <div className="px-3 py-2.5 flex flex-wrap items-center gap-2 border-b border-line">
              <label className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input aria-label="Search campaigns" className={`${inputCls} pl-8`} placeholder="Search by name, channel, owner…" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <select aria-label="Source" className={`${inputCls} !w-[160px]`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="all">All campaigns</option><option value="source">Workbook source</option><option value="local">Local simulations</option>
              </select>
              <label className="text-[12px] text-ink-2 flex items-center gap-1.5"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
            </div>
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead><tr className="text-left">{['Campaign', 'Source', 'Status', 'Proposed budget', 'Spend', 'Key signal'].map((h, i) => <th key={h} className={`label-caps !text-[10px] px-3 py-2 border-b border-line whitespace-nowrap ${i >= 3 && i <= 4 ? 'text-right' : ''} ${i === 1 || i === 3 ? 'hidden 2xl:table-cell' : ''}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} tabIndex={0} aria-selected={selected === r.id} onClick={() => pick(r.id)} onKeyDown={(e) => e.key === 'Enter' && pick(r.id)}
                        className={`cursor-pointer outline-none focus-visible:bg-blue-50 ${selected === r.id ? 'bg-blue-50 shadow-[inset_3px_0_0_#2457D6]' : 'hover:bg-canvas/70'}`}>
                        <td className="px-3 py-2 border-b border-line/60 align-top"><div className="font-medium text-ink leading-4">{r.name}</div><div className="text-[11px] text-muted leading-4 mt-0.5">{r.sub}</div><div className="2xl:hidden mt-1 flex flex-wrap gap-1">{r.kind === 'source' ? <Badge>Workbook</Badge> : <Badge tone="blue">Simulation</Badge>}{r.proposed != null && <span className="text-[11px] text-muted tnum">proposed {fmtINR(r.proposed)}</span>}</div></td>
                        <td className="hidden 2xl:table-cell px-3 py-2 border-b border-line/60 align-top">{r.kind === 'source' ? <Badge>Workbook</Badge> : <Badge tone="blue">Simulation</Badge>}</td>
                        <td className="px-3 py-2 border-b border-line/60 align-top"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                        <td className="hidden 2xl:table-cell px-3 py-2 border-b border-line/60 align-top text-right tnum">{r.proposed != null ? fmtINR(r.proposed) : <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2 border-b border-line/60 align-top text-right tnum">{r.spend != null ? <>{fmtINR(r.spend)}{r.kind === 'local' && <div className="text-[10.5px] text-muted">simulated</div>}</> : <span className="text-muted">—</span>}</td>
                        <td className={`px-3 py-2 border-b border-line/60 align-top tnum ${r.signalHot ? 'text-coral-ink font-semibold' : ''}`}>{r.signal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty title={q ? `No campaign matches “${q}”` : 'No campaigns in this view'} text={kind === 'local' && ws.campaigns.length === 0 ? 'Create a simulation, or accept a draft proposed by the Growth Analyst.' : 'Clear the search or change the source filter.'} action={q ? <Button size="sm" variant="secondary" onClick={() => setQ('')}>Clear search</Button> : <Button size="sm" onClick={() => setForm(blankCampaign())}><Plus size={13} />New simulation</Button>} />}
            <p className="text-[11.5px] text-muted px-3 py-2">Key signal: workbook campaigns show observed cost per verified attendee and registered → attended (coral = Fix / Pause quadrant). Simulations show team-entered results only.</p>
          </div>
          <div id="campaign-detail" className="xl:sticky xl:top-4 scroll-mt-4">{detail}</div>
        </div>
      )}

      {tab === 'experiments' && (
        <Card title="Experiments and results" subtitle="Planned and running tests, their results and the scale / change / stop decision" right={<Button size="sm" onClick={() => newExp(refs[0].id)}><Plus size={12} />Record experiment</Button>}>
          {ws.experiments.length ? (
            <Table columns={['Experiment', 'Campaign', 'Metric', 'Status', 'Control', 'Variant', 'Difference', 'Decision', '']} align={['l', 'l', 'l', 'l', 'r', 'r', 'r', 'l', 'r']}
              rows={ws.experiments.map((e) => {
                const diff = e.controlValue != null && e.variantValue != null ? e.variantValue - e.controlValue : null
                return [<b>{e.name}</b>, refName(e.campaignRef), e.metric, <Badge tone={e.status === 'running' ? 'blue' : 'outline'}>{e.status}</Badge>, e.controlValue ?? '—', e.variantValue ?? '—', diff == null ? '—' : <span className={diff < 0 ? 'text-coral-ink' : 'text-blue'}>{diff >= 0 ? '+' : ''}{diff.toFixed(2)}</span>, e.decision ? <Badge tone={e.decision === 'stop' ? 'coral' : 'blue'}>{e.decision}</Badge> : '—', <Button size="sm" variant="ghost" onClick={() => setExp(e)}>Edit</Button>]
              })} />
          ) : <Empty title="No experiments recorded" text="Each opportunity in Acquisition Analytics → Prioritized Strategy has a test design with scale / change / stop thresholds. Record one here to track its result and decision." />}
        </Card>
      )}

      {tab === 'tasks' && (
        <Card title="Tasks and action items" subtitle="Created manually or by the Growth Analyst after confirmation">
          <form className="grid grid-cols-1 md:grid-cols-[1fr_160px_150px_190px_auto] gap-2 items-end mb-3" onSubmit={(e) => { e.preventDefault(); if (!newTask.title.trim()) return; addTask(newTask); toast(`Task added: ${newTask.title}`); setNewTask({ ...newTask, title: '' }) }}>
            <Field label="Task"><input className={inputCls} value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="e.g. Send D-1 QR pass to confirmed registrants" /></Field>
            <Field label="Owner"><input className={inputCls} list="owners2" value={newTask.owner} onChange={(e) => setNewTask({ ...newTask, owner: e.target.value })} /><datalist id="owners2">{owners.map((o) => <option key={o} value={o} />)}</datalist></Field>
            <Field label="Due"><input type="date" className={inputCls} value={newTask.due} onChange={(e) => setNewTask({ ...newTask, due: e.target.value })} /></Field>
            <Field label="Campaign"><select className={inputCls} value={newTask.campaignRef ?? ''} onChange={(e) => setNewTask({ ...newTask, campaignRef: e.target.value || undefined })}><option value="">—</option>{refs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Button type="submit" disabled={!newTask.title.trim()}><Plus size={13} />Add</Button>
          </form>
          {ws.tasks.length ? (
            <Table columns={['', 'Task', 'Owner', 'Due', 'Campaign', 'Source', 'Status', '']} align={['l', 'l', 'l', 'l', 'l', 'l', 'l', 'r']}
              rows={ws.tasks.map((t) => [
                <input type="checkbox" aria-label="Done" checked={t.status === 'done'} onChange={(e) => update((s) => { const x = s.tasks.find((y) => y.id === t.id); if (x) x.status = e.target.checked ? 'done' : 'todo' }, `Task "${t.title}" → ${e.target.checked ? 'done' : 'todo'}`)} />,
                <span className={t.status === 'done' ? 'line-through text-muted' : ''}>{t.title}</span>,
                <input aria-label="Owner" className="bg-transparent border-b border-transparent hover:border-line focus:border-blue outline-none w-28" defaultValue={t.owner} onBlur={(e) => e.target.value !== t.owner && update((s) => { const x = s.tasks.find((y) => y.id === t.id); if (x) x.owner = e.target.value }, `Task "${t.title}" owner → ${e.target.value}`)} />,
                <span className={`whitespace-nowrap ${t.status !== 'done' && t.due < today ? 'text-coral-ink font-semibold' : ''}`}>{t.due}{t.status !== 'done' && t.due < today ? ' · overdue' : ''}</span>,
                refName(t.campaignRef), t.origin === 'analyst' ? <Badge tone="blue">analyst</Badge> : <Badge>manual</Badge>,
                <select aria-label="Status" className="bg-transparent text-[12px]" value={t.status} onChange={(e) => update((s) => { const x = s.tasks.find((y) => y.id === t.id); if (x) x.status = e.target.value as Task['status'] }, `Task "${t.title}" → ${e.target.value}`)}><option value="todo">todo</option><option value="doing">doing</option><option value="done">done</option></select>,
                <button aria-label="Delete task" className="text-muted hover:text-coral-ink" onClick={() => ask({ title: 'Delete this task?', body: t.title, label: 'Delete task', tone: 'accent', run: () => update((s) => { s.tasks = s.tasks.filter((y) => y.id !== t.id) }, `Task "${t.title}" deleted`) })}><Trash2 size={13} /></button>,
              ])} />
          ) : <Empty title="No tasks yet" text='Ask the Growth Analyst "What should we do in the next seven days?" and confirm the proposed tasks, or add one above.' />}
        </Card>
      )}

      {tab === 'activity' && (
        <Card title="Activity log" subtitle="Every change made in this workspace">
          {ws.activity.length ? <Table dense columns={['When', 'Change']} rows={ws.activity.map((a) => [<span className="whitespace-nowrap">{new Date(a.at).toLocaleString('en-IN')}</span>, a.text])} /> : <Empty title="No activity yet" />}
        </Card>
      )}

      {form && <CampaignForm initial={form} channels={channels} owners={owners} onClose={() => setForm(null)} onSaved={(c) => { setSelected(c.id); setTab('campaigns') }} />}
      {planFor && <SourcePlanForm {...planFor} onClose={() => setPlanFor(null)} />}
      {resultFor && <ResultForm c={resultFor} onClose={() => setResultFor(null)} />}
      {exp && <ExperimentForm initial={exp} refs={refs} onClose={() => setExp(null)} />}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)} footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant={confirm.tone === 'accent' ? 'accent' : 'primary'} onClick={() => { confirm.run(); toast(`${confirm.label}: done.`); setConfirm(null) }}>{confirm.label}</Button></>}>
          <p className="text-[12.5px] leading-[18px] text-ink-2">{confirm.body}</p>
        </Modal>
      )}
    </div>
  )
}
