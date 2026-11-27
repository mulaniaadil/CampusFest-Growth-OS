import { useMemo, useState, type ReactNode } from 'react'
import { ListPlus } from 'lucide-react'
import { useData } from '../data/DataContext'
import { FilterBar } from '../components/FilterBar'
import { Badge, Button, Card, Empty, Notice, Segmented } from '../components/ui'
import { CumulativeVsTargetChart, FunnelTable, QuadrantMatrix, StatusStack, C } from '../components/charts'
import {
  attendanceQuality, campaignPerformance, channelPerformance, dailyTrend, engagementSegments, funnel, recoveryPools, statusDistribution, timingSegments, type CampaignPerf,
} from '../analytics/metrics'
import { deprioritized, opportunities, proposedAllocation, PRIORITY_FORMULA } from '../analytics/opportunities'
import { fmtINR, fmtInt, fmtPct, fmtPp, safeDiv } from '../lib/format'
import { fmtDay } from '../lib/time'
import { navigate, useRoute } from '../lib/router'
import { addTask } from '../store/workspace'
import { toast } from '../lib/toast'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Tab = 'funnel' | 'campaigns' | 'cohorts' | 'strategy'
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'funnel', label: 'Funnel & Status', hint: 'Where people drop off' },
  { key: 'campaigns', label: 'Campaigns & Spend', hint: 'Which campaigns earn attendees' },
  { key: 'cohorts', label: 'Cohorts & Quality', hint: 'Which behaviours predict attendance' },
  { key: 'strategy', label: 'Prioritized Strategy', hint: 'What to do, in order' },
]

function Th({ children, r, wide }: { children: ReactNode; r?: boolean; wide?: boolean }) {
  return <th className={`label-caps !text-[10px] px-3 py-2 border-b border-line align-bottom ${r ? 'text-right' : 'text-left'} ${wide ? 'hidden xl:table-cell' : ''}`}>{children}</th>
}
function Td({ children, r, hot, strong, wide }: { children: ReactNode; r?: boolean; hot?: boolean; strong?: boolean; wide?: boolean }) {
  return <td className={`px-3 py-2 border-b border-line/60 tnum ${r ? 'text-right' : ''} ${hot ? 'text-coral-ink font-semibold' : strong ? 'font-semibold' : ''} ${wide ? 'hidden xl:table-cell' : ''}`}>{children}</td>
}

/** Sorted horizontal ranking with a reference line. Replaces rotated-label column charts. */
function Ranking({ rows, fmt, refValue, refLabel, higherIsWorse }: { rows: { name: string; value: number; sub?: string }[]; fmt: (v: number) => string; refValue: number; refLabel: string; higherIsWorse?: boolean }) {
  const valid = rows.filter((r) => Number.isFinite(r.value))
  if (!valid.length) return <Empty title="No values for this period" />
  const max = Math.max(...valid.map((r) => r.value), Number.isFinite(refValue) ? refValue : 0) * 1.08
  const sorted = [...valid].sort((a, b) => (higherIsWorse ? a.value - b.value : b.value - a.value))
  return (
    <div className="flex flex-col">
      {sorted.map((r) => {
        const bad = Number.isFinite(refValue) && (higherIsWorse ? r.value > refValue : r.value < refValue)
        return (
          <div key={r.name} className="grid grid-cols-[150px_1fr_72px] gap-3 items-center py-1.5 border-b border-line/60 last:border-0">
            <span className="text-[12px] text-ink-2 leading-4">{r.name}{r.sub && <span className="block text-[11px] text-muted">{r.sub}</span>}</span>
            <span className="relative h-3.5 bg-canvas rounded-sm">
              <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(r.value / max) * 100}%`, background: bad ? C.coral : C.blue }} />
              {Number.isFinite(refValue) && <span className="absolute -top-1 -bottom-1 w-px bg-ink/60" style={{ left: `${(refValue / max) * 100}%` }} />}
            </span>
            <span className={`text-right text-[12.5px] tnum ${bad ? 'text-coral-ink font-semibold' : 'text-ink'}`}>{fmt(r.value)}</span>
          </div>
        )
      })}
      {Number.isFinite(refValue) && <div className="text-[11.5px] text-muted mt-2">Vertical line = {refLabel} ({fmt(refValue)}). Coral = worse than the reference.</div>}
    </div>
  )
}

export function Analytics() {
  const { model, scope } = useData()
  const { params } = useRoute()
  const tabParam = params.get('tab')
  const tab: Tab = (['funnel', 'campaigns', 'cohorts', 'strategy'] as Tab[]).includes(tabParam as Tab) ? (tabParam as Tab) : tabParam === 'opportunities' ? 'strategy' : 'funnel'
  const [stage, setStage] = useState<string>('attended')
  const [trendMetric, setTrendMetric] = useState<'registrations' | 'identified'>('registrations')
  const [effMetric, setEffMetric] = useState<'cpa' | 'cpr' | 'cpi'>('cpa')

  const d = useMemo(() => {
    if (!model || !scope) return null
    return {
      fun: funnel(model, scope), perf: campaignPerformance(model, scope), ch: channelPerformance(model, scope), trend: dailyTrend(model, scope),
      status: statusDistribution(model, scope), seg: engagementSegments(model, scope), timing: timingSegments(model, scope), q: attendanceQuality(model, scope),
      pools: recoveryPools(model, scope), opp: opportunities(model, scope), avoid: deprioritized(model, scope), alloc: proposedAllocation(model, scope),
    }
  }, [model, scope])
  if (!model || !scope || !d) return null
  const setTab = (t: Tab) => navigate('analytics', { tab: t })
  const tabBar = (
    <div className="flex flex-wrap items-end gap-x-1 border-b border-line" role="tablist" aria-label="Analysis">
      {TABS.map((t) => (
        <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
          className={`px-3.5 pt-2 pb-2 -mb-px border-b-2 text-left whitespace-nowrap ${tab === t.key ? 'border-blue text-blue' : 'border-transparent text-ink-2 hover:text-ink'}`}>
          <span className="block text-[13px] font-semibold">{t.label}</span>
          <span className="block text-[11px] text-muted font-normal">{t.hint}</span>
        </button>
      ))}
    </div>
  )
  if (scope.campaignIds && scope.campaignIds.length === 0) return (<div className="flex flex-col gap-4"><FilterBar />{tabBar}<Card><Empty title="No data for this filter combination" text="Clear the campaign or channel filter." /></Card></div>)
  const { fun, perf, ch, trend, status, seg, timing, q, pools, opp, avoid, alloc } = d
  const eventSeen = scope.end >= model.raw.event.startsAt

  const fstages = eventSeen ? fun.people : fun.people.filter((x) => x.key !== 'attended')
  const stIdx = fstages.findIndex((s) => s.key === stage) >= 0 ? fstages.findIndex((s) => s.key === stage) : fstages.length - 1
  const st = fstages[stIdx], prev = fstages[stIdx - 1]
  let worst = ''
  { let l = -1; fstages.forEach((s, i) => { if (i && fstages[i - 1].value - s.value > l) { l = fstages[i - 1].value - s.value; worst = s.key } }) }
  const stageVal = (r: CampaignPerf, k: string) => ({ identified: r.identified, engaged: r.engaged, started: r.identifiedStarts, registered: r.registrations, confirmed: r.confirmed, attended: r.attendees } as Record<string, number>)[k]

  const pairs: { name: string; yes: (typeof seg)[0]; no: (typeof seg)[0] }[] = []
  for (let i = 0; i < seg.length; i += 2) pairs.push({ name: seg[i].segment, yes: seg[i], no: seg[i + 1] })

  const effLabel = { cpa: 'Cost per verified attendee', cpr: 'Cost per registration', cpi: 'Cost per identified person' }[effMetric]
  const sum = (f: (r: CampaignPerf) => number) => perf.rows.reduce((a, r) => a + f(r), 0)
  const effRef = { cpa: perf.portfolio.cpa, cpr: safeDiv(sum((r) => r.spend), sum((r) => r.registrations)), cpi: safeDiv(sum((r) => r.spend), sum((r) => r.identified)) }[effMetric]

  return (
    <div className="flex flex-col gap-4">
      <FilterBar note="Cohort views: people first identified in range, outcomes at range end" />
      {tabBar}

      {tab === 'funnel' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_1fr] gap-4">
            <Card title="Acquisition funnel" subtitle={fun.note}>
              <FunnelTable stages={fstages} selected={st.key} onSelect={setStage} worstKey={worst} />
              <p className="text-[11.5px] text-muted mt-2">{!eventSeen && <>Verified attendance is not observable before {fmtDay(model.raw.event.startsAt, true)}. </>}Select a stage to inspect it. {fmtInt(fun.walkIns)} walk-in verified visitors are outside this funnel (no campaign, no registration).</p>
            </Card>
            <Card title={`Stage: ${st.label}`} subtitle={st.definition}>
              {prev ? (
                <>
                  <dl className="grid grid-cols-2 gap-px bg-line border border-line rounded overflow-hidden text-[12px] [&>div]:bg-white">
                    <div className="px-3 py-2"><dt className="text-muted">Numerator · {st.label.toLowerCase()}</dt><dd className="text-[17px] font-semibold tnum">{fmtInt(st.value)}</dd></div>
                    <div className="px-3 py-2"><dt className="text-muted">Denominator · {prev.label.toLowerCase()}</dt><dd className="text-[17px] font-semibold tnum">{fmtInt(prev.value)}</dd></div>
                    <div className="px-3 py-2"><dt className="text-muted">Step conversion</dt><dd className={`text-[17px] font-semibold tnum ${st.key === worst ? 'text-coral-ink' : ''}`}>{fmtPct(st.fromPrev)}</dd></div>
                    <div className="px-3 py-2"><dt className="text-muted">People lost at this step</dt><dd className={`text-[17px] font-semibold tnum ${st.key === worst ? 'text-coral-ink' : ''}`}>{fmtInt(prev.value - st.value)}</dd></div>
                  </dl>
                  <table className="w-full text-[12px] mt-3">
                    <thead><tr><Th>Campaign</Th><Th r>{prev.label}</Th><Th r>{st.label}</Th><Th r>Conv.</Th></tr></thead>
                    <tbody>
                      {[...perf.rows].sort((a, b) => safeDiv(stageVal(a, st.key), stageVal(a, prev.key)) - safeDiv(stageVal(b, st.key), stageVal(b, prev.key))).map((r) => {
                        const c = safeDiv(stageVal(r, st.key), stageVal(r, prev.key))
                        return <tr key={r.id}><Td>{r.name}</Td><Td r>{fmtInt(stageVal(r, prev.key))}</Td><Td r>{fmtInt(stageVal(r, st.key))}</Td><Td r hot={c < (st.fromPrev ?? 0) - 0.05}>{fmtPct(c)}</Td></tr>
                      })}
                    </tbody>
                  </table>
                  <p className="text-[11.5px] text-muted mt-2">Coral = campaign converts ≥5 pp below the overall step rate.</p>
                </>
              ) : <Empty title="First stage" text="Select a later stage to see its numerator, denominator, conversion and loss." />}
            </Card>
          </div>

          <Card title="Anonymous awareness activity" subtitle="Platform event counts in range. Not people: impressions, clicks and sessions cannot be de-duplicated, so they are never joined to the person funnel.">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line rounded overflow-hidden [&>div]:bg-white">
              {fun.anonymous.map((a) => <div key={a.key} className="px-3 py-2"><div className="text-[11.5px] text-muted">{a.label}</div><div className="text-[17px] font-semibold tnum">{fmtInt(a.value)}</div><div className="text-[11px] text-muted">{a.fromPrev != null ? `${fmtPct(a.fromPrev, 2)} of previous` : 'events, not people'}</div></div>)}
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_1fr] gap-4">
            <Card title="Cumulative progress vs target" subtitle="Step change = target revision. Lower panel: daily status changes from registration history."
              right={<Segmented value={trendMetric} onChange={setTrendMetric} options={[{ value: 'registrations', label: 'Registrations' }, { value: 'identified', label: 'Identified' }]} />}>
              <CumulativeVsTargetChart data={trend} metric={trendMetric} height={250} />
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(v) => fmtDay(v)} minTickGap={32} tickLine={false} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip labelFormatter={(v) => fmtDay(Number(v), true)} contentStyle={{ fontSize: 11 }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar isAnimationActive={false} dataKey="confirmations" name="Changed to confirmed" fill={C.blue} maxBarSize={6} />
                  <Bar isAnimationActive={false} dataKey="cancellations" name="Changed to cancelled" fill={C.coral} maxBarSize={6} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Registration status" subtitle={`Latest status version at ${fmtDay(scope.end, true)}, split by attendance`}>
              <StatusStack data={status} height={170} />
              <table className="w-full text-[12px] mt-2">
                <thead><tr><Th>Status</Th><Th r>Registrations</Th><Th r>Attended</Th><Th r>Did not attend</Th><Th r>Show rate</Th></tr></thead>
                <tbody>{status.map((s) => <tr key={s.status}><Td>{s.status}</Td><Td r>{fmtInt(s.registrations)}</Td><Td r>{fmtInt(s.attended)}</Td><Td r hot={eventSeen && s.noShow > 0 && s.status === 'confirmed'}>{fmtInt(s.noShow)}</Td><Td r>{fmtPct(s.showRate)}</Td></tr>)}</tbody>
              </table>
              {!eventSeen && <p className="text-[11.5px] text-muted mt-1">Attendance appears from {fmtDay(model.raw.event.startsAt, true)}.</p>}
            </Card>
          </div>
        </>
      )}

      {tab === 'campaigns' && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
            <Card title="Campaign matrix" subtitle="Volume (registrations) × attendance quality (registered → attended). Bubble size = spend; dashed lines = portfolio averages.">
              <QuadrantMatrix rows={perf.rows} avgReg={perf.portfolio.avgRegistrations} showRate={perf.portfolio.showRate} height={330} onSelect={(id) => navigate('campaigns', { c: id })} />
            </Card>
            <Card title="Quadrant decisions" subtitle="Rule-based from the matrix, not a single-metric rank">
              {(['Scale', 'Grow', 'Fix', 'Pause'] as const).map((qd) => {
                const rs = perf.rows.filter((r) => r.quadrant.startsWith(qd))
                const desc = { Scale: 'High volume, high conversion: keep, scale carefully', Grow: 'Low volume, high quality: invest, test saturation', Fix: 'High volume, low conversion: fix attendance, cap spend', Pause: 'Low volume, low conversion: pause or redesign' }[qd]
                return (
                  <div key={qd} className="py-2.5 border-b border-line/70 last:border-0">
                    <div className="flex items-center gap-2"><Badge tone={qd === 'Fix' || qd === 'Pause' ? 'coral' : 'blue'}>{qd}</Badge><span className="text-[12px] text-muted">{desc}</span></div>
                    <div className="mt-1 text-[12.5px] flex flex-wrap gap-x-3">{rs.length ? rs.map((r) => <button key={r.id} className="text-blue hover:underline" onClick={() => navigate('campaigns', { c: r.id })}>{r.name} <span className="text-muted tnum">{fmtINR(r.cpa)}/att.</span></button>) : <span className="text-muted">None in this period</span>}</div>
                  </div>
                )
              })}
              {!eventSeen && <Notice>Quadrants need attendance data; move the end date to the event or later.</Notice>}
            </Card>
          </div>

          <Card title="Campaign conversion rates" subtitle="Definitions are in Data audit → Metric definitions. CTR counts anonymous events." pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr><Th>Campaign</Th><Th r wide>CTR (anon.)</Th><Th r wide>Identified → started</Th><Th r>Identified → registered</Th><Th r>Registered → confirmed</Th><Th r>Confirmed → attended</Th><Th r>Registered → attended</Th><Th r>Cancel rate</Th><Th r wide>Opted out</Th></tr></thead>
                <tbody>
                  {perf.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-blue-50/40">
                      <Td><span className="font-medium whitespace-nowrap">{r.name}</span></Td><Td r wide>{fmtPct(r.ctr, 2)}</Td><Td r wide>{fmtPct(safeDiv(r.identifiedStarts, r.identified))}</Td><Td r>{fmtPct(r.regRate)}</Td>
                      <Td r>{fmtPct(safeDiv(r.confirmed, r.registrations))}</Td><Td r hot={r.confirmedShowRate < 0.7}>{fmtPct(r.confirmedShowRate)}</Td><Td r hot={r.showRate < perf.portfolio.showRate - 0.05}>{fmtPct(r.showRate)}</Td><Td r>{fmtPct(r.cancelRate)}</Td><Td r wide>{fmtInt(r.optedOut)}</Td>
                    </tr>
                  ))}
                  <tr className="bg-canvas/60 font-semibold"><Td>Portfolio</Td><Td r wide>{fmtPct(safeDiv(sum((r) => r.clicks), sum((r) => r.impressions)), 2)}</Td><Td r wide>{fmtPct(safeDiv(sum((r) => r.identifiedStarts), sum((r) => r.identified)))}</Td><Td r>{fmtPct(safeDiv(sum((r) => r.registrations), sum((r) => r.identified)))}</Td><Td r>{fmtPct(safeDiv(sum((r) => r.confirmed), sum((r) => r.registrations)))}</Td><Td r>{fmtPct(safeDiv(sum((r) => r.confirmedAttendees), sum((r) => r.confirmed)))}</Td><Td r>{fmtPct(perf.portfolio.showRate)}</Td><Td r>{fmtPct(safeDiv(sum((r) => r.cancelled), sum((r) => r.registrations)))}</Td><Td r wide>{fmtInt(sum((r) => r.optedOut))}</Td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-muted px-3 py-2">Coral: confirmed → attended below 70%, or registered → attended ≥5 pp below portfolio. CTR, form starts and opt-outs appear on wider screens.</p>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Spend efficiency" subtitle={`${effLabel} by campaign · net spend in range`}
              right={<Segmented value={effMetric} onChange={setEffMetric} options={[{ value: 'cpa', label: 'Per attendee' }, { value: 'cpr', label: 'Per registration' }, { value: 'cpi', label: 'Per identified' }]} />}>
              <Ranking rows={perf.rows.map((r) => ({ name: r.name, value: r[effMetric], sub: `${fmtINR(r.spend)} spend` }))} fmt={fmtINR} refValue={effRef} refLabel="portfolio average" higherIsWorse />
            </Card>
            <Card title="Spend vs outcome share" subtitle="Where the money went and where attendees came from" pad={false}>
              <table className="w-full text-[12.5px]">
                <thead><tr><Th>Campaign</Th><Th r>Spend</Th><Th r>Spend share</Th><Th r>Attendee share</Th><Th r>Gap</Th></tr></thead>
                <tbody>{[...perf.rows].sort((a, b) => (b.spendShare - b.attendanceShare) - (a.spendShare - a.attendanceShare)).map((r) => { const g = r.attendanceShare - r.spendShare; return <tr key={r.id}><Td><span className="whitespace-nowrap">{r.name}</span></Td><Td r>{fmtINR(r.spend)}</Td><Td r>{fmtPct(r.spendShare)}</Td><Td r>{fmtPct(r.attendanceShare)}</Td><Td r hot={g < -0.05}>{fmtPp(g)}</Td></tr> })}</tbody>
              </table>
              <p className="text-[11.5px] text-muted px-3 py-2">Gap = attendee share − spend share. Coral = campaign takes ≥5 pp more of the budget than of the attendees.</p>
            </Card>
          </div>

          <Card title="Channel comparison" subtitle="Each source campaign uses one channel. Walk-ins have no channel and no recorded cost (unknown, not zero)." pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr><Th>Channel · campaign</Th><Th r>Spend</Th><Th r wide>Identified</Th><Th r>Registrations</Th><Th r>Verified att.</Th><Th r wide>Identified → reg.</Th><Th r>Reg → attend</Th><Th r>Cost / att.</Th></tr></thead>
                <tbody>{ch.map((c) => <tr key={c.channel}><Td><b>{c.channel}</b><div className="text-[11px] text-muted">{c.campaigns.join(', ')}</div></Td><Td r>{c.spend ? fmtINR(c.spend) : '—'}</Td><Td r wide>{fmtInt(c.identified)}</Td><Td r>{fmtInt(c.registrations)}</Td><Td r strong>{fmtInt(c.attendees)}</Td><Td r wide>{fmtPct(c.regRate)}</Td><Td r hot={Number.isFinite(c.showRate) && c.showRate < perf.portfolio.showRate - 0.05}>{fmtPct(c.showRate)}</Td><Td r>{fmtINR(c.cpa)}</Td></tr>)}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'cohorts' && (
        <>
          <Card title="Engagement behaviour and outcomes" subtitle="Campaign-identified people who did vs did not perform each identified action. Associations, not causal effects." pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr><Th>Signal</Th><Th r>People who did</Th><Th r>Their reg. rate</Th><Th r>Their attend rate</Th><Th r>People who didn't</Th><Th r>Their attend rate</Th><Th r>Difference</Th></tr></thead>
                <tbody>
                  {pairs.map((p) => {
                    const diff = p.yes.showRate - p.no.showRate
                    return <tr key={p.name}><Td><span className="font-medium">{p.name}</span></Td><Td r>{fmtInt(p.yes.people)}</Td><Td r>{fmtPct(p.yes.regRate)}</Td><Td r>{fmtPct(p.yes.showRate)}</Td><Td r>{fmtInt(p.no.people)}</Td><Td r>{fmtPct(p.no.showRate)}</Td><Td r hot={diff < -0.05} strong={diff > 0.05}>{fmtPp(diff)}</Td></tr>
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-muted px-3 py-2">Attend rate = registered people with a verified admission ÷ registered people in the group. Nurture emails went mostly to unregistered people, so recipients register less: that is targeting, not an email effect.</p>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Registration timing" subtitle="Registered → attended by days between registration and event start (IST)">
              <Ranking rows={timing.filter((t) => t.registrations > 0).map((t) => ({ name: t.bucket, value: t.showRate, sub: `${fmtInt(t.registrations)} registrations` }))} fmt={(v) => fmtPct(v)} refValue={perf.portfolio.showRate} refLabel="portfolio show rate" />
              <table className="w-full text-[12px] mt-3">
                <thead><tr><Th>Registered</Th><Th r>Registrations</Th><Th r>Attended</Th><Th r>Cancelled</Th><Th r>Confirmed share</Th></tr></thead>
                <tbody>{timing.map((t) => <tr key={t.bucket}><Td>{t.bucket}</Td><Td r>{fmtInt(t.registrations)}</Td><Td r>{fmtInt(t.attended)}</Td><Td r>{fmtPct(t.cancelRate)}</Td><Td r>{fmtPct(t.confirmedShare)}</Td></tr>)}</tbody>
              </table>
            </Card>
            <Card title="Attendance quality" subtitle="From de-duplicated check-ins; only admitted + verified records establish attendance" pad={false}>
              {eventSeen ? (
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {([
                      ['Verified unique visitors', fmtInt(q.visitors), 'distinct people'],
                      ['… registered', fmtInt(q.registered), fmtPct(safeDiv(q.registered, q.visitors))],
                      ['… walk-ins (no campaign)', fmtInt(q.walkIns), fmtPct(safeDiv(q.walkIns, q.visitors))],
                      ['Attended both days', fmtInt(q.twoDay), fmtPct(safeDiv(q.twoDay, q.visitors))],
                      ['Admission events per visitor', q.avgAdmitEvents.toFixed(2), 're-entry + second day'],
                      ['Admitted only by manual entry', fmtInt(q.manualOnly), 'scanner bypassed'],
                      ['Attended after cancelling once', fmtInt(q.everCancelledAttended), 're-confirmed'],
                      ['Lost at the gate (denied / pending)', fmtInt(q.gateLost), `${fmtInt(q.gateRecovered)} recovered later`, true],
                      ['Confirmed registrants who did not attend', fmtInt(q.confirmedNoShow), 'largest leak', true],
                    ] as [string, string, string, boolean?][]).map(([l, v, s, hot]) => <tr key={l}><Td>{l}</Td><Td r hot={hot} strong>{v}</Td><Td r><span className="text-muted">{s}</span></Td></tr>)}
                  </tbody>
                </table>
              ) : <Empty title="No attendance yet" text={`The event starts ${fmtDay(model.raw.event.startsAt, true)}. Move the end date to see attendance quality.`} />}
            </Card>
          </div>

          <Card title="Recovery pools at range end" subtitle="Identified people who can still be converted without new acquisition spend">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-line border border-line rounded overflow-hidden [&>div]:bg-white">
              {([['Form abandoners', pools.formAbandoners, 'started form, no registration'], ['… contactable', pools.formAbandonersContactable, 'not opted out'], ['Waitlisted', pools.waitlisted, 'never released'], ['Stuck at “interested”', pools.stuckInterested, 'never confirmed'], ['Cancelled', pools.cancelled, 'latest status']] as [string, number, string][]).map(([l, v, s]) => (
                <div key={l} className="px-3 py-2"><div className="text-[11.5px] text-muted">{l}</div><div className="text-[17px] font-semibold tnum">{fmtInt(v)}</div><div className="text-[11px] text-muted">{s}</div></div>
              ))}
            </div>
            <p className="text-[11.5px] text-muted mt-2">Not available in the workbook: demographics, college names, city or reasons for no-shows.</p>
          </Card>
        </>
      )}

      {tab === 'strategy' && (
        <>
          <section className="surface surface-action px-5 py-3 flex flex-wrap items-center gap-x-8 gap-y-2" aria-label="Scenario">
            <div><div className="text-[11.5px] text-muted">Observed baseline</div><div className="text-[18px] font-semibold tnum">{fmtInt(opp.baseline)} <span className="text-[12px] font-normal text-muted">verified visitors</span></div></div>
            <div><div className="text-[11.5px] text-muted">Base case (forecast)</div><div className="text-[18px] font-semibold tnum text-blue">{fmtInt(opp.scenario.base)} <span className="text-[12px] font-normal text-muted">+{fmtInt(opp.scenario.base - opp.baseline)}</span></div></div>
            <div><div className="text-[11.5px] text-muted">Range (forecast)</div><div className="text-[18px] font-semibold tnum">{fmtInt(opp.scenario.low)} – {fmtInt(opp.scenario.high)}</div></div>
            <div className="text-[11.5px] text-muted max-w-[480px] leading-4">Forecasts are modeled from observed rates with stated assumptions; each needs its experiment. {PRIORITY_FORMULA}.</div>
          </section>

          <Card title="Prioritized opportunities" subtitle="Ranked by priority score; expand a row for evidence, assumptions and the experiment" pad={false}>
            {opp.list.length ? opp.list.map((o) => (
              <details key={o.id} className="border-b border-line last:border-0" open={o.rank === 1}>
                <summary className="cursor-pointer list-none px-4 py-3 grid grid-cols-[28px_1fr_auto] lg:grid-cols-[28px_1fr_150px_100px_100px_60px] gap-3 items-center hover:bg-canvas/60">
                  <span className={`w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center ${o.rank === 1 ? 'bg-coral text-ink' : 'bg-blue text-white'}`}>{o.rank}</span>
                  <span className="text-[13px] font-semibold">{o.title}<span className="block text-[11.5px] font-normal text-muted">{o.audience}</span></span>
                  <span className="hidden lg:block text-[12.5px] tnum text-right">+{o.impact.low}–{o.impact.high} <span className="text-muted">(base +{o.impact.base})</span></span>
                  <span className="hidden lg:block text-[12px]">{o.confidence} confidence</span>
                  <span className="hidden lg:block text-[12px] text-muted">{o.effort} effort</span>
                  <span className="text-[13px] font-semibold text-right tnum" title="Priority score">{o.score}</span>
                </summary>
                <div className="px-4 pb-4 lg:pl-[52px] grid grid-cols-1 lg:grid-cols-3 gap-5 text-[12.5px] leading-[18px]">
                  <div><div className="label-caps !text-blue mb-1">Observed in the workbook</div><p className="font-medium">{o.problem}</p><ul className="list-disc ml-4 mt-1 text-ink-2">{o.evidence.map((e) => <li key={e}>{e}</li>)}</ul></div>
                  <div><div className="label-caps mb-1">Intervention</div><p>{o.intervention}</p><p className="mt-1.5 text-ink-2"><b>Success metric:</b> {o.successMetric}</p><p className="text-ink-2"><b>Assumed cost:</b> {fmtINR(o.cost)} · {o.costNote}</p></div>
                  <div>
                    <div className="label-caps !text-coral-ink mb-1">Forecast assumptions</div>
                    <ul className="list-disc ml-4 text-ink-2">{o.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                    <div className="label-caps mt-2 mb-1">Experiment · decision rules</div>
                    <p className="text-ink-2">{o.experiment}</p>
                    <dl className="mt-1.5 grid grid-cols-[56px_1fr] gap-y-1 text-[12px]"><dt className="text-blue font-semibold">Scale</dt><dd>{o.thresholds.scale}</dd><dt className="text-ink-2 font-semibold">Change</dt><dd>{o.thresholds.change}</dd><dt className="text-coral-ink font-semibold">Stop</dt><dd>{o.thresholds.stop}</dd></dl>
                    <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => { addTask({ title: `${o.id}: ${o.title}`, owner: 'Growth lead', due: new Date(Date.now() + o.daysToSignal * 86400000).toISOString().slice(0, 10), status: 'todo', origin: 'manual', opportunityId: o.id, campaignRef: o.campaignIds[0] }); toast(`Task created for ${o.id}. Track it in Campaign Manager → Tasks.`) }}><ListPlus size={13} />Create task</Button></div>
                  </div>
                </div>
              </details>
            )) : <Empty title="No opportunities apply for this filter or period" />}
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Proposed budget allocation (base case)" subtitle={`Plan within the ${fmtINR(alloc.budget)} approved budget, derived from the same opportunity model`} pad={false}>
              <table className="w-full text-[12.5px]">
                <thead><tr><Th>Line</Th><Th r>Actual spend</Th><Th r>Proposed</Th><Th r>Change</Th></tr></thead>
                <tbody>
                  {[...alloc.rows].sort((a, b) => b.delta - a.delta).map((r) => <tr key={r.id}><Td>{r.name}</Td><Td r>{fmtINR(r.current)}</Td><Td r strong>{fmtINR(r.proposed)}</Td><Td r hot={r.delta < 0}>{r.delta === 0 ? '—' : `${r.delta > 0 ? '+' : '−'}${fmtINR(Math.abs(r.delta))}`}</Td></tr>)}
                  {alloc.activation.map((a) => <tr key={a.id}><Td>{a.id} · {a.label}</Td><Td r>—</Td><Td r strong>{fmtINR(a.amount)}</Td><Td r><span className="text-muted">new</span></Td></tr>)}
                  <tr className="bg-canvas/60"><Td><b>Total</b></Td><Td r>{fmtINR(alloc.rows.reduce((a, r) => a + r.current, 0))}</Td><Td r strong>{fmtINR(alloc.total)}</Td><Td r><span className="text-muted">budget {fmtINR(alloc.budget)}</span></Td></tr>
                </tbody>
              </table>
              <p className="text-[11.5px] text-muted px-3 py-2">Proposed figures are a plan, not spend. Move money in 25% steps and read marginal cost before the next step.</p>
            </Card>
            <Card title="Deprioritized: what we would not fund" subtitle="Derived from the same campaign evidence">
              {avoid.map((a) => <div key={a.idea} className="py-2 border-b border-line/70 last:border-0"><div className="text-[12.5px] font-semibold">{a.idea}</div><div className="text-[12px] text-ink-2 leading-[17px]">{a.why}</div></div>)}
              {!avoid.length && <Empty title="Nothing deprioritized for this period" />}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
