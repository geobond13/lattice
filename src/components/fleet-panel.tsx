'use client'

import { useMemo, useState } from 'react'
import type { FleetYear, Generation } from '@/contracts'
import { GEN_COLOR, GEN_PERF } from '@/ui/fleet'

const GENS: Generation[] = [1, 2, 3, 4]
const MONO = '#8a96a8' // neutral comparison series (not a status colour)

/** 12-slot ring, one tile per module, filled by hardware generation (sequential single hue). */
function FleetRing({ y, prev }: { y: FleetYear; prev?: FleetYear }) {
  const R = 64, C = 84
  return (
    <svg viewBox="0 0 168 168" className="size-[150px] shrink-0" role="img" aria-label={`Module generations in ${y.year}`}>
      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line-2)" />
      <circle cx={C} cy={C} r={7} fill="none" stroke="var(--line-2)" />
      {y.modules.map((m, k) => {
        const a = (k * Math.PI) / 6 - Math.PI / 2
        const x = C + R * Math.cos(a), yy = C + R * Math.sin(a)
        const swapped = prev && prev.modules[k]?.generation !== m.generation
        return (
          <g key={m.module} transform={`translate(${x} ${yy}) rotate(${(k * 30)})`}>
            <title>{`${m.module} · ${m.gpu} · installed ${m.installedYear}`}</title>
            {swapped && <rect x={-13} y={-10} width={26} height={20} rx={4} fill="none" stroke="var(--accent)" strokeOpacity={0.6} className="lt-fade" />}
            <rect x={-10} y={-7} width={20} height={14} rx={2.5} fill={GEN_COLOR[m.generation]} stroke="var(--bg)" strokeWidth={2} />
          </g>
        )
      })}
      <text x={C} y={C + 3} textAnchor="middle" fontSize={8} fontFamily="var(--font-geist-mono)" fill="var(--muted)">hub</text>
    </svg>
  )
}

function CapacityChart({ fleet, idx, onPick }: { fleet: FleetYear[]; idx: number; onPick: (i: number) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 520, H = 170, L = 34, Rm = 74, T = 10, B = 20
  const max = Math.max(...fleet.map((f) => Math.max(f.capacity, f.monolithCapacity)))
  const top = Math.ceil(max / 100) * 100
  const x = (i: number) => L + (i / (fleet.length - 1)) * (W - L - Rm)
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const strandedAt = fleet.findIndex((f) => f.monolithCapacity <= 0)
  const monoEnd = strandedAt < 0 ? fleet.length - 1 : strandedAt
  const latPath = fleet.map((f, i) => `${i ? 'L' : 'M'}${x(i)} ${y(f.capacity)}`).join('')
  const monoPath = fleet.slice(0, monoEnd + 1).map((f, i) => `${i ? 'L' : 'M'}${x(i)} ${y(f.monolithCapacity)}`).join('')
  const h = hover ?? idx
  const ticks = [0, top / 2, top]
  const last = fleet[fleet.length - 1]

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center gap-4 text-[0.68rem] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-accent" />LATTICE capacity</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded" style={{ background: MONO }} />Monolith, same launch mass</span>
        <span className="ml-auto font-mono text-[0.6rem] text-faint">index: 2027 lattice = 100</span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Compute capacity, LATTICE versus monolith, 2027 to 2037"
          onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(fleet.length - 1, Math.round(((px - L) / (W - L - Rm)) * (fleet.length - 1))))) }}
          onPointerLeave={() => setHover(null)}
          onClick={() => hover != null && onPick(hover)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - Rm} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fontFamily="var(--font-geist-mono)" fill="var(--muted)">{v}</text>
            </g>
          ))}
          {fleet.map((f, i) => (i % 2 === 0 ? <text key={f.year} x={x(i)} y={H - 5} textAnchor="middle" fontSize={9} fontFamily="var(--font-geist-mono)" fill="var(--muted)">{f.year}</text> : null))}
          <line x1={x(h)} x2={x(h)} y1={T} y2={H - B} stroke="var(--ink-2)" strokeOpacity={0.35} strokeDasharray="2 3" />
          <path d={monoPath} fill="none" stroke={MONO} strokeWidth={2} strokeLinejoin="round" />
          <path d={latPath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
          {strandedAt >= 0 && (
            <g transform={`translate(${x(strandedAt)} ${y(0)})`}>
              <path d="M-4 -4L4 4M4 -4L-4 4" stroke={MONO} strokeWidth={1.6} />
              <text x={0} y={-9} textAnchor="middle" fontSize={9} fill="var(--ink-2)">stranded</text>
            </g>
          )}
          {/* direct labels at line ends */}
          <text x={x(fleet.length - 1) + 8} y={y(last.capacity) + 3} fontSize={10} fill="var(--ink)">LATTICE {last.capacity}</text>
          {strandedAt < 0 && <text x={x(fleet.length - 1) + 8} y={y(last.monolithCapacity) + 3} fontSize={10} fill="var(--ink-2)">Monolith {last.monolithCapacity}</text>}
          {/* markers for the hovered/scrubbed year (2px surface ring) */}
          <circle cx={x(h)} cy={y(fleet[h].capacity)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
          {h <= monoEnd && <circle cx={x(h)} cy={y(fleet[h].monolithCapacity)} r={4} fill={MONO} stroke="var(--bg)" strokeWidth={2} />}
        </svg>
        {hover != null && (
          <div className="glass pointer-events-none absolute top-0 rounded-md px-2 py-1.5 text-[0.66rem]" style={{ left: `${Math.min(70, (x(hover) / W) * 100 + 2)}%` }}>
            <p className="font-mono text-ink">{fleet[hover].year}</p>
            <p className="text-ink-2"><span className="num text-ink">{fleet[hover].capacity}</span> LATTICE</p>
            <p className="text-ink-2"><span className="num text-ink">{fleet[hover].monolithCapacity || '—'}</span> monolith{fleet[hover].monolithCapacity <= 0 ? ' (stranded)' : ''}</p>
            <p className="text-muted">{fleet[hover].swaps} swaps that year</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function FleetPanel({ fleet, idx, setIdx, playing, togglePlay }: { fleet: FleetYear[]; idx: number; setIdx: (i: number) => void; playing: boolean; togglePlay: () => void }) {
  const y = fleet[idx]
  const counts = useMemo(() => GENS.map((g) => (y?.modules ?? []).filter((m) => m.generation === g).length), [y])
  if (!y) return null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[0.9rem] font-medium tracking-tight text-ink">The station outlives its chips</h2>
        <span className="rounded-[4px] border border-line-2 px-1.5 font-mono text-[0.58rem] tracking-[0.12em] text-muted uppercase">Illustrative</span>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={togglePlay} className="flex size-7 items-center justify-center rounded-md border border-line-2 text-ink-2 hover:border-accent/60 hover:text-accent" aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1h2v8H2zM6 1h2v8H6z" fill="currentColor" /></svg> : <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>}
          </button>
          <span className="num text-[1.4rem] leading-none tracking-tight text-ink">{y.year}</span>
        </div>
      </div>
      <input
        type="range" min={0} max={fleet.length - 1} step={1} value={idx} onChange={(e) => setIdx(Number(e.target.value))}
        aria-label="Year" className="w-full accent-[var(--accent)]"
      />
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <FleetRing y={y} prev={fleet[idx - 1]} />
          <ul className="space-y-1.5 text-[0.68rem]">
            {GENS.map((g, i) => (
              <li key={g} className="flex items-center gap-2">
                <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: GEN_COLOR[g] }} />
                <span className="text-ink-2">Gen-{g}</span>
                <span className="font-mono text-faint">{GEN_PERF[g]}×</span>
                <span className="num ml-auto pl-2 text-ink">{counts[i]}</span>
              </li>
            ))}
            <li className="pt-1 font-mono text-[0.6rem] text-muted">{y.swaps} swaps in {y.year}</li>
          </ul>
        </div>
        <CapacityChart fleet={fleet} idx={idx} onPick={setIdx} />
      </div>
    </div>
  )
}
