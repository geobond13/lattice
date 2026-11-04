'use client'
// Camera director: cinematic overview orbit (eases toward the focus module), chase cam, and the servicer's own
// camera, with smooth blends between them. OrbitControls take over in overview while the user drags.
import { memo, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Vec3 } from '@/contracts'
import { SERVICER_CAM_FOV, SERVICER_CAM_LOCAL } from './servicer'

export type View = 'overview' | 'follow' | 'servicer'

function CameraRigImpl({ view, focusPos, servicer }: {
  view: View
  /** World position of the focus module, or null. Read every frame. */
  focusPos: RefObject<Vec3 | null>
  servicer: RefObject<THREE.Group | null>
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useRef<OrbitControlsImpl>(null)
  const st = useMemo(() => ({
    az: 0.6, look: new THREE.Vector3(0, 0, 0), up: new THREE.Vector3(0, 1, 0), userUntil: 0, dragging: false, init: false,
    blend: 0, lastView: view as View,
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

    if (view === 'overview' || !sv) {
      const userActive = st.dragging || performance.now() < st.userUntil
      if (userActive) {
        // Hand-off: keep our state in sync with what the user is doing.
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
        st.az += d * 0.04
        l.set(0, -2, 0)
        const r = 52, el = 0.36 + 0.04 * Math.sin(t * 0.05)
        p.set(Math.cos(st.az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(st.az) * Math.cos(el) * r)
        fov = 40
      }
      const k = st.init ? 1 - Math.exp(-d * (0.6 + 1.6 * st.blend)) : 1
      camera.position.lerp(p, k)
      st.look.lerp(l, k)
    } else if (view === 'follow') {
      sv.getWorldPosition(p)
      if (fp) l.set(...fp)
      else l.copy(f.set(0, 0, 1).applyQuaternion(sv.getWorldQuaternion(q)).multiplyScalar(10).add(p))
      const back = f.copy(l).sub(p)
      if (back.lengthSq() < 1e-4) back.set(0, 0, 1)
      back.normalize()
      const side = new THREE.Vector3().crossVectors(back, new THREE.Vector3(0, 1, 0)).normalize()
      const camPos = p.clone().addScaledVector(back, -6.5).addScaledVector(side, 2.2).add(new THREE.Vector3(0, 3.4, 0))
      const k = 1 - Math.exp(-d * (1.2 + 3 * st.blend))
      camera.position.lerp(camPos, k)
      st.look.lerp(l.lerp(p, 0.25), k)
      fov = 45
    } else {
      sv.updateMatrixWorld()
      sv.getWorldQuaternion(q)
      p.copy(SERVICER_CAM_LOCAL).add(new THREE.Vector3(0, 0, 0.12)).applyMatrix4(sv.matrixWorld)
      f.set(0, 0, 1).applyQuaternion(q)
      l.copy(p).addScaledVector(f, 10)
      u.set(0, 1, 0).applyQuaternion(q)
      const k = st.blend >= 1 ? 1 : 1 - Math.exp(-d * (2 + 10 * st.blend * st.blend))
      camera.position.lerp(p, k)
      st.look.lerp(l, k)
      fov = SERVICER_CAM_FOV
    }
    st.init = true
    st.up.lerp(u, 1 - Math.exp(-d * 4)).normalize()
    camera.up.copy(st.up)
    camera.lookAt(st.look)
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
