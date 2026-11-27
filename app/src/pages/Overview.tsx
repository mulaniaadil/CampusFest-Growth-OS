import { useMemo, type ReactNode } from 'react'
import { ArrowRight, ListPlus } from 'lucide-react'
import { useData } from '../data/DataContext'
import { FilterBar } from '../components/FilterBar'
import { Badge, Button, Card, Empty, InfoTip, Notice } from '../components/ui'
import { CumulativeVsTargetChart, DailyTrendChart, FunnelTable } from '../components/charts'
import { attendanceQuality, campaignPerformance, channelPerformance, dailyTrend, funnel, isFiltered, snapshot } from '../analytics/metrics'
import { bottleneck, opportunities } from '../analytics/opportunities'
import { fmtINR, fmtInt, fmtPct, safeDiv } from '../lib/format'
import { fmtDay, fmtRange, startOfDay } from '../lib/time'
import { navigate } from '../lib/router'
import { addTask } from '../store/workspace'
import { toast } from '../lib/toast'

function Primary({ label, value, def, target, attainment, sub, alert, attention }: { label: string; value: string; def: ReactNode; target?: string; attainment?: number; sub?: ReactNode; alert?: boolean; attention?: boolean }) {
  const has = attainment != null && Number.isFinite(attainment)
  const short = has && attainment! < 1
  // Bar scale: max(actual, target). Blue = achieved; light coral = remaining gap to target; tick = target.
  const scale = has ? Math.max(1, attainment!) : 1
  const done = has ? (Math.min(attainment!, scale) / scale) * 100 : 0
  const tgt = has ? (1 / scale) * 100 : 0
  return (
    <div className={`px-5 py-4 min-w-0 ${attention ? 'surface-attention' : 'bg-white'}`}>
      <div className={`flex items-center gap-1.5 label-caps !text-[10.5px] ${attention ? '!text-coral-ink' : ''}`}>{label}<InfoTip text={def} /></div>
      <div className={`text-[28px] leading-9 font-semibold tnum tracking-[-0.01em] mt-1 ${alert ? 'text-coral-ink' : 'text-ink'}`}>{value}</div>
      {has && (
        <div className="mt-2">
          <div className="relative h-1 bg-blue-50 rounded-full">
            <div className="absolute inset-y-0 left-0 rounded-full bg-blue" style={{ width: `${done}%` }} />
            {short && <div className="absolute inset-y-0 rounded-r-full bg-coral/45" style={{ left: `${done}%`, width: `${tgt - done}%` }} />}
            <div className="absolute -top-1 -bottom-1 w-px bg-ink/50" style={{ left: `calc(${tgt}% - 0.5px)` }} />
          </div>
          <div className="flex justify-between text-[11.5px] mt-1.5 tnum"><span className="text-muted">{target}</span><span className={short ? 'text-coral-ink font-semibold' : 'text-blue font-semibold'}>{fmtPct(attainment)}</span></div>
        </div>
      )}
      {sub && <div className="text-[11.5px] text-ink-2/80 mt-1.5 leading-4">{sub}</div>}
    </div>
  )
}

function Secondary({ label, value, def, note, alert }: { label: string; value: string; def: ReactNode; note?: string; alert?: boolean }) {
  return (
    <div className="px-4 py-2.5 min-w-0">
      <div className="flex items-center gap-1 text-[11.5px] text-muted">{label}<InfoTip text={def} /></div>
      <div className={`text-[15px] font-semibold tnum leading-5 ${alert ? 'text-coral-ink' : 'text-ink'}`}>{value}</div>
      {note && <div className="text-[11px] text-muted leading-4">{note}</div>}
    </div>
  )
}

export function Overview() {
  const { model, scope } = useData()
  const data = useMemo(() => {
    if (!model || !scope) return null
    return {
      snap: snapshot(model, scope), q: attendanceQuality(model, scope), trend: dailyTrend(model, scope), fun: funnel(model, scope), perf: campaignPerformance(model, scope),
      ch: channelPerformance(model, scope), bn: bottleneck(model, scope), opp: opportunities(model, { ...scope, campaignIds: null }),
      portfolio: isFiltered(scope) ? snapshot(model, { ...scope, campaignIds: null }) : null,
    }
  }, [model, scope])
  if (!model || !scope || !data) return null
  if (scope.campaignIds && scope.campaignIds.length === 0) return (<div className="flex flex-col gap-4"><FilterBar /><Card><Empty title="No data for this filter combination" text="The selected campaign does not run on the selected channel. Clear one of the filters above." /></Card></div>)
  const { snap, q, trend, fun, perf, ch, bn, opp, portfolio } = data
  const t = snap.target
  const asOf = `Cumulative to ${fmtDay(scope.end, true)}`
  const filtered = isFiltered(scope)
  const fstages = snap.eventStarted ? fun.people : fun.people.filter((x) => x.key !== 'attended')
  let worst = ''
  { let l = -1; fstages.forEach((s, i) => { if (i && fstages[i - 1].value - s.value > l) { l = fstages[i - 1].value - s.value; worst = s.key } }) }
  const top = opp.list[0]
  const totSpend = ch.reduce((a, c) => a + c.spend, 0), totAtt = ch.reduce((a, c) => a + c.attendees, 0)
  const noShowByCampaign = [...perf.rows].map((r) => ({ r, n: r.confirmed - r.confirmedAttendees })).sort((a, b) => b.n - a.n)
  const ledger = [...perf.rows].sort((a, b) => b.attendees - a.attendees)

  return (
    <div className="flex flex-col gap-4">
      <FilterBar note="Summary values are cumulative to the end date" />
      {filtered && <Notice>Targets are portfolio-level. With a campaign or channel filter, progress shows this segment's contribution to the portfolio target{portfolio ? ` (portfolio: ${fmtInt(portfolio.registrations)} registrations, ${fmtInt(portfolio.visitors)} visitors)` : ''}.</Notice>}

      {/* Summary */}
      <section className="surface overflow-hidden !bg-line" aria-label="Summary">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-px">
          <Primary label="Verified unique visitors" value={snap.eventStarted ? fmtInt(snap.visitors) : '—'} target={`target ${fmtInt(t.visitorsGoal)}`} attainment={snap.eventStarted ? snap.attainment.visitors : undefined}
            def={<>Distinct external people with ≥1 admitted + verified check-in. Repeat admissions, denied and pending records do not add visitors. {asOf}.</>}
            sub={snap.eventStarted ? <>{fmtInt(snap.visitorsRegistered)} registered + {fmtInt(snap.visitorsWalkIn)} walk-ins{snap.gap.visitors > 0 ? <> · <span className="text-coral-ink">{fmtInt(snap.gap.visitors)} short</span></> : ''}</> : `Not observable before ${fmtDay(model.raw.event.startsAt, true)}`} />
          <Primary label="Unique registrations" value={fmtInt(snap.registrations)} target={`target ${fmtInt(t.registrationGoal)}`} attainment={snap.attainment.registrations}
            def={<>Distinct external people with a registration created by the end date. Status changes are not new registrations. {asOf}.</>}
            sub={snap.projection ? <>Run-rate projection at event: <b className="text-ink tnum">{fmtInt(snap.projection.projectedRegistrations)}</b> (forecast)</> : <>{fmtInt(snap.registrationsInRange)} created in the selected range</>} />
          <Primary attention={snap.eventStarted && snap.attendanceConversion < 0.75} label="Registration → attendance" value={snap.eventStarted ? fmtPct(snap.attendanceConversion) : '—'} alert={snap.eventStarted && snap.attendanceConversion < 0.75}
            def={<>Registered people with a verified admission ÷ registered people. Cancelled, waitlisted and stuck registrations stay in the denominator. {asOf}.</>}
            sub={snap.eventStarted ? <>{fmtInt(q.confirmedNoShow)} confirmed registrants did not attend</> : 'Not observable before the event'} />
          <Primary label="Cost per verified attendee" value={fmtINR(snap.costPerVisitor)}
            def={<>Cumulative net spend ÷ verified unique external visitors (including walk-ins, whose cost is unknown). {asOf}.</>}
            sub={snap.eventStarted ? <>Campaign-attributed only: {fmtINR(perf.portfolio.cpa)}</> : 'Not observable before the event'} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px mt-px [&>*]:bg-blue-25">
          <Secondary label="Identified people" value={`${fmtInt(snap.identified)} / ${fmtInt(t.identifiedGoal)}`} note={`${fmtPct(snap.attainment.identified)} of target`} alert={snap.attainment.identified < 1} def="Distinct external people first seen by the end date, including walk-ins identified at the gate." />
          <Secondary label="Marketing spend" value={`${fmtINR(snap.spend)}`} note={`of ${fmtINR(t.budget)} · ${fmtINR(snap.gap.budgetRemaining)} unspent`} def="Net posted marketing ledger amount (debits less credits) by posting date, cumulative." />
          <Secondary label="Registration conversion" value={fmtPct(snap.regConversion)} note={`${fmtInt(snap.identified - snap.registrations)} identified without registration`} def="Registrations ÷ identified external people (cumulative)." />
          <Secondary label="Confirmed → attended" value={fmtPct(snap.confirmedShowRate)} note={`${fmtInt(snap.confirmed)} confirmed`} def="Latest status confirmed and verified admission ÷ confirmed registrations." />
          <Secondary label="Cancellation rate" value={fmtPct(snap.cancellationRate)} note={`${fmtInt(snap.cancelled)} cancelled · ${fmtInt(snap.waitlisted)} waitlisted`} def="Registrations whose latest status is cancelled ÷ registrations." />
          <Secondary label="Cost per registration" value={fmtINR(snap.costPerRegistration)} note={`${fmtINR(snap.costPerIdentified)} per identified person`} def="Cumulative net spend ÷ unique registrations." />
        </div>
      </section>

      {/* Pace + funnel */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4">
        <Card title="Acquisition pace" subtitle={`New identified people (grey) and new registrations (blue) per day · coral band = event days · ${fmtRange(scope.start, scope.end)}`}>
          {trend.length ? <DailyTrendChart data={trend} height={250} event={{ start: startOfDay(model.raw.event.startsAt), end: startOfDay(model.raw.event.endsAt) }} /> : <Empty title="No days in range" />}
        </Card>
        <Card title="Funnel performance" subtitle="People first identified in range · outcomes at range end" right={<Button size="sm" variant="ghost" onClick={() => navigate('analytics', { tab: 'funnel' })}>Inspect stages <ArrowRight size={13} /></Button>}>
          <FunnelTable stages={fstages} worstKey={worst} />
          <p className="text-[11.5px] text-muted mt-2">{!snap.eventStarted && <>Verified attendance is not observable before {fmtDay(model.raw.event.startsAt, true)}. </>}Coral = largest step loss. {fmtInt(fun.walkIns)} walk-in visitors entered without a campaign or registration and are outside this funnel.</p>
        </Card>
      </div>

      {/* Target + friction */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4">
        <Card title="Target attainment" subtitle="Cumulative registrations and verified visitors vs the target version in force each day"
          right={<span className="text-[11.5px] text-muted tnum hidden sm:inline">{model.raw.targets.length} target versions</span>}>
          <CumulativeVsTargetChart data={trend} height={240} />
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-[11.5px]">
            {model.raw.targets.map((v) => (
              <div key={v.version} className={`py-1 border-t border-line/70 ${v === t ? 'text-ink' : 'text-muted'}`}>
                <span className="font-medium">{v.version}</span> · from {fmtDay(v.effectiveAt, true)}<br />
                <span className="tnum">{fmtInt(v.identifiedGoal)} identified · {fmtInt(v.registrationGoal)} registrations · {fmtInt(v.visitorsGoal)} visitors · {fmtINR(v.budget)}</span>
              </div>
            ))}
          </div>
        </Card>
        <section className="surface surface-attention px-5 py-4 flex flex-col" aria-label="Primary friction point">
          <div className="label-caps !text-coral-ink">Primary friction point · {bn.stage === 'post-registration' ? 'after registration' : 'before registration'}</div>
          <p className="text-[15px] leading-[22px] font-semibold text-ink mt-2">{bn.headline}</p>
          <div className="mt-3 text-[12.5px]">
            {bn.breakdown.map((b, i) => (
              <div key={b.label} className="flex justify-between py-1.5 border-b border-line/70"><span className="text-ink-2">{b.label}</span><span className={`tnum font-semibold ${i === 0 && snap.eventStarted ? 'text-coral-ink' : ''}`}>{fmtInt(b.value)}</span></div>
            ))}
            <div className="flex justify-between py-1.5"><span className="text-ink-2">Never registered (campaign-identified)</span><span className="tnum font-semibold">{fmtInt(bn.preRegistrationLost)}</span></div>
          </div>
          {snap.eventStarted && noShowByCampaign[0]?.n > 0 && (
            <p className="text-[12px] text-ink-2 mt-2 leading-[17px]">Confirmed no-shows concentrate in <b>{noShowByCampaign[0].r.name}</b> ({fmtInt(noShowByCampaign[0].n)}) and <b>{noShowByCampaign[1]?.r.name}</b> ({fmtInt(noShowByCampaign[1]?.n ?? 0)}).</p>
          )}
          <div className="mt-auto pt-3"><Button size="sm" variant="secondary" onClick={() => navigate('analytics', { tab: 'funnel' })}>Open funnel & status <ArrowRight size={13} /></Button></div>
        </section>
      </div>

      {/* Ledger + channels */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4">
        <Card title="Campaign performance" subtitle="First-touch attribution · cohort identified in range" pad={false}
          right={<Button size="sm" variant="ghost" onClick={() => navigate('campaigns')}>Campaign Manager <ArrowRight size={13} /></Button>}>
          {ledger.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left">{['Campaign', 'Spend', 'Registrations', 'Verified att.', 'Reg → attend', 'Cost / att.', 'Quadrant'].map((h, i) => <th key={h} className={`label-caps !text-[10px] px-3 py-2 border-b border-line whitespace-nowrap ${i > 0 && i < 6 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {ledger.map((r) => {
                    const bad = r.quadrant.startsWith('Fix') || r.quadrant.startsWith('Pause')
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/50 cursor-pointer" onClick={() => navigate('campaigns', { c: r.id })}>
                        <td className="px-3 py-2 border-b border-line/60 min-w-[150px]"><span className="font-medium text-ink whitespace-nowrap">{r.name}</span><div className="text-[11px] text-muted">{r.channel}</div></td>
                        <td className="px-3 py-2 border-b border-line/60 text-right tnum">{fmtINR(r.spend)}</td>
                        <td className="px-3 py-2 border-b border-line/60 text-right tnum">{fmtInt(r.registrations)}</td>
                        <td className="px-3 py-2 border-b border-line/60 text-right tnum font-semibold">{fmtInt(r.attendees)}</td>
                        <td className={`px-3 py-2 border-b border-line/60 text-right tnum ${bad ? 'text-coral-ink font-semibold' : ''}`}>{fmtPct(r.showRate)}</td>
                        <td className={`px-3 py-2 border-b border-line/60 text-right tnum ${bad ? 'text-coral-ink font-semibold' : ''}`}>{fmtINR(r.cpa)}</td>
                        <td className="px-3 py-2 border-b border-line/60 whitespace-nowrap">{r.quadrant === 'Not classified' ? <span className="text-muted text-[11.5px]">needs attendance data</span> : <Badge tone={bad ? 'coral' : 'blue'}>{r.quadrant.split(':')[0]}</Badge>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="text-[11.5px] text-muted px-3 py-2">Portfolio: {fmtPct(perf.portfolio.showRate)} registered → attended · {fmtINR(perf.portfolio.cpa)} per attributed attendee. Coral = below-portfolio attendance quality. Select a row to open it.</p>
            </div>
          ) : <Empty title="No campaign in this filter" text="Walk-ins have no campaign." />}
        </Card>
        <Card title="Channel contribution" subtitle="Share of attributed spend vs share of verified attendees">
          {ch.length ? (
            <div className="flex flex-col">
              <div className="flex gap-4 text-[11px] text-muted mb-2"><span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#9AA3B2]" />Spend share</span><span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue" />Attendee share</span><span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-coral" />Spend ≥5 pp above attendees</span></div>
              {ch.map((c) => {
                const ss = safeDiv(c.spend, totSpend), as = safeDiv(c.attendees, totAtt)
                const gap = ss - as > 0.05
                return (
                  <div key={c.channel} className="grid grid-cols-[110px_1fr] gap-3 items-center py-1.5 border-b border-line/60 last:border-0">
                    <span className="text-[12px] text-ink-2 leading-4">{c.channel}</span>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2"><span className="h-2 rounded-sm bg-[#9AA3B2]" style={{ width: `${Math.max(1, ss * 100 * 1.6)}%` }} /><span className="text-[11px] tnum text-muted">{c.spend ? fmtPct(ss, 0) : 'no spend'}</span></div>
                      <div className="flex items-center gap-2"><span className={`h-2 rounded-sm ${gap ? 'bg-coral' : 'bg-blue'}`} style={{ width: `${Math.max(1, as * 100 * 1.6)}%` }} /><span className={`text-[11px] tnum ${gap ? 'text-coral-ink font-semibold' : 'text-ink'}`}>{fmtPct(as, 0)} · {fmtInt(c.attendees)}</span></div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <Empty title="No channel data" />}
        </Card>
      </div>

      {/* Next action */}
      <section className="surface surface-action px-5 py-4" aria-label="Recommended next action">
        {top ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-8 gap-y-3">
            <div>
              <div className="label-caps !text-blue">Recommended next action · ranked 1 of {opp.list.length}</div>
              <h3 className="text-[15px] font-semibold mt-1.5">{top.title}</h3>
              <p className="text-[12.5px] text-ink-2 mt-1 leading-[18px]">{top.intervention}</p>
              <p className="text-[12px] text-muted mt-1.5 leading-[17px]"><span className="text-ink-2 font-medium">Observed:</span> {top.problem}</p>
            </div>
            <div className="flex flex-col gap-2">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                <dt className="text-muted">Modeled impact</dt><dd className="tnum font-semibold">+{top.impact.low}–{top.impact.high} visitors <span className="text-muted font-normal">(base +{top.impact.base})</span></dd>
                <dt className="text-muted">Confidence</dt><dd>{top.confidence}</dd>
                <dt className="text-muted">Time to signal</dt><dd>{top.daysToSignal} days</dd>
                <dt className="text-muted">Assumed cost</dt><dd className="tnum">{fmtINR(top.cost)}</dd>
              </dl>
              <div className="flex flex-wrap gap-2 mt-1">
                <Button size="sm" onClick={() => { addTask({ title: `${top.id}: ${top.title}`, owner: 'Growth lead', due: new Date(Date.now() + top.daysToSignal * 86400000).toISOString().slice(0, 10), status: 'todo', origin: 'manual', opportunityId: top.id, campaignRef: top.campaignIds[0] }); toast(`Task created: ${top.id} ${top.title}. Track it in Campaign Manager → Tasks.`) }}><ListPlus size={13} />Create task</Button>
                <Button size="sm" variant="secondary" onClick={() => navigate('analytics', { tab: 'strategy' })}>All 5 opportunities</Button>
                <Button size="sm" variant="ghost" onClick={() => navigate('analyst', { q: 'What should we do in the next seven days?' })}>Ask the analyst</Button>
              </div>
            </div>
          </div>
        ) : <Empty title="No opportunity applies for this period" />}
      </section>
    </div>
  )
}
