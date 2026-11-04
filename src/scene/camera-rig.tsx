'use client'
// Camera director:
// - overview: slow cinematic orbit (idle: composed off-centre with the Earth limb; focus: an arc outside the ring),
// - follow: a three-quarter "ops shot" framing the servicer AND what it is working on, chosen from candidate angles
//   that are tested against neighbouring modules, the hub and the solar wings (pulled in if every angle is blocked),
// - servicer: the servicer's own camera.
// Every target is damped, so poses warped at 60× stay smooth. OrbitControls take over in overview while dragging.
import { memo, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { LatticeLayout, ModuleId, ScenePose, Vec3 } from '@/contracts'
import { SERVICER_CAM_FOV, SERVICER_CAM_LOCAL } from './servicer'
import { WING_HALF_WIDTH, WING_Y, WING_YAW } from './structure'

export type View = 'overview' | 'follow' | 'servicer'

const Y = new THREE.Vector3(0, 1, 0)
const WING_N = new THREE.Vector3(Math.sin(WING_YAW), 0, Math.cos(WING_YAW))
const WING_W = new THREE.Vector3(Math.cos(WING_YAW), 0, -Math.sin(WING_YAW))
const MODULE_R = 2.15
const HUB_R = 2.7

/** Distance along a→b (0..1) of the first occluder hit, or null. `skip` lists sphere centres to ignore. */
function firstHit(a: THREE.Vector3, b: THREE.Vector3, spheres: THREE.Vector3[]): number | null {
  const ab = b.clone().sub(a)
  const L = ab.length()
  if (L < 1e-3) return null
  const dir = ab.clone().divideScalar(L)
  // Ignore the last 1.2 m: that is the subject itself.
  const maxT = Math.max(0, L - 1.2)
  let best: number | null = null
  const test = (t: number) => { if (t > 0.3 && t < maxT && (best === null || t < best)) best = t }
  for (const c of spheres) {
    const r = c.y === 0 && c.x === 0 && c.z === 0 ? HUB_R : MODULE_R
    const oc = a.clone().sub(c)
    const bq = oc.dot(dir)
    const cq = oc.lengthSq() - r * r
    const disc = bq * bq - cq
    if (disc < 0) continue
    const s = Math.sqrt(disc)
    test(-bq - s)
    if (cq < 0) test(0.31) // camera inside a sphere
  }
  // Wing plane (through the Y axis).
  const da = a.dot(WING_N), db = b.dot(WING_N)
  if (da * db < 0) {
    const t = (da / (da - db)) * L
    const p = a.clone().addScaledVector(dir, t)
    if (Math.abs(p.dot(WING_W)) < WING_HALF_WIDTH && Math.abs(p.y) > WING_Y[0] && Math.abs(p.y) < WING_Y[1]) test(t)
  }
  return best === null ? null : best / L
}

// Candidate shots, in the subject's frame: [radial out, up, side (× preferred side sign)]. First clear one wins.
const CANDIDATES: [number, number, number][] = [
  [0.25, 0.3, 0.92], [0.22, 0.6, 0.75], [0.25, 0.3, -0.92], [0.22, 0.6, -0.75], [0.55, 0.8, 0.3], [0.9, 0.4, 0.1],
]

function CameraRigImpl({ view, focusPos, servicer, layout, poseRef, focus, sideHint }: {
  view: View
  /** World position of the focus module, or null. Read every frame. */
  focusPos: RefObject<Vec3 | null>
  servicer: RefObject<THREE.Group | null>
  layout: LatticeLayout
  poseRef: RefObject<ScenePose>
  focus: ModuleId | null
  /** Preferred side (+1 = module local +Z, −1 = −Z) for the ops shot, e.g. the side of the FRU being swapped. */
  sideHint: 1 | -1
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useRef<OrbitControlsImpl>(null)
  const st = useMemo(() => ({
    az: 0.9, look: new THREE.Vector3(0, 0, 0), up: new THREE.Vector3(0, 1, 0), userUntil: 0, dragging: false, init: false,
    blend: 0, lastView: view as View, cand: 0, candSince: 0, subj: new THREE.Vector3(), subjInit: false, off: new THREE.Vector3(), offInit: false, offX: 0,
    tmp: { p: new THREE.Vector3(), l: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), q: new THREE.Quaternion() },
  }), [])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const start = () => { st.dragging = true }
    const end = () => { st.dragging = false; st.userUntil = performance.now() + 5000 }
    c.addEventListener('start', start)
    c.addEventListener('end', end)
    return () => { c.removeEventListener('start', start); c.removeEventListener('end', end) }
  }, [st])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const { p, l, f, u, q } = st.tmp
    const d = Math.min(dt, 0.1)
    if (st.lastView !== view) { st.lastView = view; st.blend = 0 }
    st.blend = Math.min(1, st.blend + d / 2.2)
    let fov = 38
    u.set(0, 1, 0)
    const fp = focusPos.current
    const sv = servicer.current
    let kPos = 0, kLook = 0

    if (view === 'overview' || !sv) {
      const userActive = st.dragging || performance.now() < st.userUntil
      if (userActive) {
        st.look.copy(controls.current?.target ?? st.look)
        st.az = Math.atan2(camera.position.z - st.look.z, camera.position.x - st.look.x)
        st.up.set(0, 1, 0)
        camera.up.copy(st.up)
        return
      }
      if (fp) {
        // Sweep an arc on the outside of the ring, centred on the module's radial direction.
        const azC = Math.atan2(fp[2], fp[0])
        const az = azC + 0.55 * Math.sin(t * 0.06)
        l.set(fp[0] * 0.92, fp[1] - 0.2, fp[2] * 0.92)
        const r = 19, el = 0.34
        p.set(l.x + Math.cos(az) * Math.cos(el) * r, l.y + Math.sin(el) * r, l.z + Math.sin(az) * Math.cos(el) * r)
        st.az = Math.atan2(p.z, p.x)
        fov = 36
      } else {
        // Idle hero shot: low three-quarter orbit, the Earth limb filling the lower third, the lattice composed
        // right of centre (the hero copy sits bottom-left) with a slow breathing dolly.
        st.az += d * 0.028
        const r = 50 + 3 * Math.sin(t * 0.07), el = 0.25 + 0.03 * Math.sin(t * 0.045)
        p.set(Math.cos(st.az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(st.az) * Math.cos(el) * r)
        const fwd = f.set(-p.x, -p.y, -p.z).normalize()
        const right = new THREE.Vector3().crossVectors(fwd, Y).normalize()
        l.set(0, -1.5, 0).addScaledVector(right, -8.5)
        fov = 40
      }
      kPos = kLook = st.init ? 1 - Math.exp(-d * (0.6 + 1.6 * st.blend)) : 1
    } else if (view === 'follow') {
      // ── Ops shot ──
      const pose = poseRef.current
      sv.getWorldPosition(p)
      const arms = pose?.servicer.arms
      const armT = arms?.[0]?.target ?? arms?.[1]?.target ?? null
      const T = armT ? new THREE.Vector3(...armT) : fp ? new THREE.Vector3(...fp) : f.set(0, 0, 1).applyQuaternion(sv.getWorldQuaternion(q)).multiplyScalar(10).add(p).clone()
      const span = p.distanceTo(T)
      // Close work: frame servicer + work site; long transits: frame the servicer itself.
      const w = 0.62 * (1 - THREE.MathUtils.smoothstep(span, 12, 25))
      const subj = p.clone().lerp(T, w)
      // Damp the subject first (removes any per-frame jitter at high warp), then build the shot around it.
      if (!st.subjInit) { st.subj.copy(subj); st.subjInit = true }
      st.subj.lerp(subj, 1 - Math.exp(-d * 14))
      const S = st.subj
      const r = new THREE.Vector3(S.x, 0, S.z)
      if (r.lengthSq() < 1e-4) r.set(1, 0, 0)
      r.normalize()
      const tang = new THREE.Vector3(-r.z, 0, r.x)
      const D = 9.5 + 0.3 * Math.min(span, 15)
      // Occluders: every module except the ones being worked on, and the hub.
      const spheres: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)]
      for (const m of layout.modules) {
        const o = pose?.modules[m.id]
        const c = new THREE.Vector3(...(o && o.visible !== false ? o.position : m.position))
        if (m.id === focus || c.distanceTo(T) < 3.5 || c.distanceTo(p) < 2.5) continue
        spheres.push(c)
      }
      const camFor = (i: number) => {
        const [a, b, c] = CANDIDATES[i]
        const dir = r.clone().multiplyScalar(a).addScaledVector(Y, b).addScaledVector(tang, c * sideHint).normalize()
        return S.clone().addScaledVector(dir, D)
      }
      // Keep the current angle while it is clear (hysteresis); otherwise take the first clear candidate.
      let cam = camFor(st.cand)
      if (firstHit(cam, S, spheres) !== null && t - st.candSince > 0.6) {
        for (let i = 0; i < CANDIDATES.length; i++) {
          const c = camFor(i)
          if (firstHit(c, S, spheres) === null) { st.cand = i; st.candSince = t; cam = c; break }
        }
      }
      const hit = firstHit(cam, S, spheres)
      if (hit !== null) {
        // Every angle blocked: pull the camera in front of the occluder.
        const along = (1 - hit) * D
        cam = S.clone().addScaledVector(cam.clone().sub(S).normalize(), Math.max(3.5, along - 1.6))
      }
      // Damp the camera's OFFSET from the subject (not its absolute position), so the subject stays framed
      // however fast the warp moves it; angle changes and view blends still glide.
      const want = cam.sub(S)
      if (!st.offInit) { st.off.copy(camera.position).sub(S); st.offInit = true }
      st.off.lerp(want, 1 - Math.exp(-d * (0.9 + 1.4 * st.blend)))
      p.copy(S).add(st.off)
      l.copy(S)
      fov = 42
      kPos = 1
      kLook = st.blend >= 1 ? 1 : 1 - Math.exp(-d * (1.5 + 6 * st.blend))
    } else {
      sv.updateMatrixWorld()
      sv.getWorldQuaternion(q)
      p.copy(SERVICER_CAM_LOCAL).add(new THREE.Vector3(0, 0, 0.12)).applyMatrix4(sv.matrixWorld)
      f.set(0, 0, 1).applyQuaternion(q)
      l.copy(p).addScaledVector(f, 10)
      u.set(0, 1, 0).applyQuaternion(q)
      kPos = kLook = st.blend >= 1 ? 1 : 1 - Math.exp(-d * (2 + 10 * st.blend * st.blend))
      fov = SERVICER_CAM_FOV
    }
    if (view !== 'follow') { st.subjInit = false; st.offInit = false }
    if (!st.init) { kPos = kLook = 1 }
    camera.position.lerp(p, kPos)
    st.look.lerp(l, kLook)
    st.init = true
    st.up.lerp(u, 1 - Math.exp(-d * 4)).normalize()
    camera.up.copy(st.up)
    camera.lookAt(st.look)
    // Follow: frame the subject a little left of centre (the right-hand UI column covers that side).
    const offWant = view === 'follow' ? 0.07 : 0
    st.offX += (offWant - st.offX) * (1 - Math.exp(-d * 2))
    const { width: W, height: H } = state.size
    if (Math.abs(st.offX) > 1e-4) camera.setViewOffset(W, H, st.offX * W, 0, W, H)
    else if (camera.view) camera.clearViewOffset()
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-d * 3))
      camera.updateProjectionMatrix()
    }
    if (controls.current) controls.current.target.copy(st.look)
  })

  return (
    <OrbitControls
      ref={controls as never}
      enabled={view === 'overview'}
      enableDamping={false}
      enablePan={false}
      minDistance={4}
      maxDistance={140}
      makeDefault
    />
  )
}

export const CameraRig = memo(CameraRigImpl)
