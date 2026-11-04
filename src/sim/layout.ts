// Lattice geometry per docs/DESIGN.md "Geometry". Pure constants.
import type { FeatureId, LatticeLayout, ModuleGeometry, ModuleId, Vec3 } from '@/contracts'
import { DEG, type Pose, qRadial, toWorld } from './vec'

export const RING_RADIUS = 14
export const MODULE_SIZE: Vec3 = [3.2, 2.0, 2.4]
export const HALF: Vec3 = [1.6, 1.0, 1.2]
export const KEEP_OUT_RADIUS = 20
export const DEPOT: Vec3 = [0, 0, -30]
export const SERVICER_HOME: Vec3 = [0, 0, -26]
/** Radiator panel: 2.8 (x) × 1.6 (y), standing off 0.1 m from the ±Z faces, 4 cm thick. */
export const PANEL = { size: [2.8, 1.6, 0.04] as Vec3, z: HALF[2] + 0.1 }
/** Radiator features (panel centre, latches, puncture) sit on the panel's outer, space-facing surface. */
export const PANEL_FACE = PANEL.z + PANEL.size[2] / 2
/** Servicer: 1.4 m cube bus, two arms on the front (+X) face, shoulders ±0.5 m along the bus Z, 2.6 m reach. */
export const SERVICER = { half: 0.7, shoulder: 0.5, reach: 2.6, standoff: 1.6, cameraFovDeg: 50 }
/** Ring radius used for transits around the keep-out sphere (the 30 m hold radius). */
export const TRANSIT_RADIUS = RING_RADIUS + HALF[0] + 30
/** Depot berths: spares, plus an empty berth (B3, 5 m below the plane) for a failed module brought home. */
export const BERTH = { 'S-1': [-5, 0, -31] as Vec3, 'S-2': [5, 0, -31] as Vec3, B3: [0, -5, -32] as Vec3 }

export const moduleId = (slot: number): ModuleId => `M-${String(slot + 1).padStart(2, '0')}`
export const slotOf = (id: ModuleId): number | null => {
  const m = /^M-(\d{2})$/.exec(id)
  if (!m) return null
  const k = Number(m[1]) - 1
  return k >= 0 && k < 12 ? k : null
}
export const slotAngle = (slot: number) => slot * 30 * DEG
/** Radial (+R) unit vector of a slot. */
export const slotRadial = (slot: number): Vec3 => [Math.cos(slotAngle(slot)), 0, Math.sin(slotAngle(slot))]
export const slotPose = (slot: number): Pose => ({
  position: [RING_RADIUS * Math.cos(slotAngle(slot)), 0, RING_RADIUS * Math.sin(slotAngle(slot))],
  quaternion: qRadial(slotAngle(slot)),
})
const parkedPose = (p: Vec3): Pose => ({ position: p, quaternion: qRadial(Math.atan2(p[2], p[0])) })

/** Four radiator latches along each panel's outer (+X) edge; index 0 is the outer corner (the named feature). */
export const latchPoints = (side: 'a' | 'b'): Vec3[] => {
  const z = side === 'a' ? PANEL_FACE : -PANEL_FACE
  return [0.8, 0.27, -0.27, -0.8].map((y): Vec3 => [1.4, y, z])
}

/** Damage sites (module-local) per failing module. Each scenario fails a different module, so the layout carries all three. */
export const DAMAGE: Record<string, Vec3> = {
  // 0.6 m inboard of the radiator_b latch (1.4, 0.8, -1.3): (-0.55, -0.24) → |d| = 0.600 m
  'M-09': [0.85, 0.56, -PANEL_FACE],
  // the PDU panel on the -Y face
  'M-04': [0.15, -HALF[1], 0.1],
  // the RCS pod on the +X/+Y edge
  'M-11': [1.6, 1.0, 0.8],
}

function features(id: ModuleId): Record<FeatureId, Vec3> {
  const f: Partial<Record<FeatureId, Vec3>> = {
    grapple: [HALF[0], 0, 0],
    dock_port: [-HALF[0], 0, 0],
    radiator_a: [0, 0, PANEL_FACE],
    radiator_b: [0, 0, -PANEL_FACE],
    radiator_latch_a: latchPoints('a')[0],
    radiator_latch_b: latchPoints('b')[0],
    pdu_panel: [0, -HALF[1], 0],
    thruster_pod: [HALF[0], HALF[1], 0.8],
  }
  if (DAMAGE[id]) f.damage = DAMAGE[id]
  // Healthy modules have no `damage` key: the Record type is satisfied for every key that exists.
  return f as Record<FeatureId, Vec3>
}

let cached: LatticeLayout | null = null
export function latticeLayout(): LatticeLayout {
  if (cached) return cached
  const modules: ModuleGeometry[] = []
  for (let k = 0; k < 12; k++) {
    const id = moduleId(k)
    const p = slotPose(k)
    modules.push({ id, slot: k, position: p.position, quaternion: p.quaternion, size: [...MODULE_SIZE], features: features(id) })
  }
  for (const id of ['S-1', 'S-2'] as const) {
    const p = parkedPose(BERTH[id])
    modules.push({ id, slot: null, position: p.position, quaternion: p.quaternion, size: [...MODULE_SIZE], features: features(id) })
  }
  cached = {
    ringRadius: RING_RADIUS,
    modules,
    depot: DEPOT,
    servicerHome: SERVICER_HOME,
    // Module-local +X: every rendezvous runs along the target slot's radial axis (see corridorAxisOf).
    corridorAxis: [1, 0, 0],
    keepOutRadius: KEEP_OUT_RADIUS,
  }
  return cached
}

export const moduleGeom = (id: ModuleId): ModuleGeometry | undefined => latticeLayout().modules.find((m) => m.id === id)
export const modulePose = (id: ModuleId): Pose | undefined => {
  const m = moduleGeom(id)
  return m ? { position: m.position, quaternion: m.quaternion } : undefined
}
/** Lattice-frame corridor axis for a slot (unit vector pointing radially outward; approach runs along its negative). */
export const corridorAxisOf = (id: ModuleId): Vec3 | null => {
  const k = slotOf(id)
  return k === null ? null : slotRadial(k)
}
export const featureWorld = (id: ModuleId, f: FeatureId): Vec3 | undefined => {
  const m = moduleGeom(id)
  const p = m?.features[f]
  return m && p ? toWorld({ position: m.position, quaternion: m.quaternion }, p) : undefined
}
/** Servicer shoulders (lattice frame) at the planned standoff in front of a docked module's grapple. */
export const shoulders = (id: ModuleId): Vec3[] => {
  const pose = modulePose(id)
  if (!pose) return []
  const x = HALF[0] + SERVICER.standoff
  return [toWorld(pose, [x, 0, SERVICER.shoulder]), toWorld(pose, [x, 0, -SERVICER.shoulder])]
}
