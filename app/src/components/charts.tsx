import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Area } from 'recharts'
import type { ReactNode } from 'react'
import { fmtDay } from '../lib/time'
import { fmtCompact, fmtINR, fmtInt, fmtPct } from '../lib/format'
import type { CampaignPerf, DayPoint, FunnelStage } from '../analytics/metrics'

export const C = { blue: '#2457D6', blue2: '#6E92F0', blueSoft: '#DCE5FA', grey: '#9AA3B2', greySoft: '#E6E9EE', coral: '#F28C6B', coralInk: '#B5482A', ink: '#1F2430', muted: '#6B7280', grid: '#EEF1F7' }

function Tip({ active, payload, label, fmtLabel, rows }: { active?: boolean; payload?: { name: string; value: number; color?: string; payload: Record<string, unknown> }[]; label?: unknown; fmtLabel?: (l: unknown) => ReactNode; rows?: (p: Record<string, unknown>) => [string, string][] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="bg-white border border-line rounded shadow-md px-2.5 py-2 text-[11.5px] min-w-[150px]">
      <div className="font-semibold text-ink mb-1">{fmtLabel ? fmtLabel(label ?? p) : String(label ?? '')}</div>
      {(rows ? rows(p) : payload.map((x) => [x.name, fmtInt(x.value)] as [string, string])).map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-4 tnum"><span className="text-muted">{k}</span><span className="text-ink font-medium">{v}</span></div>
      ))}
    </div>
  )
}

export function DailyTrendChart({ data, height = 230, event }: { data: DayPoint[]; height?: number; event?: { start: number; end: number } }) {
  if (!data.length) return null
  const ev = event && data.some((d) => d.day === event.start) ? event : null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={(d) => fmtDay(d)} minTickGap={28} tickLine={false} axisLine={{ stroke: '#dfe4ec' }} tickMargin={6} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip content={<Tip fmtLabel={(l) => fmtDay(l as number, true)} rows={(p) => [['Newly identified', fmtInt(p.identified as number)], ['New registrations', fmtInt(p.registrations as number)], ['Net spend', fmtINR(p.spend as number)], ['Cumulative registrations', fmtInt(p.cumRegistrations as number)]]} />} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} dataKey="registrations" name="New registrations" fill={C.blue} radius={[2, 2, 0, 0]} maxBarSize={8} />
        <Line isAnimationActive={false} dataKey="identified" name="Newly identified people" stroke={C.grey} strokeWidth={2} dot={false} type="monotone" />
        {ev && <ReferenceArea x1={ev.start} x2={data.some((d) => d.day === ev.end) ? ev.end : ev.start} fill={C.coral} fillOpacity={0.14} stroke={C.coral} strokeOpacity={0.5} label={{ value: 'Event days', position: 'insideTop', fontSize: 10.5, fill: C.coralInk }} />}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function CumulativeVsTargetChart({ data, height = 240, metric = 'registrations' }: { data: DayPoint[]; height?: number; metric?: 'registrations' | 'identified' }) {
  const key = metric === 'registrations' ? 'cumRegistrations' : 'cumIdentified'
  const goal = metric === 'registrations' ? 'registrationGoal' : 'identifiedGoal'
  const change = data.find((d, i) => i > 0 && d[goal] !== data[i - 1][goal] && Number.isFinite(data[i - 1][goal]))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 12, left: -6, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={(d) => fmtDay(d)} minTickGap={28} tickLine={false} axisLine={{ stroke: '#dfe4ec' }} tickMargin={6} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
        <Tooltip content={<Tip fmtLabel={(l) => fmtDay(l as number, true)} rows={(p) => [[metric === 'registrations' ? 'Cumulative registrations' : 'Cumulative identified', fmtInt(p[key] as number)], ['Target in force', fmtInt(p[goal] as number)], ['Verified visitors (cum.)', fmtInt(p.cumVisitors as number)]]} />} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Area isAnimationActive={false} dataKey={key} name={metric === 'registrations' ? 'Cumulative registrations' : 'Cumulative identified'} stroke={C.blue} fill={C.blueSoft} strokeWidth={2} type="monotone" />
        <Line isAnimationActive={false} dataKey="cumVisitors" name="Verified visitors (cum.)" stroke={C.ink} strokeWidth={2} dot={false} type="stepAfter" />
        <Line isAnimationActive={false} dataKey={goal} name="Target in force" stroke={C.coral} strokeDasharray="5 4" strokeWidth={2} dot={false} type="stepAfter" />
        {change && <ReferenceLine x={change.day} stroke={C.coral} strokeOpacity={0.6} label={{ value: 'Target revised', position: 'insideTopLeft', fontSize: 10, fill: C.coralInk }} />}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function FunnelBars({ stages, highlight, onSelect, selected }: { stages: FunnelStage[]; highlight?: string; onSelect?: (k: string) => void; selected?: string }) {
  const max = Math.max(...stages.map((s) => s.value), 1)
  return (
    <div className="flex flex-col gap-1.5">
      {stages.map((s) => {
        const w = (s.value / max) * 100
        const hot = highlight === s.key
        return (
          <button key={s.key} type="button" onClick={() => onSelect?.(s.key)} className={`group text-left grid grid-cols-[132px_1fr_96px] items-center gap-2 rounded px-1 py-0.5 ${selected === s.key ? 'bg-blue-50' : 'hover:bg-canvas'}`} title={s.definition}>
            <span className="text-[12px] text-ink-2 truncate">{s.label}</span>
            <span className="h-[18px] bg-canvas rounded-sm relative overflow-hidden">
              <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${w}%`, background: hot ? C.coral : C.blue }} />
              <span className="absolute inset-y-0 left-1.5 flex items-center text-[11px] font-semibold tnum" style={{ color: w > 18 ? '#fff' : C.ink }}>{fmtInt(s.value)}</span>
            </span>
            <span className={`text-[11px] tnum text-right ${hot ? 'text-coral-ink font-semibold' : 'text-muted'}`}>{s.fromPrev != null ? `${fmtPct(s.fromPrev)} of prev.` : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

export function CampaignAttendeeBars({ rows, highlightIds = [], height = 230, onSelect }: { rows: CampaignPerf[]; highlightIds?: string[]; height?: number; onSelect?: (id: string) => void }) {
  const data = [...rows].sort((a, b) => b.attendees - a.attendees).map((r) => ({ ...r, label: r.name }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 92, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" width={128} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#eef2fc' }} content={<Tip fmtLabel={(l) => String(l)} rows={(p) => [['Verified attendees', fmtInt(p.attendees as number)], ['Registrations', fmtInt(p.registrations as number)], ['Reg → attend', fmtPct(p.showRate as number)], ['Spend', fmtINR(p.spend as number)], ['Cost / attendee', fmtINR(p.cpa as number)]]} />} />
        <Bar isAnimationActive={false} dataKey="attendees" name="Verified attendees" radius={[0, 3, 3, 0]} maxBarSize={18} onClick={(d) => onSelect?.((d as unknown as { id: string }).id)} cursor={onSelect ? 'pointer' : undefined}>
          {data.map((d) => <Cell key={d.id} fill={highlightIds.includes(d.id) ? C.coral : C.blue} />)}
          <LabelList dataKey="cpa" position="right" formatter={(v) => `${fmtINR(Number(v))} / att.`} style={{ fontSize: 10.5, fill: C.muted }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ShareBars({ data, height = 220 }: { data: { name: string; spendShare: number; attendeeShare: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 4, bottom: 0 }} barGap={1}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#eef2fc' }} content={<Tip fmtLabel={(l) => String(l)} rows={(p) => [['Share of spend', fmtPct(p.spendShare as number)], ['Share of verified attendees', fmtPct(p.attendeeShare as number)]]} />} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} dataKey="spendShare" name="Share of spend" fill={C.grey} radius={[0, 2, 2, 0]} maxBarSize={9} />
        <Bar isAnimationActive={false} dataKey="attendeeShare" name="Share of verified attendees" fill={C.blue} radius={[0, 2, 2, 0]} maxBarSize={9}>
          {data.map((d) => <Cell key={d.name} fill={d.spendShare - d.attendeeShare > 0.05 ? C.coral : C.blue} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function QuadrantMatrix({ rows, avgReg, showRate, height = 300, onSelect }: { rows: CampaignPerf[]; avgReg: number; showRate: number; height?: number; onSelect?: (id: string) => void }) {
  const data = rows.filter((r) => Number.isFinite(r.showRate)).map((r) => ({ ...r, x: r.registrations, y: r.showRate * 100, z: r.spend }))
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
  if (!data.length) return <div className="text-muted text-[12px] p-6 text-center">Attendance quality is not observable before the event. Move the end date to 12 Apr 2025 or later.</div>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 16, right: 24, left: -4, bottom: 8 }}>
        <CartesianGrid stroke={C.grid} />
        <XAxis type="number" dataKey="x" name="Registrations" tickLine={false} label={{ value: 'Registrations (volume) →', position: 'insideBottomRight', offset: -4, fontSize: 10.5, fill: C.muted }} domain={[0, 'dataMax + 80']} />
        <YAxis type="number" dataKey="y" name="Show rate" unit="%" tickLine={false} domain={[30, 100]} label={{ value: 'Registered → attended', angle: -90, position: 'insideLeft', offset: 18, fontSize: 10.5, fill: C.muted }} />
        <ZAxis type="number" dataKey="z" range={[90, 900]} name="Spend" />
        <ReferenceLine x={avgReg} stroke="#b8bfcc" strokeDasharray="3 3" />
        <ReferenceLine y={showRate * 100} stroke="#b8bfcc" strokeDasharray="3 3" label={{ value: `portfolio ${fmtPct(showRate)}`, position: 'insideTopRight', fontSize: 10, fill: C.muted }} />
        <Tooltip cursor={false} content={<Tip fmtLabel={(p) => (p as { name: string }).name} rows={(p) => [['Registrations', fmtInt(p.registrations as number)], ['Reg → attend', fmtPct(p.showRate as number)], ['Spend', fmtINR(p.spend as number)], ['Cost / attendee', fmtINR(p.cpa as number)], ['Quadrant', String(p.quadrant).split(':')[0]]]} />} />
        <Scatter isAnimationActive={false} data={data} onClick={(d) => onSelect?.((d as unknown as { id: string }).id)} cursor={onSelect ? 'pointer' : undefined}>
          {data.map((d) => <Cell key={d.id} fill={d.quadrant.startsWith('Pause') || d.quadrant.startsWith('Fix') ? C.coral : C.blue} fillOpacity={0.85} stroke="#fff" strokeWidth={2} />)}
          <LabelList dataKey="name" content={(props) => {
            const { viewBox, value } = props as unknown as { viewBox: { x: number; y: number; width: number; height: number }; value: string }
            const cx = viewBox.x + viewBox.width / 2, cy = viewBox.y + viewBox.height / 2, r = viewBox.width / 2
            const w = String(value).length * 6.4, h = 12
            const cands = [
              { x: cx, y: cy - r - 4, a: 'middle' }, { x: cx, y: cy + r + 12, a: 'middle' },
              { x: cx + r + 4, y: cy + 4, a: 'start' }, { x: cx - r - 4, y: cy + 4, a: 'end' },
              { x: cx, y: cy - r - 17, a: 'middle' }, { x: cx, y: cy + r + 25, a: 'middle' },
            ]
            const box = (c: { x: number; y: number; a: string }) => ({ x1: c.a === 'middle' ? c.x - w / 2 : c.a === 'start' ? c.x : c.x - w, x2: c.a === 'middle' ? c.x + w / 2 : c.a === 'start' ? c.x + w : c.x, y1: c.y - h + 2, y2: c.y + 2 })
            const hit = (b: ReturnType<typeof box>) => placed.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1)
            const c = cands.find((k) => !hit(box(k))) ?? cands[0]
            placed.push(box(c))
            return <text x={c.x} y={c.y} textAnchor={c.a as 'middle'} fontSize={10.5} fill={C.ink}>{value}</text>
          }} />
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  )
}

export function SimpleBars({ data, xKey, yKey, name, fmt = fmtInt, highlight, height = 200, yFmt, rotate }: { data: Record<string, unknown>[]; xKey: string; yKey: string; name: string; fmt?: (v: number) => string; highlight?: (d: Record<string, unknown>) => boolean; height?: number; yFmt?: (v: number) => string; rotate?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: '#dfe4ec' }} interval={0} tick={{ fontSize: 10.5 }} angle={rotate ? -28 : 0} textAnchor={rotate ? 'end' : 'middle'} height={rotate ? 62 : 30} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={yFmt} />
        <Tooltip cursor={{ fill: '#eef2fc' }} content={<Tip fmtLabel={(l) => String(l)} rows={(p) => [[name, fmt(p[yKey] as number)]]} />} />
        <Bar isAnimationActive={false} dataKey={yKey} name={name} radius={[3, 3, 0, 0]} maxBarSize={34}>
          {data.map((d, i) => <Cell key={i} fill={highlight?.(d) ? C.coral : C.blue} />)}
          <LabelList dataKey={yKey} position="top" formatter={(v) => fmt(Number(v))} style={{ fontSize: 10.5, fill: C.ink }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StatusStack({ data, height = 190 }: { data: { status: string; registrations: number; attended: number; noShow: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="status" width={78} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#eef2fc' }} content={<Tip fmtLabel={(l) => `Latest status: ${String(l)}`} rows={(p) => [['Registrations', fmtInt(p.registrations as number)], ['Verified attendees', fmtInt(p.attended as number)], ['Did not attend', fmtInt(p.noShow as number)]]} />} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar isAnimationActive={false} dataKey="attended" name="Attended" stackId="a" fill={C.blue} maxBarSize={18} />
        <Bar isAnimationActive={false} dataKey="noShow" name="Did not attend" stackId="a" fill={C.coral} maxBarSize={18} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Readable funnel: stage, count bar, step conversion, people lost. Rows are buttons when inspectable. */
export function FunnelTable({ stages, selected, onSelect, worstKey }: { stages: FunnelStage[]; selected?: string; onSelect?: (k: string) => void; worstKey?: string }) {
  const max = Math.max(...stages.map((s) => s.value), 1)
  return (
    <div role="table" aria-label="Acquisition funnel" className="text-[12.5px]">
      <div role="row" className="grid grid-cols-[minmax(120px,170px)_1fr_86px_76px] gap-3 px-2 pb-1.5 border-b border-line label-caps !text-[10px]">
        <span role="columnheader">Stage</span><span role="columnheader">People</span><span role="columnheader" className="text-right">Step conv.</span><span role="columnheader" className="text-right">Lost</span>
      </div>
      {stages.map((s, i) => {
        const prev = stages[i - 1]
        const lost = prev ? prev.value - s.value : 0
        const hot = s.key === worstKey
        const sel = selected === s.key
        const Row = onSelect ? 'button' : 'div'
        return (
          <Row key={s.key} role="row" type={onSelect ? 'button' : undefined} onClick={onSelect ? () => onSelect(s.key) : undefined} title={s.definition}
            className={`w-full text-left grid grid-cols-[minmax(120px,170px)_1fr_86px_76px] gap-3 items-center px-2 py-1.5 border-b border-line/60 ${sel ? 'bg-blue-50' : onSelect ? 'hover:bg-canvas' : ''}`}>
            <span role="cell" className={`leading-4 ${sel ? 'font-semibold text-blue' : 'text-ink'}`}>{s.label}</span>
            <span role="cell" className="flex items-center gap-2 min-w-0">
              <span className="h-3.5 rounded-sm shrink-0" style={{ width: `${Math.max(2, (s.value / max) * 78)}%`, background: hot ? C.coral : C.blue }} />
              <span className="tnum font-semibold text-ink">{fmtInt(s.value)}</span>
            </span>
            <span role="cell" className={`text-right tnum ${hot ? 'text-coral-ink font-semibold' : 'text-ink-2'}`}>{s.fromPrev != null ? fmtPct(s.fromPrev) : '—'}</span>
            <span role="cell" className={`text-right tnum ${hot ? 'text-coral-ink font-semibold' : 'text-muted'}`}>{prev ? (lost > 0 ? `−${fmtInt(lost)}` : '0') : ''}</span>
          </Row>
        )
      })}
    </div>
  )
}
