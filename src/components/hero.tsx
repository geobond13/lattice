'use client'

export function Hero({ onRun, onFleet, title }: { onRun: () => void; onFleet: () => void; title: string }) {
  return (
    <div className="pointer-events-auto max-w-[720px]">
      <p className="lt-hero eyebrow text-accent" style={{ animationDelay: '0.1s' }}>Modular orbital data center</p>
      <h1 className="mt-4 text-[clamp(1.7rem,2.9vw,2.75rem)] leading-[1.08] font-semibold tracking-[-0.03em] text-ink">
        <span className="lt-hero block" style={{ animationDelay: '0.25s' }}>GPUs age out in 3–5 years.</span>
        <span className="lt-hero block text-ink-2" style={{ animationDelay: '0.45s' }}>Orbit doesn’t let you upgrade.</span>
        <span className="lt-hero block text-accent" style={{ animationDelay: '0.65s' }}>Unless the station is modular.</span>
      </h1>
      <p className="lt-hero mt-5 font-mono text-[0.78rem] tracking-[0.04em] text-muted" style={{ animationDelay: '0.9s' }}>
        12 modules <span className="text-faint">·</span> 1 robot <span className="text-faint">·</span> no one on console
      </p>
      <div className="lt-hero mt-7 flex flex-wrap items-center gap-3" style={{ animationDelay: '1.1s' }}>
        <button type="button" onClick={onRun} className="group flex items-center gap-2.5 rounded-lg bg-accent px-4 py-2.5 text-[0.85rem] font-medium text-bg shadow-[0_0_40px_-10px_var(--accent)] transition hover:brightness-110">
          Run scenario
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="transition-transform group-hover:translate-x-0.5"><path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
        </button>
        <button type="button" onClick={onFleet} className="rounded-lg border border-line-2 bg-bg/30 px-4 py-2.5 text-[0.85rem] text-ink-2 backdrop-blur transition hover:border-accent/50 hover:text-ink">
          The fleet, 2027–2037
        </button>
        <span className="w-full pt-1 text-[0.72rem] text-muted sm:w-auto sm:pt-0 sm:pl-1">{title}</span>
      </div>
    </div>
  )
}
