// Three-slide strategy deck. Every number is computed at render time from the bundled
// workbook through the same analytics modules the product uses (no hardcoded KPIs).
// Print: open deck.html and "Save as PDF" (16:9, no margins), or run `npm run deck:pdf`.

import { useEffect, useState, type ReactNode } from 'react'
import { fetchBundledWorkbook } from '../data/loadWorkbook'
import { buildModel, type Model } from '../analytics/model'
import { attendanceQuality, campaignPerformance, engagementSegments, fullScope, funnel, recoveryPools, snapshot, statusDistribution, timingSegments } from '../analytics/metrics'
import { bottleneck, deprioritized, opportunities, proposedAllocation, PRIORITY_FORMULA } from '../analytics/opportunities'
import { answer } from '../analyst/engine'
import { fmtINR, fmtInt, fmtPct, safeDiv } from '../lib/format'
import { fmtDay } from '../lib/time'

const B = '#2457D6', B2 = '#6E92F0', BW = '#DCE5FA', BX = '#EEF2FC', CO = '#F28C6B', COI = '#B5482A', INK = '#1F2430', G = '#6B7280', LN = '#E4E7EC'
const L = (n: number) => (n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : fmtINR(n))

function Label({ n, children, right }: { n?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <div className="flex items-center gap-1.5">
        {n && <span className="w-[17px] h-[17px] rounded-full text-white text-[10px] font-bold flex items-center justify-center" style={{ background: B }}>{n}</span>}
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: B }}>{children}</span>
      </div>
      {right && <span className="text-[10px]" style={{ color: G }}>{right}</span>}
    </div>
  )
}
const Box = ({ children, className = '', tone }: { children: ReactNode; className?: string; tone?: 'coral' | 'blue' }) => (
  <div className={`rounded-[5px] border px-3 py-2.5 ${className}`} style={{ borderColor: tone === 'coral' ? CO : tone === 'blue' ? BW : LN, background: tone === 'coral' ? '#FDF0EB' : tone === 'blue' ? BX : '#fff' }}>{children}</div>
)
const Tag = ({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'coral' | 'grey' }) => (
  <span className="inline-block rounded px-1 py-[0.5px] text-[9.5px] font-semibold uppercase tracking-wide border" style={{ color: tone === 'coral' ? COI : tone === 'grey' ? G : B, borderColor: tone === 'coral' ? CO : tone === 'grey' ? LN : BW, background: tone === 'coral' ? '#FDF0EB' : tone === 'grey' ? '#fff' : BX }}>{children}</span>
)

function Slide({ n, title, question, author, children, foot }: { n: number; title: string; question: string; author: ReactNode; children: ReactNode; foot: string }) {
  const tabs = ['Diagnose · attendance gap', 'Decide · where to invest', 'Operate · Growth OS']
  return (
    <section className="slide relative bg-white overflow-hidden" style={{ width: 1600, height: 900, color: INK }}>
      <div className="absolute inset-x-0 top-0 h-[5px]" style={{ background: B }} />
      <div className="px-9 pt-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-extrabold tracking-[0.14em]" style={{ color: INK }}>RISA</span>
          <span className="text-[11px]" style={{ color: G }}>Growth APM · Challenge A — Attendee Growth</span>
        </div>
        <div className="flex gap-1 rounded-full border px-1 py-0.5" style={{ borderColor: BW, background: BX }}>
          {tabs.map((t, i) => <span key={t} className="text-[10.5px] px-3 py-[3px] rounded-full font-semibold" style={{ background: i + 1 === n ? B : 'transparent', color: i + 1 === n ? '#fff' : B }}>{i + 1}. {t}</span>)}
        </div>
        <div className="text-[10.5px] text-right leading-[13px]" style={{ color: G }}>{author}</div>
      </div>
      <div className="px-9 pt-3 pb-2 flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[29px] leading-[34px] font-bold" style={{ color: B }}>{title}</h1>
          <p className="text-[13.5px] mt-0.5" style={{ color: G }}>{question}</p>
        </div>
      </div>
      <div className="px-9" style={{ height: 742 }}>{children}</div>
      <div className="absolute bottom-0 inset-x-0 px-9 py-1.5 flex justify-between text-[9.5px] border-t" style={{ color: G, borderColor: LN, background: '#FAFBFC' }}>
        <span>{foot}</span><span>{n} / 3</span>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- slide 1 pieces

function Bullet({ label, actual, target, fmt = fmtInt, note }: { label: string; actual: number; target: number; fmt?: (n: number) => string; note?: string }) {
  const max = Math.max(actual, target) * 1.08
  const short = actual < target
  return (
    <div className="py-1.5" style={{ borderBottom: `1px dotted ${LN}` }}>
      <div className="flex justify-between items-baseline">
        <span className="text-[11.5px] font-semibold">{label}</span>
        <span className="text-[11.5px] tabular-nums"><b className="text-[15px]" style={{ color: short ? COI : B }}>{fmt(actual)}</b> <span style={{ color: G }}>/ {fmt(target)} · {fmtPct(actual / target)}</span></span>
      </div>
      <svg width="100%" height="12" viewBox="0 0 300 12" preserveAspectRatio="none" className="mt-1">
        <rect x="0" y="3" width="300" height="6" rx="3" fill={BX} />
        <rect x="0" y="3" width={(actual / max) * 300} height="6" rx="3" fill={short ? CO : B} />
        <rect x={(target / max) * 300 - 1} y="0" width="2" height="12" fill={INK} />
      </svg>
      {note && <div className="text-[9.8px] leading-[12px] mt-0.5" style={{ color: G }}>{note}</div>}
    </div>
  )
}

function FunnelSvg({ stages, walkIns }: { stages: { label: string; value: number; fromPrev?: number }[]; walkIns: number }) {
  const W = 470, rowH = 41, max = stages[0].value
  let worst = 1
  for (let i = 1; i < stages.length; i++) if (stages[i - 1].value - stages[i].value > stages[worst - 1].value - stages[worst].value) worst = i
  return (
    <svg width={W} height={stages.length * rowH + 8} viewBox={`0 0 ${W} ${stages.length * rowH + 8}`}>
      {stages.map((s, i) => {
        const w = (s.value / max) * 300, x = 150 + (300 - w) / 2
        const next = stages[i + 1]
        const hot = i === worst
        return (
          <g key={s.label}>
            <text x="0" y={i * rowH + 20} fontSize="11.5" fill={INK} fontWeight={600}>{s.label}</text>
            {s.fromPrev != null && <text x="0" y={i * rowH + 33} fontSize="10" fill={hot ? COI : G} fontWeight={hot ? 700 : 400}>{fmtPct(s.fromPrev)} of previous{hot ? ' ◀ largest loss' : ''}</text>}
            <rect x={x} y={i * rowH + 6} width={w} height={rowH - 12} rx="3" fill={hot ? CO : i === stages.length - 1 ? B : i === 0 ? B2 : B} opacity={i === 0 ? 1 : 0.92 - i * 0.04} />
            <text x={150 + 150} y={i * rowH + 6 + (rowH - 12) / 2 + 4.5} textAnchor="middle" fontSize="13" fontWeight={700} fill="#fff">{fmtInt(s.value)}</text>
            {next && s.value - next.value > 0 && <text x={462} y={i * rowH + rowH + 4} textAnchor="end" fontSize="9.5" fill={i + 1 === worst ? COI : G}>−{fmtInt(s.value - next.value)}</text>}
          </g>
        )
      })}
      <text x="150" y={stages.length * rowH + 6} fontSize="9.5" fill={G}>+ {fmtInt(walkIns)} walk-ins verified at the gate (no campaign, no registration)</text>
    </svg>
  )
}

function ScenarioSvg({ baseline, base, high, target }: { baseline: number; low?: number; base: number; high: number; target: number }) {
  const W = 540, H = 108, max = high * 1.08
  const x = (v: number) => 90 + (v / max) * (W - 140)
  const rows = [
    { l: 'Actual 2025', v: baseline, c: B2, t: 'observed' },
    { l: 'Base case', v: base, c: B, t: 'modeled' },
    { l: 'Stretch', v: high, c: CO, t: 'modeled' },
  ]
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {rows.map((r, i) => (
        <g key={r.l}>
          <text x="0" y={i * 30 + 19} fontSize="11" fontWeight={600} fill={INK}>{r.l}</text>
          <rect x="90" y={i * 30 + 6} width={x(r.v) - 90} height="18" rx="3" fill={r.c} />
          <text x={x(r.v) + 5} y={i * 30 + 19} fontSize="12" fontWeight={700} fill={i === 2 ? COI : INK}>{fmtInt(r.v)}</text>
          <text x={x(r.v) + 46} y={i * 30 + 19} fontSize="9.5" fill={G}>{r.t}</text>
        </g>
      ))}
      <line x1={x(target)} x2={x(target)} y1="2" y2="94" stroke={INK} strokeDasharray="3 3" />
      <text x={x(target)} y="104" textAnchor="middle" fontSize="9.5" fill={INK}>visitor target {fmtInt(target)}</text>
    </svg>
  )
}

// ---------------------------------------------------------------- slide 2 pieces

function MatrixSvg({ rows, avgReg, show }: { rows: ReturnType<typeof campaignPerformance>['rows']; avgReg: number; show: number }) {
  const W = 480, H = 272, pl = 40, pb = 30, pt = 14, pr = 14
  const xMax = Math.ceil(Math.max(...rows.map((r) => r.registrations)) / 100) * 100 + 60
  const yMin = 0.4, yMax = 0.95
  const X = (v: number) => pl + (v / xMax) * (W - pl - pr), Y = (v: number) => pt + (1 - (v - yMin) / (yMax - yMin)) * (H - pt - pb)
  const maxSpend = Math.max(...rows.map((r) => r.spend))
  const q = [
    { t: 'GROW — invest, test saturation', x: pl + 6, y: pt + 12, c: B },
    { t: 'SCALE — keep, scale carefully', x: W - pr - 6, y: pt + 12, c: B, a: 'end' },
    { t: 'PAUSE / REDESIGN', x: pl + 6, y: H - pb - 8, c: COI },
    { t: 'FIX — attendance conversion, cap spend', x: W - pr - 6, y: H - pb - 8, c: COI, a: 'end' },
  ]
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={X(avgReg)} y={pt} width={W - pr - X(avgReg)} height={Y(show) - pt} fill={BX} />
      <rect x={pl} y={pt} width={X(avgReg) - pl} height={Y(show) - pt} fill="#F6F8FE" />
      <rect x={pl} y={Y(show)} width={X(avgReg) - pl} height={H - pb - Y(show)} fill="#FEF6F2" />
      <rect x={X(avgReg)} y={Y(show)} width={W - pr - X(avgReg)} height={H - pb - Y(show)} fill="#FDF0EB" />
      <line x1={X(avgReg)} x2={X(avgReg)} y1={pt} y2={H - pb} stroke="#9AA3B2" strokeDasharray="3 3" />
      <line x1={pl} x2={W - pr} y1={Y(show)} y2={Y(show)} stroke="#9AA3B2" strokeDasharray="3 3" />
      {q.map((t) => <text key={t.t} x={t.x} y={t.y} fontSize="9.5" fontWeight={700} fill={t.c} textAnchor={(t.a as 'end') ?? 'start'} letterSpacing="0.06em">{t.t}</text>)}
      {[0.5, 0.6, 0.7, 0.8, 0.9].map((v) => <text key={v} x={pl - 4} y={Y(v) + 3} fontSize="9" textAnchor="end" fill={G}>{Math.round(v * 100)}%</text>)}
      {[0, 200, 400, 600].filter((v) => v < xMax).map((v) => <text key={v} x={X(v)} y={H - pb + 12} fontSize="9" textAnchor="middle" fill={G}>{v}</text>)}
      <text x={W - pr} y={H - 3} fontSize="9.5" textAnchor="end" fill={G}>Registrations (volume) →</text>
      <text x="9" y={pt + 120} fontSize="9.5" fill={G} transform={`rotate(-90 9 ${pt + 120})`}  textAnchor="middle">Registered → attended</text>
      <text x={W - pr - 2} y={Y(show) - 3} fontSize="9" textAnchor="end" fill={G}>portfolio {fmtPct(show)}</text>
      {(() => {
        // greedy label placement: try above / below / right / left; skip spots that hit placed labels or bubbles
        const pts = rows.map((r) => ({ r, x: X(r.registrations), y: Y(r.showRate), rad: 6 + Math.sqrt(r.spend / maxSpend) * 15 }))
        const boxes: { x1: number; y1: number; x2: number; y2: number }[] = []
        const hit = (b: { x1: number; y1: number; x2: number; y2: number }) => boxes.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1) || pts.some((p) => b.x1 < p.x + p.rad && b.x2 > p.x - p.rad && b.y1 < p.y + p.rad && b.y2 > p.y - p.rad) || b.x1 < pl || b.x2 > W - pr
        const placed = [...pts].sort((a, b) => a.y - b.y).map((p) => {
          const w = p.r.name.length * 5.5, h = 11
          const cands = [
            { x: p.x, y: p.y - p.rad - 3, a: 'middle' }, { x: p.x, y: p.y + p.rad + 11, a: 'middle' },
            { x: p.x + p.rad + 3, y: p.y + 3.5, a: 'start' }, { x: p.x - p.rad - 3, y: p.y + 3.5, a: 'end' },
            { x: p.x, y: p.y - p.rad - 15, a: 'middle' }, { x: p.x, y: p.y + p.rad + 24, a: 'middle' },
          ]
          const bb = (c: { x: number; y: number; a: string }) => ({ x1: c.a === 'middle' ? c.x - w / 2 : c.a === 'start' ? c.x : c.x - w, x2: c.a === 'middle' ? c.x + w / 2 : c.a === 'start' ? c.x + w : c.x, y1: c.y - h + 2, y2: c.y + 2 })
          const c = cands.find((k) => !hit(bb(k))) ?? cands[0]
          boxes.push(bb(c))
          return { p, c }
        })
        return (
          <>
            {pts.map((p) => {
              const bad = p.r.quadrant.startsWith('Fix') || p.r.quadrant.startsWith('Pause')
              return (
                <g key={p.r.id}>
                  <circle cx={p.x} cy={p.y} r={p.rad} fill={bad ? CO : B} fillOpacity={0.85} stroke="#fff" strokeWidth="2" />
                  <text x={p.x} y={p.y + 3.5} fontSize="9" textAnchor="middle" fontWeight={700} fill="#fff">₹{Math.round(p.r.cpa)}</text>
                </g>
              )
            })}
            {placed.map(({ p, c }) => <text key={p.r.id + 'l'} x={c.x} y={c.y} fontSize="10" textAnchor={c.a as 'middle'} fontWeight={600} fill={INK}>{p.r.name}</text>)}
          </>
        )
      })()}
    </svg>
  )
}

function Waterfall({ baseline, items, target, high }: { baseline: number; items: { id: string; v: number }[]; target: number; high: number }) {
  const W = 470, H = 150, pb = 26, pt = 14
  const total = baseline + items.reduce((a, x) => a + x.v, 0)
  const min = Math.floor((baseline * 0.9) / 100) * 100, max = Math.ceil((high * 1.02) / 100) * 100
  const Y = (v: number) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb)
  const cols = [{ id: 'Actual', from: min, to: baseline, c: B2 }, ...items.reduce<{ id: string; from: number; to: number; c: string }[]>((acc, x) => { const from = acc.length ? acc[acc.length - 1].to : baseline; acc.push({ id: x.id, from, to: from + x.v, c: B }); return acc }, []), { id: 'Base', from: min, to: total, c: B }]
  const bw = (W - 30) / cols.length
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <line x1="0" x2={W} y1={Y(target)} y2={Y(target)} stroke={INK} strokeDasharray="3 3" />
      <text x={2} y={Y(target) - 3} fontSize="9" textAnchor="start" fill={INK}>visitor target {fmtInt(target)}</text>
      <line x1="0" x2={W} y1={Y(high)} y2={Y(high)} stroke={CO} strokeDasharray="5 3" />
      <text x={2} y={Y(high) - 3} fontSize="9" textAnchor="start" fill={COI}>stretch {fmtInt(high)}</text>
      {cols.map((c, i) => (
        <g key={c.id}>
          <rect x={15 + i * bw + 4} y={Y(Math.max(c.from, c.to))} width={bw - 8} height={Math.max(2, Math.abs(Y(c.from) - Y(c.to)))} fill={c.c} rx="2" />
          <text x={15 + i * bw + bw / 2} y={Y(Math.max(c.from, c.to)) - 3} fontSize="10" fontWeight={700} textAnchor="middle" fill={INK}>{c.id === 'Actual' || c.id === 'Base' ? fmtInt(c.to) : `+${fmtInt(c.to - c.from)}`}</text>
          <text x={15 + i * bw + bw / 2} y={H - 10} fontSize="10" textAnchor="middle" fill={G} fontWeight={600}>{c.id}</text>
        </g>
      ))}
    </svg>
  )
}

// ---------------------------------------------------------------- slide 3 pieces

function Arch() {
  const node = (x: number, y: number, w: number, h: number, t: string, s: string, tone: 'b' | 'w' | 'c' = 'w') => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="5" fill={tone === 'b' ? B : tone === 'c' ? '#FDF0EB' : '#fff'} stroke={tone === 'c' ? CO : tone === 'b' ? B : B2} strokeWidth="1.3" />
      <text x={x + w / 2} y={y + 15} textAnchor="middle" fontSize="10.5" fontWeight={700} fill={tone === 'b' ? '#fff' : tone === 'c' ? COI : INK}>{t}</text>
      <text x={x + w / 2} y={y + 28} textAnchor="middle" fontSize="8.8" fill={tone === 'b' ? '#DCE5FA' : G}>{s}</text>
    </g>
  )
  const arrow = (x1: number, y1: number, x2: number, y2: number, dash?: boolean) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={dash ? '#9AA3B2' : B} strokeWidth="1.3" strokeDasharray={dash ? '3 3' : undefined} markerEnd="url(#ah)" />
  return (
    <svg width="490" height="252" viewBox="0 0 490 252">
      <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={B} /></marker></defs>
      {node(0, 0, 112, 36, 'Workbook .xlsx', '11 sheets · or upload')}
      {node(126, 0, 118, 36, 'Loader + validation', 'dedupe IDs · IST · audit')}
      {node(258, 0, 108, 36, 'Person model', 'joins on stable IDs')}
      {node(380, 0, 110, 36, 'Analytics library', 'snapshot · funnel · ROI')}
      {arrow(112, 18, 124, 18)}{arrow(244, 18, 256, 18)}{arrow(366, 18, 378, 18)}
      {arrow(435, 36, 435, 58)}
      {node(260, 60, 230, 36, 'Opportunity & scenario model', 'measured inputs · labelled assumptions', 'c')}
      {[['Growth Overview', 'KPIs vs dated targets'], ['Acquisition Analytics', '9 decision views'], ['Campaign Manager', 'plan · launch · test · tasks'], ['Growth Analyst', 'grounded Q&A + actions']].map(([t, s], i) => (
        <g key={t}>{node(i * 123, 122, 118, 36, t, s, 'b')}{arrow(375, 96, i * 123 + 59, 120)}</g>
      ))}
      {node(0, 192, 236, 38, 'Workspace store', 'localStorage · Supabase (free tier) sync')}
      {node(254, 192, 236, 38, 'Gemini narration (optional)', 'Vercel function · key server-side · number check')}
      {arrow(184, 158, 118, 190, true)}{arrow(307, 158, 118, 190, true)}{arrow(430, 158, 372, 190, true)}
      <text x="245" y="248" textAnchor="middle" fontSize="9" fill={G}>React + TypeScript + Vite · Recharts · SheetJS · deployed on Vercel Hobby (free)</text>
    </svg>
  )
}

function Loop() {
  const steps = ['Measure', 'Diagnose', 'Decide', 'Act', 'Experiment', 'Learn']
  const sub = ['KPIs vs target', 'bottleneck', 'ranked bets', 'campaign/task', 'holdout', 'scale/stop']
  const cx = 132, cy = 96, r = 64
  return (
    <svg width="272" height="196" viewBox="0 0 272 196">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={BW} strokeWidth="10" />
      {steps.map((s, i) => {
        const a = (i / steps.length) * Math.PI * 2 - Math.PI / 2
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
        return (
          <g key={s}>
            <circle cx={x} cy={y} r="17" fill={s === 'Decide' ? CO : B} />
            <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight={700} fill="#fff">{i + 1}</text>
            <text x={x + (Math.cos(a) >= -0.01 ? 21 : -21)} y={y - 2} textAnchor={Math.cos(a) >= -0.01 ? 'start' : 'end'} fontSize="9.5" fontWeight={700} fill={INK}>{s}</text>
            <text x={x + (Math.cos(a) >= -0.01 ? 21 : -21)} y={y + 9} textAnchor={Math.cos(a) >= -0.01 ? 'start' : 'end'} fontSize="8.5" fill={G}>{sub[i]}</text>
          </g>
        )
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="10.5" fontWeight={700} fill={B}>weekly</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="9" fill={G}>growth loop</text>
    </svg>
  )
}

function KpiNode({ t, v, s, hot }: { t: string; v: string; s?: string; hot?: boolean }) {
  return (
    <div className="rounded border px-2 py-1 text-center leading-[13px]" style={{ borderColor: hot ? CO : BW, background: hot ? '#FDF0EB' : BX }}>
      <div className="text-[9.5px] font-semibold" style={{ color: G }}>{t}</div>
      <div className="text-[13px] font-bold tabular-nums" style={{ color: hot ? COI : B }}>{v}</div>
      {s && <div className="text-[8.8px]" style={{ color: G }}>{s}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- deck

function compute(m: Model) {
  const s = fullScope(m)
  const snap = snapshot(m, s)
  const preEvent = snapshot(m, { ...s, end: m.raw.event.startsAt - 1 })
  const fun = funnel(m, s)
  const perf = campaignPerformance(m, s)
  const q = attendanceQuality(m, s)
  const pools = recoveryPools(m, s)
  const bn = bottleneck(m, s)
  const opp = opportunities(m, s)
  const alloc = proposedAllocation(m, s)
  const avoid = deprioritized(m, s)
  const seg = engagementSegments(m, s)
  const timing = timingSegments(m, s)
  const status = statusDistribution(m, s)
  const launch = m.raw.targets[0]
  const ws = { version: 1 as const, campaigns: [], overlays: {}, experiments: [], tasks: [], activity: [], updatedAt: 0 }
  const sample = answer('Which campaign should we pause or redesign?', m, s, ws, {}).response
  const sample2 = answer('Which age group attends most?', m, s, ws, {}).response
  return { s, snap, preEvent, fun, perf, q, pools, bn, opp, alloc, avoid, seg, timing, status, launch, sample, sample2 }
}

export function Deck() {
  const [m, setM] = useState<Model | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { fetchBundledWorkbook().then((r) => setM(buildModel(r))).catch((e) => setErr(String(e))) }, [])
  const params = new URLSearchParams(location.search)
  const name = params.get('name') ?? 'Your Name'
  const city = params.get('city') ?? 'Bengaluru'
  if (err) return <div className="p-8">Could not load workbook: {err}</div>
  if (!m) return <div className="p-8" style={{ color: G }}>Computing deck from workbook…</div>
  const d = compute(m)
  const { snap, preEvent, fun, perf, q, pools, bn, opp, alloc, avoid, seg, timing, launch } = d
  const t = snap.target
  const rowsByCpa = [...perf.rows].sort((a, b) => a.cpa - b.cpa)
  const bad = perf.rows.filter((r) => r.quadrant.startsWith('Fix') || r.quadrant.startsWith('Pause'))
  const badSpend = bad.reduce((a, r) => a + r.spendShare, 0), badAtt = bad.reduce((a, r) => a + r.attendanceShare, 0)
  const brochure = seg.filter((x) => x.segment === 'Downloaded brochure')
  const lowTiming = [...timing].filter((x) => x.registrations > 0).sort((a, b) => a.showRate - b.showRate)[0]
  const author = <><b style={{ color: INK }}>{name}</b><br />Host city (assumption): {city}</>
  const foot = `Source: Attendee Dataset.xlsx (synthetic CampusFest 2025, ${fmtDay(m.dayRange.start, true)} – ${fmtDay(m.dayRange.end, true)}, IST). Unique people by stable person_id; verified attendee = admitted + verified check-in; external people only. Modeled figures are labelled.`
  const top3 = opp.list.slice(0, 3)
  const stepConfirmed = fun.people.find((x) => x.key === 'confirmed')!, stepAtt = fun.people.find((x) => x.key === 'attended')!

  return (
    <div className="deck flex flex-col items-center gap-6 py-6" style={{ background: '#E9ECF1' }}>
      <style>{`@page { size: 1600px 900px; margin: 0 } @media print { body, .deck { background: #fff !important; padding: 0 !important; gap: 0 !important } .slide { break-after: page; page-break-after: always; box-shadow: none !important } .noprint { display: none !important } } .slide { box-shadow: 0 4px 24px rgba(31,36,48,.12) } body { -webkit-print-color-adjust: exact; print-color-adjust: exact }`}</style>
      <div className="noprint text-[12px]" style={{ color: G }}>3-slide strategy deck · computed live from the workbook · Print → Save as PDF (margins: none) · add <code>?name=Your%20Name</code> to the URL to set the author</div>

      {/* ============================ SLIDE 1 ============================ */}
      <Slide n={1} title="From registrations to verified attendance" question="What is preventing CampusFest from maximizing attendance?" author={author} foot={foot}>
        <div className="flex flex-col gap-2 h-full pt-1"><div className="grid grid-cols-[0.95fr_1.05fr_1fr] gap-5" style={{ height: 548 }}>
          <div className="flex flex-col gap-3">
            <div>
              <Label n="1" right={`${t.version} · as of ${fmtDay(m.dayRange.end, true)}`}>Target vs actual scorecard</Label>
              <Bullet label="Verified unique external visitors" actual={snap.visitors} target={t.visitorsGoal} note={`${fmtInt(snap.visitorsRegistered)} registered + ${fmtInt(snap.visitorsWalkIn)} walk-ins. ${fmtInt(t.visitorsGoal - snap.visitors)} short of the attendance goal.`} />
              <Bullet label="Unique registrations" actual={snap.registrations} target={t.registrationGoal} note={`Goal raised ${fmtInt(launch.registrationGoal)} → ${fmtInt(t.registrationGoal)} on ${fmtDay(t.effectiveAt, true)}; vs launch plan: ${fmtPct(snap.registrations / launch.registrationGoal)}.`} />
              <Bullet label="Identified external people" actual={snap.identified} target={t.identifiedGoal} note={`Met only because ${fmtInt(snap.identified - preEvent.identified)} walk-ins were identified at the gate; day before the event: ${fmtInt(preEvent.identified)} (${fmtPct(preEvent.identified / t.identifiedGoal)}).`} />
              <Bullet label="Net marketing spend" actual={snap.spend} target={t.budget} fmt={L} note={`${fmtINR(snap.gap.budgetRemaining)} of approved budget unspent · ${fmtINR(snap.costPerVisitor)} per verified visitor · ${fmtINR(perf.portfolio.cpa)} per campaign-attributed attendee.`} />
            </div>
            <div>
              <Label n="2" right="verified visitors">How high can we aim?</Label>
              <Box>
                <ScenarioSvg baseline={opp.baseline} low={opp.scenario.low} base={opp.scenario.base} high={opp.scenario.high} target={t.visitorsGoal} />
                <div className="text-[10px] leading-[13px] mt-1" style={{ color: G }}>Same ₹{(t.budget / 1e5).toFixed(0)}L budget, five levers on slide 2. <b style={{ color: INK }}>Base +{fmtInt(opp.scenario.base - opp.baseline)}</b> ({fmtPct(opp.scenario.base / opp.baseline - 1)}) clears the {fmtInt(t.visitorsGoal)} goal; stretch needs every lever at its high case. Capacity is not in the workbook. The 88 waitlisted registrants signal a cap, so seat release is limited by it.</div>
              </Box>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div>
              <Label n="3" right="cohort = all external people, outcomes at 20 Apr">Actual acquisition funnel</Label>
              <div className="flex gap-1.5 text-[10px] mb-1.5" style={{ color: G }}>
                {fun.anonymous.slice(0, 3).map((a, i) => <span key={a.key} className="rounded px-1.5 py-0.5 border" style={{ borderColor: LN }}>{i ? '→ ' : 'Awareness: '}<b style={{ color: INK }}>{fmtInt(a.value)}</b> {a.label.toLowerCase()}</span>)}
                <span className="italic">events, not people</span>
              </div>
              <FunnelSvg stages={fun.people.map((x) => ({ label: x.label, value: x.value, fromPrev: x.fromPrev }))} walkIns={fun.walkIns} />
            </div>
            <Box tone="coral">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.08em]" style={{ color: COI }}>Largest bottleneck: after registration, not before</div>
              <div className="text-[12px] leading-[16px] mt-1"><b>{fmtInt(bn.postRegistrationLost)}</b> registered people ({fmtPct(bn.postRegistrationLost / snap.registrations)}) never became verified attendees, versus <b>{fmtInt(bn.preRegistrationLost)}</b> lost before registering. The single biggest step: confirmed → attended, <b>{fmtInt(stepConfirmed.value - stepAtt.value)}</b> no-shows ({fmtPct(1 - (stepAtt.fromPrev ?? 0))}).</div>
              <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                {bn.breakdown.map((b) => <div key={b.label} className="text-center rounded bg-white px-1 py-1"><div className="text-[14px] font-bold" style={{ color: COI }}>{fmtInt(b.value)}</div><div className="text-[9px] leading-[10px]" style={{ color: G }}>{b.label}</div></div>)}
              </div>
            </Box>
          </div>

          <div className="flex flex-col gap-2.5">
            <div>
              <Label n="4" right="first-touch attribution">Campaign & channel performance</Label>
              <table className="w-full text-[10.5px] tabular-nums">
                <thead><tr style={{ color: G }} className="text-[9px] uppercase tracking-wide"><th className="text-left font-semibold pb-1">Campaign · channel</th><th className="text-right font-semibold">Spend</th><th className="text-right font-semibold">Att.</th><th className="text-right font-semibold">Show</th><th className="text-right font-semibold">₹/att.</th></tr></thead>
                <tbody>
                  {rowsByCpa.map((r) => {
                    const hot = r.quadrant.startsWith('Fix') || r.quadrant.startsWith('Pause')
                    return <tr key={r.id} style={{ borderTop: `1px dotted ${LN}`, background: hot ? '#FDF0EB' : undefined }}><td className="py-[3px]"><b>{r.name}</b> <span style={{ color: G }}>{r.channel}</span></td><td className="text-right">{L(r.spend)}</td><td className="text-right">{fmtInt(r.attendees)}</td><td className="text-right" style={{ color: hot ? COI : INK }}>{fmtPct(r.showRate, 0)}</td><td className="text-right font-bold" style={{ color: hot ? COI : B }}>{Math.round(r.cpa)}</td></tr>
                  })}
                </tbody>
              </table>
              <div className="text-[10.5px] leading-[14px] mt-1.5"><b style={{ color: COI }}>{bad.map((r) => r.name).join(' + ')}</b> take <b>{fmtPct(badSpend, 0)}</b> of spend for <b>{fmtPct(badAtt, 0)}</b> of attributed attendees: they convert half their registrants into attendees, against {fmtPct(perf.portfolio.showRate, 0)} for the portfolio.</div>
            </div>
            <div>
              <Label n="5" right="modeled · incremental verified attendees">Three quantified growth opportunities</Label>
              <div className="flex flex-col gap-1.5">
                {top3.map((o) => (
                  <Box key={o.id} tone={o.rank === 1 ? 'blue' : undefined} className="!py-1.5">
                    <div className="flex justify-between items-baseline"><span className="text-[11.5px] font-bold">{o.id} · {o.title}</span><span className="text-[12.5px] font-bold" style={{ color: B }}>+{o.impact.low}–{o.impact.high}</span></div>
                    <div className="text-[10px] leading-[13px]" style={{ color: G }}>{o.problem} <span style={{ color: INK }}>Base +{o.impact.base} · {o.confidence} confidence.</span></div>
                  </Box>
                ))}
              </div>
              <div className="text-[9.8px] leading-[12.5px] mt-1.5" style={{ color: G }}>Behaviour signals (observed, associations): brochure downloaders who registered attended at {fmtPct(brochure[0]?.showRate)} vs {fmtPct(brochure[1]?.showRate)}; registrants {lowTiming?.bucket.toLowerCase()} before the event showed up least ({fmtPct(lowTiming?.showRate)}). {fmtInt(pools.formAbandoners)} identified people abandoned the form ({fmtInt(pools.formAbandonOptOut)} later opted out).</div>
            </div>
          </div>
          </div>
          <div>
            <Label n="6" right="size = distinct people in the workbook · audience text = Campaigns.target_audience (plan, not observed)">Target audiences — measured size and why we prioritise them</Label>
            <div className="grid grid-cols-6 gap-2">
              {rowsByCpa.filter((r) => !bad.includes(r)).slice(0, 3).map((r, i) => (
                <Box key={r.id} tone={i === 0 ? 'blue' : undefined} className="!py-2">
                  <div className="flex justify-between items-center"><Tag>Acquire · #{i + 1}</Tag><span className="text-[9.5px]" style={{ color: G }}>{r.channel}</span></div>
                  <div className="text-[11.5px] font-bold mt-1">{r.name}</div>
                  <div className="text-[9.5px] leading-[12px] h-[24px] overflow-hidden" style={{ color: G }}>{m.campaignById.get(r.id)?.audience}</div>
                  <div className="text-[10px] mt-1 tabular-nums"><b className="text-[14px]" style={{ color: B }}>{fmtInt(r.identified)}</b> identified · {fmtPct(r.regRate, 0)} reg. · <b>{fmtPct(r.showRate, 0)}</b> attend · <b>₹{Math.round(r.cpa)}</b>/att.</div>
                </Box>
              ))}
              {[
                { t: 'Confirmed no-shows', n: q.confirmedNoShow, d: 'Already said yes; cheapest attendees to win back', k: 'O1 reminders + QR pass' },
                { t: 'Form abandoners', n: pools.formAbandoners, d: `${fmtInt(pools.formAbandonersContactable)} still contactable (not opted out)`, k: 'O3 saved-form link' },
                { t: 'Waitlisted registrants', n: pools.waitlisted, d: 'Never released; none attended', k: 'O4 release in waves' },
              ].map((x) => (
                <Box key={x.t} tone="coral" className="!py-2">
                  <div className="flex justify-between items-center"><Tag tone="coral">Convert · in funnel</Tag></div>
                  <div className="text-[11.5px] font-bold mt-1">{x.t}</div>
                  <div className="text-[9.5px] leading-[12px] h-[24px]" style={{ color: G }}>{x.d}</div>
                  <div className="text-[10px] mt-1"><b className="text-[14px]" style={{ color: COI }}>{fmtInt(x.n)}</b> people · {x.k}</div>
                </Box>
              ))}
            </div>
          </div>
        </div>
      </Slide>

      {/* ============================ SLIDE 2 ============================ */}
      <Slide n={2} title="Focus growth investment where it creates actual attendees" question="Where should we focus and why?" author={author} foot={`${PRIORITY_FORMULA}. Impact = modeled incremental verified attendees vs 2025 actuals; assumptions shown in the app (Acquisition Analytics → Opportunities).`}>
        <div className="flex flex-col gap-2 h-full pt-1"><div className="grid grid-cols-[1fr_1.12fr_0.98fr] gap-5" style={{ height: 590 }}>
          <div className="flex flex-col gap-2.5">
            <div>
              <Label n="1" right="bubble = spend · ₹ per attendee">Audience & channel matrix</Label>
              <MatrixSvg rows={perf.rows} avgReg={perf.portfolio.avgRegistrations} show={perf.portfolio.showRate} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10.2px] leading-[13px]">
              <Box tone="blue"><div className="font-bold mb-0.5" style={{ color: B }}>DOUBLE DOWN</div>{rowsByCpa.filter((r) => !bad.includes(r)).slice(0, 3).map((r) => <div key={r.id}><b>{r.name}</b> — ₹{Math.round(r.cpa)}/att., {fmtPct(r.showRate, 0)} show</div>)}<div className="mt-0.5" style={{ color: G }}>Peer, club and referral audiences arrive with intent to attend.</div></Box>
              <Box tone="coral"><div className="font-bold mb-0.5" style={{ color: COI }}>CUT / REDESIGN</div>{bad.map((r) => <div key={r.id}><b>{r.name}</b> — ₹{Math.round(r.cpa)}/att., {fmtPct(r.showRate, 0)} show</div>)}<div className="mt-0.5" style={{ color: G }}>Reach buys registrations, not attendance: half no-show or cancel.</div></Box>
            </div>
            <div>
              <Label>Deprioritised: what we will not fund</Label>
              {avoid.map((a) => <div key={a.idea} className="text-[10px] leading-[13px] py-[3px]" style={{ borderTop: `1px dotted ${LN}` }}><b>✕ {a.idea}.</b> <span style={{ color: G }}>{a.why}</span></div>)}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div>
              <Label n="2" right="ranked by priority score">Growth opportunity ranking — five bets</Label>
              <table className="w-full text-[10.2px] tabular-nums">
                <thead><tr className="text-[9px] uppercase tracking-wide" style={{ color: G }}><th className="text-left font-semibold">#</th><th className="text-left font-semibold">Bet · target audience</th><th className="text-left font-semibold w-[118px]">Impact low–high (base)</th><th className="text-right font-semibold px-1">Cost</th><th className="text-right font-semibold px-1">Conf.</th><th className="text-right font-semibold px-1">Signal</th><th className="text-right font-semibold pl-1">Score</th></tr></thead>
                <tbody>
                  {opp.list.map((o) => {
                    const mx = Math.max(...opp.list.map((x) => x.impact.high))
                    return (
                      <tr key={o.id} style={{ borderTop: `1px dotted ${LN}` }}>
                        <td className="py-1 align-top"><span className="w-[16px] h-[16px] rounded-full inline-flex items-center justify-center text-[9.5px] font-bold text-white" style={{ background: o.rank === 1 ? CO : B }}>{o.rank}</span></td>
                        <td className="align-top pr-1"><b>{o.title}</b><div className="text-[9.3px] leading-[11.5px]" style={{ color: G }}>{o.intervention.split(';')[0]}.</div></td>
                        <td className="align-top pt-1">
                          <svg width="118" height="14"><rect x={(o.impact.low / mx) * 110} y="4" width={Math.max(3, ((o.impact.high - o.impact.low) / mx) * 110)} height="6" rx="3" fill={BW} /><rect x={(o.impact.base / mx) * 110 - 1.5} y="1" width="3" height="12" fill={o.rank === 1 ? CO : B} /></svg>
                          <div className="text-[9.5px]">+{o.impact.low}–{o.impact.high} <b>(+{o.impact.base})</b></div>
                        </td>
                        <td className="text-right align-top px-1">{fmtINR(o.cost)}</td>
                        <td className="text-right align-top px-1">{o.confidence}</td>
                        <td className="text-right align-top px-1">{o.daysToSignal}d</td>
                        <td className="text-right align-top font-bold" style={{ color: o.rank === 1 ? COI : B }}>{o.score}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <Label n="3" right="observed → modeled">Expected incremental attendance</Label>
              <Box><Waterfall baseline={opp.baseline} items={opp.list.map((o) => ({ id: o.id, v: o.impact.base }))} target={t.visitorsGoal} high={opp.scenario.high} />
                <div className="text-[9.8px] leading-[12.5px]" style={{ color: G }}>Base case <b style={{ color: INK }}>{fmtInt(opp.scenario.base)}</b> verified visitors ({fmtInt(opp.scenario.low)} low, {fmtInt(opp.scenario.high)} stretch). Levers act on different people (confirmed no-shows, form abandoners, waitlist, gate, new reach), so overlap is limited. O1 and O4 both depend on show-up, so their effects are not fully additive.</div>
              </Box>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div>
              <Label n="4" right={`budget ${L(alloc.budget)} · base case`}>Budget allocation rationale</Label>
              <table className="w-full text-[10.2px] tabular-nums">
                <thead><tr className="text-[9px] uppercase tracking-wide" style={{ color: G }}><th className="text-left font-semibold">Line</th><th className="text-right font-semibold">2025</th><th className="text-right font-semibold">Plan</th><th className="text-left font-semibold pl-2">Change</th></tr></thead>
                <tbody>
                  {[...alloc.rows].sort((a, b) => b.delta - a.delta).map((r) => {
                    const mx = Math.max(...alloc.rows.map((x) => Math.abs(x.delta)))
                    return <tr key={r.id} style={{ borderTop: `1px dotted ${LN}` }}><td className="py-[2px]">{r.name}</td><td className="text-right">{L(r.current)}</td><td className="text-right font-semibold">{L(r.proposed)}</td>
                      <td className="pl-2"><svg width="104" height="10"><line x1="52" x2="52" y1="0" y2="10" stroke={LN} />{r.delta !== 0 && <rect x={r.delta > 0 ? 52 : 52 - (Math.abs(r.delta) / mx) * 50} y="2" width={(Math.abs(r.delta) / mx) * 50} height="6" rx="2" fill={r.delta > 0 ? B : CO} />}</svg></td></tr>
                  })}
                  {alloc.activation.map((a) => <tr key={a.id} style={{ borderTop: `1px dotted ${LN}` }}><td className="py-[2px]">{a.id} {a.label}</td><td className="text-right">—</td><td className="text-right font-semibold">{L(a.amount)}</td><td className="pl-2 text-[9px]" style={{ color: G }}>retention / ops</td></tr>)}
                  <tr style={{ borderTop: `1px solid ${INK}` }}><td className="py-[2px] font-bold">Total</td><td className="text-right">{L(snap.spend)}</td><td className="text-right font-bold">{L(alloc.total)}</td><td className="pl-2 text-[9px]" style={{ color: G }}>= approved budget</td></tr>
                </tbody>
              </table>
              <div className="text-[10px] leading-[13px] mt-1" style={{ color: G }}>Money follows <b style={{ color: INK }}>₹ per verified attendee</b>, not ₹ per registration. {L(alloc.freed)} is freed from the coral campaigns and added to the three cheapest-attendee campaigns, split by their attendees. {L(alloc.activation.reduce((a, x) => a + x.amount, 0))} funds converting people already in the funnel.</div>
            </div>
            <div>
              <Label n="5" right="weeks relative to event (W0 = festival)">Experiment roadmap</Label>
              <div className="relative">
                <div className="grid grid-cols-[132px_repeat(8,1fr)] text-[8.8px] mb-0.5" style={{ color: G }}><span />{['W-8', 'W-7', 'W-6', 'W-5', 'W-4', 'W-3', 'W-2', 'W-1'].map((w) => <span key={w} className="text-center">{w}</span>)}</div>
                {[
                  { id: 'O2', l: 'Staged budget shift', s: 0, e: 6, t: '25% first → read marginal ₹/confirmed' },
                  { id: 'O3', l: 'Abandoner A/B', s: 1, e: 7, t: '72h completion ≥ 20%' },
                  { id: 'O1', l: 'Reminder holdout', s: 5, e: 8, t: 'reconfirm ≥ 85%' },
                  { id: 'O4', l: 'Waitlist waves', s: 6, e: 8, t: 'acceptance ≥ 60%' },
                  { id: 'O5', l: 'Gate QR pre-check', s: 7, e: 8, t: 'day-1 lost < 1%' },
                ].map((r) => (
                  <div key={r.id} className="grid grid-cols-[132px_repeat(8,1fr)] items-center h-[20px]" style={{ borderTop: `1px dotted ${LN}` }}>
                    <span className="text-[9.8px] font-semibold whitespace-nowrap">{r.id} {r.l}</span>
                    <div className="relative h-[12px]" style={{ gridColumn: `${r.s + 2} / ${r.e + 2}` }}>
                      <div className="absolute inset-0 rounded-sm" style={{ background: r.id === 'O1' ? CO : B, opacity: 0.9 }} />
                      <span className="absolute inset-0 text-[8.6px] text-white font-semibold px-1 leading-[12px] truncate">{r.t}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[9.6px] leading-[12.5px] mt-1" style={{ color: G }}>Leading indicators before attendance exists: reconfirmation %, form completion within 72h, marginal ₹ per confirmed registrant, waitlist acceptance. Each bet has a scale, change and stop threshold (slide 3).</div>
            </div>
          </div>
          </div>
          <div>
            <Label n="6" right="maximise verified attendance, not registrations">Acquisition → attendance strategy</Label>
            <div className="grid grid-cols-5 gap-2">
              {[
                { h: 'Acquire', b: `Re-weight reach to ${rowsByCpa.filter((r) => !bad.includes(r)).slice(0, 3).map((r) => r.name).join(', ')}; cut ${bad.map((r) => r.name).join(' and ')}.`, k: `₹/verified attendee ≤ ${fmtINR(perf.portfolio.cpa)}` },
                { h: 'Convert', b: `Saved-form link to ${fmtInt(pools.formAbandonersContactable)} contactable abandoners within 24h; one nudge for ${fmtInt(pools.stuckInterested)} stuck “interested”.`, k: 'completion ≥ 20% in 72h' },
                { h: 'Recover', b: `Release ${fmtInt(pools.waitlisted)} waitlisted in waves as non-reconfirmers drop; nurture email only to form-starters, with a holdout.`, k: 'waitlist acceptance ≥ 60%' },
                { h: 'Activate', b: `D-7 reconfirm, D-1 QR pass + agenda, D-0 reminder for ${fmtInt(snap.confirmed)} confirmed; priority on Fix/Pause cohorts.`, k: 'reconfirmation ≥ 85%', hot: true },
                { h: 'Experiment', b: 'Every bet ships with a holdout or staged rollout; money moves in 25% steps; results logged in Campaign Manager.', k: 'decision within 7–14 days' },
              ].map((x, i) => (
                <Box key={x.h} tone={x.hot ? 'coral' : 'blue'} className="!py-2">
                  <div className="flex items-center gap-1.5"><span className="w-[16px] h-[16px] rounded-full text-white text-[9.5px] font-bold inline-flex items-center justify-center" style={{ background: x.hot ? CO : B }}>{i + 1}</span><span className="text-[11.5px] font-bold" style={{ color: x.hot ? COI : B }}>{x.h}</span>{i < 4 && <span className="ml-auto text-[12px]" style={{ color: G }}>→</span>}</div>
                  <div className="text-[10px] leading-[13px] mt-1">{x.b}</div>
                  <div className="text-[9.5px] mt-1 font-semibold" style={{ color: G }}>KPI: {x.k}</div>
                </Box>
              ))}
            </div>
          </div>
        </div>
      </Slide>

      {/* ============================ SLIDE 3 ============================ */}
      <Slide n={3} title="CampusFest Growth OS — from insight to action" question="How does this product make the strategy repeatable?" author={author} foot="Working product: React + TypeScript + Vite app reading the workbook directly; analyst answers are computed locally (no API key needed), optional Gemini narration is checked number-by-number against the computed data.">
        <div className="flex flex-col gap-2 h-full pt-1"><div className="grid grid-cols-[1.06fr_1fr_0.98fr] gap-5" style={{ height: 600 }}>
          <div className="flex flex-col gap-2.5">
            <div>
              <Label n="1" right="one analytics library → every surface">Product architecture</Label>
              <Arch />
            </div>
            <div>
              <Label n="2" right="each node = live metric">KPI tree — north star: verified unique visitors</Label>
              <div className="flex flex-col items-center gap-1.5">
                <KpiNode t="Verified unique external visitors" v={fmtInt(snap.visitors)} s={`target ${fmtInt(t.visitorsGoal)}`} />
                <div className="grid grid-cols-2 gap-2 w-full">
                  <KpiNode t="Registered attendees" v={fmtInt(snap.visitorsRegistered)} s="= registrations × reg→attend" />
                  <KpiNode t="Walk-ins" v={fmtInt(snap.visitorsWalkIn)} s="unattributed, cost unknown" />
                </div>
                <div className="grid grid-cols-4 gap-1.5 w-full">
                  <KpiNode t="Identified (campaign)" v={fmtInt(fun.people[0].value)} />
                  <KpiNode t="Identified → reg." v={fmtPct(safeDiv(snap.registrations, fun.people[0].value))} />
                  <KpiNode t="Confirmed share" v={fmtPct(safeDiv(snap.confirmed, snap.registrations))} />
                  <KpiNode t="Confirmed → attended" v={fmtPct(snap.confirmedShowRate)} hot />
                </div>
                <div className="grid grid-cols-3 gap-1.5 w-full">
                  <KpiNode t="₹ per verified attendee" v={fmtINR(snap.costPerVisitor)} s="efficiency guardrail" />
                  <KpiNode t="Cancellation rate" v={fmtPct(snap.cancellationRate)} />
                  <KpiNode t="Two-day attendance" v={fmtPct(safeDiv(q.twoDay, q.visitors))} s="quality proxy" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-[272px_1fr] gap-2">
              <div><Label n="3">Acquisition growth loop</Label><Loop /></div>
              <div>
                <Label>Insight → action workflow</Label>
                {[
                  ['Overview', `flags ${fmtInt(q.confirmedNoShow)} confirmed no-shows as the #1 leak`],
                  ['Analytics', `matrix puts ${bad.map((r) => r.name).join(' & ')} in Fix / Pause`],
                  ['Analyst', 'proposes a draft campaign or task with evidence'],
                  ['Confirm', 'user reviews and edits before anything is saved'],
                  ['Campaign Mgr', 'launch locally · log spend, registrations, attendees'],
                  ['Experiment', 'record control vs variant → scale / change / stop'],
                ].map(([a, b], i) => <div key={a} className="flex gap-1.5 text-[10px] leading-[12.5px] py-[3px]" style={{ borderTop: i ? `1px dotted ${LN}` : undefined }}><span className="font-bold w-[72px] shrink-0" style={{ color: i === 3 ? COI : B }}>{i + 1}. {a}</span><span>{b}</span></div>)}
              </div>
            </div>
            <div>
              <Label n="4" right="real output, computed from the workbook">Embedded growth analyst</Label>
              <Box tone="blue" className="!py-2">
                <div className="text-[10px] font-semibold rounded px-2 py-1 inline-block text-white" style={{ background: B }}>“{d.sample.title.replace('Campaigns to pause or redesign', 'Which campaign should we pause or redesign?')}”</div>
                <div className="text-[10.2px] leading-[13.5px] mt-1.5">{d.sample.summary}</div>
                <div className="grid grid-cols-2 gap-2 mt-1.5 text-[9.5px] leading-[12px]">
                  <div className="pl-1.5" style={{ borderLeft: `2px solid ${B}` }}><b style={{ color: B }}>OBSERVED</b> {d.sample.observed[0]}</div>
                  <div className="pl-1.5" style={{ borderLeft: `2px solid ${CO}` }}><b style={{ color: COI }}>HYPOTHESIS</b> {d.sample.hypotheses[0]}</div>
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">{d.sample.actions.map((a) => <Tag key={a.label}>{a.kind === 'open_campaign' ? '↗ ' : '＋ '}{a.label.length > 52 ? a.label.slice(0, 50) + '…' : a.label}</Tag>)}<Tag tone="grey">confirm before apply</Tag></div>
                <div className="text-[9.6px] mt-1.5 pt-1.5" style={{ borderTop: `1px dotted ${BW}` }}><b>“Which age group attends most?”</b> → <span style={{ color: COI }}>{d.sample2.summary}</span></div>
              </Box>
              <div className="text-[9.8px] leading-[12.5px] mt-1" style={{ color: G }}>25+ analysis routes and 16 metrics over the same functions: targets, funnel, budget, what-if shifts, comparisons, timing, signals, no-shows, tasks. It names the metric and date, keeps context for follow-ups (“why?”, “and for referrals?”), and refuses to invent missing data.</div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div>
              <Label n="5" right="tracked in Campaign Manager">Experiment & execution roadmap</Label>
              <table className="w-full text-[9.8px] leading-[12.5px]">
                <thead><tr className="text-[8.8px] uppercase tracking-wide" style={{ color: G }}><th className="text-left font-semibold">Bet</th><th className="text-left font-semibold"><span style={{ color: B }}>Scale</span> / <span style={{ color: COI }}>Stop</span></th></tr></thead>
                <tbody>
                  {opp.list.map((o) => (
                    <tr key={o.id} style={{ borderTop: `1px dotted ${LN}` }}>
                      <td className="py-1 align-top pr-1.5 w-[132px]"><b>{o.id}</b> {o.short}<div className="text-[8.6px] leading-[11px]" style={{ color: G }}>{o.successMetric.split('(')[0].split(';')[0]}</div></td>
                      <td className="py-1 align-top"><div><b style={{ color: B }}>▲</b> {o.thresholds.scale}</div><div><b style={{ color: COI }}>■</b> {o.thresholds.stop}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Label>Execution cadence</Label>
              <div className="grid grid-cols-3 gap-1.5 text-[9.6px] leading-[12px]">
                {[['Daily', 'Overview KPIs vs dated target; run-rate projection before the event'], ['Weekly', 'Matrix review → reallocate in 25% steps; analyst “next 7 days” → tasks'], ['Event week', 'Reminder holdout, waitlist waves, gate monitor; day-1 → day-2 fixes']].map(([a, b]) => <Box key={a} className="!px-2 !py-1.5"><div className="font-bold" style={{ color: B }}>{a}</div><div>{b}</div></Box>)}
              </div>
            </div>
          </div>
          </div>
          <div>
            <Label n="6" right="actual product screens, schematic">Four screens, one decision each</Label>
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1.15fr] gap-2">
              {[
                { t: 'Growth Overview', d: 'Are we on track? KPI vs the target version in force, bottleneck, #1 next action.', w: (
                  <svg width="100%" height="40" viewBox="0 0 160 40" preserveAspectRatio="none">{[0, 1, 2, 3].map((i) => <g key={i}><rect x={i * 40 + 1} y="1" width="37" height="15" rx="2" fill="#fff" stroke={BW} /><rect x={i * 40 + 4} y="11" width={i === 1 ? 18 : 28} height="2.5" fill={i === 1 ? CO : B} /></g>)}{Array.from({ length: 26 }).map((_, i) => <rect key={i} x={2 + i * 6} y={38 - (6 + ((i * 7) % 13))} width="4" height={6 + ((i * 7) % 13)} fill={B2} />)}</svg>) },
                { t: 'Acquisition Analytics', d: 'Where do we lose people and which campaigns earn attendees? Funnel, matrix, segments.', w: (
                  <svg width="100%" height="40" viewBox="0 0 160 40" preserveAspectRatio="none">{[70, 62, 55, 48, 40, 28].map((w, i) => <rect key={i} x="2" y={1 + i * 6.3} width={w} height="5" fill={i === 5 ? CO : B} />)}<rect x="84" y="1" width="74" height="38" fill={BX} />{([[96, 12, B], [110, 9, B], [126, 15, B], [140, 30, CO], [104, 30, CO]] as [number, number, string][]).map(([x, y, c], i) => <circle key={i} cx={x} cy={y} r="4" fill={c} />)}</svg>) },
                { t: 'Campaign Manager', d: 'Plan → launch (local) → log results → experiment → scale, change or stop.', w: (
                  <svg width="100%" height="40" viewBox="0 0 160 40" preserveAspectRatio="none">{[0, 1, 2, 3].map((i) => <g key={i}><rect x="2" y={2 + i * 9.5} width="156" height="8" fill={i === 2 ? '#FDF0EB' : '#fff'} stroke={BW} /><rect x="6" y={4.5 + i * 9.5} width="44" height="3" fill={INK} opacity=".5" /><rect x="110" y={3.5 + i * 9.5} width="18" height="5" rx="2" fill={i === 2 ? CO : BW} /></g>)}</svg>) },
                { t: 'Growth Analyst', d: 'Ask in plain language; get metric, date, evidence vs hypothesis, and a confirmable action.', w: (
                  <svg width="100%" height="40" viewBox="0 0 160 40" preserveAspectRatio="none"><rect x="70" y="1" width="88" height="9" rx="3" fill={B} /><rect x="2" y="13" width="120" height="17" rx="3" fill="#fff" stroke={BW} /><rect x="6" y="17" width="90" height="2.5" fill={INK} opacity=".45" /><rect x="6" y="23" width="70" height="2.5" fill={INK} opacity=".3" /><rect x="2" y="32" width="46" height="7" rx="2" fill={B} /><rect x="52" y="32" width="40" height="7" rx="2" fill="#fff" stroke={B2} /></svg>) },
              ].map((x) => (
                <Box key={x.t} className="!py-1.5">
                  <div className="text-[11px] font-bold" style={{ color: B }}>{x.t}</div>
                  <div className="my-1">{x.w}</div>
                  <div className="text-[9.6px] leading-[12px]" style={{ color: G }}>{x.d}</div>
                </Box>
              ))}
              <Box tone="coral" className="!py-1.5">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.08em]" style={{ color: COI }}>Why it is repeatable</div>
                <div className="text-[10px] leading-[13px] mt-0.5">Load a new workbook and every KPI, quadrant, opportunity, budget line and analyst answer recomputes. Decisions are stored as plan status, tasks and experiments (localStorage or Supabase), so the next edition starts from measured results, not memory.</div>
              </Box>
            </div>
          </div>
        </div>
      </Slide>
    </div>
  )
}
