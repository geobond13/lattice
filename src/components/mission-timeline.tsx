'use client'

import type { Mission } from '@/ui/use-mission'
import { fmtT } from '@/ui/format'

type State = 'done' | 'active' | 'todo' | 'fail'
interface Step { id: string; label: string; detail?: string; done: boolean; fail?: boolean; tone?: 'accent' | 'degraded' | 'failed'; children?: { label: string; state: State }[] }

const DOT: Record<State, string> = {
  done: 'border-accent bg-accent',
  active: 'border-accent lt-pulse',
  todo: 'border-line-2',
  fail: 'border-failed bg-failed',
}

/** The story so far: wake → inspect → SAM → decision → ops phases → recovery, each ticking as it completes. */
export function MissionTimeline({ m }: { m: Mission }) {
  const run = m.runs.find((r) => !r.question)
  const ev = run?.events ?? []
  const has = (pred: (e: (typeof ev)[number]) => boolean) => ev.some(pred)
  const segs = ev.filter((e) => e.type === 'segments').reduce((n, e) => n + (e.type === 'segments' ? e.segments.length : 0), 0)
  const refused = m.entries.filter((e) => e.status === 'refused' || e.status === 'superseded').length
  const p = m.primary?.status === 'refused' ? null : m.primary
  const ex = m.primaryExec
  const ops = ex?.decision.ops
  const tau = ex ? m.t - ex.startT : -1

  const steps: Step[] = [
    { id: 'wake', label: 'FDIR wakes the agent', detail: m.wakeEvent ? `${m.wakeEvent.id} · ${fmtT(m.wakeEvent.t)}` : 'Watching telemetry', done: !!m.wakeEvent },
    { id: 'inspect', label: 'Fly-around inspection', detail: m.frames.length ? `${m.frames.length} frames rendered` : undefined, done: m.frames.length > 0 },
    { id: 'evidence', label: 'Telemetry + as-built record', done: has((e) => e.type === 'tool_result' && /record/.test(e.name)) },
    { id: 'vision', label: 'Muse Spark reads the damage', done: has((e) => e.type === 'vision') },
    { id: 'sam', label: 'SAM 3.1 grasp targets', detail: segs ? `${segs} segment${segs === 1 ? '' : 's'}` : undefined, done: segs > 0 },
    {
      id: 'decide', label: 'Envelope decision',
      detail: p ? `${p.decision.tier === 'auto' ? 'Autonomous' : p.decision.tier === 'gated' ? 'Needs operator' : 'Refused'}${refused ? ` · ${refused} refused, re-planned` : ''}` : refused ? `${refused} refused, re-planning` : undefined,
      done: !!p, tone: p?.decision.tier === 'gated' ? 'degraded' : 'accent',
    },
  ]
  if (p?.decision.tier === 'gated') {
    steps.push({ id: 'approve', label: 'Operator approval', detail: p.status === 'rejected' ? 'Rejected' : p.status === 'pending' ? 'Waiting' : 'Approved', done: p.status === 'executing' || p.status === 'complete', fail: p.status === 'rejected', tone: 'degraded' })
  }
  steps.push({
    id: 'ops', label: 'Proximity ops', done: !!ops && tau >= ops.duration,
    detail: ops ? `${Math.round(Math.min(1, Math.max(0, tau / ops.duration)) * 100)}%` : undefined,
    children: ops?.phases.map((ph) => ({ label: ph.label, state: tau >= ph.t1 ? 'done' : tau >= ph.t0 ? 'active' : 'todo' })),
  })
  steps.push({ id: 'recover', label: 'Telemetry back to nominal', done: m.phase === 'resolved' && !m.playing })
  steps.push({ id: 'answer', label: 'Cited assessment written', done: has((e) => e.type === 'answer') })

  // The first unfinished step (in order) is the live one; the assessment can finish out of order.
  const firstOpen = steps.findIndex((s) => !s.done && !s.fail)

  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const st: State = s.fail ? 'fail' : s.done ? 'done' : i === firstOpen && m.phase !== 'idle' ? 'active' : 'todo'
        const last = i === steps.length - 1
        return (
          <li key={s.id} className="relative pb-2.5 pl-5">
            {!last && <span className={`absolute top-3 bottom-0 left-[4px] w-px ${s.done ? 'bg-accent/40' : 'bg-line'}`} aria-hidden />}
            <span className={`absolute top-[5px] left-0 size-[9px] rounded-full border ${DOT[st]} ${st === 'done' && s.tone === 'degraded' ? '!border-degraded !bg-degraded' : ''}`} aria-hidden />
            <div className="flex items-baseline gap-2">
              <span className={`text-[0.72rem] leading-5 ${st === 'todo' ? 'text-faint' : st === 'active' ? 'text-ink' : 'text-ink-2'}`}>{s.label}</span>
              {s.detail && <span className={`ml-auto shrink-0 font-mono text-[0.58rem] ${s.fail ? 'text-failed' : s.tone === 'degraded' && st !== 'todo' ? 'text-degraded' : 'text-muted'}`}>{s.detail}</span>}
            </div>
            {s.children && s.children.length > 0 && st === 'active' && (
              <ul className="mt-1 space-y-px">
                {(() => {
                  // Window around the live phase so long timelines (SWAP has ~16 phases) fit the rail.
                  const a = Math.max(0, s.children.findIndex((c) => c.state === 'active'))
                  const from = Math.max(0, a - 2)
                  return from > 0 ? <li className="text-[0.6rem] leading-4 text-faint">✓ {from} earlier phase{from === 1 ? '' : 's'}</li> : null
                })()}
                {s.children.map((c, j) => ({ c, j })).filter(({ j }, _, all) => {
                  const a = Math.max(0, all.findIndex(({ c }) => c.state === 'active'))
                  return j >= a - 2 && j < a + 4
                }).map(({ c, j }) => (
                  <li key={j} className="flex items-center gap-1.5 text-[0.64rem] leading-4">
                    <span className={c.state === 'done' ? 'text-accent' : c.state === 'active' ? 'lt-pulse text-accent' : 'text-faint'} aria-hidden>{c.state === 'done' ? '✓' : c.state === 'active' ? '▸' : '·'}</span>
                    <span className={`truncate ${c.state === 'todo' ? 'text-faint' : c.state === 'active' ? 'text-ink' : 'text-muted'}`}>{c.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
