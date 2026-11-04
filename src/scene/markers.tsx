'use client'
// SAM-derived SEG points drawn as pulsing cyan reticles with a thin leader line and a tiny label.
import { memo, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { Segment, Vec3 } from '@/contracts'
import { ACCENT } from './geometry'

const CYAN = new THREE.Color(ACCENT).multiplyScalar(2.2)

function Reticle({ seg, point, phase }: { seg: Segment; point: Vec3; phase: number }) {
  const ring = useRef<THREE.Group>(null)
  const leaderEnd = useMemo<Vec3>(() => {
    const out = new THREE.Vector3(point[0], 0, point[2])
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0)
    out.normalize().multiplyScalar(0.55).add(new THREE.Vector3(0, 0.85, 0))
    return [out.x, out.y, out.z]
  }, [point])
  const text = `${seg.id} · ${seg.concept}${seg.feature ? ` · ${seg.feature.distance.toFixed(2)} m` : ''}`
  const label = useMemo(() => {
    const c = document.createElement('canvas')
    const g = c.getContext('2d')!
    const font = '500 26px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    g.font = font
    const w = Math.ceil(g.measureText(text).width) + 16
    c.width = w
    c.height = 40
    g.font = font
    g.fillStyle = 'rgba(5,7,11,0.72)'
    g.fillRect(0, 0, w, 40)
    g.fillStyle = ACCENT
    g.textBaseline = 'middle'
    g.fillText(text, 8, 21)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const k = 0.0003
    return { tex, scale: [w * k, 40 * k, 1] as [number, number, number] }
  }, [text])
  useFrame((s) => {
    const t = s.clock.elapsedTime + phase
    const k = 1 + 0.18 * Math.sin(t * 4)
    ring.current?.scale.setScalar(k)
  })
  return (
    <group position={point}>
      <Billboard>
        <group ref={ring}>
          <mesh>
            <ringGeometry args={[0.12, 0.145, 40]} />
            <meshBasicMaterial color={CYAN} toneMapped={false} transparent opacity={0.95} depthTest={false} />
          </mesh>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} rotation={[0, 0, (i * Math.PI) / 2]} position={[Math.cos((i * Math.PI) / 2) * 0.2, Math.sin((i * Math.PI) / 2) * 0.2, 0]}>
              <planeGeometry args={[0.08, 0.016]} />
              <meshBasicMaterial color={CYAN} toneMapped={false} depthTest={false} />
            </mesh>
          ))}
          <mesh>
            <circleGeometry args={[0.025, 16]} />
            <meshBasicMaterial color={CYAN} toneMapped={false} depthTest={false} />
          </mesh>
        </group>
      </Billboard>
      <Line points={[[0, 0, 0], leaderEnd]} color={ACCENT} lineWidth={1} transparent opacity={0.85} depthTest={false} />
      <sprite position={leaderEnd} center={new THREE.Vector2(-0.04, 0.5)} scale={label.scale} renderOrder={21}>
        <spriteMaterial map={label.tex} sizeAttenuation={false} depthTest={false} transparent toneMapped={false} />
      </sprite>
    </group>
  )
}

function MarkersImpl({ markers, groupRef }: { markers: Segment[]; groupRef?: React.RefObject<THREE.Group | null> }) {
  return (
    <group ref={groupRef} name="markers" renderOrder={20}>
      {markers.map((s, i) => (s.point ? <Reticle key={s.id} seg={s} point={s.point} phase={i * 0.9} /> : null))}
    </group>
  )
}

export const Markers = memo(MarkersImpl)
