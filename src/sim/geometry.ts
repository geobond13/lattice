// Camera unprojection and feature lookup (lattice frame).
import type { CameraFrame, FeatureId, ModuleId, Vec3 } from '@/contracts'
import { HALF, PANEL, moduleGeom } from './layout'
import { add, cross, dist, dot, norm, type Pose, qConj, qRotate, scale, sub, toLocal, toWorld, DEG } from './vec'

/** Pinhole ray through a source pixel: three.js conventions (vertical FOV, aspect = w/h, pixel y down). */
export function pixelRay(frame: Pick<CameraFrame, 'camera' | 'width' | 'height'>, px: { x: number; y: number }): { origin: Vec3; dir: Vec3 } {
  const { position, target, up, fovDeg } = frame.camera
  const f = norm(sub(target, position))
  const r = norm(cross(f, up))
  const u = cross(r, f)
  const th = Math.tan((fovDeg * DEG) / 2)
  const aspect = frame.width / frame.height
  const nx = (2 * px.x) / frame.width - 1
  const ny = 1 - (2 * px.y) / frame.height
  return { origin: position, dir: norm(add(f, add(scale(r, nx * th * aspect), scale(u, ny * th)))) }
}

/** Project a lattice-frame point to source pixels (inverse of pixelRay); null if behind the camera. */
export function projectPoint(frame: Pick<CameraFrame, 'camera' | 'width' | 'height'>, p: Vec3): { x: number; y: number } | null {
  const { position, target, up, fovDeg } = frame.camera
  const f = norm(sub(target, position))
  const r = norm(cross(f, up))
  const u = cross(r, f)
  const d = sub(p, position)
  const z = dot(d, f)
  if (z <= 1e-6) return null
  const th = Math.tan((fovDeg * DEG) / 2)
  const aspect = frame.width / frame.height
  const nx = dot(d, r) / z / (th * aspect)
  const ny = dot(d, u) / z / th
  return { x: ((nx + 1) / 2) * frame.width, y: ((1 - ny) / 2) * frame.height }
}

/** Slab test against an axis-aligned box (centre c, half-size h) in local coordinates. Returns entry distance. */
export function rayBox(o: Vec3, d: Vec3, c: Vec3, h: Vec3): number | null {
  let tmin = -Infinity
  let tmax = Infinity
  for (let i = 0; i < 3; i++) {
    const lo = c[i] - h[i] - o[i]
    const hi = c[i] + h[i] - o[i]
    if (Math.abs(d[i]) < 1e-12) {
      if (lo > 0 || hi < 0) return null
      continue
    }
    const a = lo / d[i]
    const b = hi / d[i]
    tmin = Math.max(tmin, Math.min(a, b))
    tmax = Math.min(tmax, Math.max(a, b))
  }
  if (tmax < Math.max(tmin, 0)) return null
  return tmin >= 0 ? tmin : null // origin inside a box: ignore
}

/** Collision boxes of a module (local frame): the body plus both radiator panels. */
export const MODULE_BOXES: { c: Vec3; h: Vec3 }[] = [
  { c: [0, 0, 0], h: HALF },
  { c: [0, 0, PANEL.z], h: scale(PANEL.size, 0.5) },
  { c: [0, 0, -PANEL.z], h: scale(PANEL.size, 0.5) },
]

/** Intersect a lattice-frame ray with a module at `pose`. */
export function rayModule(pose: Pose, origin: Vec3, dir: Vec3): Vec3 | null {
  const o = toLocal(pose, origin)
  const d = qRotate(qConj(pose.quaternion), dir)
  let best: number | null = null
  for (const b of MODULE_BOXES) {
    const t = rayBox(o, d, b.c, b.h)
    if (t !== null && (best === null || t < best)) best = t
  }
  return best === null ? null : toWorld(pose, add(o, scale(d, best)))
}

export function unproject(frame: CameraFrame, px: { x: number; y: number }): Vec3 | null {
  const m = moduleGeom(frame.module)
  if (!m) return null
  const { origin, dir } = pixelRay(frame, px)
  return rayModule({ position: m.position, quaternion: m.quaternion }, origin, dir)
}

export function nearestFeature(module: ModuleId, p: Vec3): { id: FeatureId; distance: number } | undefined {
  const m = moduleGeom(module)
  if (!m) return undefined
  const pose = { position: m.position, quaternion: m.quaternion }
  let best: { id: FeatureId; distance: number } | undefined
  for (const [id, local] of Object.entries(m.features) as [FeatureId, Vec3][]) {
    const d = dist(toWorld(pose, local), p)
    if (!best || d < best.distance) best = { id, distance: d }
  }
  return best
}

/** Is a lattice-frame point on (or within `margin` of) a module's body or radiator panels? */
export function onModule(module: ModuleId, p: Vec3, margin = 0.15): boolean {
  const m = moduleGeom(module)
  if (!m) return false
  const l = toLocal({ position: m.position, quaternion: m.quaternion }, p)
  return MODULE_BOXES.some((b) => [0, 1, 2].every((i) => Math.abs(l[i] - b.c[i]) <= b.h[i] + margin))
}
