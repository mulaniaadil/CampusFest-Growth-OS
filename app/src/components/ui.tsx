import { useState, type ReactNode } from 'react'
import { Info, AlertTriangle, Inbox } from 'lucide-react'

export function Card({ title, subtitle, right, children, className = '', pad = true, id }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <section id={id} className={`surface ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-line/70">
          <div className="min-w-0">
            {title && <h3 className="text-[13px] font-semibold text-ink leading-5">{title}</h3>}
            {subtitle && <p className="text-[11.5px] text-muted leading-4 mt-0.5">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function InfoTip({ text }: { text: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="Definition" onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="text-muted hover:text-blue">
        <Info size={13} />
      </button>
      {open && (
        <span role="tooltip" className="absolute z-50 left-1/2 -translate-x-1/2 top-5 w-64 rounded border border-line bg-white p-2.5 text-[11.5px] leading-4 text-ink-2 shadow-lg font-normal normal-case tracking-normal">
          {text}
        </span>
      )}
    </span>
  )
}

export function Kpi({ label, value, sub, target, attainment, definition, tone = 'default', range }: {
  label: string; value: string; sub?: ReactNode; target?: string; attainment?: number; definition: ReactNode; tone?: 'default' | 'alert'; range?: string
}) {
  const pctW = attainment != null && Number.isFinite(attainment) ? Math.min(100, attainment * 100) : null
  const short = attainment != null && attainment < 1
  return (
    <div className="surface px-3.5 py-3 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="label-caps leading-[13px]">{label}</span>
        <InfoTip text={<>{definition}{range && <><br /><span className="text-muted">Range: {range}</span></>}</>} />
      </div>
      <div className={`text-[22px] leading-7 font-semibold tnum ${tone === 'alert' ? 'text-coral-ink' : 'text-ink'}`}>{value}</div>
      {pctW != null && (
        <div className="mt-0.5">
          <div className="h-1.5 bg-blue-50 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${short ? 'bg-coral' : 'bg-blue'}`} style={{ width: `${pctW}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-muted mt-1 tnum">
            <span>{target}</span>
            <span className={short ? 'text-coral-ink font-medium' : 'text-blue font-medium'}>{(attainment! * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}
      {sub && <div className="text-[11.5px] text-muted leading-4">{sub}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'blue' | 'coral' | 'outline' }) {
  const cls = {
    neutral: 'bg-canvas text-ink-2 border-line',
    blue: 'bg-blue-50 text-blue border-blue-100',
    coral: 'bg-coral-50 text-coral-ink border-coral/40',
    outline: 'bg-white text-ink-2 border-line',
  }[tone]
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[11px] font-medium whitespace-nowrap ${cls}`}>{children}</span>
}

export function Empty({ title, text, action }: { title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 text-muted">
      <Inbox size={22} className="mb-2 text-blue-300" />
      <div className="text-[13px] font-medium text-ink-2">{title}</div>
      {text && <div className="text-[12px] mt-1 max-w-md">{text}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Notice({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'coral' }) {
  return (
    <div className={`flex gap-2 items-start rounded border px-3 py-2 text-[12px] leading-4 ${tone === 'coral' ? 'bg-coral-50 border-coral/40 text-ink' : 'bg-blue-50 border-blue-100 text-ink-2'}`}>
      {tone === 'coral' ? <AlertTriangle size={14} className="text-coral-ink mt-0.5 shrink-0" /> : <Info size={14} className="text-blue mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  )
}

export function Button({ children, onClick, variant = 'primary', size = 'md', type = 'button', disabled, title }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'accent'; size?: 'sm' | 'md'; type?: 'button' | 'submit'; disabled?: boolean; title?: string }) {
  const v = {
    primary: 'bg-blue text-white hover:bg-blue-600 border-blue',
    secondary: 'bg-white text-ink border-line hover:border-blue-300 hover:text-blue',
    ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-blue-50 hover:text-blue',
    accent: 'bg-coral text-ink border-coral hover:brightness-95',
  }[variant]
  const s = size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]'
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-1.5 rounded border font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${v} ${s}`}>
      {children}
    </button>
  )
}

export function Table({ columns, rows, align, highlightRow, dense }: { columns: ReactNode[]; rows: ReactNode[][]; align?: ('l' | 'r')[]; highlightRow?: (i: number) => boolean; dense?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={`label-caps !text-[10px] py-1.5 px-2 border-b border-line whitespace-nowrap ${align?.[i] === 'r' ? 'text-right' : 'text-left'}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`${highlightRow?.(i) ? 'bg-coral-50/60' : 'hover:bg-blue-50/40'}`}>
              {r.map((c, j) => (
                <td key={j} className={`${dense ? 'py-1' : 'py-1.5'} px-2 dotted-b tnum ${align?.[j] === 'r' ? 'text-right' : 'text-left'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded border border-line bg-white p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={`px-2 h-6 rounded-sm text-[11.5px] font-medium ${value === o.value ? 'bg-blue text-white' : 'text-ink-2 hover:text-blue'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="label-caps">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

export const inputCls = 'h-8 rounded border border-line bg-white px-2 text-[12.5px] text-ink focus:outline-none focus:border-blue focus:ring-2 focus:ring-blue-100 w-full'

export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-white rounded-md border border-line shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] flex flex-col`}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h3 className="font-semibold text-[14px]">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink text-[18px] leading-none" aria-label="Close">×</button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mt-1">
      <h2 className="label-caps !text-[11px] !text-blue">{children}</h2>
      {right}
    </div>
  )
}
