'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from 'react'
import type { Citation, Generation, ModuleId } from '@/contracts'
import type { UseAgentRuns } from '@/agent/client'
import type { LatticeSceneHandle, LatticeSceneProps } from '@/scene'
import type { MissionApi } from '@/ui/api'
import { useMission } from '@/ui/use-mission'
import { CameraFeed } from './camera-feed'
import { ConfirmDialog } from './confirm-dialog'
import { DecisionCard } from './decision-card'
import { FleetPanel } from './fleet-panel'
import { Hero } from './hero'
import { RecordDrawer } from './record-drawer'
import { ScenarioRail, type RailTab } from './scenario-rail'
import { Telemetry } from './telemetry'
import { TopBar } from './top-bar'
import { TracePane } from './trace/trace-pane'
import { VoiceButton } from './voice-button'

export type SceneComponent = ComponentType<LatticeSceneProps & { ref?: Ref<LatticeSceneHandle> }>

function AskBox({ onSubmit, disabled }: { onSubmit: (text: string) => void; disabled?: boolean }) {
  const [v, setV] = useState('')
  return (
    <form
      className="flex items-center gap-2 border-t border-line px-3 py-2.5"
      onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); setV('') } }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        disabled={disabled}
        placeholder={disabled ? 'Run a scenario to talk to the agent' : 'Ask the agent, or say “approve”…'}
        className="min-w-0 flex-1 rounded-lg border border-line bg-sunken px-3 py-2 text-[0.76rem] text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none disabled:opacity-50"
        aria-label="Ask the agent"
      />
      <VoiceButton onTranscript={onSubmit} disabled={disabled} />
    </form>
  )
}

export function Console({ api, agent, Scene, mock }: { api: MissionApi; agent: UseAgentRuns; Scene: SceneComponent; mock?: boolean }) {
  const sceneRef = useRef<LatticeSceneHandle | null>(null)
  const m = useMission({ api, agent, sceneRef })
  const [tab, setTab] = useState<RailTab>('scenarios')
  const [openId, setOpenId] = useState<string | null>(null)

  // ── fleet scrubber ──
  const fleet = useMemo(() => api.fleetTimeline(), [api])
  const [yearIdx, setYearIdx] = useState(0)
  const [fleetPlaying, setFleetPlaying] = useState(false)
  useEffect(() => {
    if (!fleetPlaying) return
    const h = window.setInterval(() => setYearIdx((i) => {
      if (i >= fleet.length - 1) { setFleetPlaying(false); return i }
      return i + 1
    }), 1100)
    return () => window.clearInterval(h)
  }, [fleetPlaying, fleet.length])
  const fleetMode = tab === 'fleet'
  const generations = useMemo(() => {
    if (!fleetMode || !fleet[yearIdx]) return undefined
    const g: Record<ModuleId, Generation> = {}
    for (const fm of fleet[yearIdx].modules) g[fm.module] = fm.generation
    return g
  }, [fleetMode, fleet, yearIdx])

  // ── citations from every run (for WEB urls and drawer labels) ──
  const citations = useMemo(() => {
    const map = new Map<string, Citation>()
    for (const r of m.runs) for (const e of r.events) {
      if (e.type === 'tool_result' || e.type === 'answer' || e.type === 'vision') for (const c of e.citations) map.set(c.id, c)
    }
    return map
  }, [m.runs])
  const open = useCallback((id: string) => {
    const c = citations.get(id)
    if (id.startsWith('WEB-') && c?.url) window.open(c.url, '_blank', 'noopener,noreferrer')
    else setOpenId(id)
  }, [citations])

  const idle = m.phase === 'idle'
  const showMission = !idle && !fleetMode
  const confirmEntry = m.confirm ? m.entries.find((e) => e.key === m.confirm!.key) : null
  const banner =
    m.phase === 'waking' ? `Agent waking · ${m.wakeEvent?.id ?? ''} · fly-around inspection`
    : m.phase === 'agent' && !m.primary && m.agentRunning ? `Agent reasoning · ${m.wakeEvent?.id ?? ''}`
    : null

  return (
    <div className="relative flex min-h-dvh flex-col lg:block lg:h-dvh lg:min-h-0 lg:overflow-hidden">
      <TopBar m={m} mock={mock} />

      {/* ── scene ── */}
      <div className="relative order-1 h-[50vh] shrink-0 lg:absolute lg:inset-0 lg:h-auto">
        <Scene
          ref={sceneRef}
          className="absolute inset-0"
          layout={m.layout}
          pose={m.pose}
          modules={m.modules}
          focus={fleetMode ? null : m.focus}
          damage={fleetMode ? null : m.damage}
          markers={m.segments}
          view={fleetMode ? 'overview' : m.view}
          generations={generations}
        />
        {/* hero: first frame of the video */}
        {idle && !fleetMode && (
          <div className="pointer-events-none absolute inset-0 flex items-end bg-[linear-gradient(90deg,rgba(5,7,11,0.75)_0%,rgba(5,7,11,0.25)_45%,transparent_70%)] p-5 pb-8 lg:pt-[68px] lg:pr-[24px] lg:pb-16 lg:pl-[332px]">
            <Hero onRun={() => m.run()} onFleet={() => setTab('fleet')} title={m.def.title} />
          </div>
        )}
        {banner && (
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center lg:top-auto lg:bottom-[184px] lg:pr-[464px] lg:pl-[308px]">
            <span className="glass lt-rise flex items-center gap-2 rounded-full px-3.5 py-1.5 font-mono text-[0.66rem] text-ink">
              <span className="lt-pulse size-1.5 rounded-full bg-accent" />{banner}
            </span>
          </div>
        )}
      </div>

      {/* ── left rail ── */}
      <aside className="glass relative z-10 order-3 m-3 rounded-xl lg:absolute lg:top-[68px] lg:bottom-3 lg:left-0 lg:m-0 lg:ml-3 lg:w-[284px]">
        <ScenarioRail m={m} tab={tab} setTab={setTab} />
      </aside>

      {/* ── centre: overlays over the scene + bottom strip ── */}
      <main className="pointer-events-none relative z-10 order-2 flex flex-col gap-3 px-3 lg:absolute lg:top-[68px] lg:right-[464px] lg:bottom-3 lg:left-[308px] lg:px-0">
        {showMission && (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="pointer-events-auto w-full lg:w-[min(420px,52%)]">
              {(m.phase !== 'armed' || m.frames.length > 0) && <CameraFeed frames={m.frames} segments={m.segments} capturing={m.phase === 'waking'} onOpen={open} />}
            </div>
            <div className="pointer-events-auto w-full lg:w-[min(372px,46%)]">
              <DecisionCard m={m} onOpen={open} />
            </div>
          </div>
        )}
        <div className="hidden flex-1 lg:block" />
        {showMission && (
          <section className="glass pointer-events-auto rounded-xl px-4 pt-3 pb-3.5">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="eyebrow">Telemetry · {m.def.module}</span>
              <span className="ml-auto hidden items-center gap-3 font-mono text-[0.58rem] text-faint sm:flex">
                <span className="flex items-center gap-1"><span className="h-0 w-3 border-t border-dashed border-muted" />nominal</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-accent" />actual</span>
                <span className="flex items-center gap-1"><span className="h-0 w-3 border-t border-dotted border-failed" />limit</span>
                <span className="text-degraded">▾ FDIR</span>
              </span>
            </div>
            <Telemetry m={m} onOpen={open} />
          </section>
        )}
        {fleetMode && fleet.length > 0 && (
          <section className="glass pointer-events-auto rounded-xl p-4 lg:mr-[-120px] lg:max-w-[900px]">
            <FleetPanel fleet={fleet} idx={yearIdx} setIdx={(i) => { setFleetPlaying(false); setYearIdx(i) }} playing={fleetPlaying} togglePlay={() => { if (yearIdx >= fleet.length - 1) setYearIdx(0); setFleetPlaying((p) => !p) }} />
          </section>
        )}
      </main>

      {/* ── right: agent trace ── */}
      {!fleetMode && (
        <aside className={`glass relative z-10 order-4 m-3 flex h-[78vh] flex-col overflow-hidden rounded-xl transition-opacity duration-700 lg:absolute lg:top-[68px] lg:right-0 lg:bottom-3 lg:m-0 lg:mr-3 lg:h-auto lg:w-[440px] ${idle ? 'lg:pointer-events-none lg:opacity-0' : 'opacity-100'}`}>
          <div className="min-h-0 flex-1">
            <TracePane runs={m.runs} frames={m.frames} onOpen={open} idleHint={m.phase === 'armed' ? 'Sleeping. Onboard FDIR is watching the telemetry; the agent wakes on the first event.' : undefined} />
          </div>
          <AskBox onSubmit={m.voice} disabled={idle} />
        </aside>
      )}

      <RecordDrawer id={openId} m={m} citations={citations} onClose={() => setOpenId(null)} onOpen={open} />
      {m.confirm && confirmEntry && (
        <ConfirmDialog decision={confirmEntry.decision} via={m.confirm.via} transcript={m.confirm.transcript} onConfirm={() => m.approve(m.confirm!.key)} onCancel={m.cancelConfirm} />
      )}
    </div>
  )
}
