import { X } from 'lucide-react'
import { useData } from '../data/DataContext'
import { UNATTRIBUTED } from '../analytics/model'
import { targetAt } from '../analytics/metrics'
import { dayKey, fmtRange } from '../lib/time'
import { activePhase, phases } from '../lib/phases'

const sel = 'h-8 rounded border border-line bg-white px-2 text-[12.5px] text-ink focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100'

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded border border-blue-100 bg-blue-50 text-[11.5px] text-blue">
      {label}
      <button aria-label={`Clear ${label}`} onClick={onClear} className="w-4 h-4 inline-flex items-center justify-center rounded hover:bg-blue-100"><X size={11} /></button>
    </span>
  )
}

/** Shared reporting controls: phase, date range, campaign, channel. Sticky under the top bar. */
export function FilterBar({ note }: { note?: string }) {
  const { model, filters, setFilters, resetFilters, scope } = useData()
  if (!model || !scope) return null
  const min = dayKey(model.dayRange.start), max = dayKey(model.dayRange.end)
  const ph = phases(model)
  const active = activePhase(model, filters.from, filters.to)
  const channels = [...new Set(model.campaigns.map((c) => c.channel))]
  const t = targetAt(model, scope.end)
  const campaignName = filters.campaign === UNATTRIBUTED ? 'Walk-in / unattributed' : model.campaignById.get(filters.campaign)?.name
  const chips: { label: string; clear: () => void }[] = []
  if (!(filters.from === min && filters.to === max)) chips.push({ label: active ? `Phase: ${active.label}` : `Dates: ${fmtRange(scope.start, scope.end)}`, clear: () => setFilters({ from: min, to: max }) })
  if (filters.campaign !== 'all') chips.push({ label: `Campaign: ${campaignName}`, clear: () => setFilters({ campaign: 'all' }) })
  if (filters.channel !== 'all') chips.push({ label: `Channel: ${filters.channel}`, clear: () => setFilters({ channel: 'all' }) })
  const empty = scope.campaignIds && scope.campaignIds.length === 0

  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-[#f2f5fc]/92 backdrop-blur-[3px] border-b border-line/80 shadow-[0_1px_0_rgba(255,255,255,0.8)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2" role="group" aria-label="Reporting period">
          <label className="text-[11.5px] text-muted" htmlFor="phase">Phase</label>
          <select id="phase" className={`${sel} w-[168px]`} value={active?.key ?? 'custom'} onChange={(e) => { const p = ph.find((x) => x.key === e.target.value); if (p) setFilters({ from: p.from, to: p.to }) }}>
            {ph.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            {!active && <option value="custom" disabled>Custom range</option>}
          </select>
          <input aria-label="From date" type="date" className={`${sel} w-[132px] tnum`} min={min} max={filters.to} value={filters.from} onChange={(e) => e.target.value && setFilters({ from: e.target.value })} />
          <span className="text-muted">–</span>
          <input aria-label="To date (inclusive, IST end of day)" type="date" className={`${sel} w-[132px] tnum`} min={filters.from} max={max} value={filters.to} onChange={(e) => e.target.value && setFilters({ to: e.target.value })} />
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Segment">
          <select aria-label="Campaign" className={`${sel} w-[200px]`} value={filters.campaign} onChange={(e) => setFilters({ campaign: e.target.value })}>
            <option value="all">All campaigns + walk-ins</option>
            {model.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
            <option value={UNATTRIBUTED}>Walk-in / unattributed</option>
          </select>
          <select aria-label="Channel" className={`${sel} w-[160px]`} value={filters.channel} onChange={(e) => setFilters({ channel: e.target.value })}>
            <option value="all">All channels</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="walk_in">walk_in (no campaign)</option>
          </select>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => <Chip key={c.label} label={c.label} onClear={c.clear} />)}
            {chips.length > 1 && <button onClick={resetFilters} className="text-[11.5px] text-blue hover:underline ml-1">Clear all</button>}
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[11.5px] text-muted flex flex-wrap gap-x-3 gap-y-0.5">
        <span><span className="text-ink-2 font-medium tnum">{fmtRange(scope.start, scope.end)}</span> · IST, end date inclusive</span>
        <span>Target in force: <span className="text-ink-2 font-medium">{t.version}</span></span>
        {note && <span>{note}</span>}
        {empty && <span className="text-coral-ink font-medium">No campaign matches this campaign + channel combination</span>}
      </div>
    </div>
  )
}
