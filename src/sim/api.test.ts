// Compile-time guard: the exports keep the frozen signatures from the original src/sim/index.ts stubs.
import { describe, expect, it } from 'vitest'
import type {
  ActionKind, ActionParams, CameraFrame, ChannelSpec, Decision, FdirEvent, FeatureId, FleetYear, LatticeLayout, ModuleId, ModuleRecord,
  ModuleStatus, OpsTimeline, ScenarioDef, ScenarioId, ScenePose, Segment, TelemetryPoint, Vec3,
} from '@/contracts'
import * as sim from './index'

const api: {
  latticeLayout: () => LatticeLayout
  SCENARIOS: Record<ScenarioId, ScenarioDef>
  SCENARIO_IDS: ScenarioId[]
  channels: (scenario: ScenarioId) => ChannelSpec[]
  sample: (scenario: ScenarioId, channelId: string, t0: number, t1: number, n: number, resolvedAt?: number) => TelemetryPoint[]
  fdirEvents: (scenario: ScenarioId) => FdirEvent[]
  records: (module?: ModuleId) => ModuleRecord[]
  recordById: (id: string) => ModuleRecord | undefined
  lattice: (scenario: ScenarioId, t: number, executed: { decision: Decision; startT: number }[]) => Record<ModuleId, { status: ModuleStatus; util: number }>
  decide: (action: ActionKind, params: ActionParams, ctx: { scenario: ScenarioId; t: number; segments: Segment[] }) => Decision
  poseAt: (ops: OpsTimeline | null, tau: number) => ScenePose
  unproject: (frame: CameraFrame, px: { x: number; y: number }) => Vec3 | null
  nearestFeature: (module: ModuleId, p: Vec3) => { id: FeatureId; distance: number } | undefined
  fleetTimeline: () => FleetYear[]
} = sim

describe('public API', () => {
  it('exports every frozen name', () => {
    for (const k of Object.keys(api)) expect(sim).toHaveProperty(k)
    expect(sim.SCENARIO_IDS).toEqual(['radiator-puncture', 'power-bus-short', 'thruster-stuck'])
  })
})
