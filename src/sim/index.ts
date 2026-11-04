// Public surface of the simulation + policy (owned by the sim workstream).
// STUB: signatures are frozen; bodies are placeholders until src/sim is implemented.
import type {
  ActionKind, ActionParams, CameraFrame, ChannelSpec, Decision, FdirEvent, LatticeLayout, ModuleId, ModuleRecord,
  ModuleStatus, OpsTimeline, ScenarioDef, ScenarioId, ScenePose, Segment, TelemetryPoint, Vec3,
} from '@/contracts'

/** The lattice geometry (pure constant). */
export declare function latticeLayout(): LatticeLayout
export declare const SCENARIOS: Record<ScenarioId, ScenarioDef>
export declare const SCENARIO_IDS: ScenarioId[]

/** Channels the UI shows and the agent can read for a scenario (failing module + lattice-level). */
export declare function channels(scenario: ScenarioId): ChannelSpec[]
/**
 * n samples of a channel between t0 and t1. `resolvedAt` (ops end time) returns the channel to nominal
 * afterwards (or ends it, for a module that left).
 */
export declare function sample(scenario: ScenarioId, channelId: string, t0: number, t1: number, n: number, resolvedAt?: number): TelemetryPoint[]
export declare function fdirEvents(scenario: ScenarioId): FdirEvent[]

export declare function records(module?: ModuleId): ModuleRecord[]
export declare function recordById(id: string): ModuleRecord | undefined

/** Per-module status and compute utilisation at time t, given executed decisions (with their ops start time). */
export declare function lattice(scenario: ScenarioId, t: number, executed: { decision: Decision; startT: number }[]): Record<ModuleId, { status: ModuleStatus; util: number }>

/** The deterministic envelope + autonomy policy. Never calls a model. */
export declare function decide(action: ActionKind, params: ActionParams, ctx: { scenario: ScenarioId; t: number; segments: Segment[] }): Decision

/** Scene pose at tau seconds into an ops timeline (null timeline = everything at home). */
export declare function poseAt(ops: OpsTimeline | null, tau: number): ScenePose

/** Unproject a source pixel of a frame onto a module's body box. Null if the ray misses. */
export declare function unproject(frame: CameraFrame, px: { x: number; y: number }): Vec3 | null
/** Nearest named feature to a lattice-frame point on a module. */
export declare function nearestFeature(module: ModuleId, p: Vec3): { id: import('@/contracts').FeatureId; distance: number } | undefined
