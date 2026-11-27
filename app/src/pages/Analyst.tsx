import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, ExternalLink, ListPlus, Send, Sparkles, Trash2 } from 'lucide-react'
import { useData } from '../data/DataContext'
import { Badge, Button, Modal, Notice, Table, inputCls } from '../components/ui'
import { answer, dataPack, type AnalystAction, type AnalystContext, type AnalystResponse } from '../analyst/engine'
import { geminiStatus, narrate, type GeminiResult } from '../analyst/gemini'
import { addTask, setCampaignStatus, useWorkspace, getState } from '../store/workspace'
import { CampaignForm, blankCampaign } from './CampaignManager'
import { navigate, useRoute } from '../lib/router'
import { DAY, dayKey, endOfDay, fmtDay, parseDayKey, startOfDay } from '../lib/time'
import { snapshot, type Scope } from '../analytics/metrics'
import { fmtINR, fmtInt, fmtPct } from '../lib/format'
import { toast } from '../lib/toast'

interface Turn { id: string; q: string; r: AnalystResponse; asOf: string; gemini?: GeminiResult | { error: string } | 'loading'; applied: string[] }
const KEY = 'campusfest-growth-os:analyst:v1'

const GROUPS: { title: string; qs: string[] }[] = [
  { title: 'Targets and pace', qs: ['Why are we missing our registration target?', 'Are we on track as of 20 March?', 'How many registrations in February?'] },
  { title: 'Campaigns and budget', qs: ['Which campaign should receive more budget?', 'Which campaign should we pause or redesign?', 'Which channel produces the most verified attendees?', 'What if we move ₹20,000 from Creator Partners to College Partnerships?'] },
  { title: 'Funnel and attendance', qs: ['Where are we losing people in the acquisition funnel?', 'What is our cost per verified attendee?', 'Which campaigns have the most no-shows?', 'Do brochure downloads predict attendance?'] },
  { title: 'Next steps', qs: ['What should we do in the next seven days?', 'What should we not do?', 'Show my tasks'] },
]

function loadTurns(): Turn[] {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as Turn[]).map((t) => (t.gemini === 'loading' ? { ...t, gemini: undefined } : t)) } catch { return [] }
}

function Block({ label, children, tone }: { label: string; children: ReactNode; tone?: 'blue' | 'coral' | 'grey' }) {
  const c = tone === 'coral' ? 'border-coral text-coral-ink' : tone === 'grey' ? 'border-line text-muted' : 'border-blue text-blue'
  return (
    <div className={`border-l-2 pl-3 ${c.split(' ')[0]}`}>
      <div className={`label-caps !text-[10px] mb-0.5 ${c.split(' ')[1]}`}>{label}</div>
      <div className="text-[12.5px] leading-[18px] text-ink-2 flex flex-col gap-1">{children}</div>
    </div>
  )
}

function ResponseView({ t, onAction, onFollow }: { t: Turn; onAction: (a: AnalystAction, turnId: string, idx: number) => void; onFollow: (q: string) => void }) {
  const r = t.r
  const blocked = r.intent === 'unsupported' || r.intent === 'unknown'
  return (
    <article className="surface">
      <header className="px-4 pt-3 pb-2.5 border-b border-line/70">
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
          <span className="font-medium text-ink-2">{r.title}</span>
          <span>·</span><span>{r.dateRange}</span>
          <span className="ml-auto">{blocked ? <Badge tone="coral">{r.intent === 'unsupported' ? 'Not in the data' : 'Not understood'}</Badge> : <Badge tone={r.confidence === 'Low' ? 'coral' : 'blue'}>Confidence: {r.confidence}</Badge>}</span>
        </div>
        <p className="text-[14px] leading-[21px] text-ink font-medium mt-1.5">{r.summary}</p>
      </header>
      <div className="px-4 py-3 flex flex-col gap-3">
        {(r.facts.length > 0 || r.table) && (
          <div>
            <div className="label-caps !text-[10px] mb-1">Supporting metrics</div>
            {r.facts.length > 0 && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">
                {r.facts.map((f, i) => <div key={i} className="flex justify-between gap-3 border-b border-line/60 py-1 text-[12.5px]"><span className="text-muted">{f.label}</span><span className="text-right tnum font-medium">{f.value}{f.note && <span className="text-muted font-normal"> · {f.note}</span>}</span></div>)}
              </div>
            )}
            {r.table && <div className="border border-line rounded mt-2 overflow-x-auto"><Table dense columns={r.table.columns} rows={r.table.rows} align={r.table.columns.map((_, i) => (i === 0 ? 'l' : 'r'))} /></div>}
          </div>
        )}
        {(r.observed.length > 0 || r.hypotheses.length > 0 || r.limits.length > 0) && (
          <div>
            <div className="label-caps !text-[10px] mb-1.5">Interpretation</div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {r.observed.length > 0 && <Block label="Observed in the workbook">{r.observed.map((o, i) => <p key={i}>{o}</p>)}</Block>}
              {r.hypotheses.length > 0 && <Block label="Forecast / hypothesis" tone="coral">{r.hypotheses.map((o, i) => <p key={i}>{o}</p>)}</Block>}
              {r.limits.length > 0 && <Block label={blocked ? 'What the data contains instead' : 'Limits of the data'} tone="grey">{r.limits.map((o, i) => <p key={i}>{o}</p>)}</Block>}
            </div>
          </div>
        )}
        {t.gemini && (
          <div className="rounded border border-blue-100 bg-blue-50/50 px-3 py-2">
            <div className="label-caps !text-[10px] !text-blue flex items-center gap-1 mb-1"><Sparkles size={11} />Gemini narration{typeof t.gemini === 'object' && 'model' in t.gemini && <span className="normal-case tracking-normal font-normal text-muted"> · {t.gemini.model} · rewritten from the metrics above</span>}</div>
            {t.gemini === 'loading' ? <p className="text-muted text-[12.5px]">Writing…</p> : 'error' in t.gemini ? <p className="text-coral-ink text-[12.5px]">Gemini unavailable: {t.gemini.error}. The answer above is complete without it.</p> : (
              <>
                <p className="whitespace-pre-wrap text-ink-2 text-[12.5px] leading-[18px]">{t.gemini.text}</p>
                {t.gemini.unverified.length > 0 ? <p className="text-[11.5px] text-coral-ink mt-1">Grounding check: {t.gemini.unverified.join(', ')} not found in the computed data; treat as unverified.</p> : <p className="text-[11.5px] text-blue mt-1">Grounding check passed: every number appears in the computed data.</p>}
              </>
            )}
          </div>
        )}
        {(r.actions.length > 0 || r.followUps.length > 0) && (
          <div className="border-t border-line/70 pt-3">
            {r.actions.length > 0 && (
              <>
                <div className="label-caps !text-[10px] mb-1.5">Recommended next step · nothing changes until you confirm</div>
                <div className="flex flex-wrap gap-1.5">
                  {r.actions.map((a, i) => {
                    const done = t.applied.includes(String(i))
                    return <Button key={i} size="sm" variant={a.kind === 'open_campaign' ? 'secondary' : done ? 'ghost' : 'primary'} disabled={done} onClick={() => onAction(a, t.id, i)}>
                      {done ? <CheckCircle2 size={12} /> : a.kind === 'open_campaign' ? <ExternalLink size={12} /> : <ListPlus size={12} />}{done ? 'Applied' : a.label}
                    </Button>
                  })}
                </div>
              </>
            )}
            {r.followUps.length > 0 && <div className="flex flex-wrap items-center gap-1.5 mt-2"><span className="text-[11.5px] text-muted mr-1">Follow up:</span>{r.followUps.map((f) => <button key={f} onClick={() => onFollow(f)} className="text-[12px] px-2 h-6 rounded border border-line text-ink-2 hover:border-blue-300 hover:text-blue">{f}</button>)}</div>}
          </div>
        )}
        {r.metrics.length > 0 && <p className="text-[11px] text-muted">Source metrics: {r.metrics.slice(0, 8).join(' · ')}. Definitions in Data audit.</p>}
      </div>
    </article>
  )
}

export function Analyst() {
  const { model } = useData()
  const ws = useWorkspace()
  const { params } = useRoute()
  const [turns, setTurns] = useState<Turn[]>(loadTurns)
  const [ctx, setCtx] = useState<AnalystContext>(() => { const t = loadTurns(); const last = t[t.length - 1]; return last ? { lastResponse: last.r, campaignIds: last.r.focusCampaigns } : {} })
  const [input, setInput] = useState('')
  const [asOf, setAsOf] = useState('')
  const [gem, setGem] = useState<{ enabled: boolean; model?: string }>({ enabled: false })
  const [useGem, setUseGem] = useState(false)
  const [pending, setPending] = useState<{ a: AnalystAction; turnId: string; idx: number } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const handled = useRef<string | null>(null)

  useEffect(() => { geminiStatus().then((s) => { setGem(s); setUseGem(s.enabled) }) }, [])
  useEffect(() => { if (model && !asOf) setAsOf(dayKey(model.dayRange.end)) }, [model, asOf])
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(turns.slice(-40))) } catch { /* ignore */ } }, [turns])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [turns.length])

  const scope: Scope | null = useMemo(() => (model && asOf ? { start: model.dayRange.start, end: Math.min(endOfDay(parseDayKey(asOf)), model.dayRange.end), campaignIds: null } : null), [model, asOf])
  const snap = useMemo(() => (model && scope ? snapshot(model, scope) : null), [model, scope])

  const ask = (q: string) => {
    if (!model || !scope || !q.trim()) return
    const { response, context } = answer(q, model, scope, getState(), ctx)
    const id = `${Date.now()}`
    setTurns((p) => [...p, { id, q, r: response, asOf, applied: [], gemini: useGem && gem.enabled ? 'loading' : undefined }])
    setCtx(context)
    setInput('')
    if (useGem && gem.enabled) {
      const history = turns.slice(-4).map((x) => ({ q: x.q, a: x.r.summary }))
      narrate(q, response, dataPack(model, scope, getState()), history)
        .then((g) => setTurns((p) => p.map((x) => (x.id === id ? { ...x, gemini: g } : x))))
        .catch((e) => setTurns((p) => p.map((x) => (x.id === id ? { ...x, gemini: { error: (e as Error).message.slice(0, 160) } } : x))))
    }
  }

  useEffect(() => {
    const q = params.get('q')
    if (q && model && scope && handled.current !== q) { handled.current = q; ask(q); history.replaceState(null, '', '#/analyst') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, model, scope])

  const markApplied = (turnId: string, idx: number) => setTurns((p) => p.map((x) => (x.id === turnId ? { ...x, applied: [...x.applied, String(idx)] } : x)))
  const onAction = (a: AnalystAction, turnId: string, idx: number) => {
    if (a.kind === 'open_campaign') { navigate('campaigns', { c: a.campaignId }); return }
    setPending({ a, turnId, idx })
  }

  if (!model || !scope || !snap) return null
  const channels = [...new Set(model.campaigns.map((c) => c.channel))]
  const owners = [...new Set(model.campaigns.map((c) => c.ownerName))]
  const ctxCampaigns = ctx.campaignIds?.map((id) => model.campaignById.get(id)?.name ?? (id === 'UNATTRIBUTED' ? 'Walk-ins' : id)) ?? []
  const preEvent = dayKey(startOfDay(model.raw.event.startsAt) - DAY)
  const ctxRow = (k: string, v: ReactNode, hot?: boolean) => <div className="flex justify-between gap-3 py-1 border-b border-line/60 text-[12px]"><span className="text-muted">{k}</span><span className={`tnum text-right ${hot ? 'text-coral-ink font-semibold' : 'text-ink font-medium'}`}>{v}</span></div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] gap-4 items-start">
      <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
        <section className="surface surface-tint px-4 py-3">
          <h3 className="label-caps !text-blue">Analysis context</h3>
          <label className="block mt-2 text-[11.5px] text-muted" htmlFor="asof">Answer as of (IST end of day)</label>
          <input id="asof" type="date" className={`${inputCls} mt-1 tnum`} min={dayKey(model.dayRange.start)} max={dayKey(model.dayRange.end)} value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
          <div className="flex gap-1.5 mt-1.5">
            <button onClick={() => setAsOf(preEvent)} className={`h-6 px-2 rounded border text-[11.5px] ${asOf === preEvent ? 'border-blue text-blue bg-blue-50' : 'border-line text-ink-2 hover:border-blue-300'}`}>Day before event</button>
            <button onClick={() => setAsOf(dayKey(model.dayRange.end))} className={`h-6 px-2 rounded border text-[11.5px] ${asOf === dayKey(model.dayRange.end) ? 'border-blue text-blue bg-blue-50' : 'border-line text-ink-2 hover:border-blue-300'}`}>End of history</button>
          </div>
          <div className="mt-3">
            {ctxRow('Target in force', snap.target.version)}
            {ctxRow('Registrations · target', `${fmtInt(snap.registrations)} / ${fmtInt(snap.target.registrationGoal)}`, snap.attainment.registrations < 1)}
            {ctxRow('Verified visitors · target', snap.eventStarted ? `${fmtInt(snap.visitors)} / ${fmtInt(snap.target.visitorsGoal)}` : 'event not started', snap.eventStarted && snap.attainment.visitors < 1)}
            {ctxRow('Spend · budget', `${fmtINR(snap.spend)} / ${fmtINR(snap.target.budget)}`)}
            {ctxRow('Cost per verified attendee', fmtINR(snap.costPerVisitor))}
            {ctxRow('Registration → attendance', fmtPct(snap.attendanceConversion))}
          </div>
          <p className="text-[11px] text-muted mt-1.5 leading-4">Observed values from the workbook at this date. Questions naming a date ("as of 31 March", "in February") use that date instead.</p>
          <div className="mt-3 text-[12px]"><div className="text-[11.5px] text-muted">Follow-ups apply to</div><div className="mt-1 flex flex-wrap gap-1">{ctxCampaigns.length ? ctxCampaigns.map((c) => <Badge key={c} tone="blue">{c}</Badge>) : <span className="text-ink-2">the whole portfolio</span>}</div></div>
          <div className="mt-2 text-[11.5px] text-muted">Workspace: {ws.campaigns.length} simulations · {ws.tasks.filter((t) => t.status !== 'done').length} open tasks · {ws.experiments.length} experiments</div>
        </section>
        <section className="surface surface-tint px-4 py-3 text-[12px]">
          <div className="flex items-center justify-between"><span className="label-caps !text-blue">Answer engine</span><span className="text-[11px] text-muted">{gem.enabled ? `Local + ${gem.model}` : 'Local'}</span></div>
          <p className="text-[11.5px] text-muted mt-1 leading-4">Numbers come from the same functions as the dashboard. {gem.enabled ? 'Gemini only rewrites them, and every number it writes is checked.' : 'Optional Gemini narration is off (set GEMINI_API_KEY on the server).'}</p>
          {gem.enabled && <label className="flex items-center gap-2 mt-2"><input type="checkbox" checked={useGem} onChange={(e) => setUseGem(e.target.checked)} />Add Gemini narration</label>}
          {turns.length > 0 && <button onClick={() => { setTurns([]); setCtx({}) }} className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-coral-ink"><Trash2 size={12} />Clear conversation</button>}
        </section>
      </aside>

      <div className="flex flex-col gap-3 min-w-0">
        {turns.length === 0 ? (
          <section className="surface px-5 py-4">
            <h2 className="text-[15px] font-semibold">Ask about {model.raw.event.name}</h2>
            <p className="text-[12.5px] text-ink-2 mt-1 leading-[18px] max-w-[760px]">Answers come from the workbook and this workspace. Each one states the metric and date range, separates observed facts from forecasts, says when the data cannot answer, and proposes changes you confirm before anything is saved.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mt-4">
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <div className="label-caps !text-[10px] mb-1">{g.title}</div>
                  {g.qs.map((q) => <button key={q} onClick={() => ask(q)} className="block w-full text-left text-[12.5px] text-blue hover:underline py-1 border-b border-line/60">{q}</button>)}
                </div>
              ))}
            </div>
          </section>
        ) : turns.map((t) => (
          <div key={t.id} className="flex flex-col gap-2">
            <div className="self-end max-w-[85%] bg-blue text-white rounded-md px-3 py-2 text-[13px]">{t.q}<div className="text-[11px] text-blue-100 mt-0.5">as of {fmtDay(parseDayKey(t.asOf), true)}</div></div>
            <ResponseView t={t} onAction={onAction} onFollow={ask} />
          </div>
        ))}
        <div ref={endRef} />
        <form className="sticky bottom-0 bg-canvas pt-1 pb-2" onSubmit={(e) => { e.preventDefault(); ask(input) }}>
          <div className="flex gap-2 surface p-1.5 focus-within:border-blue focus-within:ring-2 focus-within:ring-blue-100">
            <input className="flex-1 px-2 outline-none text-[13px] bg-transparent min-w-0" placeholder={ctx.lastResponse ? 'Follow up: "why?", "and for referrals?", "how confident is this?"' : 'Ask about targets, funnel, campaigns, costs, budget or next steps'} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Question" />
            <Button type="submit" disabled={!input.trim()}><Send size={13} />Ask</Button>
          </div>
          {turns.length > 0 && <div className="flex flex-wrap gap-1.5 mt-1.5">{GROUPS.flatMap((g) => g.qs.slice(0, 1)).map((q) => <button key={q} type="button" onClick={() => ask(q)} className="text-[11.5px] px-2 h-6 rounded border border-line bg-white text-ink-2 hover:border-blue-300 hover:text-blue">{q}</button>)}</div>}
        </form>
      </div>

      {pending && pending.a.kind === 'create_campaign' && (
        <CampaignForm channels={channels} owners={owners} initial={{ ...blankCampaign(), ...pending.a.draft, origin: 'analyst', status: 'draft' }}
          onClose={() => setPending(null)} onSaved={(c) => { markApplied(pending.turnId, pending.idx); navigate('campaigns', { c: c.id }) }} />
      )}
      {pending && pending.a.kind === 'create_task' && (() => {
        const a = pending.a
        return (
          <Modal title="Confirm task" onClose={() => setPending(null)} footer={<><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button onClick={() => { addTask(a.task); markApplied(pending.turnId, pending.idx); setPending(null); toast(`Task created: ${a.task.title}`) }}>Create task</Button></>}>
            <Notice>The analyst proposes this task. It is created only after you confirm.</Notice>
            <div className="mt-3 text-[12.5px] grid grid-cols-[100px_1fr] gap-y-1"><span className="text-muted">Task</span><b>{a.task.title}</b><span className="text-muted">Owner</span><span>{a.task.owner}</span><span className="text-muted">Due</span><span>{a.task.due}</span>{a.task.opportunityId && <><span className="text-muted">Opportunity</span><span>{a.task.opportunityId}</span></>}</div>
          </Modal>
        )
      })()}
      {pending && pending.a.kind === 'set_status' && (() => {
        const a = pending.a
        return (
          <Modal title="Confirm plan status change" onClose={() => setPending(null)} footer={<><Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button variant="accent" onClick={() => { setCampaignStatus(a.campaignId, a.status, a.isSource, a.name); markApplied(pending.turnId, pending.idx); setPending(null); toast(`${a.name}: plan status set to ${a.status}.`) }}>Set to {a.status}</Button></>}>
            <p className="text-[12.5px]">Set the plan status of <b>{a.name}</b> to <b>{a.status}</b>?</p>
            <p className="text-[12px] text-muted mt-2">{a.isSource ? 'This is a planning status inside this app. Historical workbook results do not change and nothing is sent to an ad platform.' : 'Local simulation only.'}</p>
          </Modal>
        )
      })()}
    </div>
  )
}
