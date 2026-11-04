'use client'

import type { Mission, SceneView, Warp } from '@/ui/use-mission'
import { fmtT } from '@/ui/format'
import { MissionTimeline } from './mission-timeline'

export type RailTab = 'scenarios' | 'fleet'

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`flex-1 rounded-md px-2 py-1 text-[0.7rem] transition-colors ${value === o.v ? 'bg-white/[0.07] text-ink' : 'text-muted hover:text-ink-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ScenarioRail({ m, tab, setTab }: { m: Mission; tab: RailTab; setTab: (t: RailTab) => void }) {
  const idle = m.phase === 'idle'
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3 pb-0">
        <Seg label="Rail" value={tab} onChange={setTab} options={[{ v: 'scenarios', label: 'Scenarios' }, { v: 'fleet', label: 'Fleet 2027–37' }]} />
      </div>

      {tab === 'scenarios' ? (
        <>
          {idle ? (
            <div className="scroll-quiet min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {m.scenarioIds.map((id, i) => {
              const s = m.scenarios[id]
              const on = id === m.scenario
              const live = on && !idle
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => m.setScenario(id)}
                  aria-pressed={on}
                  className={`group w-full rounded-lg border p-3 text-left transition-colors ${on ? 'border-accent/45 bg-accent-soft/50' : 'border-line hover:border-line-2 hover:bg-white/[0.02]'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[0.6rem] ${on ? 'text-accent' : 'text-faint'}`}>0{i + 1}</span>
                    <span className="font-mono text-[0.6rem] text-muted">{s.module}</span>
                    {live && <span className="ml-auto flex items-center gap-1 font-mono text-[0.58rem] text-accent"><span className="lt-pulse size-1.5 rounded-full bg-accent" />live</span>}
                  </div>
                  <p className={`mt-1.5 text-[0.8rem] leading-5 font-medium ${on ? 'text-ink' : 'text-ink-2'}`}>{s.title}</p>
                  <p className="mt-1 text-[0.7rem] leading-[1.1rem] text-muted">{s.blurb}</p>
                  <p className="mt-2 font-mono text-[0.6rem] text-faint">
                    Fault {fmtT(s.faultT)} · next contact {fmtT(Math.min(...s.contacts.filter((c) => c.aos > s.faultT).map((c) => c.aos)))}
                  </p>
                </button>
              )
            })}
          </div>
          ) : (
            <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-3">
              <ul className="space-y-1">
                {m.scenarioIds.map((id, i) => {
                  const s = m.scenarios[id]
                  const on = id === m.scenario
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => m.setScenario(id)}
                        aria-pressed={on}
                        className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${on ? 'border-accent/45 bg-accent-soft/50' : 'border-transparent hover:border-line'}`}
                      >
                        <span className={`font-mono text-[0.58rem] ${on ? 'text-accent' : 'text-faint'}`}>0{i + 1}</span>
                        <span className={`min-w-0 flex-1 truncate text-[0.72rem] ${on ? 'text-ink' : 'text-muted'}`}>{s.title}</span>
                        {on && <span className="lt-pulse size-1.5 shrink-0 rounded-full bg-accent" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-4 border-t border-line pt-3">
                <p className="eyebrow mb-2.5">Mission timeline</p>
                <MissionTimeline m={m} />
              </div>
            </div>
          )}

          <div className="space-y-3 border-t border-line p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={m.togglePlay}
                aria-label={m.playing ? 'Pause' : 'Play'}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-2 text-ink hover:border-accent/60 hover:text-accent"
              >
                {m.playing && !idle
                  ? <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1h2v8H2zM6 1h2v8H6z" fill="currentColor" /></svg>
                  : <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>}
              </button>
              <div className="flex-1">
                <Seg<Warp> label="Time warp" value={m.autoWarping ? (0 as Warp) : m.warp} onChange={m.setWarp} options={[{ v: 1, label: '1×' }, { v: 30, label: '30×' }, { v: 120, label: '120×' }]} />
              </div>
            </div>
            {m.autoWarping && <p className="-mt-1 font-mono text-[0.6rem] text-accent">auto-warp {Math.round(m.effectiveWarp)}× · {m.phase === 'ops' ? 'ops in ~40 s' : m.phase === 'resolved' ? 'recovery' : 'to next contact'}</p>}
            <div className="space-y-1.5">
              <span className="eyebrow">Run source</span>
              <Seg label="Run source" value={m.source} onChange={m.setSource} options={[{ v: 'live', label: 'Live Muse' }, { v: 'recorded', label: 'Recorded run' }]} />
            </div>
            <div className="space-y-1.5">
              <span className="eyebrow">Camera</span>
              <Seg<SceneView> label="Camera" value={m.view} onChange={m.setView} options={[{ v: 'overview', label: 'Overview' }, { v: 'follow', label: 'Follow' }, { v: 'servicer', label: 'Servicer' }]} />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => m.run()} className="flex-1 rounded-lg bg-accent px-3 py-2 text-[0.78rem] font-medium text-bg transition hover:brightness-110">
                {idle ? 'Run scenario' : 'Restart'}
              </button>
              {!idle && (
                <button type="button" onClick={m.reset} className="rounded-lg border border-line-2 px-3 py-2 text-[0.78rem] text-ink-2 hover:text-ink">Reset</button>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-3 p-4 text-[0.76rem] leading-6 text-ink-2">
          <p>GPUs go obsolete in 3–5 years. A monolithic orbital data center can’t be upgraded in place, so it is a stranded asset by the time it pays back.</p>
          <p>LATTICE swaps modules as hardware ages, repairs or replaces failed ones, and deorbits dead ones.</p>
          <ul className="space-y-2 border-t border-line pt-3 text-[0.72rem]">
            <li><span className="text-ink">The standard.</span> <span className="text-muted">One interface for power, thermal, data and grapple.</span></li>
            <li><span className="text-ink">The servicer.</span> <span className="text-muted">A two-armed robot and a depot of next-gen spares.</span></li>
            <li><span className="text-ink">The brain.</span> <span className="text-muted">Diagnosis from each module’s as-built record.</span></li>
          </ul>
          <p className="border-t border-line pt-3 font-mono text-[0.62rem] text-faint">Numbers are illustrative.</p>
        </div>
      )}
    </div>
  )
}
