'use client'
// The story state machine: sim clock → FDIR wake-up → inspection → agent run → envelope decision → ops → recovery.
//
//   idle ──run()──▶ armed (warp 30×) ──t ≥ first FDIR──▶ waking (1×, captureInspection) ──frames──▶ agent
//   agent ──decision auto──▶ ops (auto-warp: ops plays in ~40 s) ──t ≥ ops end──▶ resolved (30× recovery, then pause)
//   agent ──decision gated──▶ pending (warp to next AOS) ──approve()──▶ ops     ──reject()──▶ agent
//   agent ──decision refused──▶ shown red; the next proposal supersedes it
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { CameraFrame, Decision, FdirEvent, ModuleId, ScenarioId, Segment } from '@/contracts'
import { parseVoiceCommand, type RunSource, type UseAgentRuns } from '@/agent/client'
import type { LatticeSceneHandle } from '@/scene'
import type { Executed, MissionApi } from './api'

export type MissionPhase = 'idle' | 'armed' | 'waking' | 'agent' | 'ops' | 'resolved'
export type Warp = 1 | 30 | 120
export type SceneView = 'overview' | 'follow' | 'servicer'
export type DecisionStatus = 'executing' | 'complete' | 'pending' | 'rejected' | 'refused' | 'superseded'

export interface DecisionEntry {
  key: string // runId:callId
  decision: Decision
  status: DecisionStatus
  /** Mission time the decision arrived. */
  at: number
  /** Mission time its ops started (auto or approved). */
  startT?: number
}

/** Ops play in about this many wall-clock seconds. */
const OPS_WALL_S = 40
/** Seconds of recovery shown after ops end before the clock pauses. */
const RECOVERY_S = 900
/** Give the scene this long to fly around before falling back. */
const CAPTURE_TIMEOUT_MS = 15000

export function useMission({ api, agent, sceneRef }: { api: MissionApi; agent: UseAgentRuns; sceneRef: RefObject<LatticeSceneHandle | null> }) {
  const scenarios = useMemo(() => api.scenarios(), [api])
  const scenarioIds = useMemo(() => api.scenarioIds(), [api])
  const layout = useMemo(() => api.layout(), [api])

  const [scenario, setScenarioState] = useState<ScenarioId>(scenarioIds[0])
  const [phase, setPhase] = useState<MissionPhase>('idle')
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [warp, setWarpState] = useState<Warp>(30)
  const [autoWarp, setAutoWarp] = useState<number | null>(null)
  const [source, setSource] = useState<RunSource>('recorded')
  const [frames, setFrames] = useState<CameraFrame[]>([])
  const [wakeEvent, setWakeEvent] = useState<FdirEvent | null>(null)
  const [entries, setEntries] = useState<DecisionEntry[]>([])
  const [viewOverride, setViewOverride] = useState<SceneView | null>(null)
  const [confirm, setConfirm] = useState<{ key: string; via: 'voice' | 'click'; transcript?: string } | null>(null)

  const def = scenarios[scenario]
  const fdir = useMemo(() => api.fdirEvents(scenario), [api, scenario])
  const wakeAt = useMemo(() => api.wakeEvent?.(scenario) ?? fdir[0], [api, scenario, fdir])

  // ── refs mirrored for the rAF loop ────────────────────────────────────────────────────────────
  const S = useRef({ t: 0, playing: false, warp: 30 as number, autoWarp: null as number | null, phase: 'idle' as MissionPhase, scenario, entries: [] as DecisionEntry[], processed: new Map<string, number>(), source: 'recorded' as RunSource })
  useEffect(() => {
    Object.assign(S.current, { playing, warp, autoWarp, phase, scenario, entries, source })
  }, [playing, warp, autoWarp, phase, scenario, entries, source])
  const agentRef = useRef(agent)
  useEffect(() => { agentRef.current = agent }, [agent])

  const executed: Executed[] = useMemo(
    () => entries.filter((e) => e.startT != null && (e.status === 'executing' || e.status === 'complete')).map((e) => ({ decision: e.decision, startT: e.startT! })),
    [entries],
  )
  const primaryExec = useMemo(() => [...executed].reverse().find((e) => e.decision.action !== 'MIGRATE_WORKLOADS' && e.decision.ops), [executed])
  const opsEnd = primaryExec ? primaryExec.startT + primaryExec.decision.ops!.duration : null

  // ── transitions ───────────────────────────────────────────────────────────────────────────────
  const wake = useCallback(async (ev: FdirEvent) => {
    const sc = S.current.scenario
    S.current.phase = 'waking'
    setPhase('waking')
    setWakeEvent(ev)
    setWarpState(1)
    setAutoWarp(null)
    const mod = scenarios[sc].module
    let shots: CameraFrame[] = []
    try {
      const cap = sceneRef.current?.captureInspection(mod)
      if (cap) shots = await Promise.race([cap, new Promise<CameraFrame[]>((r) => setTimeout(() => r([]), CAPTURE_TIMEOUT_MS))])
    } catch { /* fall through to fallback frames */ }
    if (!shots.length && api.fallbackFrames) shots = api.fallbackFrames(mod)
    if (S.current.scenario !== sc || S.current.phase !== 'waking') return // reset meanwhile
    setFrames(shots)
    S.current.phase = 'agent'
    setPhase('agent')
    void agentRef.current.start({ scenario: sc, frames: shots.length ? shots : undefined, source: S.current.source })
  }, [api, scenarios, sceneRef])

  const beginOps = useCallback((d: Decision, at: number) => {
    if (d.action === 'MIGRATE_WORKLOADS' || !d.ops) return
    S.current.phase = 'ops'
    setPhase('ops')
    setAutoWarp(Math.max(1, d.ops.duration / OPS_WALL_S))
    setPlaying(true)
    void at
  }, [])

  const ingest = useCallback((key: string, d: Decision, at: number) => {
    const prev = S.current.entries
    if (prev.some((e) => e.key === key)) return
    const next = prev.map((e) =>
      e.status === 'refused' && e.decision.params.module === d.params.module && d.action !== 'MIGRATE_WORKLOADS' ? { ...e, status: 'superseded' as const } : e,
    )
    const entry: DecisionEntry = { key, decision: d, at, status: d.tier === 'refused' ? 'refused' : d.tier === 'gated' ? 'pending' : 'executing' }
    if (d.tier === 'auto') entry.startT = at
    next.push(entry)
    S.current.entries = next
    setEntries(next)
    if (d.tier === 'auto') beginOps(d, at)
    if (d.tier === 'gated' && d.nextContact != null && d.nextContact > at) setAutoWarp(60) // fast-forward to the next contact
  }, [beginOps])

  // ── the loop: advance the clock, fire crossings, ingest agent decisions ───────────────────────
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const s = S.current
      if (s.playing) {
        const eff = s.autoWarp ?? s.warp
        let nt = s.t + dt * eff
        const first = wakeAt
        if (s.phase === 'armed' && first && nt >= first.t) { nt = first.t; void wake(first) }
        // gated: stop fast-forward once a human is reachable
        const pending = s.entries.find((e) => e.status === 'pending')
        if (pending && s.autoWarp && pending.decision.nextContact != null && nt >= pending.decision.nextContact) { nt = pending.decision.nextContact; s.autoWarp = null; setAutoWarp(null); setWarpState(1); s.warp = 1 }
        const ex = [...s.entries].reverse().find((e) => e.startT != null && e.status === 'executing' && e.decision.action !== 'MIGRATE_WORKLOADS' && e.decision.ops)
        if (s.phase === 'ops' && ex) {
          const end = ex.startT! + ex.decision.ops!.duration
          if (nt >= end) {
            s.phase = 'resolved'; setPhase('resolved')
            s.autoWarp = 30; setAutoWarp(30)
            const done = s.entries.map((e) => (e.status === 'executing' ? { ...e, status: 'complete' as const } : e))
            s.entries = done; setEntries(done)
          }
        }
        if (s.phase === 'resolved' && ex == null) {
          const last = [...s.entries].reverse().find((e) => e.status === 'complete' && e.decision.ops && e.decision.action !== 'MIGRATE_WORKLOADS')
          if (last && nt >= last.startT! + last.decision.ops!.duration + RECOVERY_S) { s.playing = false; setPlaying(false); s.autoWarp = null; setAutoWarp(null) }
        }
        s.t = nt
        setT(nt)
      }
      // decisions from every run of this mission
      for (const run of agentRef.current.runs) {
        const from = s.processed.get(run.id) ?? 0
        for (let i = from; i < run.events.length; i++) {
          const ev = run.events[i]
          if (ev.type === 'decision') ingest(`${run.id}:${ev.callId}`, ev.decision, s.t)
        }
        s.processed.set(run.id, run.events.length)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [wakeAt, wake, ingest])

  // ── commands ──────────────────────────────────────────────────────────────────────────────────
  const clearState = useCallback(() => {
    agentRef.current.reset()
    S.current.entries = []
    S.current.processed = new Map()
    setEntries([])
    setFrames([])
    setWakeEvent(null)
    setAutoWarp(null)
    setViewOverride(null)
    setConfirm(null)
  }, [])

  const run = useCallback((id?: ScenarioId) => {
    const sc = id ?? S.current.scenario
    clearState()
    const t0 = Math.max(0, scenarios[sc].faultT - 45)
    Object.assign(S.current, { scenario: sc, t: t0, phase: 'armed', playing: true, warp: 30, autoWarp: null })
    setScenarioState(sc)
    setT(t0)
    setPhase('armed')
    setWarpState(30)
    setPlaying(true)
  }, [clearState, scenarios])

  const reset = useCallback(() => {
    clearState()
    Object.assign(S.current, { t: 0, phase: 'idle', playing: false })
    setT(0)
    setPhase('idle')
    setPlaying(false)
  }, [clearState])

  const setScenario = useCallback((id: ScenarioId) => {
    if (S.current.phase === 'idle') { S.current.scenario = id; setScenarioState(id) } else run(id)
  }, [run])

  const setWarp = useCallback((w: Warp) => { setWarpState(w); setAutoWarp(null); S.current.warp = w; S.current.autoWarp = null }, [])
  const togglePlay = useCallback(() => {
    if (S.current.phase === 'idle') return run()
    setPlaying((p) => { S.current.playing = !p; return !p })
  }, [run])

  const approve = useCallback((key: string) => {
    const at = S.current.t
    const next = S.current.entries.map((e) => (e.key === key && e.status === 'pending' ? { ...e, status: 'executing' as const, startT: at } : e))
    const d = next.find((e) => e.key === key)?.decision
    S.current.entries = next
    setEntries(next)
    setConfirm(null)
    if (d) beginOps(d, at)
  }, [beginOps])

  const reject = useCallback((key: string) => {
    const next = S.current.entries.map((e) => (e.key === key && e.status === 'pending' ? { ...e, status: 'rejected' as const } : e))
    S.current.entries = next
    setEntries(next)
    setConfirm(null)
    setAutoWarp(null)
  }, [])

  const ask = useCallback((question: string) => {
    if (S.current.phase === 'idle') return
    void agentRef.current.start({ scenario: S.current.scenario, question, source: 'live' })
  }, [])

  /** Voice: "approve …" opens the confirm dialog for the pending decision; "reject …" rejects; anything else is a question. */
  const voice = useCallback((text: string) => {
    const pending = S.current.entries.find((e) => e.status === 'pending')
    const cmd = parseVoiceCommand(text)
    if (cmd.kind === 'empty') return
    if (pending && cmd.kind === 'approve') return setConfirm({ key: pending.key, via: 'voice', transcript: text })
    if (pending && cmd.kind === 'reject') return reject(pending.key)
    ask(text)
  }, [ask, reject])

  const requestApprove = useCallback((key: string) => setConfirm({ key, via: 'click' }), [])

  // ── derived view state ────────────────────────────────────────────────────────────────────────
  const modules = useMemo(() => api.lattice(scenario, phase === 'idle' ? 0 : t, executed), [api, scenario, t, executed, phase])
  const latticeUtil = useMemo(() => {
    const ring = layout.modules.filter((m) => m.slot != null).map((m) => m.id)
    const extra = Object.entries(modules).filter(([id, m]) => !ring.includes(id) && m.status === 'nominal').map(([id]) => id)
    const ids = [...ring, ...extra]
    return ids.reduce((a, id) => a + (modules[id]?.util ?? 0), 0) / 12
  }, [layout, modules])

  const contact = useMemo(() => {
    const now = def.contacts.find((c) => t >= c.aos && t < c.los)
    const next = def.contacts.filter((c) => c.aos > t).sort((a, b) => a.aos - b.aos)[0]
    return { inContact: !!now, station: now?.station ?? next?.station ?? '', nextAos: next?.aos ?? null, los: now?.los ?? null }
  }, [def, t])

  const pose = useMemo(() => {
    if (!primaryExec) return api.poseAt(null, 0)
    return api.poseAt(primaryExec.decision.ops!, Math.max(0, t - primaryExec.startT))
  }, [api, primaryExec, t])

  const runs = agent.runs
  const segments: Segment[] = useMemo(() => {
    const out: Segment[] = []
    for (const r of runs) for (const e of r.events) if (e.type === 'segments') out.push(...e.segments)
    return out
  }, [runs])

  const primary = useMemo(() => [...entries].reverse().find((e) => e.decision.action !== 'MIGRATE_WORKLOADS') ?? entries[entries.length - 1] ?? null, [entries])
  const supersededRefusal = useMemo(() => {
    if (!primary || primary.status === 'refused') return null
    return [...entries].reverse().find((e) => e.status === 'superseded' && e.decision.params.module === primary.decision.params.module) ?? null
  }, [entries, primary])
  const migration = useMemo(() => entries.find((e) => e.decision.action === 'MIGRATE_WORKLOADS') ?? null, [entries])
  const pending = entries.find((e) => e.status === 'pending') ?? null

  const view: SceneView = viewOverride ?? (phase === 'ops' ? 'follow' : 'overview')
  const focus: ModuleId | null = phase === 'idle' ? null : def.module
  const damage = phase !== 'idle' && t >= def.faultT ? scenario : null

  return {
    api, layout, scenarios, scenarioIds, scenario, def, setScenario, fdir,
    phase, t, playing, togglePlay, warp, effectiveWarp: autoWarp ?? warp, autoWarping: autoWarp != null, setWarp,
    source, setSource, run, reset, ask, voice,
    frames, wakeEvent, segments, runs, agentRunning: agent.running,
    entries, primary, supersededRefusal, migration, pending, approve, reject, requestApprove,
    confirm, cancelConfirm: () => setConfirm(null),
    modules, latticeUtil, contact, pose, view, setView: setViewOverride, focus, damage,
    executed, primaryExec, opsEnd, resolvedAt: opsEnd ?? undefined,
  }
}

export type Mission = ReturnType<typeof useMission>
