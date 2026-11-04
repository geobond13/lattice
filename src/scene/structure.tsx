'use client'
// Static lattice structure: hub, instanced lattice-girder ring truss + spokes, solar wings, dock adapters, depot.
import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { LatticeLayout, Vec3 } from '@/contracts'
import { crinkleTex, solarTex } from './textures'
import { SUN_DIR } from './environment'

type Seg = { a: THREE.Vector3; b: THREE.Vector3; r: number }

/** Triangular lattice girder through `centers`; `side[i]`/`up[i]` span the cross-section plane at node i. */
function girder(centers: THREE.Vector3[], side: THREE.Vector3[], up: THREE.Vector3[], rad: number, strut: number, out: Seg[], closed = false) {
  const angles = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]
  const nodes = centers.map((c, i) =>
    angles.map((a) => c.clone().addScaledVector(side[i], Math.cos(a) * rad).addScaledVector(up[i], Math.sin(a) * rad)),
  )
  const n = nodes.length
  const last = closed ? n : n - 1
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) out.push({ a: nodes[i][k], b: nodes[i][(k + 1) % 3], r: strut * 0.8 })
  }
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n
    for (let k = 0; k < 3; k++) {
      out.push({ a: nodes[i][k], b: nodes[j][k], r: strut * 1.35 })
      out.push({ a: nodes[i][k], b: nodes[j][(k + 1) % 3], r: strut * 0.65 })
    }
  }
}

function straight(from: THREE.Vector3, to: THREE.Vector3, bay: number, upHint: THREE.Vector3) {
  const dir = to.clone().sub(from)
  const steps = Math.max(1, Math.round(dir.length() / bay))
  const d = dir.clone().normalize()
  const side = new THREE.Vector3().crossVectors(d, upHint).normalize()
  const up = new THREE.Vector3().crossVectors(side, d).normalize()
  const centers: THREE.Vector3[] = []
  for (let i = 0; i <= steps; i++) centers.push(from.clone().addScaledVector(dir, i / steps))
  return { centers, side: centers.map(() => side), up: centers.map(() => up) }
}

export const TRUSS_RADIUS = 11.35

function Truss({ layout }: { layout: LatticeLayout }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const segs = useMemo(() => {
    const out: Seg[] = []
    // Ring truss.
    const N = 72
    const centers: THREE.Vector3[] = [], side: THREE.Vector3[] = [], up: THREE.Vector3[] = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      centers.push(new THREE.Vector3(Math.cos(a) * TRUSS_RADIUS, 0, Math.sin(a) * TRUSS_RADIUS))
      side.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)))
      up.push(new THREE.Vector3(0, 1, 0))
    }
    girder(centers, side, up, 0.6, 0.035, out, true)
    // Spokes, between module slots.
    for (let k = 0; k < 4; k++) {
      const a = ((15 + 90 * k) * Math.PI) / 180
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      const s = straight(d.clone().multiplyScalar(2.4), d.clone().multiplyScalar(TRUSS_RADIUS - 0.45), 1.0, new THREE.Vector3(0, 1, 0))
      girder(s.centers, s.side, s.up, 0.42, 0.03, out)
    }
    // Wing masts (±Y).
    for (const sgn of [1, -1]) {
      const s = straight(new THREE.Vector3(0, sgn * 2.2, 0), new THREE.Vector3(0, sgn * 33, 0), 1.1, new THREE.Vector3(1, 0, 0))
      girder(s.centers, s.side, s.up, 0.28, 0.025, out)
    }
    // Depot keel under the spares.
    const dp = new THREE.Vector3(...layout.depot)
    const k = straight(dp.clone().add(new THREE.Vector3(-7, -1.9, 0)), dp.clone().add(new THREE.Vector3(7, -1.9, 0)), 0.9, new THREE.Vector3(0, 0, 1))
    girder(k.centers, k.side, k.up, 0.4, 0.03, out)
    return out
  }, [layout.depot])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const o = new THREE.Object3D()
    const Y = new THREE.Vector3(0, 1, 0)
    segs.forEach((s, i) => {
      const d = s.b.clone().sub(s.a)
      o.position.copy(s.a).addScaledVector(d, 0.5)
      o.quaternion.setFromUnitVectors(Y, d.clone().normalize())
      o.scale.set(s.r, d.length(), s.r)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [segs])

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, segs.length]} frustumCulled={false}>
      <cylinderGeometry args={[1, 1, 1, 6, 1]} />
      <meshStandardMaterial color="#c3cad3" metalness={0.55} roughness={0.38} />
    </instancedMesh>
  )
}

function Hub() {
  const bump = crinkleTex()
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[2.2, 2.2, 3.4, 48]} />
        <meshStandardMaterial color="#d8dde3" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[2.26, 2.26, 1.6, 48]} />
        <meshStandardMaterial color="#f2b64a" metalness={0.85} roughness={0.42} roughnessMap={bump} emissive="#3a2406" emissiveIntensity={0.35} />
      </mesh>
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[0, s * 1.95, 0]}>
            <cylinderGeometry args={[1.5, 2.0, 0.5, 40]} />
            <meshStandardMaterial color="#9aa4b0" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, s * 2.5, 0]}>
            <cylinderGeometry args={[0.7, 0.7, 0.8, 24]} />
            <meshStandardMaterial color="#2a313c" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      ))}
      {/* Navigation beacons. */}
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={[Math.cos((k * Math.PI) / 2) * 2.28, 0.95, Math.sin((k * Math.PI) / 2) * 2.28]}>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshBasicMaterial color={new THREE.Color('#59d6ff').multiplyScalar(4)} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function Wings() {
  const tex = useMemo(() => {
    const t = solarTex().clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(2, 5)
    t.needsUpdate = true
    return t
  }, [])
  // Sun-tracking: the wing plane contains Y and faces the sun's horizontal direction.
  const yaw = Math.atan2(SUN_DIR.x, SUN_DIR.z)
  const blankets = [0, 1, 2, 3, 4, 5]
  const len = 4.6, width = 3.6
  return (
    <group rotation={[0, yaw, 0]}>
      {[1, -1].map((sgn) =>
        blankets.map((i) => {
          const y = sgn * (4 + i * (len + 0.35) + len / 2)
          return (
            <group key={`${sgn}${i}`} position={[0, y, 0]}>
              {[-1, 1].map((side) => (
                <mesh key={side} position={[side * (width / 2 + 0.35), 0, 0]}>
                  <boxGeometry args={[width, len, 0.04]} />
                  <meshStandardMaterial attach="material-0" color="#cfd5dc" />
                  <meshStandardMaterial attach="material-1" color="#cfd5dc" />
                  <meshStandardMaterial attach="material-2" color="#cfd5dc" />
                  <meshStandardMaterial attach="material-3" color="#cfd5dc" />
                  <meshStandardMaterial attach="material-4" map={tex} metalness={0.55} roughness={0.22} color="#ffffff" emissive="#0a1a44" emissiveIntensity={0.35} />
                  <meshStandardMaterial attach="material-5" color="#d9dde2" metalness={0.2} roughness={0.7} />
                </mesh>
              ))}
            </group>
          )
        }),
      )}
    </group>
  )
}

function DockAdapters({ layout }: { layout: LatticeLayout }) {
  const slots = layout.modules.filter((m) => m.slot !== null)
  return (
    <>
      {slots.map((m) => {
        const p = new THREE.Vector3(...m.position)
        const r = new THREE.Vector3(p.x, 0, p.z).normalize()
        const halfX = m.size[0] / 2
        const inner = p.clone().addScaledVector(r, -halfX)
        const from = r.clone().multiplyScalar(TRUSS_RADIUS + 0.5)
        const mid = from.clone().add(inner).multiplyScalar(0.5)
        const l = Math.max(0.05, inner.distanceTo(from))
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), r)
        return (
          <group key={m.id} position={mid.toArray() as Vec3} quaternion={q}>
            <mesh>
              <cylinderGeometry args={[0.42, 0.5, l, 24]} />
              <meshStandardMaterial color="#8d97a3" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0, l / 2 - 0.05, 0]}>
              <torusGeometry args={[0.52, 0.05, 8, 32]} />
              <meshStandardMaterial color="#2a313c" metalness={0.6} roughness={0.4} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

function Depot({ layout }: { layout: LatticeLayout }) {
  const d = layout.depot
  return (
    <group position={d}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 7, -1.9, 0]}>
          <sphereGeometry args={[0.09, 10, 8]} />
          <meshBasicMaterial color={new THREE.Color('#ff5d5d').multiplyScalar(4)} toneMapped={false} />
        </mesh>
      ))}
      {layout.modules.filter((m) => m.slot === null).map((m) => (
        <mesh key={m.id} position={[m.position[0] - d[0], -1.35, m.position[2] - d[2]]}>
          <cylinderGeometry args={[0.35, 0.45, 0.6, 16]} />
          <meshStandardMaterial color="#8d97a3" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  )
}

function LatticeStructureImpl({ layout }: { layout: LatticeLayout }) {
  return (
    <group>
      <Hub />
      <Truss layout={layout} />
      <Wings />
      <DockAdapters layout={layout} />
      <Depot layout={layout} />
    </group>
  )
}

export const LatticeStructure = memo(LatticeStructureImpl)
