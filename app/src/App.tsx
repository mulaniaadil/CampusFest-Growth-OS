import { useEffect, useRef, useState } from 'react'
import { BarChart3, Bot, ChevronRight, Download, FileSpreadsheet, LayoutDashboard, Loader2, AlertTriangle, Megaphone, Presentation, ShieldCheck, Upload, X } from 'lucide-react'
import { DataProvider, useData } from './data/DataContext'
import { useRoute, navigate, type Route } from './lib/router'
import { Overview } from './pages/Overview'
import { Analytics } from './pages/Analytics'
import { CampaignManager } from './pages/CampaignManager'
import { Analyst } from './pages/Analyst'
import { DataQuality } from './pages/DataQuality'
import { initRemoteSync, useSyncStatus, useWorkspace } from './store/workspace'
import { remoteLabel } from './store/supabase'
import { fmtDay } from './lib/time'
import { exportCampaignCsv, exportWorkspaceJson } from './lib/export'
import { toast, useToasts, dismissToast } from './lib/toast'

const NAV: { route: Route; label: string; icon: typeof LayoutDashboard; desc: string }[] = [
  { route: 'overview', label: 'Growth Overview', icon: LayoutDashboard, desc: 'Target attainment, acquisition pace and the next decision for the selected period.' },
  { route: 'analytics', label: 'Acquisition Analytics', icon: BarChart3, desc: 'Funnel, campaign economics, cohorts and the prioritized strategy behind the numbers.' },
  { route: 'campaigns', label: 'Campaign Manager', icon: Megaphone, desc: 'Source campaigns from the workbook and local simulations: budgets, experiments, tasks.' },
  { route: 'analyst', label: 'Growth Analyst', icon: Bot, desc: 'Questions answered from the workbook and workspace, with evidence and confirmable actions.' },
]
const DATA_PAGE = { route: 'data' as Route, label: 'Data audit', icon: ShieldCheck, desc: 'Workbook audit, data-quality findings, metric definitions and targets.' }

function Toasts() {
  const ts = useToasts()
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
      {ts.map((t) => (
        <div key={t.id} className={`flex gap-2 items-start rounded-md border bg-white px-3 py-2.5 shadow-lg text-[12.5px] leading-[17px] ${t.tone === 'error' ? 'border-coral' : 'border-line'}`}>
          <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${t.tone === 'error' ? 'bg-coral' : 'bg-blue'}`} />
          <span className="flex-1">{t.text}</span>
          <button aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="text-muted hover:text-ink"><X size={13} /></button>
        </div>
      ))}
    </div>
  )
}

function Shell() {
  const { route } = useRoute()
  const { model, error, loading, isCustomWorkbook, loadFile, scope } = useData()
  const ws = useWorkspace()
  const sync = useSyncStatus()
  const file = useRef<HTMLInputElement>(null)
  const [exportOpen, setExportOpen] = useState(false)
  useEffect(() => { initRemoteSync() }, [])
  useEffect(() => { if (!exportOpen) return; const on = () => setExportOpen(false); window.addEventListener('click', on); return () => window.removeEventListener('click', on) }, [exportOpen])
  const current = [...NAV, DATA_PAGE].find((n) => n.route === route)!
  const openTasks = ws.tasks.filter((t) => t.status !== 'done').length
  const ev = model?.raw.event
  const pick = () => file.current?.click()

  return (
    <div className="min-h-full flex flex-col md:flex-row">
      <input ref={file} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }} />
      <aside className="md:w-[232px] shrink-0 sidebar-tint border-b md:border-b-0 md:border-r border-line md:sticky md:top-0 md:h-screen flex md:flex-col">
        <div className="px-4 py-3 md:pt-4 md:pb-3 flex items-center gap-2.5 md:border-b border-line shrink-0">
          <div className="w-7 h-7 rounded bg-blue flex items-center justify-center shrink-0"><svg viewBox="0 0 32 32" width="17" height="17" aria-hidden><path d="M7 22 L13 14 L18 18 L25 9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /><circle cx="25" cy="9" r="3" fill="#F28C6B" /></svg></div>
          <div className="leading-[15px] min-w-0">
            <div className="font-semibold text-[13px]">CampusFest Growth OS</div>
            {ev && <div className="text-[11.5px] text-muted">{ev.name} · {fmtDay(ev.startsAt)}–{fmtDay(ev.endsAt, true)}</div>}
          </div>
        </div>
        <nav className="flex md:flex-col gap-0.5 px-2 py-2 overflow-x-auto md:overflow-visible flex-1 md:flex-none" aria-label="Primary">
          <div className="hidden md:block label-caps px-2.5 pt-1 pb-1.5">Workspace</div>
          {NAV.map((n) => {
            const active = route === n.route
            return (
              <a key={n.route} href={`#/${n.route}`} aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-2.5 h-8 px-2.5 rounded text-[12.5px] whitespace-nowrap ${active ? 'nav-active text-blue font-semibold' : 'text-ink-2 hover:bg-blue-25 hover:text-ink'}`}>
                {active && <span className="hidden md:block absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r bg-blue" />}
                <n.icon size={15} strokeWidth={active ? 2.2 : 1.8} />
                <span>{n.label}</span>
                {n.route === 'campaigns' && openTasks > 0 && <span className="ml-auto text-[10.5px] tnum rounded px-1.5 bg-coral-50 text-coral-ink" title={`${openTasks} open tasks`}>{openTasks}</span>}
              </a>
            )
          })}
        </nav>
        <div className="hidden md:flex flex-col mt-auto border-t border-line">
          <a href="./deck.html" target="_blank" rel="noreferrer" className="flex items-center gap-2.5 h-9 px-4 text-[12.5px] text-ink-2 hover:text-blue"><Presentation size={15} strokeWidth={1.8} />Strategy deck <span className="text-muted text-[11px]">(new tab)</span></a>
          <div className="px-4 py-3 border-t border-line bg-blue-50/50">
            <div className="flex items-center justify-between">
              <span className="label-caps">Dataset</span>
              <span className={`text-[10.5px] font-medium ${error ? 'text-coral-ink' : 'text-blue'}`}>{loading ? 'Loading…' : error ? 'Check' : 'Loaded'}</span>
            </div>
            {model ? (
              <>
                <div className="flex items-center gap-1.5 mt-1.5 text-[12px] font-medium min-w-0" title={model.raw.sourceName}><FileSpreadsheet size={13} className="text-blue shrink-0" /><span className="truncate">{model.raw.sourceName.replace(' (bundled)', '')}</span></div>
                <div className="text-[11px] text-muted mt-0.5 leading-[15px]">{isCustomWorkbook ? 'Uploaded workbook' : 'Bundled workbook'} · {model.raw.people.length.toLocaleString('en-IN')} people · {model.campaigns.length} campaigns<br />History {fmtDay(model.dayRange.start)} – {fmtDay(model.dayRange.end, true)}, IST</div>
                <div className="text-[11px] text-muted mt-0.5">Workspace: {remoteLabel.startsWith('Supabase') ? `Supabase (${sync.status})` : 'saved in this browser'}</div>
              </>
            ) : <div className="text-[11.5px] text-muted mt-1">No workbook loaded</div>}
            <div className="grid grid-cols-3 gap-1 mt-2.5 relative">
              <button onClick={pick} disabled={loading} className="h-7 rounded border border-line bg-white text-[11.5px] text-ink-2 hover:border-blue-300 hover:text-blue inline-flex items-center justify-center gap-1 disabled:opacity-50"><Upload size={12} />Import</button>
              <button onClick={(e) => { e.stopPropagation(); setExportOpen((v) => !v) }} disabled={!model} aria-expanded={exportOpen} className="h-7 rounded border border-line bg-white text-[11.5px] text-ink-2 hover:border-blue-300 hover:text-blue inline-flex items-center justify-center gap-1 disabled:opacity-50"><Download size={12} />Export</button>
              <a href="#/data" className={`h-7 rounded border text-[11.5px] inline-flex items-center justify-center gap-1 ${route === 'data' ? 'border-blue text-blue bg-blue-50' : 'border-line bg-white text-ink-2 hover:border-blue-300 hover:text-blue'}`}><ShieldCheck size={12} />Audit</a>
              {exportOpen && model && scope && (
                <div className="absolute bottom-9 left-0 right-0 z-30 rounded-md border border-line bg-white shadow-lg py-1 text-[12px]" onClick={(e) => e.stopPropagation()}>
                  <button className="w-full text-left px-3 py-2 hover:bg-blue-50" onClick={() => { exportCampaignCsv(model, scope); setExportOpen(false); toast('Campaign performance CSV downloaded for the current filters.') }}>Campaign performance (CSV)<div className="text-[10.5px] text-muted">Current filters and date range</div></button>
                  <button className="w-full text-left px-3 py-2 hover:bg-blue-50" onClick={() => { exportWorkspaceJson(ws); setExportOpen(false); toast('Workspace JSON downloaded.') }}>Workspace backup (JSON)<div className="text-[10.5px] text-muted">Local campaigns, tasks, experiments</div></button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="header-band border-b border-line px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <nav className="flex items-center gap-1 text-[11.5px] text-muted" aria-label="Breadcrumb">
              <span>{ev?.name ?? 'CampusFest'}</span><ChevronRight size={12} /><span className="text-ink-2">{current.label}</span>
            </nav>
            <h1 className="text-[17px] font-semibold leading-6 mt-0.5">{current.label}</h1>
            <p className="text-[12px] text-muted leading-4">{current.desc}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {route !== 'data' && <button onClick={() => navigate('data')} className="hidden lg:inline-flex h-8 px-3 rounded border border-line text-[12.5px] text-ink-2 hover:border-blue-300 hover:text-blue items-center gap-1.5"><ShieldCheck size={14} />Data audit</button>}
            <button onClick={pick} disabled={loading} className="h-8 px-3 rounded border border-blue bg-blue text-white text-[12.5px] font-medium hover:bg-blue-600 inline-flex items-center gap-1.5 disabled:opacity-50">{loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}Import workbook</button>
          </div>
        </header>
        <div className="px-6 py-4 flex-1 min-h-0">
          {loading && !model && <div className="flex items-center gap-2 text-muted py-20 justify-center"><Loader2 className="animate-spin" size={16} />Reading workbook and building the model…</div>}
          {error && (
            <div className="mb-3 flex gap-2 items-start rounded border border-coral/60 bg-coral-50 px-3 py-2 text-[12.5px]"><AlertTriangle size={15} className="text-coral-ink mt-0.5 shrink-0" /><div><b>Data problem:</b> {error}{!model && <> The app expects <code>public/data/Attendee Dataset.xlsx</code> or an imported workbook with the same sheets.</>}</div></div>
          )}
          {model && (
            <>
              {route === 'overview' && <Overview />}
              {route === 'analytics' && <Analytics />}
              {route === 'campaigns' && <CampaignManager />}
              {route === 'analyst' && <Analyst />}
              {route === 'data' && <DataQuality />}
            </>
          )}
        </div>
      </main>
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}
