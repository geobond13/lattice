// The data surface the console composes. `realApi` forwards to the sim workstream (`@/sim`);
// `mockApi` (./mocks) implements the same shape so the UI can be built and screenshotted on its own.
import type {
  ChannelSpec, CameraFrame, Decision, FdirEvent, FleetYear, LatticeLayout, ModuleId, ModuleRecord, ModuleStatus,
  OpsTimeline, ScenarioDef, ScenarioId, ScenePose, TelemetryPoint,
} from '@/contracts'
import * as sim from '@/sim'

export type ModuleStates = Record<ModuleId, { status: ModuleStatus; util: number }>
export type Executed = { decision: Decision; startT: number }

export interface MissionApi {
  scenarios(): Record<ScenarioId, ScenarioDef>
  scenarioIds(): ScenarioId[]
  layout(): LatticeLayout
  channels(scenario: ScenarioId): ChannelSpec[]
  sample(scenario: ScenarioId, channelId: string, t0: number, t1: number, n: number, resolvedAt?: number): TelemetryPoint[]
  fdirEvents(scenario: ScenarioId): FdirEvent[]
  lattice(scenario: ScenarioId, t: number, executed: Executed[]): ModuleStates
  poseAt(ops: OpsTimeline | null, tau: number): ScenePose
  recordById(id: string): ModuleRecord | undefined
  /** Fleet refresh 2027–2037 (illustrative). */
  fleetTimeline(): FleetYear[]
  /** Pre-captured frames used when the scene can't render (mock only). */
  fallbackFrames?(module: ModuleId): CameraFrame[]
}

export const realApi: MissionApi = {
  scenarios: () => sim.SCENARIOS,
  scenarioIds: () => sim.SCENARIO_IDS,
  layout: () => sim.latticeLayout(),
  channels: (s) => sim.channels(s),
  sample: (s, id, t0, t1, n, r) => sim.sample(s, id, t0, t1, n, r),
  fdirEvents: (s) => sim.fdirEvents(s),
  lattice: (s, t, ex) => sim.lattice(s, t, ex),
  poseAt: (ops, tau) => sim.poseAt(ops, tau),
  recordById: (id) => sim.recordById(id),
  fleetTimeline: () => sim.fleetTimeline(),
}
