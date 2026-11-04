// Local fake layout + REPAIR-like pose generator for the scene preview (follows DESIGN.md geometry).
// Used only by __preview.tsx while src/sim is still stubbed.
import type { FeatureId, LatticeLayout, ModuleGeometry, ModuleId, ModuleStatus, PhaseKind, Quat, ScenarioId, ScenePose, Vec3 } from '@/contracts'
import { add, defaultFeatures, featuresOf, findModule, lerp3, localToWorld, norm, quatY, scale, sub, len } from './geometry'

const R = 14
const SIZE: Vec3 = [3.2, 2.0, 2.4]
const FAILING: Record<ScenarioId, ModuleId> = { 'radiator-puncture': 'M-09', 'power-bus-short': 'M-04', 'thruster-stuck': 'M-11' }

export function fixtureLayout(): LatticeLayout {
  const modules: ModuleGeometry[] = []
  for (let k = 0; k < 12; k++) {
    const th = (k * 30 * Math.PI) / 180
    const id = `M-${String(k + 1).padStart(2, '0')}`
    const scen = (Object.keys(FAILING) as ScenarioId[]).find((s) => FAILING[s] === id) ?? null
    const features = defaultFeatures(SIZE, scen) as Record<FeatureId, Vec3>
    modules.push({ id, slot: k, position: [R * Math.cos(th), 0, R * Math.sin(th)], quaternion: quatY(-th), size: SIZE, features })
  }
  for (const [i, x] of [[1, -3.5], [2, 3.5]] as const) {
    modules.push({ id: `S-${i}`, slot: null, position: [x, 0, -30], quaternion: quatY(-Math.PI / 2), size: SIZE, features: defaultFeatures(SIZE, null) as Record<FeatureId, Vec3> })
  }
  return { ringRadius: R, modules, depot: [0, 0, -30], servicerHome: [0, 0, -25.5], corridorAxis: [1, 0, 0], keepOutRadius: 20 }
}

export function fixtureModules(scenario: ScenarioId | null, t = 0): Record<ModuleId, { status: ModuleStatus; util: number }> {
  const out: Record<ModuleId, { status: ModuleStatus; util: number }> = {}
  for (let k = 0; k < 12; k++) {
    const id = `M-${String(k + 1).padStart(2, '0')}`
    out[id] = { status: 'nominal', util: 0.55 + 0.35 * Math.abs(Math.sin(k * 1.7 + t * 0.01)) }
  }
  out['S-1'] = { status: 'spare', util: 0 }
  out['S-2'] = { status: 'spare', util: 0 }
  if (scenario) out[FAILING[scenario]] = { status: scenario === 'power-bus-short' ? 'degraded' : 'failed', util: scenario === 'power-bus-short' ? 0.48 : 0.74 }
  return out
}

export const failingModule = (s: ScenarioId) => FAILING[s]

const ss = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }

/** A REPAIR-like loop (period 34 s) toward `module`: transfer, hold at 10 m, final approach, reach, grip, extract. */
export function fixturePose(layout: LatticeLayout, module: ModuleId, tau: number): ScenePose {
  const T = tau % 34
  const m = findModule(layout, module)!
  const f = featuresOf(m, 'radiator-puncture')
  const docked = { position: m.position, quaternion: m.quaternion }
  const radial = norm([m.position[0], 0, m.position[2]])
  const grapple = localToWorld(docked, f.grapple)
  const standoff = add(grapple, scale(radial, 1.6 + 0.7))
  const hold = add(grapple, scale(radial, 10 + 0.7))
  const home = layout.servicerHome
  const face = Math.atan2(-radial[0], -radial[2])
  const q: Quat = quatY(face)

  let pos: Vec3 = home
  let phase: PhaseKind | null = null
  let label = 'At depot'
  let thrust = 0
  let arms: ScenePose['servicer']['arms'] = [{ target: null, grip: 0 }, { target: null, grip: 0 }]
  let fru: ScenePose['fru']

  const latchW = localToWorld(docked, f.radiator_latch_b)
  const radW = localToWorld(docked, f.radiator_b)
  const pin = add(grapple, scale(radial, 0.32))
  if (T < 2) { pos = home; thrust = ss(T / 2) * 0.6 }
  else if (T < 10) { const k = ss((T - 2) / 8); pos = lerp3(home, hold, k); phase = 'approach'; label = 'Transfer to 10 m hold'; thrust = T < 4 || T > 8 ? 0.9 : 0.15 }
  else if (T < 12) { pos = hold; phase = 'hold'; label = 'Hold at 10 m: go/no-go' }
  else if (T < 18) { const k = ss((T - 12) / 6); pos = lerp3(hold, standoff, k); phase = 'final_approach'; label = 'Final approach (corridor)'; thrust = T < 13 || T > 17 ? 0.7 : 0.1 }
  else {
    pos = standoff
    const reach = ss((T - 18) / 3)
    const grip = ss((T - 21) / 1.5)
    phase = T < 21 ? 'grapple' : T < 22.5 ? 'unlatch' : 'extract'
    label = phase === 'grapple' ? 'Reach to grapple fixture' : phase === 'unlatch' ? 'Grip + unlatch radiator B' : 'Extract damaged panel'
    const shoulderL = localToWorld({ position: pos, quaternion: q }, [-0.5, 0.15, 0.72])
    const shoulderR = localToWorld({ position: pos, quaternion: q }, [0.5, 0.15, 0.72])
    const ext = ss((T - 22.5) / 5)
    const out = add(scale(radial, ext * 1.4), [0, ext * 0.3, 0])
    const panelPos = add(radW, out)
    const latchNow = add(latchW, out)
    arms = [
      { target: lerp3(add(shoulderR, scale(radial, -0.8)), pin, reach), grip },
      { target: lerp3(add(shoulderL, scale(radial, -0.8)), latchNow, reach), grip },
    ]
    if (T >= 22.5) fru = { position: panelPos, quaternion: m.quaternion, visible: true, kind: 'radiator_b', damaged: true }
  }
  const range = len(sub(pos, grapple))
  return {
    servicer: { position: pos, quaternion: q, visible: true, arms, thrust },
    modules: {},
    fru,
    phase,
    phaseLabel: label,
    range,
    rangeRate: 0,
  }
}
