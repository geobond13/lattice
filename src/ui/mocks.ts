'use client'
// Local mock layer behind `?mock=1`: same shapes as the real sim + agent so the whole console can be developed,
// screenshotted and demoed without the other workstreams. Never imported by the real path's logic.
import { useCallback, useRef, useState } from 'react'
import type {
  ActionKind, AgentEvent, CameraFrame, ChannelSpec, Check, Citation, Decision, FdirEvent, LatticeLayout,
  ModuleGeometry, ModuleId, ModuleRecord, OpsTimeline, Phase, PhaseKind, Quat, ScenarioDef, ScenarioId, ScenePose,
  Segment, TelemetryPoint, UsageInfo, Vec3,
} from '@/contracts'
import type { AgentRun, UseAgentRuns } from '@/agent/client'
import type { Executed, MissionApi, ModuleStates } from './api'
import { mockFleetTimeline } from './fleet'

// ─── Scenarios ────────────────────────────────────────────────────────────────────────────────────

const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  'radiator-puncture': {
    id: 'radiator-puncture',
    title: "Micrometeoroid hit on M-09's radiator",
    blurb: 'Coolant loop B is losing pressure and the GPUs are heating toward their throttle limit.',
    module: 'M-09',
    faultT: 120,
    contacts: [{ aos: -540, los: 60, station: 'Svalbard' }, { aos: 4500, los: 5100, station: 'Svalbard' }],
    expected: 'REPAIR',
  },
  'power-bus-short': {
    id: 'power-bus-short',
    title: 'Primary bus short on M-04',
    blurb: 'Bus A tripped; M-04 is limping on bus B at half compute. The catalogue and the as-built record disagree.',
    module: 'M-04',
    faultT: 90,
    contacts: [{ aos: -600, los: 30, station: 'Inuvik' }, { aos: 1320, los: 1920, station: 'Svalbard' }],
    expected: 'SWAP',
  },
  'thruster-stuck': {
    id: 'thruster-stuck',
    title: 'RCS thruster stuck open on M-11',
    blurb: 'A valve will not close. Body rate and dock-latch load are climbing on a module wedged between two neighbours.',
    module: 'M-11',
    faultT: 60,
    contacts: [{ aos: -500, los: 20, station: 'Awarua' }, { aos: 3120, los: 3700, station: 'Svalbard' }],
    expected: 'DEORBIT',
  },
}
const SCENARIO_IDS: ScenarioId[] = ['radiator-puncture', 'power-bus-short', 'thruster-stuck']

// ─── Layout ───────────────────────────────────────────────────────────────────────────────────────

const R = 14
const yawQuat = (phi: number): Quat => [0, Math.sin(phi / 2), 0, Math.cos(phi / 2)]
const MOD_FEATURES: ModuleGeometry['features'] = {
  grapple: [1.6, 0, 0], dock_port: [-1.6, 0, 0], radiator_a: [0, 0, 1.3], radiator_b: [0, 0, -1.3],
  radiator_latch_a: [1.4, 0.8, 1.3], radiator_latch_b: [1.4, 0.8, -1.3], pdu_panel: [0, -1, 0], thruster_pod: [1.6, 1, 0],
  damage: [0.8, 0.8, -1.3],
}
let layoutCache: LatticeLayout | null = null
function layout(): LatticeLayout {
  if (layoutCache) return layoutCache
  const modules: ModuleGeometry[] = []
  for (let k = 0; k < 12; k++) {
    const th = (k * Math.PI) / 6
    modules.push({
      id: `M-${String(k + 1).padStart(2, '0')}`, slot: k, position: [R * Math.cos(th), 0, R * Math.sin(th)],
      quaternion: yawQuat(-th), size: [3.2, 2, 2.4], features: MOD_FEATURES,
    })
  }
  modules.push({ id: 'S-1', slot: null, position: [-3, 0, -30], quaternion: yawQuat(0), size: [3.2, 2, 2.4], features: MOD_FEATURES })
  modules.push({ id: 'S-2', slot: null, position: [3, 0, -30], quaternion: yawQuat(0), size: [3.2, 2, 2.4], features: MOD_FEATURES })
  layoutCache = { ringRadius: R, modules, depot: [0, 0, -30], servicerHome: [0, 2.5, -30], corridorAxis: [1, 0, 0], keepOutRadius: 20 }
  return layoutCache
}

// ─── Telemetry ────────────────────────────────────────────────────────────────────────────────────

type Curve = (t: number) => { v: number; nominal: number }
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const jitter = (t: number, a: number) => a * (Math.sin(t * 0.37) * 0.6 + Math.sin(t * 1.13 + 1) * 0.4)

const CH: Record<ScenarioId, { spec: ChannelSpec; f: Curve }[]> = {
  'radiator-puncture': [
    { spec: { id: 'TM-M09-CLT', module: 'M-09', key: 'coolantKPa', label: 'Coolant loop B', unit: 'kPa', limits: { lo: 220 } },
      f: (t) => ({ nominal: 310, v: (t < 120 ? 310 : t < 480 ? 310 - 130 * Math.pow((t - 120) / 360, 0.8) : 180) + jitter(t, 1.5) }) },
    { spec: { id: 'TM-M09-GPU', module: 'M-09', key: 'gpuC', label: 'GPU temperature', unit: '°C', limits: { hi: 85 } },
      f: (t) => ({ nominal: 62, v: (t < 120 ? 62 : t < 2040 ? 62 + 23 * Math.pow((t - 120) / 1920, 0.85) : 85 + 10 * ((t - 2040) / 960)) + jitter(t, 0.3) }) },
    { spec: { id: 'TM-M09-RAD', module: 'M-09', key: 'radiatorC', label: 'Radiator B', unit: '°C', limits: { hi: 40 } },
      f: (t) => ({ nominal: 18, v: (t < 120 ? 18 : 18 + 26 * smooth((t - 120) / 900)) + jitter(t, 0.4) }) },
    { spec: { id: 'TM-M09-UTL', module: 'M-09', key: 'util', label: 'Utilisation', unit: '%', limits: { hi: 100 } },
      f: (t) => ({ nominal: 92, v: 92 + jitter(t, 0.8) }) },
  ],
  'power-bus-short': [
    { spec: { id: 'TM-M04-BUS', module: 'M-04', key: 'busV', label: 'Primary bus A', unit: 'V', limits: { lo: 100 } },
      f: (t) => ({ nominal: 120, v: t < 90 ? 120 + jitter(t, 0.4) : Math.max(0, 120 - 40 * (t - 90)) }) },
    { spec: { id: 'TM-M04-UTL', module: 'M-04', key: 'util', label: 'Utilisation', unit: '%', limits: { hi: 100 } },
      f: (t) => ({ nominal: 90, v: (t < 90 ? 90 : 48) + jitter(t, 0.6) }) },
    { spec: { id: 'TM-M04-GPU', module: 'M-04', key: 'gpuC', label: 'GPU temperature', unit: '°C', limits: { hi: 85 } },
      f: (t) => ({ nominal: 63, v: (t < 90 ? 63 : 63 - 11 * smooth((t - 90) / 300)) + jitter(t, 0.3) }) },
  ],
  'thruster-stuck': [
    { spec: { id: 'TM-M11-RATE', module: 'M-11', key: 'rateDegS', label: 'Body rate', unit: '°/s', limits: { hi: 0.5 } },
      f: (t) => ({ nominal: 0.02, v: (t < 60 ? 0.02 : 0.02 + 0.00075 * (t - 60)) + jitter(t, 0.004) }) },
    { spec: { id: 'TM-M11-LATCH', module: 'M-11', key: 'latchLoadN', label: 'Dock latch load', unit: 'N', limits: { hi: 4500 } },
      f: (t) => ({ nominal: 800, v: (t < 60 ? 800 : 800 + 3700 * Math.pow((t - 60) / 840, 1.3)) + jitter(t, 12) }) },
    { spec: { id: 'TM-M11-UTL', module: 'M-11', key: 'util', label: 'Utilisation', unit: '%', limits: { hi: 100 } },
      f: (t) => ({ nominal: 88, v: 88 + jitter(t, 0.6) }) },
  ],
}

function sample(s: ScenarioId, id: string, t0: number, t1: number, n: number, resolvedAt?: number): TelemetryPoint[] {
  const c = CH[s].find((x) => x.spec.id === id)
  if (!c) return []
  const out: TelemetryPoint[] = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? t1 : t0 + ((t1 - t0) * i) / (n - 1)
    const { v, nominal } = c.f(t)
    let val = v
    if (resolvedAt != null && t > resolvedAt) {
      const k = smooth((t - resolvedAt) / 420)
      const atRes = c.f(resolvedAt).v
      val = atRes + (nominal - atRes) * k + jitter(t, Math.abs(nominal) * 0.004)
    }
    out.push({ t, v: val, nominal })
  }
  return out
}

const FDIR: Record<ScenarioId, FdirEvent[]> = {
  'radiator-puncture': [
    { id: 'FE-0921', t: 150, module: 'M-09', channel: 'TM-M09-CLT', severity: 'warning', summary: 'Coolant loop B pressure decaying 22 kPa/min' },
    { id: 'FE-0922', t: 480, module: 'M-09', channel: 'TM-M09-CLT', severity: 'critical', summary: 'Loop B isolated; loop A carrying full load' },
  ],
  'power-bus-short': [
    { id: 'FE-0417', t: 92, module: 'M-04', channel: 'TM-M04-BUS', severity: 'critical', summary: 'Primary bus A undervoltage: failover to bus B, util capped at 48 %' },
  ],
  'thruster-stuck': [
    { id: 'FE-1103', t: 75, module: 'M-11', channel: 'TM-M11-RATE', severity: 'critical', summary: 'Uncommanded body rate; RCS valve 3 open, close command unacknowledged' },
  ],
}

// ─── Records ──────────────────────────────────────────────────────────────────────────────────────

const RECORDS: ModuleRecord[] = [
  { id: 'FRU-RAD-02', kind: 'fru', module: '*', title: 'Radiator panel, field-replaceable unit', date: '2026-02-11', body: 'Radiator panels A and B are field-replaceable. Four latches torqued to 12 N·m. Nominal swap time 22 min. The servicer carries two spare panels.', values: { latches: 4, torqueNm: 12, swapMin: 22, sparesCarried: 2 } },
  { id: 'TR-1180', kind: 'test', module: 'M-09', title: 'M-09 thermal-vacuum acceptance', date: '2026-03-04', body: 'Single-loop rejection measured at 6.1 kW. Module dissipation is 7.4 kW at 92 % util, so one loop holds only at ≤ 74 % util.', values: { singleLoopKW: 6.1, dissipationKW: 7.4, maxUtilOneLoop: '74 %' } },
  { id: 'BLD-M09', kind: 'build', module: 'M-09', title: 'M-09 build traveler', date: '2026-02-27', body: 'Integrated at bay 3. Radiators S/N RB-2291 (A) and RB-2294 (B). No open items at ship.' },
  { id: 'ICD-GRP-01', kind: 'icd', module: '*', title: 'Grapple fixture interface', date: '2025-11-19', body: 'Standard grapple fixture on the +X face centre. Capture envelope ±5 cm, ±3°. Approach ≤ 0.02 m/s at contact.' },
  { id: 'FRU-PDU-01', kind: 'fru', module: '*', title: 'Power distribution unit, catalogue entry', date: '2025-12-02', body: 'The PDU is listed as field-replaceable on the standard module build: six captive fasteners, two blind-mate connectors.' },
  { id: 'NCR-0412', kind: 'ncr', module: 'M-04', title: 'PDU harness potted during rework', date: '2026-03-18', body: 'During rework the M-04 PDU harness was potted in place. Disposition: use-as-is. The PDU is NOT field-replaceable on this unit.' },
  { id: 'TR-1302', kind: 'test', module: 'S-1', title: 'Spare S-1 burn-in', date: '2026-04-02', body: 'S-1 completed 240 h burn-in with zero ECC faults. Qualified for docking.' },
  { id: 'TR-0977', kind: 'test', module: 'M-04', title: 'Single-bus endurance', date: '2026-03-09', body: 'Bus B alone carries 3.6 kW indefinitely; thermal stable. No hazard on single-bus operation.' },
  { id: 'NCR-0388', kind: 'ncr', module: 'M-11', title: 'Slow latch valve actuation', date: '2026-03-22', body: 'M-11 latch valve accepted with slow actuation (410 ms vs 250 ms spec). Disposition: use-as-is.' },
  { id: 'OPS-VALVE-07', kind: 'ops', module: 'M-11', title: 'Valve close command log', date: '2026-11-04', body: 'Close command sent to RCS valve 3 at T+00:01:05. No response from the valve driver.' },
  { id: 'OPS-SEP-03', kind: 'ops', module: '*', title: 'Separation procedure', date: '2025-10-30', body: 'Separation spring imparts 0.3 m/s along the −corridor axis after latch release.' },
  { id: 'ICD-DOCK-01', kind: 'icd', module: '*', title: 'Dock latch interface', date: '2025-10-12', body: 'Dock latch rated to 4500 N. Exceeding it risks latch failure and uncontrolled separation.' },
]

// ─── Ops + lattice ────────────────────────────────────────────────────────────────────────────────

const PH = (kind: PhaseKind, label: string, t0: number, t1: number): Phase => ({ kind, label, t0, t1 })
function opsFor(action: ActionKind, module: ModuleId): OpsTimeline {
  const phases: Phase[] =
    action === 'MIGRATE_WORKLOADS' ? [PH('drain', `Migrating jobs off ${module}`, 0, 240)]
    : action === 'REPAIR_FRU' ? [
        PH('depart_home', 'Depart depot', 0, 300), PH('approach', 'Approach along corridor', 300, 900),
        PH('hold', 'Hold at 10 m: go/no-go', 900, 1020), PH('final_approach', 'Final approach to grapple', 1020, 1260),
        PH('grapple', 'Grapple fixture capture', 1260, 1380), PH('unlatch', 'Unlatch radiator B (4 × 12 N·m)', 1380, 1620),
        PH('extract', 'Extract damaged panel', 1620, 1800), PH('insert', 'Insert spare panel', 1800, 2040),
        PH('latch', 'Latch and torque', 2040, 2220), PH('release', 'Release grapple', 2220, 2280), PH('retreat', 'Retreat to 12 m', 2280, 2400)]
    : action === 'SWAP_MODULE' ? [
        PH('drain', 'Drain M-04', 0, 300), PH('depart_home', 'Depart depot', 300, 480), PH('approach', 'Approach along corridor', 480, 900),
        PH('hold', 'Hold at 10 m: go/no-go', 900, 1000), PH('final_approach', 'Final approach', 1000, 1200), PH('grapple', 'Grapple M-04', 1200, 1300),
        PH('undock', 'Undock M-04', 1300, 1500), PH('tow', 'Tow M-04 to depot', 1500, 2000), PH('spare_approach', 'Bring S-1 to slot 3', 2000, 2500),
        PH('dock', 'Dock S-1', 2500, 2800), PH('retreat', 'Retreat', 2800, 3000)]
    : action === 'DEORBIT_MODULE' ? [
        PH('drain', 'Emergency checkpoint + drain', 0, 120), PH('undock', 'Separate along −corridor', 120, 300),
        PH('approach', 'Chase M-11', 300, 700), PH('grapple', 'Capture M-11', 700, 850), PH('tow', 'Tow clear of the lattice', 850, 1200),
        PH('dispose_burn', 'Disposal burn into reentry corridor', 1200, 1500), PH('release', 'Release', 1500, 1600), PH('return_home', 'Return to depot', 1600, 1800)]
    : [PH('approach', 'Fly-around', 0, 120)]
  return { action, module, phases, duration: phases[phases.length - 1].t1 }
}

const RANGE: Partial<Record<PhaseKind, [number, number]>> = {
  drain: [40, 40], depart_home: [40, 30], approach: [30, 10], hold: [10, 10], final_approach: [10, 1.6], grapple: [1.6, 1.6],
  unlatch: [1.6, 1.6], extract: [1.6, 1.6], insert: [1.6, 1.6], latch: [1.6, 1.6], release: [1.6, 2], retreat: [2, 12],
  undock: [1.6, 1.6], tow: [1.6, 1.6], spare_approach: [25, 1.6], dock: [1.6, 1.6], dispose_burn: [1.6, 1.6], return_home: [12, 40],
}

function poseAt(ops: OpsTimeline | null, tau: number): ScenePose {
  const home: ScenePose['servicer'] = { position: layout().servicerHome, quaternion: [0, 0, 0, 1], visible: true, arms: [{ target: null, grip: 0 }, { target: null, grip: 0 }], thrust: 0 }
  if (!ops || tau < 0) return { servicer: home, modules: {}, phase: null, phaseLabel: '', range: 40, rangeRate: 0 }
  const ph = ops.phases.find((p) => tau >= p.t0 && tau < p.t1) ?? ops.phases[ops.phases.length - 1]
  const [r0, r1] = RANGE[ph.kind] ?? [10, 10]
  const k = Math.min(1, Math.max(0, (tau - ph.t0) / (ph.t1 - ph.t0)))
  const range = r0 + (r1 - r0) * k
  const moving = r0 !== r1
  return {
    servicer: { ...home, thrust: moving ? 0.6 : 0.05, arms: [{ target: null, grip: ['grapple', 'unlatch', 'extract', 'insert', 'latch', 'tow', 'dispose_burn'].includes(ph.kind) ? 1 : 0 }, { target: null, grip: 0 }] },
    modules: {}, phase: ph.kind, phaseLabel: ph.label, range, rangeRate: (r1 - r0) / (ph.t1 - ph.t0),
  }
}

function lattice(s: ScenarioId, t: number, executed: Executed[]): ModuleStates {
  const sc = SCENARIOS[s]
  const out: ModuleStates = {}
  for (let k = 0; k < 12; k++) out[`M-${String(k + 1).padStart(2, '0')}`] = { status: 'nominal', util: 80 + 8 * Math.sin(k * 1.7) }
  out['S-1'] = { status: 'spare', util: 0 }
  out['S-2'] = { status: 'spare', util: 0 }
  const m = sc.module
  const migrated = executed.find((e) => e.decision.action === 'MIGRATE_WORKLOADS')
  if (t >= sc.faultT) out[m] = s === 'radiator-puncture' ? { status: 'degraded', util: 92 } : s === 'power-bus-short' ? { status: 'degraded', util: 48 } : { status: 'failed', util: 88 }
  else out[m] = { ...out[m], util: s === 'radiator-puncture' ? 92 : out[m].util }
  if (migrated && t >= migrated.startT) {
    const k = Math.min(1, (t - migrated.startT) / 240)
    const target = s === 'radiator-puncture' ? 72 : 0
    out[m] = { status: k < 1 ? 'draining' : 'drained', util: out[m].util + (target - out[m].util) * k }
  }
  const act = executed.find((e) => e.decision.action !== 'MIGRATE_WORKLOADS' && e.decision.ops)
  if (act && t >= act.startT) {
    const tau = t - act.startT
    const end = act.decision.ops!.duration
    if (act.decision.action === 'REPAIR_FRU') out[m] = tau >= end ? { status: 'nominal', util: 72 + 20 * smooth((tau - end) / 300) } : { status: 'drained', util: out[m].util }
    if (act.decision.action === 'SWAP_MODULE') {
      out[m] = tau < 1300 ? { status: 'draining', util: 48 * (1 - Math.min(1, tau / 300)) } : { status: 'undocked', util: 0 }
      out['S-1'] = tau < 2000 ? out['S-1'] : tau < end ? { status: 'docking', util: 0 } : { status: 'nominal', util: 86 * smooth((tau - end) / 300) }
    }
    if (act.decision.action === 'DEORBIT_MODULE') out[m] = tau < 120 ? { status: 'draining', util: 88 * (1 - tau / 120) } : tau < 1200 ? { status: 'undocked', util: 0 } : { status: 'departed', util: 0 }
  }
  return out
}

// ─── Frames ───────────────────────────────────────────────────────────────────────────────────────

const W = 1280, H = 720
function frameSvg(kind: 1 | 2 | 3, scenario: ScenarioId): string {
  const dmg = scenario === 'radiator-puncture'
  const scale = kind === 1 ? 1 : 1.9
  const cx = kind === 3 ? 520 : kind === 2 ? 760 : 640
  const cy = 360
  const bw = 300 * scale, bh = 190 * scale
  const rw = 240 * scale, rh = 150 * scale
  const panel = (x: number, y: number, hit: boolean) => {
    const lines = Array.from({ length: 9 }, (_, i) => `<line x1="${x + (rw / 9) * i}" y1="${y}" x2="${x + (rw / 9) * i}" y2="${y + rh}" stroke="#7aa6c8" stroke-opacity=".35" stroke-width="1.2"/>`).join('')
    return `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="url(#rad)" stroke="#9cc6e6" stroke-opacity=".5"/>${lines}<rect x="${x + rw - 15 * scale}" y="${y + 5 * scale}" width="${10 * scale}" height="${10 * scale}" rx="2" fill="#e7c36a"/>` +
      (hit && dmg ? `<g transform="translate(${x + rw * 0.62} ${y + rh * 0.35})"><circle r="${9 * scale}" fill="#0a0d12"/><circle r="${16 * scale}" fill="none" stroke="#c9e6ff" stroke-opacity=".5"/><path d="M-${22 * scale} -4 L${20 * scale} 6 M-6 -${20 * scale} L4 ${22 * scale}" stroke="#d8eeff" stroke-opacity=".6" stroke-width="1.5"/><circle r="${30 * scale}" fill="url(#frost)"/></g>` : '')
  }
  const bx = cx - bw / 2, by = cy - bh / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="earth" cx="50%" cy="190%" r="140%"><stop offset="0.62" stop-color="#0b2a4a"/><stop offset="0.66" stop-color="#2f7fbf" stop-opacity=".7"/><stop offset="0.69" stop-color="#05070b" stop-opacity="0"/></radialGradient>
<linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfd6df"/><stop offset="1" stop-color="#59626e"/></linearGradient>
<linearGradient id="rad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b4a66"/><stop offset="1" stop-color="#16263a"/></linearGradient>
<radialGradient id="frost"><stop offset="0" stop-color="#e8f6ff" stop-opacity=".35"/><stop offset="1" stop-color="#e8f6ff" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="#04060a"/>
<rect width="${W}" height="${H}" fill="url(#earth)"/>
${kind === 1 ? panel(bx - rw - 8, cy - rh / 2, false) : ''}
${panel(kind === 1 ? bx + bw + 8 : bx + bw - 30 * scale, cy - rh / 2 - (kind === 1 ? 0 : 40), true)}
<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6" fill="url(#body)"/>
<rect x="${bx + 14}" y="${by + 14}" width="${bw - 28}" height="${bh - 28}" rx="3" fill="none" stroke="#2c333d" stroke-opacity=".5"/>
<g transform="translate(${cx - 40 * scale} ${cy})"><rect x="${-34 * scale}" y="${-34 * scale}" width="${68 * scale}" height="${68 * scale}" rx="${8 * scale}" fill="#2b3139" stroke="#e7c36a" stroke-width="${3 * scale}"/><circle r="${14 * scale}" fill="#11151b" stroke="#e7c36a" stroke-width="${2 * scale}"/><path d="M${-26 * scale} 0 H${26 * scale} M0 ${-26 * scale} V${26 * scale}" stroke="#e7c36a" stroke-opacity=".6"/></g>
<g fill="#e7c36a">${[0, 1, 2, 3].map((i) => `<rect x="${bx + bw - 22 - (i % 2) * (bw - 44)}" y="${by + 8 + Math.floor(i / 2) * (bh - 24)}" width="14" height="14" rx="2"/>`).join('')}</g>
<rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`
}

function mockFrames(module: ModuleId, scenario: ScenarioId = 'radiator-puncture'): CameraFrame[] {
  const p = layout().modules.find((m) => m.id === module)?.position ?? [14, 0, 0]
  const labels = ['Fly-around, 12 m, +R', 'Damage close-up, 4 m', 'Grapple / FRU close-up, 3 m']
  return ([1, 2, 3] as const).map((k) => ({
    id: `CAM-${k}`, label: labels[k - 1], width: W, height: H, module,
    src: `data:image/svg+xml;utf8,${encodeURIComponent(frameSvg(k, scenario))}`,
    camera: { position: [p[0] * 1.6, 1, p[2] * 1.6] as Vec3, target: p, up: [0, 1, 0] as Vec3, fovDeg: 50 },
  }))
}

export const mockApi: MissionApi = {
  scenarios: () => SCENARIOS,
  scenarioIds: () => SCENARIO_IDS,
  layout,
  channels: (s) => [...CH[s].map((c) => c.spec), { id: 'TM-LAT-UTL', module: '*', key: 'util', label: 'Lattice compute', unit: '%', limits: { hi: 95 } }],
  sample,
  fdirEvents: (s) => FDIR[s],
  lattice,
  poseAt,
  recordById: (id) => RECORDS.find((r) => r.id === id),
  fleetTimeline: mockFleetTimeline,
  fallbackFrames: (m) => mockFrames(m),
}
export { mockFrames }

// ─── Mock agent run ───────────────────────────────────────────────────────────────────────────────

const cost = (p: number, c: number) => (p * 1.25 + c * 4.25) / 1e6
const usage = (label: string, role: UsageInfo['role'], model: string, effort: UsageInfo['effort'], p: number, c: number, r: number, ms: number): AgentEvent =>
  ({ type: 'usage', usage: { label, role, model, effort, promptTokens: p, completionTokens: c, reasoningTokens: r, costUsd: cost(p, c), ms } })
const rec = (id: string, label = ''): Citation => ({ type: id.startsWith('TM-') ? 'telemetry' : id.startsWith('CAM') ? 'camera' : id.startsWith('SEG') ? 'segment' : id.startsWith('WEB') ? 'web' : id.startsWith('FE-') ? 'event' : 'record', id, label })
const ck = (id: string, label: string, pass: boolean, detail: string): Check => ({ id, label, pass, detail })

type Step = [number, AgentEvent]

function decisionsFor(s: ScenarioId): { first?: Decision; final: Decision; migrate?: Decision } {
  if (s === 'radiator-puncture') {
    const base = [
      ck('fru', 'Unit is field-replaceable on this module', true, 'FRU-RAD-02: radiator_b replaceable on M-09'),
      ck('drained', 'Module drained below threshold', true, 'M-09 at 72 % ≤ 74 % (TR-1180)'),
      ck('capacity', 'Lattice stays within capacity', true, 'Lattice 88 % ≤ 95 %'),
      ck('corridor-v', 'Approach velocity within corridor limits', true, 'Max 0.11 m/s at the 10 m hold ≤ 0.12 m/s'),
      ck('deadline', 'Hazard deadline before next contact', true, 'Start by T+34:00 · next contact T+75:00'),
    ]
    return {
      migrate: { action: 'MIGRATE_WORKLOADS', params: { module: 'M-09', targets: ['M-08', 'M-10', 'M-02'] }, tier: 'auto', reason: 'Migration within capacity is always autonomous.', deadline: null, nextContact: 4500, checks: [ck('capacity', 'Lattice stays within capacity', true, 'Lattice 88 % ≤ 95 % after moving 20 % of M-09')], ops: opsFor('MIGRATE_WORKLOADS', 'M-09') },
      first: { action: 'REPAIR_FRU', params: { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-2'] }, tier: 'refused', reason: 'A safety check failed: the grasp point is inside the damage keep-out.', deadline: 2040, nextContact: 4500,
        checks: [ck('grasp', 'Grasp segment unprojected onto module', true, 'SEG-2 → radiator_latch_b'), ck('reach', 'Grasp point within arm reach', true, '2.21 m from shoulder ≤ 2.6 m'), ck('damage-keepout', 'Clear of the damage site', false, 'Grasp point 0.3 m from the puncture: sharp edges and frozen coolant'), ...base] },
      final: { action: 'REPAIR_FRU', params: { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-1'] }, tier: 'auto', reason: 'Reversible repair whose deadline (T+34:00) falls before the next contact (T+75:00).', deadline: 2040, nextContact: 4500,
        checks: [ck('grasp', 'Grasp segment unprojected onto module', true, 'SEG-1 → grapple, 0.04 m from fixture centre'), ck('reach', 'Grasp point within arm reach', true, '1.84 m from shoulder ≤ 2.6 m'), ck('damage-keepout', 'Clear of the damage site', true, '1.92 m from the puncture ≥ 0.5 m'), ...base], ops: opsFor('REPAIR_FRU', 'M-09') },
    }
  }
  if (s === 'power-bus-short') {
    return {
      final: { action: 'SWAP_MODULE', params: { module: 'M-04', spare: 'S-1', grasp: ['SEG-1'] }, tier: 'gated', reason: 'Removes a module with no hazard deadline: waits for an operator.', deadline: null, nextContact: 1320,
        checks: [ck('grasp', 'Grasp segment unprojected onto module', true, 'SEG-1 → grapple, 0.03 m from fixture centre'), ck('reach', 'Grasp point within arm reach', true, '1.79 m from shoulder ≤ 2.6 m'), ck('spare', 'Spare is qualified', true, 'S-1 passed 240 h burn-in (TR-1302)'), ck('drained', 'Module drained before undock', true, 'M-04 drained to 0 % before undock'), ck('capacity', 'Lattice stays within capacity', true, 'Lattice 91 % ≤ 95 %'), ck('corridor-v', 'Approach velocity within corridor limits', true, 'Max 0.11 m/s at the 10 m hold ≤ 0.12 m/s'), ck('deadline', 'Hazard deadline before next contact', true, 'No hazard (TR-0977: bus B stable) · next contact T+22:00')],
        ops: opsFor('SWAP_MODULE', 'M-04') },
    }
  }
  return {
    final: { action: 'DEORBIT_MODULE', params: { module: 'M-11', grasp: ['SEG-1'] }, tier: 'auto', reason: 'Hazard-driven: the latch limit (T+15:00) arrives before the next contact (T+52:00).', deadline: 900, nextContact: 3120,
      checks: [ck('grasp', 'Grasp segment unprojected onto module', true, 'SEG-1 → grapple, 0.05 m from fixture centre'), ck('reach', 'Grasp point within arm reach', true, '1.88 m from shoulder ≤ 2.6 m'), ck('drained', 'Module drained', true, 'Emergency checkpoint: M-11 at 0 %'), ck('capacity', 'Lattice stays within capacity', true, 'Lattice 89 % ≤ 95 %'), ck('debris', 'Disposal corridor clear', true, 'No tracked objects within 2 km of the reentry corridor'), ck('corridor-v', 'Approach velocity within corridor limits', true, 'Separation 0.3 m/s along −corridor (OPS-SEP-03)'), ck('deadline', 'Hazard deadline before next contact', true, 'Latch limit T+15:00 · next contact T+52:00')],
      ops: opsFor('DEORBIT_MODULE', 'M-11') },
  }
}

const ANSWERS: Record<ScenarioId, string> = {
  'radiator-puncture': `**Diagnosis.** A micrometeoroid punctured radiator B on M-09 (FE-0921). Loop B pressure fell from 310 to 180 kPa (TM-M09-CLT) and GPU temperature is climbing toward the 85 °C throttle limit (TM-M09-GPU), reached at about T+34:00.

**Evidence.** CAM-2 shows a ~4 cm perforation with frozen coolant around it. TR-1180 says one loop rejects 6.1 kW, which holds only at ≤ 74 % util, so I migrated workloads first.

**Action.** Replace radiator B (FRU-RAD-02, 22 min swap). My first grasp (SEG-2, the latch) was **refused**: 0.3 m from the puncture. Re-targeted the grapple fixture SEG-1 per ICD-GRP-01; all checks pass.

**Why autonomous.** The deadline is T+34:00 and the next ground contact is T+75:00. No human is reachable in time.`,
  'power-bus-short': `**Diagnosis.** Primary bus A shorted on M-04 (FE-0417, TM-M04-BUS). The module failed over to bus B and is capped at 48 % (TM-M04-UTL).

**The as-built twist.** The catalogue (FRU-PDU-01) says the PDU is field-replaceable, but NCR-0412 records that M-04's harness was potted during rework. Repair is not possible on this unit.

**Action.** Swap M-04 for spare S-1, which passed burn-in (TR-1302). Grasp on the grapple fixture, SEG-1.

**Why it waits.** Bus B is stable on its own (TR-0977), so there is no hazard deadline, and the swap removes a module. The next contact is T+22:00: this goes to the operator.`,
  'thruster-stuck': `**Diagnosis.** RCS valve 3 on M-11 is stuck open (FE-1103). The close command got no response (OPS-VALVE-07), consistent with the slow valve accepted under NCR-0388.

**Hazard.** Dock latch load (TM-M11-LATCH) reaches the 4500 N limit of ICD-DOCK-01 at about T+15:00. If the latch fails, M-11 strikes M-10 and M-12.

**Action.** Emergency checkpoint and drain, separate along the −corridor (OPS-SEP-03, 0.3 m/s), capture at SEG-1 and dispose. Public precedent for controlled disposal of a failed module is in WEB-1.

**Why autonomous.** The deadline is T+15:00, before the next contact at T+52:00.`,
}

function script(s: ScenarioId, question?: string): Step[] {
  const sc = SCENARIOS[s]
  const fe = FDIR[s][0]
  const m = sc.module
  const d = decisionsFor(s)
  const tm = CH[s].map((c) => c.spec.id)
  const recs = RECORDS.filter((r) => r.module === m || (s === 'radiator-puncture' && ['FRU-RAD-02', 'ICD-GRP-01'].includes(r.id)) || (s === 'power-bus-short' && ['FRU-PDU-01', 'TR-1302'].includes(r.id)) || (s === 'thruster-stuck' && ['OPS-SEP-03', 'ICD-DOCK-01'].includes(r.id))).map((r) => r.id)
  const MUSE = 'muse-spark-1.3'
  const steps: Step[] = []
  if (question) {
    steps.push([200, { type: 'run_start', runId: `mock-${Date.now()}`, scenario: s, event: fe, models: { answer: { model: MUSE, effort: 'high' } } }])
    steps.push([900, { type: 'thinking', label: 'Answering the operator', model: MUSE, effort: 'high', text: `Operator asked: "${question}". The run's evidence already covers this.` }])
    for (const chunk of ['Short answer: ', 'the envelope, not the model, decides. ', `Every check for ${m} is deterministic and logged; `, 'the model only proposes and cites (FE-' + fe.id.slice(3) + ').']) steps.push([260, { type: 'answer_delta', text: chunk }])
    steps.push([200, usage('answer', 'answer', MUSE, 'high', 6100, 140, 90, 2100)])
    steps.push([100, { type: 'done', totals: { promptTokens: 6100, completionTokens: 140, costUsd: cost(6100, 140), ms: 3300, toolCalls: 0 } }])
    return steps
  }
  steps.push([300, { type: 'run_start', runId: `mock-${Date.now()}`, scenario: s, event: fe, models: { planner: { model: MUSE, effort: 'high' }, executor: { model: MUSE, effort: 'minimal' }, vision: { model: MUSE, effort: 'medium' }, segmenter: { model: 'sam-3.1' } } }])
  steps.push([1400, { type: 'thinking', label: 'Planning', model: MUSE, effort: 'high', text: `${fe.id} on ${m}: ${fe.summary}. I need the trend, the as-built record, eyes on the module, and a grasp target before proposing anything.` }])
  steps.push([300, { type: 'plan', steps: [
    { goal: 'Read the failing channels', tool: 'read_telemetry' }, { goal: `Pull ${m}'s as-built record`, tool: 'get_records' },
    { goal: 'Inspect the damage', tool: 'inspect_frame' }, { goal: 'Segment the grasp targets', tool: 'segment' }, { goal: 'Propose an action to the envelope', tool: 'propose_action' }] }])
  steps.push([200, usage('plan', 'planner', MUSE, 'high', 3800, 410, 620, 2400)])
  // telemetry
  steps.push([500, { type: 'tool_call', callId: 'c1', name: 'read_telemetry', args: { channels: tm, window: [0, 'now'] }, model: MUSE, effort: 'minimal', round: 1 }])
  steps.push([900, { type: 'tool_result', callId: 'c1', name: 'read_telemetry', summary: s === 'radiator-puncture' ? 'Loop B 310 → 186 kPa; GPU 62 → 66 °C, trending to 85 °C at T+34:00' : s === 'power-bus-short' ? 'Bus A 0 V since T+01:30; util capped at 48 %; GPU cooling' : 'Body rate 0.06 °/s rising; latch load 1.1 kN, 4.5 kN at T+15:00', citations: tm.map((id) => rec(id)), ms: 412 }])
  steps.push([100, usage('route', 'executor', MUSE, 'minimal', 2900, 60, 0, 380)])
  // records
  steps.push([500, { type: 'tool_call', callId: 'c2', name: 'get_records', args: { module: m }, model: MUSE, effort: 'minimal', round: 1 }])
  steps.push([800, { type: 'tool_result', callId: 'c2', name: 'get_records', summary: `${recs.length} records: ${s === 'power-bus-short' ? 'NCR-0412 overrides the FRU catalogue' : s === 'radiator-puncture' ? 'one loop holds only at ≤ 74 % util' : 'latch valve accepted slow; latch rated 4500 N'}`, citations: recs.map((id) => rec(id, RECORDS.find((r) => r.id === id)?.title)), ms: 96 }])
  if (d.migrate) {
    steps.push([600, { type: 'tool_call', callId: 'c2b', name: 'propose_action', args: { action: 'MIGRATE_WORKLOADS', module: m, targets: d.migrate.params.targets }, model: MUSE, effort: 'minimal', round: 2 }])
    steps.push([500, { type: 'decision', callId: 'c2b', decision: d.migrate }])
    steps.push([200, { type: 'tool_result', callId: 'c2b', name: 'propose_action', summary: 'auto · migrating to ≤ 74 %', citations: [rec('TR-1180')], ms: 31 }])
  }
  // vision
  steps.push([600, { type: 'tool_call', callId: 'c3', name: 'inspect_frame', args: { frame: 'CAM-2', question: 'Describe the damage and anything near the grasp points.' }, model: MUSE, effort: 'medium', round: 2 }])
  steps.push([2200, { type: 'vision', callId: 'c3', frame: 'CAM-2', findings: s === 'radiator-puncture' ? 'Perforation ~4 cm on radiator B, upper right quadrant, with a frost halo of frozen coolant. Latch B is 0.3 m from the hole. Grapple fixture is intact.' : s === 'power-bus-short' ? 'No external damage. PDU access panel closed; scorching visible at the panel seam. Grapple fixture intact.' : 'Plume visible from the +X/+Y thruster pod. Module visibly rotated against its dock latches.', citations: [rec('CAM-2')] }])
  steps.push([200, { type: 'tool_result', callId: 'c3', name: 'inspect_frame', summary: 'Damage localised; grapple fixture clear', citations: [rec('CAM-2')], ms: 2310 }])
  steps.push([100, usage('vision', 'vision', MUSE, 'medium', 2650, 180, 240, 2310)])
  // SAM
  const segs: Segment[] = [
    { id: 'SEG-1', frame: 'CAM-3', concept: 'grapple fixture', box: { x1: 372, y1: 288, x2: 516, y2: 432 }, confidence: 0.94,
      maskPath: 'M 395 296 L 493 296 Q 508 296 508 311 L 508 409 Q 508 424 493 424 L 395 424 Q 380 424 380 409 L 380 311 Q 380 296 395 296 Z', point: [16.2, 0, 0], feature: { id: 'grapple', distance: 0.04 } },
  ]
  if (s === 'radiator-puncture') segs.push({ id: 'SEG-2', frame: 'CAM-3', concept: 'radiator latch', box: { x1: 1160, y1: 173, x2: 1210, y2: 223 }, confidence: 0.81, point: [15.1, 0.8, -1.3], feature: { id: 'damage', distance: 0.3 } })
  steps.push([600, { type: 'tool_call', callId: 'c4', name: 'segment', args: { frame: 'CAM-3', concepts: segs.map((x) => x.concept) }, model: 'sam-3.1', round: 2 }])
  steps.push([1600, { type: 'segments', callId: 'c4', frame: 'CAM-3', concept: segs.map((x) => x.concept).join(', '), segments: segs }])
  steps.push([200, { type: 'tool_result', callId: 'c4', name: 'segment', summary: segs.map((x) => `${x.id} ${x.concept} ${(x.confidence ?? 0).toFixed(2)}`).join(' · '), citations: segs.map((x) => rec(x.id, x.concept)), ms: 1480 }])
  if (s === 'thruster-stuck') {
    steps.push([500, { type: 'tool_call', callId: 'c5', name: 'web_search', args: { query: 'controlled disposal of failed module stuck thruster precedent' }, model: 'server', round: 3 }])
    steps.push([1400, { type: 'tool_result', callId: 'c5', name: 'web_search', summary: '3 sources: ESA ClearSpace-1, NASA ODMSP disposal guidelines', citations: [{ type: 'web', id: 'WEB-1', label: 'NASA ODMSP', url: 'https://orbitaldebris.jsc.nasa.gov/library/usg_orbital_debris_mitigation_standard_practices_november_2019.pdf' }], ms: 1390 }])
  }
  // proposals
  if (d.first) {
    steps.push([700, { type: 'tool_call', callId: 'c6', name: 'propose_action', args: { action: d.first.action, ...d.first.params }, model: MUSE, effort: 'minimal', round: 3 }])
    steps.push([700, { type: 'decision', callId: 'c6', decision: d.first }])
    steps.push([200, { type: 'tool_result', callId: 'c6', name: 'propose_action', summary: 'refused · damage-keepout failed', citations: [rec('SEG-2')], ms: 28 }])
    steps.push([800, { type: 'thinking', label: 'Re-targeting', model: MUSE, effort: 'high', text: 'The envelope refused SEG-2. Grasp the standard grapple fixture (SEG-1) instead; it is 1.9 m from the puncture.' }])
  }
  steps.push([700, { type: 'tool_call', callId: 'c7', name: 'propose_action', args: { action: d.final.action, ...d.final.params }, model: MUSE, effort: 'minimal', round: 4 }])
  steps.push([700, { type: 'decision', callId: 'c7', decision: d.final }])
  steps.push([200, { type: 'tool_result', callId: 'c7', name: 'propose_action', summary: `${d.final.tier} · ${d.final.checks.filter((c) => c.pass).length}/${d.final.checks.length} checks pass`, citations: [rec('SEG-1')], ms: 33 }])
  // answer
  const md = ANSWERS[s]
  const words = md.split(/(?<=\s)/)
  for (let i = 0; i < words.length; i += 6) steps.push([90, { type: 'answer_delta', text: words.slice(i, i + 6).join('') }])
  const ids = Array.from(new Set(md.match(/\b(?:NCR|TR|FRU|ICD|OPS|BLD|TM|FE|CAM|SEG|WEB)-[A-Z0-9-]+\b/g) ?? []))
  steps.push([200, { type: 'answer', markdown: md, citations: ids.map((id) => id === 'WEB-1' ? { type: 'web', id, label: 'NASA ODMSP', url: 'https://orbitaldebris.jsc.nasa.gov/' } : rec(id)), unknownIds: [] }])
  steps.push([100, usage('answer', 'answer', MUSE, 'high', 7400, 520, 380, 5200)])
  steps.push([100, { type: 'done', totals: { promptTokens: 19500, completionTokens: 1350, costUsd: cost(19500, 1350), ms: 24800, toolCalls: d.first ? 7 : 6 } }])
  return steps
}

/** Same contract as `useAgentRuns`, replaying a scripted run with realistic pacing. */
export function useMockAgentRuns(): UseAgentRuns {
  const [runs, setRuns] = useState<AgentRun[]>([])
  const timers = useRef<number[]>([])
  const clear = () => { timers.current.forEach((h) => window.clearTimeout(h)); timers.current = [] }
  const start: UseAgentRuns['start'] = useCallback(async ({ scenario, question, source }) => {
    const id = `run-${Date.now()}`
    setRuns((rs) => [...rs, { id, scenario, question, source, events: [], status: 'running' }])
    const steps = script(scenario, question)
    let at = 0
    steps.forEach(([delay, ev], i) => {
      at += delay
      timers.current.push(window.setTimeout(() => {
        setRuns((rs) => rs.map((r) => r.id === id ? { ...r, events: [...r.events, ev], status: i === steps.length - 1 ? 'done' : 'running' } : r))
      }, at))
    })
  }, [])
  const stop = useCallback(() => { clear(); setRuns((rs) => rs.map((r) => r.status === 'running' ? { ...r, status: 'done' } : r)) }, [])
  const reset = useCallback(() => { clear(); setRuns([]) }, [])
  return { runs, running: runs.some((r) => r.status === 'running'), start, stop, reset }
}
