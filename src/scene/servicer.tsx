'use client'
// The servicer: 1.4 m gold-MLI bus, front camera, RCS plumes, two 3-segment arms with analytic planar IK.
// Local frame: +Z is the FRONT (camera + arms face), +Y up. Arm shoulders at (±0.5, 0.15, 0.72).
import { memo, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ArmPose, ScenePose, Vec3 } from '@/contracts'
import { crinkleTex } from './textures'
import { ExhaustCone, Plume } from './effects'
import { RadiatorPanel } from './module'

export const SERVICER_HALF = 0.7
export const SHOULDER_X = 0.5
export const LINKS = [1.0, 0.9, 0.7] as const // total reach 2.6 m
/** Servicer camera mount (local) and its vertical FOV. */
export const SERVICER_CAM_LOCAL = new THREE.Vector3(0, 0.42, 0.74)
export const SERVICER_CAM_FOV = 50

const Y = new THREE.Vector3(0, 1, 0)
const BURN_DIR: Vec3 = [0, 1, 0]
const FWD = new THREE.Vector3(0, 0, 1)

interface ArmRig {
  links: (THREE.Group | null)[]
  joints: (THREE.Mesh | null)[]
  hand: THREE.Group | null
  fingers: (THREE.Group | null)[]
  eff: THREE.Vector3
  app: THREE.Vector3
  bend: THREE.Vector3
  grip: number
  init: boolean
}

function newRig(): ArmRig {
  return { links: [null, null, null], joints: [null, null, null], hand: null, fingers: [null, null], eff: new THREE.Vector3(), app: new THREE.Vector3(), bend: new THREE.Vector3(), grip: 0, init: false }
}

const tmp = { w: new THREE.Vector3(), dir: new THREE.Vector3(), perp: new THREE.Vector3(), e: new THREE.Vector3(), end: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3() }

/**
 * Analytic IK in the arm plane. The last link aligns with the approach vector `app`; the first two links solve
 * the classic 2-link triangle to the wrist, bending toward `bend`. All vectors in servicer-local coordinates.
 */
/** Rotates model +Z (front) onto the sim's +X (facing direction). */
const SIM_TO_MODEL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)

function solveArm(rig: ArmRig, shoulder: THREE.Vector3, target: THREE.Vector3, app: THREE.Vector3, bend: THREE.Vector3) {
  const [L1, L2, L3] = LINKS
  const w = tmp.w.copy(target).addScaledVector(app, -L3)
  const dir = tmp.dir.copy(w).sub(shoulder)
  let d = dir.length()
  if (d < 1e-4) { dir.copy(FWD); d = 1e-4 } else dir.divideScalar(d)
  const dc = THREE.MathUtils.clamp(d, Math.abs(L1 - L2) + 0.03, L1 + L2 - 1e-3)
  const cosA = THREE.MathUtils.clamp((L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), -1, 1)
  const A = Math.acos(cosA)
  const perp = tmp.perp.copy(bend).addScaledVector(dir, -bend.dot(dir))
  if (perp.lengthSq() < 1e-6) perp.set(0, 1, 0).addScaledVector(dir, -dir.y)
  perp.normalize()
  const e = tmp.e.copy(shoulder).addScaledVector(dir, L1 * Math.cos(A)).addScaledVector(perp, L1 * Math.sin(A))
  w.copy(shoulder).addScaledVector(dir, dc)
  const end = tmp.end.copy(w).addScaledVector(app, L3)
  const pts = [shoulder, e, w, end]
  for (let i = 0; i < 3; i++) {
    const g = rig.links[i]
    if (!g) continue
    g.position.copy(pts[i])
    tmp.v.copy(pts[i + 1]).sub(pts[i]).normalize()
    g.quaternion.setFromUnitVectors(Y, tmp.v)
    const j = rig.joints[i]
    if (j) j.position.copy(pts[i])
  }
  if (rig.hand) {
    rig.hand.position.copy(end)
    rig.hand.quaternion.setFromUnitVectors(Y, app)
  }
  const open = (1 - rig.grip) * 0.55
  if (rig.fingers[0]) rig.fingers[0].rotation.z = open
  if (rig.fingers[1]) rig.fingers[1].rotation.z = -open
}

function Arm({ rig, white }: { rig: ArmRig; white: THREE.Material }) {
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a313c', metalness: 0.7, roughness: 0.35 }), [])
  return (
    <group>
      {LINKS.map((L, i) => (
        <group key={i} ref={(g) => { rig.links[i] = g }}>
          <mesh position={[0, L / 2, 0]} material={white}>
            <cylinderGeometry args={[0.055 - i * 0.008, 0.065 - i * 0.008, L, 14]} />
          </mesh>
        </group>
      ))}
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { rig.joints[i] = m }} material={dark}>
          <sphereGeometry args={[0.095 - i * 0.012, 16, 12]} />
        </mesh>
      ))}
      <group ref={(g) => { rig.hand = g }}>
        <mesh material={dark} position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.07, 0.06, 0.1, 14]} />
        </mesh>
        {[0, 1].map((k) => (
          <group key={k} ref={(g) => { rig.fingers[k] = g }} position={[k ? -0.04 : 0.04, 0.08, 0]}>
            <mesh material={dark} position={[k ? -0.01 : 0.01, 0.09, 0]}>
              <boxGeometry args={[0.025, 0.18, 0.06]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

export interface ServicerProps {
  /** Live pose, read every frame (servicer, arms, thrust, carried FRU). */
  poseRef: RefObject<ScenePose>
  groupRef: RefObject<THREE.Group | null>
  /** Which FRU panel is carried (drives what is drawn; its motion comes from poseRef). */
  fruKind: 'radiator_a' | 'radiator_b' | null
  fruDamaged: boolean
  /** Panel-local damage offset for a damaged FRU the servicer carries. */
  fruDamageAt?: Vec3 | null
  fruLatchAt?: Vec3 | null
}

function ServicerImpl({ poseRef, groupRef, fruKind, fruDamaged, fruDamageAt, fruLatchAt }: ServicerProps) {
  const rigs = useMemo(() => [newRig(), newRig()], [])
  const first = useRef(true)
  const thrust = useRef(0)
  const fruRef = useRef<THREE.Group>(null)
  const fruFirst = useRef(true)
  // Main burn: twin canted plumes opposite the direction of travel (they clear anything held in front).
  const burnL = useRef<THREE.Group>(null)
  const burnR = useRef<THREE.Group>(null)
  const burn = useRef(0)
  const motion = useMemo(() => ({ prev: new THREE.Vector3(), vel: new THREE.Vector3(), init: false, perp: new THREE.Vector3(), d: new THREE.Vector3(), q: new THREE.Quaternion() }), [])
  const gold = useMemo(() => {
    const bump = crinkleTex()
    return new THREE.MeshStandardMaterial({ color: '#e2aa48', metalness: 0.7, roughness: 0.55, roughnessMap: bump, emissive: '#4a2c06', emissiveIntensity: 0.2 })
  }, [])
  const spotTarget = useMemo(() => new THREE.Object3D(), [])
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e9edf1', metalness: 0.2, roughness: 0.45 }), [])
  const v = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), inv: new THREE.Matrix4(), t: new THREE.Vector3(), app: new THREE.Vector3(), bend: new THREE.Vector3() }), [])

  useFrame((_, dt) => {
    const g = groupRef.current
    const ps = poseRef.current.servicer
    if (!g) return
    g.visible = ps.visible !== false
    v.p.set(...ps.position)
    // The sim aims the servicer's local +X at its target; this model's front is +Z.
    v.q.set(...ps.quaternion).multiply(SIM_TO_MODEL)
    const k = first.current ? 1 : 1 - Math.exp(-dt * 12)
    first.current = false
    g.position.lerp(v.p, k)
    g.quaternion.slerp(v.q, k)
    g.updateMatrixWorld()
    v.inv.copy(g.matrixWorld).invert()
    thrust.current += (THREE.MathUtils.clamp(ps.thrust, 0, 1) - thrust.current) * (1 - Math.exp(-dt * 10))

    ps.arms.forEach((arm: ArmPose, i: number) => {
      const rig = rigs[i]
      const sx = i === 0 ? SHOULDER_X : -SHOULDER_X
      const shoulder = new THREE.Vector3(sx, 0.15, SERVICER_HALF + 0.02)
      if (arm.target) {
        v.t.set(...arm.target).applyMatrix4(v.inv)
        v.app.copy(v.t).sub(shoulder).normalize().addScaledVector(FWD, 0.6).normalize()
        v.bend.set(Math.sign(sx) * 0.6, 1, 0).normalize()
      } else {
        v.t.set(sx * 0.7, -0.5, SERVICER_HALF + 0.45)
        v.app.set(Math.sign(sx) * 0.15, -1, 0.35).normalize()
        v.bend.set(Math.sign(sx) * 0.4, 0.3, 1).normalize()
      }
      const ka = rig.init ? 1 - Math.exp(-dt * 5) : 1
      rig.init = true
      rig.eff.lerp(v.t, ka)
      rig.app.lerp(v.app, ka).normalize()
      rig.bend.lerp(v.bend, ka).normalize()
      rig.grip += (THREE.MathUtils.clamp(arm.grip, 0, 1) - rig.grip) * (1 - Math.exp(-dt * 8))
      solveArm(rig, shoulder, rig.eff, rig.app, rig.bend)
    })

    // Velocity (scene time) of the smoothed body drives the burn plume orientation.
    if (dt > 0) {
      if (!motion.init) { motion.prev.copy(g.position); motion.init = true }
      const inst = g.position.clone().sub(motion.prev).divideScalar(dt)
      motion.prev.copy(g.position)
      motion.vel.lerp(inst, 1 - Math.exp(-dt * 3))
    }
    const moving = motion.vel.length() > 0.05
    burn.current += ((moving ? thrust.current : 0) - burn.current) * (1 - Math.exp(-dt * 6))
    if (burnL.current && burnR.current) {
      const back = motion.d.copy(motion.vel).normalize().negate()
      motion.perp.crossVectors(back, new THREE.Vector3(0, 1, 0))
      if (motion.perp.lengthSq() < 1e-4) motion.perp.set(1, 0, 0)
      motion.perp.normalize()
      ;[burnL.current, burnR.current].forEach((b, i) => {
        const s = i === 0 ? 1 : -1
        b.visible = burn.current > 0.04
        b.position.copy(g.position).addScaledVector(motion.perp, s * 0.75).addScaledVector(back, 0.55)
        const dir = back.clone().addScaledVector(motion.perp, s * 0.6).normalize()
        b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
      })
    }

    const fr = fruRef.current
    const fp = poseRef.current.fru
    if (fr) {
      fr.visible = !!fp && fp.visible !== false
      if (fp) {
        v.p.set(...fp.position)
        v.q.set(...fp.quaternion)
        const kf = fruFirst.current ? 1 : 1 - Math.exp(-dt * 12)
        fruFirst.current = false
        fr.position.lerp(v.p, kf)
        fr.quaternion.slerp(v.q, kf)
      } else fruFirst.current = true
    }
  })

  const level = () => thrust.current * 0.6
  const burnLevel = () => burn.current
  const rcs: { p: Vec3; d: Vec3 }[] = [
    { p: [0.55, 0.55, -0.72], d: [0, 0, -1] }, { p: [-0.55, 0.55, -0.72], d: [0, 0, -1] },
    { p: [0.55, -0.55, -0.72], d: [0, 0, -1] }, { p: [-0.55, -0.55, -0.72], d: [0, 0, -1] },
    { p: [0.72, 0.55, -0.55], d: [1, 0, 0] }, { p: [-0.72, 0.55, -0.55], d: [-1, 0, 0] },
  ]

  return (
    <>
      <group ref={groupRef} name="servicer">
        {/* Bus. */}
        <mesh material={gold}>
          <boxGeometry args={[1.4, 1.4, 1.4]} />
        </mesh>
        {/* Frame edges. */}
        {[[1, 1], [1, -1], [-1, 1], [-1, -1]].flatMap(([a, b], i) => [
          <mesh key={`x${i}`} position={[0, a * 0.7, b * 0.7]}><boxGeometry args={[1.44, 0.05, 0.05]} /><meshStandardMaterial color="#cfd5dc" metalness={0.6} roughness={0.35} /></mesh>,
          <mesh key={`y${i}`} position={[a * 0.7, 0, b * 0.7]}><boxGeometry args={[0.05, 1.44, 0.05]} /><meshStandardMaterial color="#cfd5dc" metalness={0.6} roughness={0.35} /></mesh>,
          <mesh key={`z${i}`} position={[a * 0.7, b * 0.7, 0]}><boxGeometry args={[0.05, 0.05, 1.44]} /><meshStandardMaterial color="#cfd5dc" metalness={0.6} roughness={0.35} /></mesh>,
        ])}
        {/* Front plate, camera and floodlights. */}
        <mesh position={[0, 0, 0.705]}>
          <boxGeometry args={[1.25, 1.25, 0.02]} />
          <meshStandardMaterial color="#232a34" metalness={0.5} roughness={0.45} />
        </mesh>
        <group position={SERVICER_CAM_LOCAL.toArray() as Vec3}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.11, 0.13, 0.16, 24]} />
            <meshStandardMaterial color="#111" metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0, 0.081]}>
            <circleGeometry args={[0.085, 24]} />
            <meshStandardMaterial color="#0a1830" metalness={0.6} roughness={0.28} emissive="#2a6cff" emissiveIntensity={0.4} />
          </mesh>
        </group>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.32, 0.42, 0.72]}>
            <boxGeometry args={[0.14, 0.08, 0.02]} />
            <meshBasicMaterial color={new THREE.Color('#fff6e8').multiplyScalar(3)} toneMapped={false} />
          </mesh>
        ))}
        {/* Floodlight for the servicer / chase views (hidden with the servicer during captures). */}
        <primitive object={spotTarget} position={[0, 0, 8]} />
        <spotLight position={[0, 0.42, 0.75]} target={spotTarget} intensity={8} distance={14} angle={0.5} penumbra={0.8} decay={1.6} color="#fff4e6" />
        {/* Shoulder housings. */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * SHOULDER_X, 0.15, SERVICER_HALF + 0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.14, 0.08, 18]} />
            <meshStandardMaterial color="#2a313c" metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
        {/* Side solar panels on short booms. */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 1.55, 0, -0.1]}>
            <mesh position={[-s * 0.4, 0, 0]}>
              <boxGeometry args={[0.5, 0.05, 0.05]} />
              <meshStandardMaterial color="#cfd5dc" metalness={0.6} roughness={0.35} />
            </mesh>
            <mesh>
              <boxGeometry args={[1.2, 0.03, 0.95]} />
              <meshStandardMaterial color="#1b2f6e" metalness={0.6} roughness={0.25} emissive="#0a1a44" emissiveIntensity={0.3} />
            </mesh>
          </group>
        ))}
        {/* Antenna dish. */}
        <group position={[0.25, 0.72, -0.3]}>
          <mesh position={[0, 0.12, 0]}><cylinderGeometry args={[0.02, 0.02, 0.24, 6]} /><meshStandardMaterial color="#cfd5dc" /></mesh>
          <mesh position={[0, 0.26, 0]} rotation={[Math.PI, 0, 0]}>
            <sphereGeometry args={[0.22, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3]} />
            <meshStandardMaterial color="#eef1f4" side={THREE.DoubleSide} roughness={0.5} />
          </mesh>
        </group>
        {/* RCS quads + plumes. */}
        {rcs.map((r, i) => (
          <group key={i}>
            <mesh position={r.p}>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
              <meshStandardMaterial color="#3a414c" metalness={0.6} roughness={0.4} />
            </mesh>
            <ExhaustCone position={[r.p[0] + r.d[0] * 0.05, r.p[1] + r.d[1] * 0.05, r.p[2] + r.d[2] * 0.05]} dir={r.d} length={i < 4 ? 1.1 : 0.6} radius={i < 4 ? 0.16 : 0.1} intensity={2.2} level={level} />
          </group>
        ))}
        {rigs.map((rig, i) => <Arm key={i} rig={rig} white={white} />)}
      </group>
      {[burnL, burnR].map((ref, i) => (
        <group key={i} ref={ref} visible={false}>
          <ExhaustCone position={[0, 0, 0]} dir={BURN_DIR} length={3.6} radius={0.42} color="#a8dcff" intensity={2.6} level={burnLevel} />
          <Plume position={[0, 0.1, 0]} dir={BURN_DIR} count={260} life={0.6} speed={7} spread={0.1} size={0.06} grow={0.8} colorA="#ffffff" colorB="#8cc8ff" intensity={1.2} level={burnLevel} />
        </group>
      ))}
      <group ref={fruRef} visible={false}>
        {fruKind && (
          <RadiatorPanel normalSign={fruKind === 'radiator_a' ? 1 : -1} damageAt={fruDamaged ? fruDamageAt ?? [0.75, 0.45, 0] : null} latchAt={fruLatchAt ?? null} tone={fruDamaged ? 'damaged' : 'new'} />
        )}
      </group>
    </>
  )
}

export const Servicer = memo(ServicerImpl)
