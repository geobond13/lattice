// Pure geometry helpers for the scene (no three.js, no DOM): safe to import from node / headless scripts.
// Conventions (lattice frame, metres, Y up): a module's local +X points radially outward, +Y up, +Z along-ring.
// Quaternions are [x, y, z, w].
import type { BodyPose, FeatureId, LatticeLayout, ModuleGeometry, ModuleId, ModuleStatus, Quat, Vec3 } from '@/contracts'

export type DamageKind = 'radiator-puncture' | 'power-bus-short' | 'thruster-stuck'

// ─── Visual language ──────────────────────────────────────────────────────────────────────────────

export const ACCENT = '#59d6ff'
export const STATUS_COLOR: Record<ModuleStatus, string> = {
  nominal: '#6b7a90',
  degraded: '#f2b84b',
  failed: '#ff5d5d',
  draining: '#f2b84b',
  drained: '#59d6ff',
  undocked: '#59d6ff',
  docking: '#59d6ff',
  departed: '#ff5d5d',
  spare: '#9aa7ff',
}

/** Utilisation may arrive as a fraction (0..1) or a percentage (0..100). Returns 0..1. */
export function utilFraction(u: number): number {
  const f = u > 1.5 ? u / 100 : u
  return Math.min(1, Math.max(0, f))
}

// ─── Tiny vector math ─────────────────────────────────────────────────────────────────────────────

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Rotate v by unit quaternion q = [x, y, z, w]. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ]
}

/** Quaternion for a rotation of `angle` radians about +Y. */
export function quatY(angle: number): Quat {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]
}

// ─── Modules and features ─────────────────────────────────────────────────────────────────────────

export function findModule(layout: LatticeLayout, id: ModuleId): ModuleGeometry | undefined {
  return layout.modules.find((m) => m.id === id)
}

/** Default local feature positions per DESIGN.md (used only where the layout omits a feature). */
export function defaultFeatures(size: Vec3, damage: DamageKind | null): Partial<Record<FeatureId, Vec3>> {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2]
  const rz = hz + 0.1
  const f: Partial<Record<FeatureId, Vec3>> = {
    grapple: [hx, 0, 0],
    dock_port: [-hx, 0, 0],
    radiator_a: [0, 0, rz],
    radiator_b: [0, 0, -rz],
    radiator_latch_a: [1.3, 0.7, rz],
    radiator_latch_b: [1.3, 0.7, -rz],
    pdu_panel: [0.3, -hy, 0],
    thruster_pod: [hx, hy, 0.8],
  }
  if (damage === 'radiator-puncture') f.damage = [0.75, 0.45, -rz]
  else if (damage === 'power-bus-short') f.damage = f.pdu_panel
  else if (damage === 'thruster-stuck') f.damage = f.thruster_pod
  return f
}

/** Features in module-local coordinates: the layout's own values win; defaults fill any gaps. */
export function featuresOf(m: ModuleGeometry, damage: DamageKind | null = null): Record<FeatureId, Vec3> {
  return { ...defaultFeatures(m.size, damage), ...m.features } as Record<FeatureId, Vec3>
}

export function localToWorld(pose: { position: Vec3; quaternion: Quat }, p: Vec3): Vec3 {
  return add(pose.position, rotate(pose.quaternion, p))
}

/** Which body face (outward unit normal, module-local) a local point sits on. Radiator stand-offs count as ±Z. */
export function faceNormal(size: Vec3, p: Vec3): Vec3 {
  const r = [Math.abs(p[0]) / (size[0] / 2), Math.abs(p[1]) / (size[1] / 2), Math.abs(p[2]) / (size[2] / 2)]
  // Edge features (thruster pod on the +X/+Y edge) get the bisector.
  if (r[0] > 0.95 && r[1] > 0.95) return norm([Math.sign(p[0]), Math.sign(p[1]), 0])
  const i = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2
  const n: Vec3 = [0, 0, 0]
  n[i] = Math.sign(p[i]) || 1
  return n
}

// ─── Inspection stations (CAM-1/2/3) ──────────────────────────────────────────────────────────────

export const INSPECTION_WIDTH = 1024
export const INSPECTION_HEIGHT = 768
/** Vertical field of view (degrees) per station. Aspect is always 1024/768 = 4:3. */
export const INSPECTION_FOV = { wide: 40, close: 50 } as const

export interface InspectionStation {
  id: 'CAM-1' | 'CAM-2' | 'CAM-3'
  label: string
  /** Pinhole camera in the lattice frame. fovDeg is VERTICAL; aspect = width / height = 4:3. */
  camera: { position: Vec3; target: Vec3; up: Vec3; fovDeg: number }
}

/**
 * The three fixed inspection stations around a module, in the lattice frame. Pure, deterministic.
 * - CAM-1: wide, ~12 m out along the module's +X (radial), slightly above, yawed toward the damaged side; 40° vfov.
 * - CAM-2: ~4 m from the `damage` feature, looking at it from outside its face; 50° vfov.
 * - CAM-3: ~4 m from the midpoint of the grapple fixture and the radiator latch; 50° vfov.
 * `pose` overrides the module's docked pose (e.g. pose.modules[id] while it is moving).
 * `damage` only fills a missing `damage` feature from DESIGN.md defaults.
 */
export function inspectionStations(
  layout: LatticeLayout,
  module: ModuleId,
  opts: { pose?: Pick<BodyPose, 'position' | 'quaternion'>; damage?: DamageKind | null } = {},
): InspectionStation[] {
  const m = findModule(layout, module)
  if (!m) throw new Error(`inspectionStations: unknown module ${module}`)
  const pose = opts.pose ?? { position: m.position, quaternion: m.quaternion }
  const f = featuresOf(m, opts.damage ?? null)
  const hz = m.size[2] / 2
  const damage = f.damage ?? f.radiator_b
  // Look at the damaged side of the module (radiator B, −Z, by default).
  const side = Math.abs(damage[2]) > hz * 0.5 ? Math.sign(damage[2]) : -1
  const up = norm(rotate(pose.quaternion, [0, 1, 0]))
  const W = (p: Vec3) => localToWorld(pose, p)

  // CAM-1: wide fly-around station.
  const d1 = norm([1, 0.28, 0.42 * side])
  const cam1 = { position: W(scale(d1, 12)), target: W([0, 0, 0]), up, fovDeg: INSPECTION_FOV.wide }

  // CAM-2: damage close-up, from outside the damaged face, slightly outboard and above.
  const n = faceNormal(m.size, damage)
  const d2 = norm(add(add(n, [0.5, 0.3, 0]), n[1] !== 0 ? [0, 0, 0.3 * side] : [0, 0, 0]))
  const cam2 = { position: W(add(damage, scale(d2, 4))), target: W(damage), up, fovDeg: INSPECTION_FOV.close }

  // CAM-3: grapple fixture + the latch of the radiator on the damaged side.
  const latch = side < 0 ? f.radiator_latch_b : f.radiator_latch_a
  const mid = scale(add(f.grapple, latch), 0.5)
  const d3 = norm([1, 0.35, 0.55 * side])
  const cam3 = { position: W(add(mid, scale(d3, 4))), target: W(mid), up, fovDeg: INSPECTION_FOV.close }

  return [
    { id: 'CAM-1', label: 'Fly-around, 12 m, +R', camera: cam1 },
    { id: 'CAM-2', label: 'Damage site close-up, 4 m', camera: cam2 },
    { id: 'CAM-3', label: `Grapple fixture + latch ${side < 0 ? 'B' : 'A'}, 4 m`, camera: cam3 },
  ]
}

// ─── Hardware generations ─────────────────────────────────────────────────────────────────────────

/** One hue ramp: Gen-1 dim steel blue → Gen-4 bright cyan-white. */
export const GEN_COLOR: Record<1 | 2 | 3 | 4, string> = { 1: '#4d6a8c', 2: '#5f93bf', 3: '#7fcbec', 4: '#d8f6ff' }
/** Trim emissive strength per generation (subtle; status colour stays the primary signal). */
export const GEN_GLOW: Record<1 | 2 | 3 | 4, number> = { 1: 0.35, 2: 0.6, 3: 0.95, 4: 1.4 }
/** Panel finish per generation: older = warmer, rougher; newer = cooler, satin. */
export const GEN_FINISH: Record<1 | 2 | 3 | 4, { tint: string; roughness: number; metalness: number }> = {
  1: { tint: '#ece6dc', roughness: 0.66, metalness: 0.08 },
  2: { tint: '#e8eaee', roughness: 0.56, metalness: 0.14 },
  3: { tint: '#e4eaf1', roughness: 0.46, metalness: 0.2 },
  4: { tint: '#e2ecf7', roughness: 0.36, metalness: 0.28 },
}
