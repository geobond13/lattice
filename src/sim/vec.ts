// Small, dependency-free vector / quaternion kit for the sim. Quaternions are [x, y, z, w] (three.js order).
import type { Quat, Vec3 } from '@/contracts'

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b))
export const norm = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]
}
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u
export const lerpV = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)]
export const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x))
/** C1 ease-in/out (zero velocity at both ends). */
export const smooth = (u: number): number => {
  const x = clamp(u)
  return x * x * (3 - 2 * x)
}
export const DEG = Math.PI / 180

export const qIdentity: Quat = [0, 0, 0, 1]
export function qAxisAngle(axis: Vec3, angle: number): Quat {
  const n = norm(axis)
  const s = Math.sin(angle / 2)
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)]
}
export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}
export const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]
export function qRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u×v) + 2u×(u×v)
  const u: Vec3 = [q[0], q[1], q[2]]
  const t = scale(cross(u, v), 2)
  return add(add(v, scale(t, q[3])), cross(u, t))
}
export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
export function qSlerp(a: Quat, b: Quat, u: number): Quat {
  let [bx, by, bz, bw] = b
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw
  if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d }
  if (d > 0.9995) return qNormalize([lerp(a[0], bx, u), lerp(a[1], by, u), lerp(a[2], bz, u), lerp(a[3], bw, u)])
  const th = Math.acos(d)
  const s = Math.sin(th)
  const wa = Math.sin((1 - u) * th) / s
  const wb = Math.sin(u * th) / s
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb]
}
/** Quaternion from an orthonormal basis given as the images of local X, Y, Z. */
export function qFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const [m00, m10, m20] = x
  const [m01, m11, m21] = y
  const [m02, m12, m22] = z
  const tr = m00 + m11 + m22
  let q: Quat
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
  }
  return qNormalize(q)
}
/** Orientation whose local +X points from `from` toward `to`, local +Y as close to `up` as possible. */
export function qLookX(from: Vec3, to: Vec3, up: Vec3 = [0, 1, 0]): Quat {
  const x = norm(sub(to, from))
  let z = cross(x, up)
  if (len(z) < 1e-6) z = cross(x, [1, 0, 0])
  z = norm(z)
  const y = cross(z, x)
  return qFromBasis(x, y, z)
}
/** Yaw about +Y so that local +X points along the radial direction at ring angle theta (radians). */
export const qRadial = (theta: number): Quat => qAxisAngle([0, 1, 0], -theta)

export interface Pose { position: Vec3; quaternion: Quat }
export const toWorld = (pose: Pose, local: Vec3): Vec3 => add(pose.position, qRotate(pose.quaternion, local))
export const toLocal = (pose: Pose, world: Vec3): Vec3 => qRotate(qConj(pose.quaternion), sub(world, pose.position))

/** Deterministic, sample-rate independent sensor noise in [-1, 1] for (seed, t). */
export function noise(seed: number, t: number): number {
  const k = Math.floor(t / 4)
  const h = (n: number) => {
    const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
    return (x - Math.floor(x)) * 2 - 1
  }
  const f = t / 4 - k
  return lerp(h(k), h(k + 1), smooth(f))
}
export const r1 = (x: number) => Math.round(x * 10) / 10
export const r2 = (x: number) => Math.round(x * 100) / 100
