'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import type { AgentEvent, CameraFrame, PlanStep, Tier } from '@/contracts'
import type { AgentRun } from '@/agent/client'
import { ACTION_LABEL } from '@/ui/format'
import { FrameOverlay } from '../frame-overlay'
import { CitationChip } from './citation-chip'
import { Markdown } from './markdown'
import { ModelBadge } from './model-badge'

type Ev<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>

export const TIER_PILL: Record<Tier, string> = {
  auto: 'border-accent/40 bg-accent-soft text-accent',
  gated: 'border-degraded/40 bg-degraded-soft text-degraded',
  refused: 'border-failed/40 bg-failed-soft text-failed',
}

function fmtArg(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function Args({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args)
  if (!entries.length) return null
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[0.66rem] leading-[1.1rem]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="min-w-0 truncate text-ink-2" title={fmtArg(v)}>{fmtArg(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Plan({ steps, called, answered }: { steps: PlanStep[]; called: string[]; answered: boolean }) {
  const remaining = [...called]
  const done = steps.map((s) => {
    const i = remaining.indexOf(s.tool)
    if (i < 0) return false
    remaining.splice(i, 1)
    return true
  })
  const next = done.indexOf(false)
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2 text-[0.75rem] leading-5">
          <span className={`mt-[5px] size-2.5 shrink-0 rounded-full border ${done[i] ? 'border-accent bg-accent' : i === next ? 'lt-pulse border-accent' : 'border-line-2'}`} aria-hidden />
          <span className={done[i] ? 'text-muted' : 'text-ink-2'}>{s.goal}</span>
          <code className="ml-auto shrink-0 font-mono text-[0.62rem] leading-5 text-faint">{s.tool}</code>
        </li>
      ))}
      <li className="flex items-start gap-2 text-[0.75rem] leading-5">
        <span className={`mt-[5px] size-2.5 shrink-0 rounded-full border ${answered ? 'border-accent bg-accent' : 'border-line-2'}`} aria-hidden />
        <span className={answered ? 'text-muted' : 'text-ink-2'}>Write a cited answer</span>
      </li>
    </ol>
  )
}

function Rail({ children, dot = 'bg-line-2', last }: { children: React.ReactNode; dot?: string; last?: boolean }) {
  return (
    <li className="lt-rise relative pl-5">
      {!last && <span className="absolute top-3 bottom-[-12px] left-[4.5px] w-px bg-line" aria-hidden />}
      <span className={`absolute top-[7px] left-0 size-2.5 rounded-full border-2 border-bg ${dot}`} aria-hidden />
      {children}
    </li>
  )
}

function ToolStep({ call, result, vision, segs, frames, onOpen }: {
  call: Ev<'tool_call'>; result?: Ev<'tool_result'>; vision?: Ev<'vision'>; segs?: Ev<'segments'>; frames: CameraFrame[]; onOpen: (id: string) => void
}) {
  const frameId = vision?.frame ?? segs?.frame
  const frame = frames.find((f) => f.id === frameId)
  return (
    <div className={`rounded-lg border px-3 py-2.5 transition-colors ${result ? 'border-line bg-sunken' : 'border-accent/40 bg-accent-soft/40'}`}>
      <div className="flex items-center gap-2">
        <code className="font-mono text-[0.74rem] font-medium text-ink">{call.name}</code>
        <ModelBadge model={call.model} effort={call.effort} tool={call.name} />
        <span className="ml-auto font-mono text-[0.62rem] text-faint">{result ? `${result.ms.toLocaleString()} ms` : <span className="lt-pulse text-accent">running</span>}</span>
      </div>
      <Args args={call.args} />
      {frame && (vision || segs) && (
        <div className="mt-2.5 w-[62%] overflow-hidden rounded-md border border-line">
          <FrameOverlay frame={frame} segments={segs?.segments} compact />
        </div>
      )}
      {vision && <p className="mt-2 text-[0.74rem] leading-5 text-ink-2">{vision.findings}</p>}
      {segs && (
        <ul className="mt-2 space-y-0.5 font-mono text-[0.66rem]">
          {segs.segments.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <CitationChip id={s.id} onOpen={onOpen} />
              <span className="text-ink-2">{s.concept}</span>
              {s.confidence != null && <span className="text-faint">{s.confidence.toFixed(2)}</span>}
              {s.feature && <span className={`ml-auto ${s.feature.id === 'damage' ? 'text-failed' : 'text-muted'}`}>{s.feature.distance.toFixed(2)} m from {s.feature.id}</span>}
            </li>
          ))}
        </ul>
      )}
      {result && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-[0.74rem] leading-5 text-ink-2"><span className="text-faint">→ </span>{result.summary}</p>
          {result.citations.length > 0 && (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {result.citations.slice(0, 10).map((c) => <CitationChip key={c.id} id={c.id} title={c.label} onOpen={onOpen} />)}
              {result.citations.length > 10 && <span className="self-center font-mono text-[0.62rem] text-faint">+{result.citations.length - 10}</span>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const RunView = memo(function RunView({ run, frames, onOpen }: { run: AgentRun; frames: CameraFrame[]; onOpen: (id: string) => void }) {
  const ev = run.events
  const idx = useMemo(() => {
    const results = new Map<string, Ev<'tool_result'>>()
    const vision = new Map<string, Ev<'vision'>>()
    const segs = new Map<string, Ev<'segments'>>()
    for (const e of ev) {
      if (e.type === 'tool_result') results.set(e.callId, e)
      if (e.type === 'vision') vision.set(e.callId, e)
      if (e.type === 'segments') segs.set(e.callId, e)
    }
    return { results, vision, segs }
  }, [ev])
  const start = ev.find((e): e is Ev<'run_start'> => e.type === 'run_start')
  const plan = ev.find((e): e is Ev<'plan'> => e.type === 'plan')
  const answer = ev.find((e): e is Ev<'answer'> => e.type === 'answer')
  const streaming = answer ? null : ev.filter((e): e is Ev<'answer_delta'> => e.type === 'answer_delta').map((e) => e.text).join('')
  const called = [...idx.results.values()].map((r) => r.name)

  const items: React.ReactNode[] = []
  ev.forEach((e, i) => {
    if (e.type === 'thinking') {
      items.push(
        <Rail key={i}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[0.72rem] text-muted hover:text-ink-2">
              <span>Reasoning · {e.label}</span>
              <ModelBadge model={e.model} effort={e.effort} />
              <span className="ml-auto font-mono text-[0.6rem] text-faint group-open:hidden">show</span>
            </summary>
            <p className="mt-1.5 text-[0.72rem] leading-5 whitespace-pre-wrap text-ink-2">{e.text}</p>
          </details>
        </Rail>,
      )
    } else if (e.type === 'tool_call') {
      items.push(
        <Rail key={i} dot={idx.results.has(e.callId) ? 'bg-ink-2' : 'bg-accent lt-pulse'}>
          <ToolStep call={e} result={idx.results.get(e.callId)} vision={idx.vision.get(e.callId)} segs={idx.segs.get(e.callId)} frames={frames} onOpen={onOpen} />
        </Rail>,
      )
    } else if (e.type === 'decision') {
      const d = e.decision
      const failed = d.checks.filter((c) => !c.pass)
      items.push(
        <Rail key={i} dot={d.tier === 'auto' ? 'bg-accent' : d.tier === 'gated' ? 'bg-degraded' : 'bg-failed'}>
          <div className="flex flex-wrap items-center gap-2 text-[0.74rem]">
            <span className="text-muted">Envelope</span>
            <span className="text-ink">{ACTION_LABEL[d.action]} {d.params.module}</span>
            <span className={`rounded-[5px] border px-1.5 font-mono text-[0.6rem] leading-[1.1rem] tracking-wider uppercase ${TIER_PILL[d.tier]}`}>{d.tier}</span>
            <span className="ml-auto font-mono text-[0.62rem] text-faint">{d.checks.length - failed.length}/{d.checks.length} checks</span>
          </div>
          {failed.length > 0 && <p className="mt-1 text-[0.7rem] leading-5 text-failed">✗ {failed.map((c) => c.detail).join(' · ')}</p>}
        </Rail>,
      )
    } else if (e.type === 'notice') {
      items.push(<Rail key={i} dot="bg-degraded"><p className="text-[0.72rem] leading-5 text-degraded">{e.message}</p></Rail>)
    } else if (e.type === 'error') {
      items.push(<Rail key={i} dot="bg-failed"><p className="text-[0.72rem] leading-5 text-failed">{e.message}</p></Rail>)
    }
  })

  const text = answer?.markdown ?? streaming
  const decided = ev.some((e) => e.type === 'decision')
  const writing = run.status === 'running' && decided && !text
  return (
    <section className="space-y-4">
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="eyebrow">{run.question ? 'Operator question' : 'Autonomous wake-up'}</span>
          <span className="eyebrow ml-auto text-faint">{run.source === 'live' ? 'Live Muse' : 'Recorded run'}</span>
        </div>
        {run.question ? (
          <p className="text-[0.82rem] text-ink">“{run.question}”</p>
        ) : start ? (
          <p className="text-[0.8rem] leading-5 text-ink-2">
            <CitationChip id={start.event.id} onOpen={onOpen} /> <span className="text-ink">{start.event.summary}</span>
          </p>
        ) : (
          run.status === 'running' ? <p className="lt-pulse text-[0.8rem] text-muted">Waking…</p> : null
        )}
      </header>

      {plan && (
        <div className="rounded-lg border border-line px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="eyebrow">Plan</span>
            {start?.models.planner && <ModelBadge model={start.models.planner.model} effort={start.models.planner.effort} />}
          </div>
          <Plan steps={plan.steps} called={called} answered={!!answer} />
        </div>
      )}

      {items.length > 0 && <ol className="space-y-3">{items}</ol>}

      {writing && (
        <div className="lt-rise rounded-lg border border-line px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Assessment</span>
            {start?.models.answer && <ModelBadge model={start.models.answer.model} effort={start.models.answer.effort} />}
            <span className="lt-pulse ml-auto font-mono text-[0.6rem] text-accent">writing</span>
          </div>
          <div className="mt-3 space-y-2" aria-hidden>
            {[92, 78, 85].map((w, i) => <div key={i} className="lt-pulse h-2 rounded bg-line" style={{ width: `${w}%`, animationDelay: `${i * 0.2}s` }} />)}
          </div>
        </div>
      )}

      {text && (
        <div className="lt-rise rounded-lg border border-line-2 bg-panel-solid/60 px-3.5 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="eyebrow">Assessment</span>
            {start?.models.answer && <ModelBadge model={start.models.answer.model} effort={start.models.answer.effort} />}
            {answer && (
              <span className={`ml-auto font-mono text-[0.6rem] ${answer.unknownIds.length ? 'text-failed' : 'text-muted'}`}>
                {answer.unknownIds.length ? `${answer.unknownIds.length} uncited id(s)` : `${answer.citations.length} citations · all from tools`}
              </span>
            )}
          </div>
          <Markdown text={text} onOpen={onOpen} unknownIds={answer?.unknownIds} />
          {!answer && <span className="lt-pulse ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-accent" aria-hidden />}
        </div>
      )}
    </section>
  )
})

export function usageTotals(runs: AgentRun[]) {
  let prompt = 0, completion = 0, reasoning = 0, cost = 0, ms = 0, calls = 0
  for (const r of runs) {
    const done = r.events.find((e): e is Ev<'done'> => e.type === 'done')
    let rMs = 0
    for (const e of r.events) {
      if (e.type === 'usage') {
        prompt += e.usage.promptTokens; completion += e.usage.completionTokens; reasoning += e.usage.reasoningTokens ?? 0
        cost += e.usage.costUsd; rMs += e.usage.ms; calls++
      }
    }
    ms += done?.totals.ms ?? rMs
  }
  return { prompt, completion, reasoning, cost, ms, calls }
}

export function TracePane({ runs, frames, onOpen, idleHint }: { runs: AgentRun[]; frames: CameraFrame[]; onOpen: (id: string) => void; idleHint?: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const userScroll = useRef(0)
  const sig = runs.map((r) => r.events.length).join(',')
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [sig])
  // Images and markdown change height after render: keep following the bottom while pinned.
  useEffect(() => {
    const el = scroller.current, inner = content.current
    if (!el || !inner) return
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight })
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])
  const u = usageTotals(runs)
  const running = runs.some((r) => r.status === 'running')
  const cur = runs[runs.length - 1]
  const status = !cur ? null
    : cur.status === 'error' ? 'error'
    : cur.status !== 'running' ? 'done'
    : cur.events.some((e) => e.type === 'answer_delta') ? 'writing assessment'
    : cur.events.some((e) => e.type === 'decision') ? 'drafting assessment'
    : cur.events.some((e) => e.type === 'tool_call') ? 'investigating'
    : 'waking'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[0.78rem] font-medium text-ink">Agent trace</h2>
        {running ? (
          <span className="flex items-center gap-1.5 font-mono text-[0.62rem] text-accent"><span className="lt-pulse size-1.5 rounded-full bg-accent" />{status}</span>
        ) : status ? (
          <span className={`font-mono text-[0.62rem] ${status === 'error' ? 'text-failed' : 'text-muted'}`}>{status === 'done' ? 'run complete' : status}</span>
        ) : null}
      </div>
      <div
        ref={scroller}
        // Only a user gesture can unpin: content growth and scroll anchoring must not stop the follow.
        onWheel={() => { userScroll.current = Date.now() }}
        onTouchMove={() => { userScroll.current = Date.now() }}
        onPointerDown={() => { userScroll.current = Date.now() }}
        onKeyDown={() => { userScroll.current = Date.now() }}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          if (atBottom) pinned.current = true
          else if (Date.now() - userScroll.current < 600) pinned.current = false
        }}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-4 [overflow-anchor:none]"
      >
        <div ref={content} className="space-y-8">
        {runs.length === 0 ? (
          <p className="max-w-[34ch] text-[0.78rem] leading-6 text-muted">{idleHint ?? 'Nothing to do. The agent sleeps until onboard FDIR raises an event.'}</p>
        ) : (
          runs.map((r) => <RunView key={r.id} run={r} frames={frames} onOpen={onOpen} />)
        )}
        </div>
      </div>
      {u.calls > 0 && (
        <footer className="grid grid-cols-4 gap-2 border-t border-line px-4 py-2.5 font-mono text-[0.62rem] text-muted">
          <span title="Prompt + completion tokens"><span className="text-ink-2">{(u.prompt + u.completion).toLocaleString()}</span> tok</span>
          <span title="Reasoning tokens"><span className="text-ink-2">{u.reasoning.toLocaleString()}</span> reasoning</span>
          <span title="Estimated cost at $1.25 / $4.25 per M tokens"><span className="text-ink-2">${u.cost.toFixed(4)}</span></span>
          <span className="text-right" title="Wall time"><span className="text-ink-2">{(u.ms / 1000).toFixed(1)}</span> s</span>
        </footer>
      )}
    </div>
  )
}
