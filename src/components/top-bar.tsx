'use client'

import type { Mission } from '@/ui/use-mission'
import { fmtClock, fmtDur } from '@/ui/format'

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="7" fill="none" stroke="var(--accent)" strokeOpacity="0.45" />
        {Array.from({ length: 12 }, (_, k) => {
          const a = (k * Math.PI) / 6
          return <rect key={k} x={(10 + 7 * Math.cos(a) - 1.1).toFixed(2)} y={(10 + 7 * Math.sin(a) - 1.1).toFixed(2)} width="2.2" height="2.2" rx="0.4" fill={k === 4 ? 'var(--accent)' : 'var(--ink-2)'} />
        })}
      </svg>
      <span className="text-[0.82rem] font-semibold tracking-[0.32em] text-ink">LATTICE</span>
    </span>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-0.5 leading-none">
      <span className="eyebrow text-[0.55rem]">{label}</span>
      {children}
    </div>
  )
}

export function TopBar({ m, mock }: { m: Mission; mock?: boolean }) {
  const idle = m.phase === 'idle'
  const c = m.contact
  const minsToAos = c.nextAos != null ? (c.nextAos - m.t) : null
  return (
    <header className="relative z-20 order-0 flex h-14 items-center gap-4 border-b border-line bg-bg/55 px-4 backdrop-blur-md lg:absolute lg:inset-x-0 lg:top-0">
      <div className="flex min-w-0 items-center gap-4">
        <Wordmark />
        <span className="hidden truncate text-[0.72rem] text-muted md:inline">Self-servicing orbital compute · reasoning by Muse</span>
        {mock && <span className="hidden rounded-[4px] sm:inline border border-line-2 px-1.5 font-mono text-[0.55rem] tracking-[0.14em] text-faint uppercase">mock</span>}
      </div>
      <div className="ml-auto flex items-center gap-4 sm:gap-6">
        <div className="hidden sm:block"><Stat label="Ground">
          {idle ? (
            <span className="text-[0.74rem] text-muted">—</span>
          ) : c.inContact ? (
            <span className="flex items-center gap-1.5 text-[0.74rem] text-ink"><span className="size-1.5 rounded-full bg-accent" />Ground contact: {c.station}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-[0.74rem] text-ink-2">
              <span className="size-1.5 rounded-full border border-muted" />
              No ground contact<span className="hidden sm:inline">{minsToAos != null ? ` · next AOS in ${fmtDur(minsToAos)}` : ''}</span>
            </span>
          )}
        </Stat></div>
        <Stat label="Compute">
          <span className="num text-[0.9rem] text-ink">{m.latticeUtil.toFixed(0)}<span className="text-muted">%</span></span>
        </Stat>
        <Stat label={m.effectiveWarp > 1 && m.playing ? `Mission · ${Math.round(m.effectiveWarp)}×` : 'Mission'}>
          <span className={`num text-[0.95rem] tracking-tight ${idle ? 'text-muted' : 'text-ink'}`}>{fmtClock(idle ? 0 : m.t)}</span>
        </Stat>
      </div>
    </header>
  )
}
