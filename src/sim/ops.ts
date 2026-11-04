// Proximity-operations choreography: OpsTimeline builder + poseAt. Every pose is a pure function of
// (action, module, tau). Phases are built sequentially from the previous phase's end state, so the
// choreography is continuous by construction (tests sample it densely).
import type { ActionKind, ArmPose, BodyPose, ModuleId, OpsTimeline, Phase, PhaseKind, Quat, ScenarioId, ScenePose, Vec3 } from '@/contracts'
import {
  BERTH, HALF, PANEL, SERVICER, SERVICER_HOME, TRANSIT_RADIUS, latchPoints, moduleGeom, slotOf, slotPose, slotRadial,
} from './layout'
import { baseDemand } from './models'
import { FAULTS, SCENARIOS, scenarioOfModule } from './scenarios'
import {
  add, clamp, DEG, dist, len, lerp, lerpV, norm, type Pose, qAxisAngle, qLookX, qMul, qRadial, scale, smooth, sub, toWorld,
} from './vec'

type Fru = NonNullable<ScenePose['fru']>
interface Frame {
  servicer: Vec3
  look: Vec3
  arms: [ArmPose, ArmPose]
  modules: Record<ModuleId, BodyPose>
  fru?: Fru
  /** Range is |rangeFrom − rangeTo| − rangeOffset. */
  rangeFrom: Vec3
  rangeTo: Vec3
  rangeOffset: number
  burn?: boolean
}
interface PhaseImpl { kind: PhaseKind; label: string; dur: number; at: (u: number) => Frame }
export interface Plan {
  action: ActionKind
  module: ModuleId
  spare?: ModuleId
  fru?: 'radiator_a' | 'radiator_b'
  phases: PhaseImpl[]
  duration: number
  times: [number, number][]
}

const STOW: ArmPose = { target: null, grip: 0 }
const HOME_LOOK: Vec3 = add(SERVICER_HOME, [0, 0, 10])
/** Servicer centre in a target module's local frame when grappled at the 1.6 m standoff: 1.6 + 1.6 + 0.7. */
export const GRAPPLED_X = HALF[0] + SERVICER.standoff + SERVICER.half
const GRAPPLE_LOCAL: Vec3 = [HALF[0], 0, 0]
const HOLD10_X = HALF[0] + 10 + SERVICER.half
const HOLD30_X = HALF[0] + 30 + SERVICER.half

// ─── Paths ───────────────────────────────────────────────────────────────────────────────────────
interface Path { at: (s: number) => Vec3; length: number }
function polyline(pts: Vec3[]): Path {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]))
  const L = cum[cum.length - 1]
  return {
    length: L,
    at(s) {
      if (L < 1e-9) return pts[0]
      const d = clamp(s) * L
      let i = 1
      while (i < cum.length - 1 && cum[i] < d) i++
      const seg = cum[i] - cum[i - 1]
      return lerpV(pts[i - 1], pts[i], seg > 0 ? (d - cum[i - 1]) / seg : 1)
    },
  }
}
const angleXZ = (p: Vec3) => Math.atan2(p[2], p[0])
/** Distance from the origin to segment ab. */
function segOriginDist(a: Vec3, b: Vec3): number {
  const ab = sub(b, a)
  const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
  const t = L2 > 0 ? clamp(-(a[0] * ab[0] + a[1] * ab[1] + a[2] * ab[2]) / L2) : 0
  return len(add(a, scale(ab, t)))
}
/**
 * Route between two points around the keep-out sphere: straight if the chord clears it by 2 m, otherwise
 * radially out to the transit ring (the 30 m hold radius), around it (dir −1 = decreasing angle, +1
 * increasing, 0 shortest) and radially in. Inside 20 m the only legs are radial, i.e. along a corridor.
 */
function transitPath(a: Vec3, b: Vec3, dir: -1 | 0 | 1 = 0, R = TRANSIT_RADIUS): Path {
  if (segOriginDist(a, b) >= 22) return polyline([a, b])
  const ta = angleXZ(a)
  let d = angleXZ(b) - ta
  if (dir === 0) d = Math.atan2(Math.sin(d), Math.cos(d))
  else if (dir < 0) { while (d > 0) d -= 2 * Math.PI } else { while (d < 0) d += 2 * Math.PI }
  const pts: Vec3[] = [a]
  const steps = Math.max(2, Math.ceil(Math.abs(d) / (2 * DEG)))
  for (let i = 0; i <= steps; i++) {
    const th = ta + (d * i) / steps
    pts.push([R * Math.cos(th), lerp(a[1], b[1], i / steps), R * Math.sin(th)])
  }
  pts.push(b)
  return polyline(pts)
}
/** Transit duration at an average speed (m/s), rounded to 10 s. */
const transitDur = (p: Path, v = 0.4) => Math.max(60, Math.round(p.length / v / 10) * 10)

// ─── Builder ─────────────────────────────────────────────────────────────────────────────────────
class Builder {
  phases: PhaseImpl[] = []
  t = 0
  constructor(public cur: Frame) {}
  /** `at(u, t0, start)`: u ∈ [0,1] within the phase, t0 = phase start (s from ops start), start = previous end frame. */
  push(kind: PhaseKind, label: string, dur: number, at: (u: number, t0: number, start: Frame) => Frame) {
    const t0 = this.t
    const start = this.cur
    this.phases.push({ kind, label, dur, at: (u) => at(u, t0, start) })
    this.t += dur
    this.cur = at(1, t0, start)
  }
  /** Servicer flies a path (eased), looking at a fixed point or blending between two. */
  fly(kind: PhaseKind, label: string, path: Path | [Vec3, Vec3], dur: number, opts: { look?: Vec3; lookTo?: Vec3; rangeTo?: Vec3 } = {}) {
    const s = this.cur
    const p = Array.isArray(path) ? polyline(path) : path
    this.push(kind, label, dur, (u) => {
      const pos = p.at(smooth(u))
      return {
        ...s,
        servicer: pos,
        look: opts.lookTo ? lerpV(opts.look ?? s.look, opts.lookTo, smooth(u)) : opts.look ?? s.look,
        rangeFrom: pos,
        rangeTo: opts.rangeTo ?? s.rangeTo,
        rangeOffset: SERVICER.half,
      }
    })
  }
  hold(label: string, dur: number, kind: PhaseKind = 'hold') {
    const s = this.cur
    this.push(kind, label, dur, () => s)
  }
  plan(action: ActionKind, module: ModuleId, extra: Partial<Plan> = {}): Plan {
    const times: [number, number][] = []
    let t = 0
    for (const p of this.phases) { times.push([t, t + p.dur]); t += p.dur }
    return { action, module, phases: this.phases, duration: t, times, ...extra }
  }
}

function homeFrame(): Frame {
  return { servicer: SERVICER_HOME, look: HOME_LOOK, arms: [STOW, STOW], modules: {}, rangeFrom: SERVICER_HOME, rangeTo: HOME_LOOK, rangeOffset: SERVICER.half }
}

// ─── Drain ───────────────────────────────────────────────────────────────────────────────────────
/** Util the module is drained from (its fault state). */
export function drainFrom(module: ModuleId): number {
  if (scenarioOfModule(module) === 'power-bus-short') return 48
  const k = slotOf(module)
  return k === null ? 0 : Math.round(baseDemand(k, 0))
}
export function drainTarget(action: ActionKind, module: ModuleId): number {
  if (action === 'SWAP_MODULE' || action === 'DEORBIT_MODULE') return 0
  const s = scenarioOfModule(module)
  return s ? FAULTS[s].migrateTo : 0
}
const isEmergency = (module: ModuleId) => scenarioOfModule(module) === 'thruster-stuck'
/** Checkpoint + live-migrate time: 45 s plus 3.5 s per point of util moved; an emergency checkpoint is 60 s. */
export function drainDur(from: number, to: number, emergency: boolean): number {
  return emergency ? 60 : Math.round(45 + 3.5 * Math.max(0, from - to))
}
function drainPhase(b: Builder, action: ActionKind, module: ModuleId, look?: Vec3) {
  const from = drainFrom(module)
  const to = drainTarget(action, module)
  const em = isEmergency(module)
  const label = em ? `Emergency checkpoint: drain ${module} ${from} % → ${to} %` : `Migrate workloads off ${module}: ${from} % → ${to} %`
  b.push('drain', label, drainDur(from, to, em), (u, _t0, s) => ({ ...s, look: look ? lerpV(s.look, look, smooth(u)) : s.look }))
}

const slotFrame = (module: ModuleId) => {
  const k = slotOf(module) as number
  const P = slotPose(k)
  const r = slotRadial(k)
  const g = toWorld(P, GRAPPLE_LOCAL)
  /** Servicer centre for a given range (front face to grapple) on the corridor. */
  return { k, P, r, g, at: (range: number) => add(g, scale(r, range + SERVICER.half)) }
}

/** Common inbound: depart home → hold 30 m → approach → hold 10 m (go/no-go) → final approach → grapple. */
function inbound(b: Builder, module: ModuleId, dir: -1 | 0 | 1 = 0) {
  const f = slotFrame(module)
  const p30 = f.at(30)
  const path = transitPath(b.cur.servicer, p30, dir)
  b.fly('depart_home', `Depart depot for ${module} (${Math.round(path.length)} m transit)`, path, transitDur(path), { look: b.cur.look, lookTo: f.g, rangeTo: f.g })
  b.hold(`Hold at 30 m on ${module}'s corridor`, 30)
  b.fly('approach', 'Corridor approach 30 → 10 m', [p30, f.at(10)], 180, { look: f.g })
  b.hold('Hold at 10 m: go/no-go for keep-out entry', 60)
  b.fly('final_approach', `Final approach to ${SERVICER.standoff} m standoff`, [f.at(10), f.at(SERVICER.standoff)], 240, { look: f.g })
  b.push('grapple', `Grapple ${module} fixture (ICD-GRP-01)`, 45, (u, _t0, s) => ({ ...s, arms: [{ target: f.g, grip: smooth((u - 0.4) / 0.6) }, STOW] }))
  return f
}
function outbound(b: Builder, module: ModuleId, dir: -1 | 0 | 1 = 0) {
  const f = slotFrame(module)
  b.fly('retreat', 'Retreat along corridor to 30 m', [b.cur.servicer, f.at(30)], 240, { look: f.g })
  const path = transitPath(f.at(30), SERVICER_HOME, dir)
  b.fly('return_home', 'Return to depot', path, transitDur(path), { look: f.g, lookTo: HOME_LOOK, rangeTo: SERVICER_HOME })
}
const releaseArm = (target: Vec3, u: number): ArmPose => (u < 1 ? { target, grip: 1 - smooth(u / 0.7) } : STOW)

// ─── REPAIR_FRU ──────────────────────────────────────────────────────────────────────────────────
function buildRepair(module: ModuleId, fru: 'radiator_a' | 'radiator_b'): Plan {
  const b = new Builder(homeFrame())
  const f = slotFrame(module)
  drainPhase(b, 'REPAIR_FRU', module, f.g)
  inbound(b, module)
  const side = fru === 'radiator_a' ? 'a' : 'b'
  const zs = side === 'a' ? 1 : -1
  const latches = latchPoints(side).map((p) => toWorld(f.P, p))
  const hold0: ArmPose = { target: f.g, grip: 1 }
  // Arm 2 works the four latches in turn: 30 % of each slot moving, 70 % torquing.
  const visit = (u: number, from: Vec3 = latches[0]): Vec3 => {
    const i = Math.min(3, Math.floor(u * 4))
    return lerpV(i === 0 ? from : latches[i - 1], latches[i], smooth((u * 4 - i) / 0.3))
  }
  b.push('unlatch', `Release 4 latches on ${fru} (12 N·m, FRU-RAD-02)`, 300, (u, _t0, s) => ({ ...s, arms: [hold0, { target: visit(u), grip: 0.9 }] }))
  // Panel: mounted → pulled 1 m clear of the body → caddy on top of the servicer bus.
  const mounted: Pose = { position: toWorld(f.P, [0, 0, zs * PANEL.z]), quaternion: f.P.quaternion }
  const pulled = toWorld(f.P, [0, 0, zs * (PANEL.z + 1)])
  const caddy = add(b.cur.servicer, [0, 1.3, 0])
  const panelAt = (v: number): Vec3 => (v < 0.35 ? lerpV(mounted.position, pulled, smooth(v / 0.35)) : lerpV(pulled, caddy, smooth((v - 0.35) / 0.65)))
  const fruPose = (pos: Vec3, damaged: boolean): Fru => ({ position: pos, quaternion: mounted.quaternion, visible: true, kind: fru, damaged })
  const edge = (pos: Vec3) => toWorld({ position: pos, quaternion: mounted.quaternion }, [1.4, 0, 0])
  b.push('extract', `Extract damaged ${fru} and stow it`, 240, (u, _t0, s) => {
    const p = panelAt(u)
    return { ...s, fru: fruPose(p, true), arms: [hold0, { target: lerpV(latches[3], edge(p), smooth(u / 0.08)), grip: 1 }] }
  })
  b.push('insert', `Insert new ${fru} panel (1 of 2 carried)`, 360, (u, _t0, s) => {
    const p = panelAt(1 - u)
    return { ...s, fru: fruPose(p, false), arms: [hold0, { target: edge(p), grip: 1 }] }
  })
  b.push('latch', 'Torque 4 latches to 12 N·m; refill loop B', 420, (u, _t0, s) => ({ ...s, fru: fruPose(mounted.position, false), arms: [hold0, { target: visit(u, edge(mounted.position)), grip: 0.9 }] }))
  b.push('release', 'Release grapple', 60, (u, _t0, s) => ({ ...s, fru: undefined, arms: [releaseArm(f.g, u), STOW] }))
  outbound(b, module)
  return b.plan('REPAIR_FRU', module, { fru })
}

// ─── SWAP_MODULE ─────────────────────────────────────────────────────────────────────────────────
const radialPose = (p: Vec3): Pose => ({ position: p, quaternion: qRadial(angleXZ(p)) })
const moduleBody = (p: Pose, visible = true): BodyPose => ({ position: p.position, quaternion: p.quaternion, visible })

function buildSwap(module: ModuleId, spare: ModuleId): Plan {
  const b = new Builder(homeFrame())
  const f = slotFrame(module)
  drainPhase(b, 'SWAP_MODULE', module, f.g)
  inbound(b, module)
  /** Servicer rigidly grappled to `mod` at `pose`. */
  const carry = (mod: ModuleId, pose: Pose, s: Frame): Frame => {
    const g = toWorld(pose, GRAPPLE_LOCAL)
    const sv = toWorld(pose, [GRAPPLED_X, 0, 0])
    return { ...s, servicer: sv, look: g, arms: [{ target: g, grip: 1 }, STOW], modules: { ...s.modules, [mod]: moduleBody(pose) }, rangeFrom: sv, rangeTo: g, rangeOffset: SERVICER.half }
  }
  const out4 = add(f.P.position, scale(f.r, 4))
  b.push('undock', `Undock ${module}: release 4 dock latches, back out 4 m`, 120, (u, _t0, s) => carry(module, { position: lerpV(f.P.position, out4, smooth(u)), quaternion: f.P.quaternion }, s))
  const tow = transitPath(out4, BERTH.B3, -1)
  b.push('tow', `Tow ${module} to depot berth B3`, transitDur(tow, 0.25), (u, _t0, s) => carry(module, radialPose(tow.at(smooth(u))), s))
  const mg = toWorld(radialPose(BERTH.B3), GRAPPLE_LOCAL)
  b.push('release', `Berth ${module} at B3 and release`, 45, (u, _t0, s) => ({ ...s, arms: [releaseArm(mg, u), STOW] }))
  // Translate to the spare at its berth.
  const sp = moduleGeom(spare) as NonNullable<ReturnType<typeof moduleGeom>>
  const spPose: Pose = { position: sp.position, quaternion: sp.quaternion }
  const sg = toWorld(spPose, GRAPPLE_LOCAL)
  b.fly('approach', `Translate to ${spare} at its berth`, [b.cur.servicer, toWorld(spPose, [GRAPPLED_X, 0, 0])], 240, { look: mg, lookTo: sg, rangeTo: sg })
  b.push('grapple', `Grapple ${spare}`, 45, (u, _t0, s) => ({ ...s, arms: [{ target: sg, grip: smooth((u - 0.4) / 0.6) }, STOW] }))
  // Carry the spare: range is measured from the spare's centre to the empty slot.
  const slotC = f.P.position
  const carrySpare = (pose: Pose, s0: Frame): Frame => ({ ...carry(spare, pose, s0), rangeFrom: pose.position, rangeTo: slotC, rangeOffset: 0 })
  const at = (range: number) => add(slotC, scale(f.r, range))
  const leg = transitPath(sp.position, at(30), -1)
  b.push('spare_approach', `Carry ${spare} to ${module}'s corridor, 30 m`, transitDur(leg, 0.25), (u, _t0, s) => carrySpare(radialPose(leg.at(smooth(u))), s))
  b.hold(`Hold at 30 m with ${spare}`, 30)
  b.push('spare_approach', `${spare} corridor approach 30 → 10 m`, 240, (u, _t0, s) => carrySpare({ position: lerpV(at(30), at(10), smooth(u)), quaternion: f.P.quaternion }, s))
  b.hold('Hold at 10 m: go/no-go for keep-out entry', 60)
  b.push('dock', `Dock ${spare} into slot ${f.k} (ICD-DOCK-01)`, 480, (u, _t0, s) => carrySpare({ position: lerpV(at(10), slotC, smooth(u)), quaternion: f.P.quaternion }, s))
  b.hold('Dock latches 4/4 engaged; power, coolant and data mate', 90, 'latch')
  b.push('release', `Release ${spare}`, 45, (u, _t0, s) => ({ ...s, arms: [releaseArm(f.g, u), STOW], rangeFrom: s.servicer, rangeTo: f.g, rangeOffset: SERVICER.half }))
  outbound(b, module, -1)
  return b.plan('SWAP_MODULE', module, { spare })
}

// ─── DEORBIT_MODULE ──────────────────────────────────────────────────────────────────────────────
export const SEPARATION = { v: 0.3, rampS: 3, tumbleDegS: 0.04, burnAccel: 0.03, burnS: 120, coastS: 60 }
function buildDeorbit(module: ModuleId): Plan {
  const b = new Builder(homeFrame())
  const f = slotFrame(module)
  drainPhase(b, 'DEORBIT_MODULE', module, f.g)
  const tSep = b.t
  const axis = norm([0.2, 1, 0.3])
  // Spring separation along −corridor (radially out) at 0.3 m/s with a slight tumble (OPS-SEP-03).
  const drift = (s: number) => (s <= 0 ? 0 : s < SEPARATION.rampS ? (SEPARATION.v * s * s) / (2 * SEPARATION.rampS) : SEPARATION.v * (s - SEPARATION.rampS / 2))
  const modAt = (t: number): Pose => {
    const s = Math.max(0, t - tSep)
    return { position: add(f.P.position, scale(f.r, drift(s))), quaternion: qMul(f.P.quaternion, qAxisAngle(axis, SEPARATION.tumbleDegS * DEG * s)) }
  }
  const holdPt = (t: number, x: number) => toWorld(modAt(t), [x, 0, 0])
  /** Servicer at `sv`, tracking the drifting module. */
  const track = (t: number, sv: Vec3, s0: Frame, arms: Frame['arms'] = s0.arms): Frame => {
    const pose = modAt(t)
    const g = toWorld(pose, GRAPPLE_LOCAL)
    return { ...s0, servicer: sv, look: g, arms, modules: { [module]: moduleBody(pose) }, rangeFrom: sv, rangeTo: g, rangeOffset: SERVICER.half }
  }
  b.push('undock', `Separate ${module}: spring push ${SEPARATION.v} m/s along −corridor (OPS-SEP-03)`, 60, (u, t0, s) => {
    const pose = modAt(t0 + u * 60)
    const g = toWorld(pose, GRAPPLE_LOCAL)
    return { ...s, look: lerpV(s.look, g, smooth(u)), modules: { [module]: moduleBody(pose) }, rangeTo: g }
  })
  // Intercept: fly toward where the 30 m hold point will be, plus the drift that accrues meanwhile; then a
  // corridor approach in the module's (drifting, slowly tumbling) frame.
  const durA = 480
  const endPt = holdPt(b.t + durA, HOLD30_X)
  const path = transitPath(b.cur.servicer, endPt)
  b.push('approach', `Intercept drifting ${module} at 30 m`, durA, (u, t0, s) => {
    const t = t0 + u * durA
    const k = smooth(u)
    // Arc 40 m above the ring plane so the intercept never passes near the drifting module.
    const bump: Vec3 = [0, 40 * Math.sin(Math.PI * k), 0]
    return track(t, add(add(path.at(k), bump), scale(sub(holdPt(t, HOLD30_X), endPt), k)), s)
  })
  b.push('hold', 'Hold at 30 m, drift matched', 30, (u, t0, s) => track(t0 + u * 30, holdPt(t0 + u * 30, HOLD30_X), s))
  b.push('approach', 'Corridor approach 30 → 10 m', 180, (u, t0, s) => track(t0 + u * 180, holdPt(t0 + u * 180, lerp(HOLD30_X, HOLD10_X, smooth(u))), s))
  b.push('hold', 'Hold at 10 m: go/no-go', 45, (u, t0, s) => track(t0 + u * 45, holdPt(t0 + u * 45, HOLD10_X), s))
  b.push('final_approach', `Final approach to ${SERVICER.standoff} m standoff`, 240, (u, t0, s) => track(t0 + u * 240, holdPt(t0 + u * 240, lerp(HOLD10_X, GRAPPLED_X, smooth(u))), s))
  b.push('grapple', `Capture ${module} (ICD-GRP-01)`, 45, (u, t0, s) => {
    const t = t0 + u * 45
    return track(t, holdPt(t, GRAPPLED_X), s, [{ target: toWorld(modAt(t), GRAPPLE_LOCAL), grip: smooth((u - 0.4) / 0.6) }, STOW])
  })
  // Disposal burn: the tug pulls the module away and down, releases, climbs clear; the module coasts on.
  const tB = b.t
  const durB = SEPARATION.burnS + SEPARATION.coastS
  const dBurn = norm(add(f.r, [0, -0.8, 0]))
  const a = SEPARATION.burnAccel
  const ext = (sb: number) => (sb <= SEPARATION.burnS ? 0.5 * a * sb * sb : 0.5 * a * SEPARATION.burnS ** 2 + a * SEPARATION.burnS * (sb - SEPARATION.burnS))
  b.push('dispose_burn', `Disposal burn into reentry corridor (OPS-DSP-02), release at ${SEPARATION.burnS} s`, durB, (u, t0, s) => {
    const t = t0 + u * durB
    const sb = t - tB
    const p = modAt(t)
    const pose: Pose = { position: add(p.position, scale(dBurn, ext(sb))), quaternion: p.quaternion }
    const g = toWorld(pose, GRAPPLE_LOCAL)
    const after = Math.max(0, sb - SEPARATION.burnS)
    const sv = add(toWorld(pose, [GRAPPLED_X, 0, 0]), [0, 0.5 * 0.03 * after * after, 0])
    return {
      ...s, servicer: sv, look: g, burn: sb < SEPARATION.burnS,
      arms: [after < 10 ? { target: g, grip: after <= 0 ? 1 : 1 - smooth(after / 10) } : STOW, STOW],
      modules: { [module]: moduleBody(pose, u < 1) }, rangeFrom: sv, rangeTo: g, rangeOffset: SERVICER.half,
    }
  })
  const back = transitPath(b.cur.servicer, SERVICER_HOME)
  b.push('return_home', 'Return to depot', transitDur(back, 0.8), (u, _t0, s) => {
    const pos = back.at(smooth(u))
    return { ...s, servicer: pos, look: lerpV(s.look, HOME_LOOK, smooth(u)), rangeFrom: pos, rangeTo: SERVICER_HOME, burn: false }
  })
  return b.plan('DEORBIT_MODULE', module)
}

// ─── INSPECT / MIGRATE ───────────────────────────────────────────────────────────────────────────
function buildInspect(module: ModuleId): Plan {
  const b = new Builder(homeFrame())
  const m = moduleGeom(module) as NonNullable<ReturnType<typeof moduleGeom>>
  const c = m.position
  const r = norm([c[0], 0, c[2]])
  const tg: Vec3 = [-r[2], 0, r[0]]
  const at = (phi: number): Vec3 => add(c, add(scale(r, 13 * Math.cos(phi)), scale(tg, 13 * Math.sin(phi))))
  const path = transitPath(b.cur.servicer, at(0))
  b.fly('depart_home', `Depart depot for ${module} inspection`, path, transitDur(path), { look: b.cur.look, lookTo: c, rangeTo: c })
  b.push('hold', `Fly-around inspection of ${module} at 13 m, ±50°`, 240, (u, _t0, s) => {
    const p = at(50 * DEG * Math.sin(2 * Math.PI * u))
    return { ...s, servicer: p, rangeFrom: p }
  })
  const back = transitPath(b.cur.servicer, SERVICER_HOME)
  b.fly('return_home', 'Return to depot', back, transitDur(back), { look: c, lookTo: HOME_LOOK, rangeTo: SERVICER_HOME })
  return b.plan('INSPECT', module)
}
function buildMigrate(module: ModuleId): Plan {
  const b = new Builder(homeFrame())
  drainPhase(b, 'MIGRATE_WORKLOADS', module)
  return b.plan('MIGRATE_WORKLOADS', module)
}

// ─── Public ──────────────────────────────────────────────────────────────────────────────────────
const plans = new Map<string, Plan>()
export function buildPlan(action: ActionKind, module: ModuleId, opts: { spare?: ModuleId; fru?: 'radiator_a' | 'radiator_b' } = {}): Plan {
  const key = `${action}|${module}|${opts.spare ?? ''}|${opts.fru ?? ''}`
  const hit = plans.get(key)
  if (hit) return hit
  let p: Plan
  switch (action) {
    case 'REPAIR_FRU': p = buildRepair(module, opts.fru ?? 'radiator_b'); break
    case 'SWAP_MODULE': p = buildSwap(module, opts.spare ?? 'S-1'); break
    case 'DEORBIT_MODULE': p = buildDeorbit(module); break
    case 'INSPECT': p = buildInspect(module); break
    default: p = buildMigrate(module)
  }
  plans.set(key, p)
  return p
}

export function toTimeline(p: Plan): OpsTimeline {
  const phases: Phase[] = p.phases.map((ph, i) => ({ kind: ph.kind, label: ph.label, t0: p.times[i][0], t1: p.times[i][1] }))
  return { action: p.action, module: p.module, phases, duration: p.duration }
}

/** Recover the plan behind a (possibly JSON-serialised) timeline. Spare and FRU are encoded in phase labels. */
export function planOf(ops: OpsTimeline): Plan {
  const spare = ops.phases.find((p) => p.kind === 'spare_approach')?.label.match(/S-\d/)?.[0]
  const fru = ops.phases.find((p) => p.kind === 'extract')?.label.match(/radiator_[ab]/)?.[0] as 'radiator_a' | 'radiator_b' | undefined
  return buildPlan(ops.action, ops.module, { spare, fru })
}

/** Phase index and local u at tau, honouring the timeline's own phase times. */
function locate(ops: OpsTimeline, plan: Plan, tau: number): { i: number; u: number } {
  const ph = ops.phases.length === plan.phases.length ? ops.phases.map((p) => [p.t0, p.t1] as [number, number]) : plan.times
  if (!ph.length) return { i: -1, u: 0 }
  if (tau <= ph[0][0]) return { i: 0, u: 0 }
  for (let i = 0; i < ph.length; i++) {
    const [a, b] = ph[i]
    if (tau < b) return { i, u: b > a ? (tau - a) / (b - a) : 1 }
  }
  return { i: ph.length - 1, u: 1 }
}

function frameAt(ops: OpsTimeline | null, tau: number): { f: Frame; phase: Phase | null } {
  if (!ops) return { f: homeFrame(), phase: null }
  const plan = planOf(ops)
  const { i, u } = locate(ops, plan, tau)
  if (i < 0) return { f: homeFrame(), phase: null }
  const phase = ops.phases[i] ?? { kind: plan.phases[i].kind, label: plan.phases[i].label, t0: plan.times[i][0], t1: plan.times[i][1] }
  return { f: plan.phases[i].at(u), phase }
}

const rangeOf = (f: Frame) => Math.max(0, dist(f.rangeFrom, f.rangeTo) - f.rangeOffset)

export function poseAt(ops: OpsTimeline | null, tau: number): ScenePose {
  const { f, phase } = frameAt(ops, tau)
  const h = 0.5
  const fm = frameAt(ops, tau - h).f
  const fp = frameAt(ops, tau + h).f
  const acc = len(add(sub(fp.servicer, scale(f.servicer, 2)), fm.servicer)) / (h * h)
  const thrust = f.burn ? 1 : clamp(acc / 0.006)
  const rangeRate = (rangeOf(fp) - rangeOf(fm)) / (2 * h)
  const quaternion: Quat = qLookX(f.servicer, f.look)
  const done = !!ops && tau >= ops.duration
  return {
    servicer: { position: f.servicer, quaternion, visible: true, arms: f.arms, thrust: done ? 0 : thrust },
    modules: f.modules,
    ...(f.fru ? { fru: f.fru } : {}),
    phase: done ? null : phase?.kind ?? null,
    phaseLabel: !ops ? 'Servicer at depot' : done ? 'Ops complete' : phase?.label ?? '',
    range: rangeOf(f),
    rangeRate: done || Math.abs(rangeRate) < 1e-6 ? 0 : rangeRate,
  }
}

/** Corridor-v: closing speed vs 0.01·range + 0.02 m/s, sampled every second of every inbound phase inside 30 m. */
export function corridorCheck(ops: OpsTimeline): { ok: boolean; worst: { v: number; range: number; limit: number; t: number } | null; peak: { v: number; range: number } | null } {
  const plan = planOf(ops)
  let worst: { v: number; range: number; limit: number; t: number } | null = null
  let peak: { v: number; range: number } | null = null
  let worstRatio = -Infinity
  const inboundKinds: PhaseKind[] = ['approach', 'final_approach', 'spare_approach', 'dock']
  plan.phases.forEach((ph, i) => {
    if (!inboundKinds.includes(ph.kind)) return
    const [a, b] = plan.times[i]
    for (let t = a; t <= b; t += 1) {
      const r = rangeOf(frameAt(ops, t).f)
      if (r > 30.5) continue
      const v = -(rangeOf(frameAt(ops, Math.min(b, t + 0.5)).f) - rangeOf(frameAt(ops, Math.max(a, t - 0.5)).f))
      const limit = 0.01 * r + 0.02
      if (v / limit > worstRatio) { worstRatio = v / limit; worst = { v, range: r, limit, t } }
      if (!peak || v > peak.v) peak = { v, range: r }
    }
  })
  return { ok: worst === null || worstRatio <= 1, worst, peak }
}

/** Canonical plan for a scenario's expected outcome (interprets `resolvedAt` in telemetry). */
export function canonicalPlan(scenario: ScenarioId): Plan {
  const s = SCENARIOS[scenario]
  const action: ActionKind = s.expected === 'REPAIR' ? 'REPAIR_FRU' : s.expected === 'SWAP' ? 'SWAP_MODULE' : 'DEORBIT_MODULE'
  return buildPlan(action, s.module, action === 'REPAIR_FRU' ? { fru: 'radiator_b' } : action === 'SWAP_MODULE' ? { spare: 'S-1' } : {})
}
/** [t0, t1] of the nth phase of a kind in a timeline. */
export function phaseSpan(ops: Pick<OpsTimeline, 'phases'>, kind: PhaseKind, nth = 0): [number, number] | null {
  let k = 0
  for (const ph of ops.phases) if (ph.kind === kind && k++ === nth) return [ph.t0, ph.t1]
  return null
}
