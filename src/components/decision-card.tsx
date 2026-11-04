'use client'

import type { Decision } from '@/contracts'
import type { DecisionEntry, Mission } from '@/ui/use-mission'
import { ACTION_LABEL, fmtT } from '@/ui/format'
import { CitationChip } from './trace/citation-chip'
import { GEN_PERF, defaultGeneration } from '@/ui/fleet'

const BADGE: Record<DecisionEntry['status'], { text: string; cls: string; dot: string }> = {
  executing: { text: 'Executing autonomously', cls: 'border-accent/40 bg-accent-soft text-accent', dot: 'bg-accent lt-pulse' },
  complete: { text: 'Complete', cls: 'border-accent/30 bg-accent-soft text-accent', dot: 'bg-accent' },
  pending: { text: 'Awaiting operator', cls: 'border-degraded/40 bg-degraded-soft text-degraded', dot: 'bg-degraded lt-pulse' },
  refused: { text: 'Refused', cls: 'border-failed/40 bg-failed-soft text-failed', dot: 'bg-failed' },
  rejected: { text: 'Rejected by operator', cls: 'border-line-2 bg-sunken text-muted', dot: 'bg-muted' },
  superseded: { text: 'Superseded', cls: 'border-line-2 bg-sunken text-muted', dot: 'bg-muted' },
}

function ContactBar({ d, now, los }: { d: Decision; now: number; los: number }) {
  const next = d.nextContact
  const end = Math.max(next ?? 0, d.deadline ?? 0, now) * 1.08 + 60
  const start = Math.min(los, now, d.deadline ?? now)
  const x = (t: number) => `${(((t - start) / (end - start)) * 100).toFixed(2)}%`
  const gapStart = Math.max(los, start)
  return (
    <div>
      {now <= (next ?? d.deadline ?? now) && <div className="relative h-7">
        {/* the no-human-reachable gap */}
        {next != null && (
          <div
            className="absolute top-2.5 h-2 rounded-[2px] border border-line-2"
            style={{ left: x(gapStart), width: `calc(${x(next)} - ${x(gapStart)})`, background: 'repeating-linear-gradient(135deg, rgba(160,190,230,0.10) 0 3px, transparent 3px 6px)' }}
            title="No ground contact: no human reachable"
          />
        )}
        {next != null && <div className="absolute top-1.5 h-4 w-0.5 rounded bg-ink-2" style={{ left: x(next) }} />}
        {d.deadline != null && <div className="absolute top-1 h-5 w-0.5 rounded bg-degraded" style={{ left: x(d.deadline) }} />}
        <div className="absolute top-0 h-7 w-px bg-accent" style={{ left: x(now) }}>
          <span className="absolute -top-0.5 -left-[3px] size-[7px] rounded-full bg-accent" />
        </div>
      </div>}
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[0.62rem]">
        <span>
          {d.deadline != null ? <span className="text-degraded">Deadline {fmtT(d.deadline)}</span> : <span className="text-muted">No hazard deadline</span>}
          {next != null && <><span className="text-faint"> vs </span><span className="text-ink-2">next contact {fmtT(next)}</span></>}
        </span>
        <span className="text-faint">▨ no human reachable</span>
      </div>
    </div>
  )
}

function OpsProgress({ m }: { m: Mission }) {
  const ex = m.primaryExec
  if (!ex?.decision.ops) return null
  const ops = ex.decision.ops
  const tau = Math.max(0, m.t - ex.startT)
  const p = Math.min(1, tau / ops.duration)
  const pose = m.pose
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">Proximity ops</span>
        <span className="num ml-auto text-[0.66rem] text-muted">{Math.round(p * 100)}%</span>
      </div>
      <div className="flex h-1 gap-[2px]">
        {ops.phases.map((ph) => {
          const w = (ph.t1 - ph.t0) / ops.duration
          const f = Math.min(1, Math.max(0, (tau - ph.t0) / (ph.t1 - ph.t0)))
          return (
            <div key={ph.kind + ph.t0} className="relative overflow-hidden rounded-full bg-line" style={{ flexGrow: w }} title={ph.label}>
              <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${f * 100}%` }} />
            </div>
          )
        })}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-[0.78rem] text-ink">{p >= 1 ? 'Ops complete · servicer clear' : pose.phaseLabel || '—'}</span>
        {p < 1 && (
          <span className="num shrink-0 text-[0.7rem] text-ink-2">
            {pose.range.toFixed(1)} m <span className="text-muted">· {pose.rangeRate >= 0 ? '+' : ''}{(pose.rangeRate * 100).toFixed(1)} cm/s</span>
          </span>
        )}
      </div>
    </div>
  )
}

export function DecisionCard({ m, onOpen }: { m: Mission; onOpen: (id: string) => void }) {
  const e = m.primary
  if (!e) return null
  const d = e.decision
  const b = BADGE[e.status]
  const approved = e.status !== 'pending' && d.tier === 'gated' && e.startT != null
  const failed = d.checks.filter((c) => !c.pass)
  const spare = d.action === 'SWAP_MODULE' ? d.params.spare : undefined
  const gFrom = defaultGeneration(d.params.module)
  const gTo = spare ? defaultGeneration(spare) : gFrom
  const lastLos = Math.max(...m.def.contacts.filter((c) => c.los <= e.at).map((c) => c.los), 0)

  return (
    <div className={`glass lt-rise overflow-hidden rounded-xl ${e.status === 'refused' ? 'border-failed/40' : e.status === 'pending' ? 'border-degraded/40' : ''}`}>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.12em] uppercase ${b.cls}`}>
            <span className={`size-1.5 rounded-full ${b.dot}`} />
            {approved && e.status === 'executing' ? 'Executing · operator approved' : b.text}
          </span>
          <span className="ml-auto font-mono text-[0.62rem] text-faint">{fmtT(e.at)}</span>
        </div>
        <div>
          <h3 className="text-[1.05rem] font-medium tracking-tight text-ink">
            {ACTION_LABEL[d.action]}{d.params.fru ? ` · ${d.params.fru.replace('_', ' ')}` : ''} <span className="text-muted">on</span> {d.params.module}
            {spare && <span className="text-muted"> → {spare}</span>}
          </h3>
          <p className="mt-0.5 text-[0.74rem] leading-5 text-ink-2">{d.reason}</p>
          {d.params.grasp && d.params.grasp.length > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-[0.66rem] text-muted">Grasp {d.params.grasp.map((id) => <CitationChip key={id} id={id} onOpen={onOpen} />)}</p>
          )}
          {spare && gTo > gFrom && (
            <p className="mt-1 font-mono text-[0.68rem] text-accent">Failure → upgrade: Gen-{gFrom} → Gen-{gTo}, {(GEN_PERF[gTo] / GEN_PERF[gFrom]).toFixed(1)}× perf/kW</p>
          )}
          {m.supersededRefusal && (
            <p className="mt-1.5 text-[0.68rem] text-muted">
              Supersedes a refused proposal: <span className="text-failed">{m.supersededRefusal.decision.checks.filter((c) => !c.pass).map((c) => c.id).join(', ')}</span>
            </p>
          )}
        </div>

        {(d.deadline != null || d.nextContact != null) && <ContactBar d={d} now={m.t} los={lastLos} />}

        <ul className="space-y-0.5 border-t border-line pt-2.5">
          {d.checks.map((c) => (
            <li key={c.id} className="grid grid-cols-[14px_1fr] gap-x-2 text-[0.7rem] leading-[1.15rem]" title={c.label}>
              <span className={c.pass ? 'text-accent' : 'text-failed'} aria-label={c.pass ? 'pass' : 'fail'}>{c.pass ? '✓' : '✗'}</span>
              <span className="min-w-0">
                <span className={`font-mono text-[0.64rem] ${c.pass ? 'text-muted' : 'text-failed'}`}>{c.id}</span>
                <span className={`ml-2 ${c.pass ? 'text-ink-2' : 'text-failed'}`}>{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        {m.migration && m.migration !== e && (
          <p className="flex items-center gap-2 border-t border-line pt-2.5 text-[0.7rem] text-muted">
            <span className="size-1.5 rounded-full bg-accent" />
            Workloads migrated off {m.migration.decision.params.module}
            {m.migration.decision.params.targets && <span className="font-mono text-[0.64rem] text-faint">→ {m.migration.decision.params.targets.join(' ')}</span>}
            <span className="ml-auto font-mono text-[0.6rem] text-faint">auto</span>
          </p>
        )}

        {(e.status === 'executing' || e.status === 'complete') && <OpsProgress m={m} />}

        {e.status === 'refused' && failed.length > 0 && (
          <p className="lt-pulse font-mono text-[0.64rem] text-muted">Agent re-planning…</p>
        )}

        {e.status === 'pending' && (
          <div className="flex items-center gap-2 border-t border-line pt-3">
            <button type="button" onClick={() => m.requestApprove(e.key)} className="flex-1 rounded-lg bg-degraded px-3 py-2 text-[0.8rem] font-medium text-bg transition hover:brightness-110">
              Approve {ACTION_LABEL[d.action].toLowerCase()}
            </button>
            <button type="button" onClick={() => m.reject(e.key)} className="rounded-lg border border-line-2 px-3 py-2 text-[0.8rem] text-ink-2 transition hover:border-failed/60 hover:text-failed">
              Reject
            </button>
          </div>
        )}
        {e.status === 'pending' && <p className="text-center font-mono text-[0.6rem] text-faint">or say “approve the swap”</p>}
      </div>
    </div>
  )
}

/** Compact ops-time bar: tier + action + live proximity-ops phase, progress and range. Click to expand the full card. */
export function DecisionBar({ m, expanded, onToggle }: { m: Mission; expanded: boolean; onToggle: () => void }) {
  const e = m.primary
  if (!e) return null
  const d = e.decision
  const b = BADGE[e.status]
  const ex = m.primaryExec
  const ops = ex?.decision.ops
  const tau = ex ? Math.max(0, m.t - ex.startT) : 0
  const p = ops ? Math.min(1, tau / ops.duration) : 0
  const done = p >= 1
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="glass lt-rise flex w-full max-w-[480px] items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5 text-left transition-colors hover:border-line-2"
    >
      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[0.56rem] tracking-[0.12em] uppercase ${b.cls}`}>
        <span className={`size-1.5 rounded-full ${b.dot}`} />
        {e.status === 'executing' ? (d.tier === 'gated' ? 'Approved' : 'Autonomous') : b.text}
      </span>
      <span className="shrink-0 text-[0.76rem] text-ink">{ACTION_LABEL[d.action]} <span className="text-muted">{d.params.module}</span></span>
      <span className="min-w-0 flex-1 truncate text-[0.72rem] text-ink-2">{done ? 'Complete · servicer clear' : m.pose.phaseLabel}</span>
      {ops && (
        <span className="hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-line sm:block">
          <span className="block h-full bg-accent" style={{ width: `${p * 100}%` }} />
        </span>
      )}
      {!done && <span className="num shrink-0 text-[0.68rem] text-ink-2">{m.pose.range.toFixed(1)} m</span>}
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`shrink-0 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" /></svg>
    </button>
  )
}
