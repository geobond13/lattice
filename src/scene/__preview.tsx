'use client'
// Dev-only scene preview (mounted at /scene-preview). Fake REPAIR-like poses from __fixtures, view/scenario
// switches, and an inspection-capture button that shows the JPEGs and their pinhole cameras.
// URL params (for Playwright): ?scenario=radiator-puncture&view=overview&t=20&paused=1&quality=high&focus=1
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CameraFrame, Generation, ScenarioId, Segment } from '@/contracts'
import { LatticeScene, type LatticeSceneHandle } from './index'
import { featuresOf, findModule, localToWorld } from './geometry'
import { failingModule, fixtureLayout, fixtureModules, fixturePose } from './__fixtures'

type View = 'overview' | 'follow' | 'servicer'
const SCENARIOS: ScenarioId[] = ['radiator-puncture', 'power-bus-short', 'thruster-stuck']

declare global {
  interface Window { __lattice?: { capture: () => Promise<CameraFrame[]>; set: (s: Partial<{ view: View; scenario: ScenarioId | null; t: number; paused: boolean; markers: boolean; focus: boolean }>) => void } }
}

export function ScenePreview() {
  const layout = useMemo(() => fixtureLayout(), [])
  const scene = useRef<LatticeSceneHandle>(null)
  const [view, setView] = useState<View>('overview')
  const [scenario, setScenario] = useState<ScenarioId | null>('radiator-puncture')
  const [focusOn, setFocusOn] = useState(true)
  const [tau, setTau] = useState(0)
  const [paused, setPaused] = useState(false)
  const [quality, setQuality] = useState<'high' | 'low'>('high')
  const [frames, setFrames] = useState<CameraFrame[]>([])
  const [showMarkers, setShowMarkers] = useState(false)
  const [genYear, setGenYear] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    /* eslint-disable react-hooks/set-state-in-effect */
    if (q.get('view')) setView(q.get('view') as View)
    if (q.has('scenario')) setScenario((q.get('scenario') || null) as ScenarioId | null)
    if (q.get('t')) setTau(Number(q.get('t')))
    if (q.get('paused')) setPaused(q.get('paused') === '1')
    if (q.get('quality')) setQuality(q.get('quality') as 'high' | 'low')
    if (q.get('focus')) setFocusOn(q.get('focus') === '1')
    if (q.get('markers')) setShowMarkers(q.get('markers') === '1')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  useEffect(() => {
    if (paused) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      setTau((t) => t + (now - last) / 1000)
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paused])

  const target = scenario ? failingModule(scenario) : 'M-09'
  const focus = focusOn && scenario ? target : null
  const pose = useMemo(() => fixturePose(layout, 'M-09', tau), [layout, tau])
  const modules = useMemo(() => fixtureModules(scenario, tau), [scenario, tau])
  const generations = useMemo(() => {
    const g: Record<string, Generation> = { 'S-1': 2, 'S-2': 2 }
    for (let k = 0; k < 12; k++) g[`M-${String(k + 1).padStart(2, '0')}`] = (Math.min(4, 1 + Math.floor((genYear + ((k * 5) % 12)) / 6)) as Generation)
    return g
  }, [genYear])

  const markers = useMemo<Segment[]>(() => {
    if (!showMarkers) return []
    const m = findModule(layout, target)!
    const f = featuresOf(m, scenario)
    const W = (p: [number, number, number]) => localToWorld(m, p)
    return [
      { id: 'SEG-1', frame: 'CAM-3', concept: 'grapple fixture', box: { x1: 0, y1: 0, x2: 1, y2: 1 }, point: W([f.grapple[0] + 0.05, f.grapple[1], f.grapple[2]]), feature: { id: 'grapple', distance: 0.05 } },
      { id: 'SEG-2', frame: 'CAM-3', concept: 'radiator latch', box: { x1: 0, y1: 0, x2: 1, y2: 1 }, point: W(f.radiator_latch_b), feature: { id: 'radiator_latch_b', distance: 0.02 } },
    ]
  }, [showMarkers, layout, target, scenario])

  const capture = async () => {
    setBusy(true)
    try {
      const fr = await scene.current!.captureInspection(target)
      setFrames(fr)
      return fr
    } finally { setBusy(false) }
  }

  useEffect(() => {
    window.__lattice = {
      capture,
      set: (s) => {
        if (s.view) setView(s.view)
        if (s.scenario !== undefined) setScenario(s.scenario)
        if (s.t !== undefined) setTau(s.t)
        if (s.paused !== undefined) setPaused(s.paused)
        if (s.markers !== undefined) setShowMarkers(s.markers)
        if (s.focus !== undefined) setFocusOn(s.focus)
      },
    }
  })

  const btn = (on: boolean): React.CSSProperties => ({
    font: '500 11px/1 var(--font-geist-mono, monospace)', padding: '6px 9px', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${on ? '#59d6ff' : 'rgba(255,255,255,0.15)'}`, background: on ? 'rgba(89,214,255,0.12)' : 'rgba(5,7,11,0.7)', color: on ? '#59d6ff' : '#c9d3df',
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05070b', color: '#c9d3df' }}>
      <LatticeScene
        ref={scene}
        layout={layout}
        pose={pose}
        modules={modules}
        focus={focus}
        damage={scenario}
        markers={markers}
        view={view}
        generations={generations}
        quality={quality}
      />
      <div data-ui style={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 'calc(100% - 24px)' }}>
        {(['overview', 'follow', 'servicer'] as View[]).map((v) => <button key={v} style={btn(view === v)} onClick={() => setView(v)}>{v}</button>)}
        <span style={{ width: 8 }} />
        {SCENARIOS.map((s) => <button key={s} style={btn(scenario === s)} onClick={() => setScenario(s)}>{s}</button>)}
        <button style={btn(scenario === null)} onClick={() => setScenario(null)}>no damage</button>
        <span style={{ width: 8 }} />
        <button style={btn(focusOn)} onClick={() => setFocusOn((f) => !f)}>focus</button>
        <button style={btn(paused)} onClick={() => setPaused((p) => !p)}>{paused ? 'play' : 'pause'}</button>
        <button style={btn(showMarkers)} onClick={() => setShowMarkers((m) => !m)}>SEG markers</button>
        <button style={btn(false)} onClick={() => setGenYear((y) => y + 2)}>gen +2y</button>
        <button style={btn(quality === 'low')} onClick={() => setQuality((q) => (q === 'high' ? 'low' : 'high'))}>quality: {quality}</button>
        <button style={btn(busy)} onClick={() => void capture()} data-capture>capture {target}</button>
      </div>
      <div style={{ position: 'absolute', top: 48, left: 12, font: '500 11px/1.4 var(--font-geist-mono, monospace)', color: '#8a97a8' }}>
        τ {tau.toFixed(1)} s · {pose.phaseLabel} · range {pose.range.toFixed(1)} m
      </div>
      {frames.length > 0 && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 8, maxWidth: 'calc(100% - 24px)', overflowX: 'auto' }}>
          {frames.map((f) => (
            <figure key={f.id} style={{ margin: 0, background: 'rgba(5,7,11,0.85)', border: '1px solid rgba(255,255,255,0.12)', padding: 6 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.src} alt={f.label} width={288} height={216} style={{ display: 'block' }} data-frame={f.id} />
              <figcaption style={{ font: '500 10px/1.4 var(--font-geist-mono, monospace)', marginTop: 4, maxWidth: 288 }}>
                {f.id} · {f.label}<br />
                pos [{f.camera.position.map((v) => v.toFixed(2)).join(', ')}] fov {f.camera.fovDeg}°
              </figcaption>
            </figure>
          ))}
          <button style={{ ...btn(false), alignSelf: 'flex-start' }} onClick={() => setFrames([])}>×</button>
        </div>
      )}
    </div>
  )
}

export default ScenePreview
