'use client'
// Client hook for agent runs: stream NDJSON from /api/agent live, or replay /recordings/<scenario>.json.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, CameraFrame, ScenarioId } from '@/contracts'

export type RunSource = 'live' | 'recorded'
export interface AgentRun {
  id: string
  scenario: ScenarioId
  question?: string
  source: RunSource
  events: AgentEvent[]
  status: 'running' | 'done' | 'error'
}

export interface UseAgentRuns {
  runs: AgentRun[]
  running: boolean
  /** Start the autonomous wake-up run (or a follow-up question). Recorded = replay /recordings/<scenario>.json with original pacing. */
  start(opts: { scenario: ScenarioId; frames?: CameraFrame[]; question?: string; source: RunSource }): Promise<void>
  stop(): void
  reset(): void
}

/** A recording (scripts/record.ts): every event with `dt`, the milliseconds since the previous event. */
export type Recording = { dt: number; event: AgentEvent }[]

export interface ReplayOptions {
  /** Playback speed: 1 = original pacing, 4 = four times faster. */
  speed?: number
  /** Cap any single wait (ms, after speed-up), e.g. to skip long model pauses in a demo. */
  maxGapMs?: number
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

/** Parse NDJSON lines into events, carrying the incomplete tail. */
export function parseNdjson(buffer: string): { events: AgentEvent[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const events: AgentEvent[] = []
  for (const l of lines) {
    if (!l.trim()) continue
    try { events.push(JSON.parse(l) as AgentEvent) } catch { /* skip a corrupt line */ }
  }
  return { events, rest }
}

/** The answer text so far: the final answer if present, else the streamed deltas. */
export function answerText(run: Pick<AgentRun, 'events'>): string {
  const final = run.events.findLast((e) => e.type === 'answer')
  if (final?.type === 'answer') return final.markdown
  return run.events.map((e) => (e.type === 'answer_delta' ? e.text : '')).join('')
}

export function useAgentRuns(options: ReplayOptions = {}): UseAgentRuns {
  const [runs, setRuns] = useState<AgentRun[]>([])
  const abort = useRef<AbortController | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const active = useRef<string | null>(null)
  const opts = useRef(options)
  opts.current = options

  const patch = useCallback((id: string, fn: (r: AgentRun) => AgentRun) => setRuns((rs) => rs.map((r) => (r.id === id ? fn(r) : r))), [])
  const append = useCallback((id: string, events: AgentEvent[]) => {
    if (!events.length) return
    patch(id, (r) => {
      let status = r.status
      for (const e of events) {
        if (e.type === 'done') status = 'done'
        else if (e.type === 'error') status = 'error'
      }
      return { ...r, events: [...r.events, ...events], status }
    })
  }, [patch])

  const clearTimers = () => { for (const t of timers.current) clearTimeout(t); timers.current = [] }

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    clearTimers()
    const id = active.current
    active.current = null
    if (id) patch(id, (r) => (r.status === 'running' ? { ...r, status: 'done', events: [...r.events, { type: 'notice', message: 'Stopped by operator.' }] } : r))
  }, [patch])

  const reset = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    clearTimers()
    active.current = null
    setRuns([])
  }, [])

  useEffect(() => () => { abort.current?.abort(); clearTimers() }, [])

  const start = useCallback<UseAgentRuns['start']>(async ({ scenario, frames, question, source }) => {
    if (active.current) stop()
    const id = newId()
    active.current = id
    setRuns((rs) => [...rs, { id, scenario, ...(question ? { question } : {}), source, events: [], status: 'running' }])
    const fail = (message: string) => append(id, [{ type: 'error', message }])

    if (source === 'recorded') {
      let rec: Recording
      try {
        const res = await fetch(`/recordings/${scenario}.json`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`No recorded run for ${scenario} (${res.status})`)
        rec = (await res.json()) as Recording
        if (!Array.isArray(rec)) throw new Error('Recording is malformed')
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Could not load the recorded run')
        if (active.current === id) active.current = null
        return
      }
      const speed = Math.max(0.1, opts.current.speed ?? 1)
      await new Promise<void>((resolve) => {
        let at = 0
        // Group events that fall in the same tick so a burst of answer deltas costs one render.
        const batches = new Map<number, AgentEvent[]>()
        for (const { dt, event } of rec) {
          let gap = Math.max(0, dt) / speed
          if (opts.current.maxGapMs !== undefined) gap = Math.min(gap, opts.current.maxGapMs)
          at += gap
          const slot = Math.round(at / 16) * 16
          batches.set(slot, [...(batches.get(slot) ?? []), event])
        }
        for (const [slot, events] of batches) {
          timers.current.push(setTimeout(() => { if (active.current === id) append(id, events) }, slot))
        }
        timers.current.push(setTimeout(() => {
          if (active.current === id) {
            patch(id, (r) => (r.status === 'running' ? { ...r, status: 'done' } : r))
            active.current = null
          }
          resolve()
        }, at + 50))
      })
      return
    }

    const controller = new AbortController()
    abort.current = controller
    try {
      const res = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ scenario, ...(frames?.length ? { frames } : {}), ...(question ? { question } : {}) }),
      })
      if (!res.body) { fail(`Request failed (${res.status})`); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let sawEvent = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseNdjson(buffer)
        buffer = rest
        if (events.length) sawEvent = true
        if (active.current === id) append(id, events)
      }
      const tail = parseNdjson(buffer + '\n').events
      if (tail.length) { sawEvent = true; append(id, tail) }
      if (!sawEvent && !res.ok) fail(`Request failed (${res.status})`)
      patch(id, (r) => (r.status === 'running' ? { ...r, status: res.ok ? 'done' : 'error' } : r))
    } catch (e) {
      if (!controller.signal.aborted) fail(e instanceof Error ? e.message : 'Network error')
    } finally {
      if (abort.current === controller) abort.current = null
      if (active.current === id) active.current = null
    }
  }, [append, patch, stop])

  return { runs, running: runs.some((r) => r.status === 'running'), start, stop, reset }
}

// ─── Voice commands ───────────────────────────────────────────────────────────────────────────────

export type VoiceCommand = { kind: 'approve' } | { kind: 'reject' } | { kind: 'question'; text: string } | { kind: 'empty' }

const APPROVE = /^(?:(?:yes|ok(?:ay)?|confirm(?:ed)?|copy|roger)[,.!\s]*)?(?:i\s+)?(?:approve[ds]?|approval granted|confirm(?:ed)?|go(?: ahead)?|proceed|execute|authori[sz]e[ds]?|green light|you(?:'re| are) go|go for (?:it|swap|repair|deorbit))\b/
const REJECT = /^(?:(?:no|negative)[,.!\s]*)?(?:reject(?:ed)?|deny|denied|abort|cancel|stop|hold|no[- ]go|do not (?:approve|proceed)|don'?t (?:approve|proceed)|veto)\b/

/**
 * Turn a transcript into an operator command. Approve/reject only when the utterance leads with the command
 * ("approve", "approve the swap, bring in spare S-1", "no-go", "don't approve"); anything else is a question.
 */
export function parseVoiceCommand(transcript: string): VoiceCommand {
  const text = transcript.trim().replace(/\s+/g, ' ')
  const t = text.toLowerCase().replace(/[“”"]/g, '')
  if (!t.replace(/[^a-z0-9]/g, '')) return { kind: 'empty' }
  if (/\?\s*$/.test(t) || /^(?:why|what|how|when|where|which|who|is|are|can|could|should|would|will|does|do you|did|explain|tell me)\b/.test(t)) return { kind: 'question', text }
  if (REJECT.test(t)) return { kind: 'reject' }
  if (APPROVE.test(t)) return { kind: 'approve' }
  if (/^(?:yes|yep|affirmative)\b[.!]?$/.test(t)) return { kind: 'approve' }
  if (/^(?:no|nope|negative)\b[.!]?$/.test(t)) return { kind: 'reject' }
  return { kind: 'question', text }
}
