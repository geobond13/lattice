// LATTICE shared contracts. Every workstream (sim, scene, agent, UI) codes against these types.
// Changing a type here is a cross-team change: keep it additive.
//
// Units: metres, seconds, m/s, degrees, watts, °C. Frame: Y up. The lattice ring lies in the XZ plane,
// centred on the origin. Mission time `t` is seconds from scenario start (fault at FAULT_T).

export type Vec3 = [number, number, number]
/** Quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number]

// ─── Lattice ──────────────────────────────────────────────────────────────────────────────────────

/** Compute modules M-01 … M-12 on the ring; spares S-1, S-2 parked at the depot. */
export type ModuleId = string

export type ModuleStatus = 'nominal' | 'degraded' | 'failed' | 'draining' | 'drained' | 'undocked' | 'departed' | 'spare' | 'docking'

export interface ModuleGeometry {
  id: ModuleId
  /** Ring slot 0..11, or null for a spare. */
  slot: number | null
  /** Docked pose (spares: parked pose at the depot). */
  position: Vec3
  quaternion: Quat
  /** Body box size [x radial, y up, z along-ring]. */
  size: Vec3
  /** Named features in MODULE-LOCAL coordinates: grapple fixture, FRU latches, dock port, damage site. */
  features: Record<FeatureId, Vec3>
}

export type FeatureId = 'grapple' | 'dock_port' | 'radiator_a' | 'radiator_b' | 'radiator_latch_a' | 'radiator_latch_b' | 'pdu_panel' | 'thruster_pod' | 'damage'

export interface LatticeLayout {
  ringRadius: number
  modules: ModuleGeometry[]
  /** Where spares and the servicer park. */
  depot: Vec3
  servicerHome: Vec3
  /** Approach corridor axis (unit vector, lattice frame) used for every rendezvous. */
  corridorAxis: Vec3
  /** No uncontrolled entry inside this radius from the lattice centre (m). */
  keepOutRadius: number
}

// ─── Telemetry ────────────────────────────────────────────────────────────────────────────────────

export type ChannelKey = 'busV' | 'radiatorC' | 'gpuC' | 'util' | 'coolantKPa' | 'rateDegS' | 'latchLoadN'

export interface ChannelSpec {
  /** Citation id, e.g. TM-M09-RAD. */
  id: string
  module: ModuleId
  key: ChannelKey
  label: string
  unit: string
  /** Hard limits: crossing one is an FDIR event. */
  limits: { lo?: number; hi?: number }
}

export interface TelemetryPoint { t: number; v: number; /** what a healthy module would read */ nominal: number }

// ─── Scenarios ────────────────────────────────────────────────────────────────────────────────────

export type ScenarioId = 'radiator-puncture' | 'power-bus-short' | 'thruster-stuck'
export type Outcome = 'REPAIR' | 'SWAP' | 'DEORBIT'

export interface ScenarioDef {
  id: ScenarioId
  title: string // "Micrometeoroid hit on M-09's radiator"
  blurb: string // one line for the scenario rail
  module: ModuleId
  faultT: number
  /** Ground passes (s from start): when a human can be reached. */
  contacts: { aos: number; los: number; station: string }[]
  /** The outcome a correct agent reaches (eval + tests only, never shown to the model). */
  expected: Outcome
}

/** Raised by deterministic onboard checks (no LLM). Wakes the agent. */
export interface FdirEvent {
  id: string // FE-0921
  t: number
  module: ModuleId
  channel: string // TM-… id
  severity: 'watch' | 'warning' | 'critical'
  summary: string
}

// ─── Records (the module's as-built pedigree) ─────────────────────────────────────────────────────

export type RecordKind = 'build' | 'test' | 'ncr' | 'fru' | 'icd' | 'ops'
export interface ModuleRecord {
  id: string // NCR-0412, FRU-RAD-02, TR-1180, ICD-DOCK-01, OPS-SEP-03
  kind: RecordKind
  module: ModuleId | '*'
  title: string
  date: string // ISO date
  body: string // 1–4 sentences, with the numbers that matter
  values?: Record<string, number | string>
}

// ─── Camera frames, vision and segmentation ───────────────────────────────────────────────────────

/** A frame rendered from the live 3D scene by the servicer's camera. */
export interface CameraFrame {
  id: string // CAM-1
  label: string // "Fly-around, 12 m, +R"
  /** JPEG data URL (client) or public path (pre-captured). */
  src: string
  width: number
  height: number
  /** Pinhole camera that took the frame, lattice frame. Used to unproject SAM boxes into 3D. */
  camera: { position: Vec3; target: Vec3; up: Vec3; fovDeg: number }
  /** Module in view. */
  module: ModuleId
}

/** One SAM 3.1 match, unprojected onto the module. */
export interface Segment {
  id: string // SEG-1
  frame: string // CAM-n
  concept: string // "grapple fixture"
  /** Source-pixel box. */
  box: { x1: number; y1: number; x2: number; y2: number }
  confidence?: number
  /** Decoded mask as an SVG path in source pixels (optional: boxes are enough to target). */
  maskPath?: string
  /** Box centre ray intersected with the module's body box (lattice frame), or null if it misses. */
  point: Vec3 | null
  /** Nearest named feature on the module and distance to it (m). */
  feature?: { id: FeatureId; distance: number }
}

// ─── Actions, envelope and policy ─────────────────────────────────────────────────────────────────

export type ActionKind =
  | 'MIGRATE_WORKLOADS' // move jobs off the failing module
  | 'REPAIR_FRU' // servicer replaces a field-replaceable unit
  | 'SWAP_MODULE' // undock the module, park it at the depot, dock a spare in its slot
  | 'DEORBIT_MODULE' // undock and send to a disposal orbit
  | 'INSPECT' // fly-around inspection (always allowed)

export interface ActionParams {
  module: ModuleId
  /** REPAIR_FRU: which FRU. */
  fru?: 'radiator_a' | 'radiator_b'
  /** Grasp targets from SAM (SEG ids). REPAIR/SWAP/DEORBIT need one for the grapple. */
  grasp?: string[]
  /** SWAP: which spare. */
  spare?: ModuleId
  /** MIGRATE: target modules. */
  targets?: ModuleId[]
}

export interface Check {
  id: string // 'reach' | 'keepout' | 'corridor-v' | 'drained' | 'capacity' | 'deadline' | 'fru' | 'debris' …
  label: string // "Grasp point within arm reach"
  pass: boolean
  detail: string // "1.84 m from shoulder ≤ 2.6 m"
}

export type Tier = 'auto' | 'gated' | 'refused'

export interface Decision {
  action: ActionKind
  params: ActionParams
  tier: Tier
  /** One line: why this tier. */
  reason: string
  /** When the action must start to beat the hazard (s), and the next ground contact. */
  deadline: number | null
  nextContact: number | null
  checks: Check[]
  /** Present when tier !== 'refused': the motion the scene plays. */
  ops?: OpsTimeline
}

// ─── Proximity operations timeline (sim → scene) ──────────────────────────────────────────────────

export type PhaseKind =
  | 'drain' | 'depart_home' | 'approach' | 'hold' | 'final_approach' | 'grapple' | 'unlatch' | 'extract'
  | 'insert' | 'latch' | 'release' | 'undock' | 'tow' | 'dispose_burn' | 'spare_approach' | 'dock' | 'retreat' | 'return_home'

export interface Phase {
  kind: PhaseKind
  label: string // "Hold at 10 m: go/no-go"
  t0: number // seconds from ops start
  t1: number
}

export interface OpsTimeline {
  action: ActionKind
  module: ModuleId
  phases: Phase[]
  duration: number
}

export interface ArmPose {
  /** End effector target in lattice frame, or null for stowed. */
  target: Vec3 | null
  /** 0 open … 1 closed. */
  grip: number
}

export interface BodyPose { position: Vec3; quaternion: Quat; visible: boolean }

/** Everything the scene needs at one instant. Pure function of (timeline, tau). */
export interface ScenePose {
  servicer: BodyPose & { arms: [ArmPose, ArmPose]; /** thruster plume intensity 0..1 */ thrust: number }
  /** Overrides for modules that move (undocked, departing, spare docking). Others stay at layout pose. */
  modules: Record<ModuleId, BodyPose>
  /** FRU panel carried by the servicer during REPAIR, if any. */
  fru?: BodyPose & { kind: 'radiator_a' | 'radiator_b'; damaged: boolean }
  phase: PhaseKind | null
  phaseLabel: string
  /** Servicer range to target and closing rate, for the HUD. */
  range: number
  rangeRate: number
}

// ─── Agent protocol (NDJSON over /api/agent) ──────────────────────────────────────────────────────

export type CitationType = 'telemetry' | 'event' | 'record' | 'camera' | 'segment' | 'web' | 'check'
export interface Citation { type: CitationType; id: string; label: string; url?: string }

export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ModelRole = 'planner' | 'executor' | 'vision' | 'segmenter' | 'search' | 'answer' | 'transcribe'

export interface PlanStep { goal: string; tool: string }

export interface UsageInfo {
  label: string
  role: ModelRole
  model: string
  effort?: Effort
  promptTokens: number
  completionTokens: number
  reasoningTokens?: number
  costUsd: number
  ms: number
}

export type AgentEvent =
  | { type: 'run_start'; runId: string; scenario: ScenarioId; event: FdirEvent; models: Partial<Record<ModelRole, { model: string; effort?: Effort }>> }
  | { type: 'plan'; steps: PlanStep[] }
  | { type: 'thinking'; label: string; model: string; effort?: Effort; text: string }
  | { type: 'tool_call'; callId: string; name: string; args: Record<string, unknown>; model: string; effort?: Effort; round: number }
  | { type: 'tool_result'; callId: string; name: string; summary: string; citations: Citation[]; ms: number }
  /** Muse Spark's read of a camera frame. */
  | { type: 'vision'; callId: string; frame: string; findings: string; citations: Citation[] }
  /** SAM 3.1 matches on a frame (the UI overlays them on the camera feed). */
  | { type: 'segments'; callId: string; frame: string; concept: string; segments: Segment[] }
  | { type: 'decision'; callId: string; decision: Decision }
  | { type: 'answer_delta'; text: string }
  | { type: 'answer'; markdown: string; citations: Citation[]; unknownIds: string[]; numbers?: { checked: number; unsupported: string[] } }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'notice'; message: string }
  | { type: 'done'; totals: { promptTokens: number; completionTokens: number; costUsd: number; ms: number; toolCalls: number } }
  | { type: 'error'; message: string }

/** POST /api/agent body. Frames are optional: the server falls back to pre-captured frames. */
export interface AgentRequest {
  scenario: ScenarioId
  frames?: CameraFrame[]
  /** Operator question (voice or typed) asked after the run; omitted for the autonomous wake-up. */
  question?: string
}

// ─── Tools ────────────────────────────────────────────────────────────────────────────────────────

export interface ToolCtx {
  scenario: ScenarioId
  t: number
  frames: CameraFrame[]
  /** Segments produced so far this run (propose_action resolves SEG ids against these). */
  segments: Segment[]
  /** Emit side-channel events (vision, segments, decision). */
  emit: (e: AgentEvent) => void
  signal?: AbortSignal
}

export interface ToolResult {
  data: unknown
  citations: Citation[]
  summary: string
  decision?: Decision
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  run(args: Record<string, unknown>, ctx: ToolCtx): ToolResult | Promise<ToolResult>
}
