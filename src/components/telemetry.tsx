'use client'

import { useId, useMemo, useState } from 'react'
import type { ChannelSpec, FdirEvent, TelemetryPoint } from '@/contracts'
import type { Mission } from '@/ui/use-mission'
import { fmtT } from '@/ui/format'

const VW = 300, VH = 64, PAD = 6

/** Short strip labels; the full channel label stays in the tooltip and the record drawer. */
const SHORT: Record<ChannelSpec['key'], string> = {
  gpuC: 'GPU temp', coolantKPa: 'Coolant B', radiatorC: 'Radiator B', util: 'Utilisation',
  busV: 'Bus A', rateDegS: 'Body rate', latchLoadN: 'Latch load',
}
export const shortLabel = (spec: ChannelSpec) => (spec.id === 'TM-LAT-UTL' ? 'Lattice compute' : SHORT[spec.key] ?? spec.label)

function fmtV(v: number, unit: string): string {
  const a = Math.abs(v)
  const s = a >= 1000 ? Math.round(v).toLocaleString() : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)
  return `${s}${unit === '%' ? '' : ' '}${unit}`
}

export function Strip({ spec, pts, now, t0, t1, fdir, ops, onOpen }: {
  spec: ChannelSpec; pts: TelemetryPoint[]; now: number; t0: number; t1: number; fdir: FdirEvent[]
  ops?: { start: number; end: number } | null; onOpen: (id: string) => void
}) {
  const clip = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const ended = pts.length === 0
  const { lo, hi } = spec.limits
  const past = pts.filter((p) => p.t <= now)
  const cur = past[past.length - 1]
  const { y, x } = useMemo(() => {
    const vals = pts.length ? pts.flatMap((p) => [p.v, p.nominal]) : [0, 1]
    if (lo != null) vals.push(lo)
    if (hi != null && hi < Math.max(...vals) * 1.6) vals.push(hi)
    let mn = Math.min(...vals), mx = Math.max(...vals)
    if (mx - mn < 1e-6) { mn -= 1; mx += 1 }
    const pad = (mx - mn) * 0.12
    mn -= pad; mx += pad
    return {
      x: (t: number) => ((t - t0) / (t1 - t0)) * VW,
      y: (v: number) => PAD + (1 - (v - mn) / (mx - mn)) * (VH - 2 * PAD),
    }
  }, [pts, lo, hi, t0, t1])
  const line = (sel: (p: TelemetryPoint) => number, arr: TelemetryPoint[]) => arr.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(sel(p)).toFixed(1)}`).join('')
  const breach = cur && ((hi != null && cur.v > hi) || (lo != null && cur.v < lo))
  const near = cur && !breach && ((hi != null && cur.v > hi - (hi - cur.nominal) * 0.25) || (lo != null && cur.v < lo + (cur.nominal - lo) * 0.25))
  const hp = hover != null ? pts.reduce((b, p) => (Math.abs(p.t - hover) < Math.abs(b.t - hover) ? p : b), pts[0]) : null
  const hpPast = hp && hp.t <= now

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <button type="button" onClick={() => onOpen(spec.id)} className="min-w-0 truncate text-left text-[0.72rem] text-ink-2 hover:text-accent" title={`${spec.label} · ${spec.id}`}>
          {shortLabel(spec)}
        </button>
        <span className={`num ml-auto shrink-0 whitespace-nowrap text-[0.95rem] leading-none tracking-tight ${breach ? 'text-failed' : near ? 'text-degraded' : 'text-ink'}`}>
          {cur ? fmtV(cur.v, spec.unit) : '—'}
        </span>
      </div>
      {ended ? (
        <div className="mt-1.5 flex h-14 items-center border-t border-dashed border-line font-mono text-[0.6rem] text-faint">channel ended · {spec.module} left the lattice</div>
      ) : (
      <div
        className="relative mt-1.5"
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(t0 + ((e.clientX - r.left) / r.width) * (t1 - t0)) }}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" className="block h-14 w-full overflow-visible" role="img" aria-label={`${spec.label} sparkline`}>
          <defs>
            <clipPath id={`${clip}b`}>
              {hi != null && <rect x={0} y={-50} width={VW} height={Math.max(0, y(hi) + 50)} />}
              {lo != null && <rect x={0} y={Math.min(y(lo), VH + 50)} width={VW} height={VH + 50} />}
            </clipPath>
          </defs>
          {ops && ops.end > t0 && ops.start < t1 && (
            <rect x={Math.max(0, x(ops.start))} y={0} width={Math.max(0, Math.min(VW, x(ops.end)) - Math.max(0, x(ops.start)))} height={VH} fill="var(--accent)" fillOpacity={0.05} />
          )}
          {hi != null && <line x1={0} x2={VW} y1={y(hi)} y2={y(hi)} stroke="var(--failed)" strokeOpacity={0.45} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
          {lo != null && <line x1={0} x2={VW} y1={y(lo)} y2={y(lo)} stroke="var(--failed)" strokeOpacity={0.45} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
          <path d={line((p) => p.nominal, pts)} fill="none" stroke="var(--muted)" strokeOpacity={0.7} strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={line((p) => p.v, past)} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path d={line((p) => p.v, past)} fill="none" stroke="var(--failed)" strokeWidth={1.8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${clip}b)`} />
          {fdir.filter((f) => f.t >= t0 && f.t <= t1 && f.t <= now).map((f) => (
            <g key={f.id}>
              <line x1={x(f.t)} x2={x(f.t)} y1={0} y2={VH} stroke="var(--degraded)" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          <line x1={x(now)} x2={x(now)} y1={0} y2={VH} stroke="var(--ink)" strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />
          {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={0} y2={VH} stroke="var(--ink-2)" strokeOpacity={0.5} strokeDasharray="1 2" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* markers drawn in HTML so they stay round under the stretched viewBox */}
        {cur && <span className={`pointer-events-none absolute size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg ${breach ? 'bg-failed' : 'bg-accent'}`} style={{ left: `${(x(cur.t) / VW) * 100}%`, top: `${(y(cur.v) / VH) * 100}%` }} />}
        {fdir.filter((f) => f.t >= t0 && f.t <= t1 && f.t <= now).map((f) => (
          <span key={f.id} className="pointer-events-none absolute -top-1 -translate-x-1/2 font-mono text-[0.55rem] text-degraded" style={{ left: `${(x(f.t) / VW) * 100}%` }}>▾</span>
        ))}
        {hp && (
          <div
            className="glass pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-md px-2 py-1 font-mono text-[0.62rem] whitespace-nowrap text-ink-2"
            style={{ left: `${Math.min(85, Math.max(15, (x(hp.t) / VW) * 100))}%` }}
          >
            <span className="text-muted">{fmtT(hp.t)}</span>{' '}
            {hpPast ? <span className="text-ink">{fmtV(hp.v, spec.unit)}</span> : <span className="text-muted">forecast</span>}{' '}
            <span className="text-muted">· nominal {fmtV(hp.nominal, spec.unit)}</span>
          </div>
        )}
      </div>
      )}
    </div>
  )
}

const SPAN = 900

export function Telemetry({ m, onOpen }: { m: Mission; onOpen: (id: string) => void }) {
  const specs = useMemo(() => m.api.channels(m.scenario).filter((c) => c.module === m.def.module), [m.api, m.scenario, m.def.module])
  const t = m.t
  let t1 = t + SPAN * 0.18
  let t0 = t1 - SPAN
  if (t0 < 0) { t0 = 0; t1 = SPAN }
  const ops = m.primaryExec ? { start: m.primaryExec.startT, end: m.opsEnd ?? m.primaryExec.startT } : null
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
      {specs.slice(0, 4).map((spec) => (
        <Strip
          key={spec.id}
          spec={spec}
          pts={m.api.sample(m.scenario, spec.id, t0, t1, 120, m.resolvedAt)}
          now={t}
          t0={t0}
          t1={t1}
          fdir={m.fdir.filter((f) => f.channel === spec.id)}
          ops={ops}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
