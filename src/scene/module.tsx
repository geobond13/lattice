'use client'
// One compute module (or spare): body with panel lines, status strip, generation trim, util-driven server lights,
// radiators A/B with latches, grapple fixture (+X), PDU panel (−Y), thruster pod, and per-scenario damage.
import { memo, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { FeatureId, Generation, ModuleGeometry, ModuleStatus, ScenePose, Vec3 } from '@/contracts'
import {
  add, faceNormal, featuresOf, GEN_COLOR, GEN_FINISH, GEN_GLOW, norm, scale, STATUS_COLOR, utilFraction, type DamageKind,
} from './geometry'
import { grappleTex, hazardTex, moduleSkin, pduTex, punctureTex, radiatorGlowTex, radiatorTex, scorchTex } from './textures'
import { alignY, burstHash, ExhaustCone, Plume } from './effects'

export type RadiatorState = 'intact' | 'removed' | 'repaired'

// ─── Server lights ────────────────────────────────────────────────────────────────────────────────

function ledMaterial(cols: number, rows: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uUtil: { value: 0.5 }, uDead: { value: 0 }, uGrid: { value: new THREE.Vector2(cols, rows) } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uUtil, uDead; uniform vec2 uGrid; varying vec2 vUv;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 g = vUv * uGrid; vec2 id = floor(g); vec2 f = fract(g);
        float cell = 1.0 - smoothstep(0.28, 0.40, max(abs(f.x - 0.5), abs(f.y - 0.5)));
        float h = h2(id);
        float tick = floor(uTime * (1.5 + 9.0 * h) * (0.25 + uUtil) + h * 50.0);
        float on = step(h2(id + tick * 0.37), uUtil * 0.95);
        vec3 col = mix(vec3(0.35, 0.85, 1.0), vec3(0.55, 1.0, 0.7), step(0.86, h));
        vec3 dead = vec3(1.0, 0.25, 0.2) * step(0.93, h) * (0.5 + 0.5 * sin(uTime * 3.0));
        vec3 lit = mix(col * on * 2.4, dead * 2.0, uDead);
        vec3 bg = vec3(0.025, 0.032, 0.045);
        gl_FragColor = vec4(mix(bg, lit + bg, cell), 1.0);
      }`,
  })
}

// ─── Radiator panel (also used for the FRU the servicer carries) ──────────────────────────────────

export const RAD_W = 2.8
export const RAD_H = 1.6

/** Radiator panel centred at the origin; outward normal is +Z * normalSign. Damage/latch offsets are panel-local. */
export function RadiatorPanel({ normalSign, damageAt, latchAt, venting, heat = 0.5, tone = 'normal' }: {
  normalSign: 1 | -1
  damageAt?: Vec3 | null
  latchAt?: Vec3 | null
  venting?: boolean
  heat?: number
  /** 'damaged': sooty, cold, dark. 'new': bright, glowing tubes and a cyan edge (fresh FRU). */
  tone?: 'normal' | 'damaged' | 'new'
}) {
  const out = normalSign * 0.026
  const ventDir = useMemo(() => norm([-0.35, 0.25, normalSign * 1]), [normalSign])
  return (
    <group>
      <mesh>
        <boxGeometry args={[RAD_W, RAD_H, 0.04]} />
        <meshStandardMaterial
          map={radiatorTex()}
          emissiveMap={radiatorGlowTex()}
          emissive={tone === 'new' ? '#e6f7ff' : '#ffd9a8'}
          emissiveIntensity={tone === 'damaged' ? 0 : tone === 'new' ? 1.6 : heat}
          metalness={0.15}
          roughness={tone === 'damaged' ? 0.8 : 0.35}
          color={tone === 'damaged' ? '#948a7e' : '#ffffff'}
        />
      </mesh>
      {/* Edge frame for a crisp silhouette. */}
      <mesh position={[0, 0, -normalSign * 0.035]}>
        <boxGeometry args={[RAD_W + 0.06, RAD_H + 0.06, 0.03]} />
        <meshStandardMaterial color="#3d4652" metalness={0.7} roughness={0.4} emissive={tone === 'damaged' ? '#ff5d5d' : '#59d6ff'} emissiveIntensity={tone === 'new' ? 2.2 : tone === 'damaged' ? 0.9 : 0} />
      </mesh>
      {latchAt && <Latch position={[latchAt[0], latchAt[1], out]} normalSign={normalSign} />}
      {damageAt && (
        <>
          <mesh position={[damageAt[0], damageAt[1], out + normalSign * 0.004]} rotation={[0, normalSign > 0 ? 0 : Math.PI, 0]} renderOrder={2}>
            <planeGeometry args={[1.0, 1.0]} />
            <meshStandardMaterial map={punctureTex()} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} roughness={0.9} metalness={0.1} />
          </mesh>
          {venting && (
            <Plume
              position={[damageAt[0], damageAt[1], out]}
              dir={ventDir}
              count={1100}
              life={2.2}
              speed={1.7}
              spread={0.22}
              size={0.028}
              grow={0.25}
              colorA="#ffffff"
              colorB="#8fd8ff"
              intensity={1.3}
            />
          )}
        </>
      )}
    </group>
  )
}

function Latch({ position, normalSign }: { position: Vec3; normalSign: 1 | -1 }) {
  const hz = hazardTex()
  return (
    <group position={position} rotation={[0, normalSign > 0 ? 0 : Math.PI, 0]}>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[0.22, 0.22, 0.08]} />
        <meshStandardMaterial map={hz} roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.1]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[0.2, 0.05, 0.05]} />
        <meshStandardMaterial color="#111418" metalness={0.6} roughness={0.35} />
      </mesh>
    </group>
  )
}

// ─── Grapple fixture ──────────────────────────────────────────────────────────────────────────────

function Grapple({ position, normal }: { position: Vec3; normal: Vec3 }) {
  const q = useMemo(() => alignY(normal), [normal])
  const tex = grappleTex()
  return (
    <group position={position} quaternion={q}>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.64, 0.04, 0.64]} />
        <meshStandardMaterial attach="material-0" color="#f4f4f4" />
        <meshStandardMaterial attach="material-1" color="#f4f4f4" />
        <meshStandardMaterial attach="material-2" map={tex} roughness={0.55} metalness={0.05} />
        <meshStandardMaterial attach="material-3" color="#f4f4f4" />
        <meshStandardMaterial attach="material-4" color="#f4f4f4" />
        <meshStandardMaterial attach="material-5" color="#f4f4f4" />
      </mesh>
      {/* Grapple pin with cone tip and black band. */}
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.045, 0.06, 0.32, 20]} />
        <meshStandardMaterial color="#f4f4f4" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.049, 0.049, 0.06, 20]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <coneGeometry args={[0.09, 0.12, 24]} />
        <meshStandardMaterial color="#ffd400" roughness={0.4} emissive="#ffd400" emissiveIntensity={0.15} />
      </mesh>
      {/* Alignment cross on a short stand-off. */}
      <group position={[0.24, 0.14, -0.24]}>
        <mesh position={[0, -0.05, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.1, 6]} />
          <meshStandardMaterial color="#0a0a0a" />
        </mesh>
        <mesh>
          <cylinderGeometry args={[0.08, 0.08, 0.012, 24]} />
          <meshStandardMaterial color="#0a0a0a" />
        </mesh>
        <mesh position={[0, 0.008, 0]}>
          <boxGeometry args={[0.13, 0.004, 0.02]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0.008, 0]}>
          <boxGeometry args={[0.02, 0.004, 0.13]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      </group>
    </group>
  )
}

// ─── Thruster pod ─────────────────────────────────────────────────────────────────────────────────

const STUCK_DIR: Vec3 = norm([0.15, 0.25, 1])

function ThrusterPod({ position, stuck }: { position: Vec3; stuck: boolean }) {
  const nozzles: Vec3[] = [STUCK_DIR, [0, 1, 0], norm([0.15, 0.25, -1])]
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.36, 0.26, 0.36]} />
        <meshStandardMaterial color="#3a414c" metalness={0.6} roughness={0.4} />
      </mesh>
      {nozzles.map((d, i) => {
        const q = alignY(d)
        const p = scale(d, 0.2)
        return (
          <group key={i} position={p} quaternion={q}>
            <mesh position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.07, 0.035, 0.12, 14, 1, true]} />
              <meshStandardMaterial
                color="#8b8f96"
                metalness={0.9}
                roughness={0.3}
                side={THREE.DoubleSide}
                emissive="#ff7a2a"
                emissiveIntensity={stuck && i === 0 ? 2.2 : 0}
              />
            </mesh>
          </group>
        )
      })}
      {stuck && (
        <>
          <ExhaustCone position={scale(STUCK_DIR, 0.3)} dir={STUCK_DIR} length={3.2} radius={0.5} color="#9fd8ff" intensity={2.4} />
          <Plume position={scale(STUCK_DIR, 0.3)} dir={STUCK_DIR} count={420} life={0.8} speed={5.5} spread={0.12} size={0.045} grow={0.6} colorA="#ffffff" colorB="#8cc8ff" intensity={1.4} />
        </>
      )}
    </group>
  )
}

// ─── PDU panel ────────────────────────────────────────────────────────────────────────────────────

function PduPanel({ position, normal, shorted }: { position: Vec3; normal: Vec3; shorted: boolean }) {
  const q = useMemo(() => alignY(normal), [normal])
  const light = useRef<THREE.PointLight>(null)
  const arc = useRef<THREE.MeshBasicMaterial>(null)
  const arcColor = useMemo(() => new THREE.Color('#ffb36b'), [])
  useFrame((s) => {
    if (!shorted) return
    const t = s.clock.elapsedTime
    // Same burst schedule as the spark plume (burstRate 3/s).
    const on = burstHash(Math.floor(t * 3)) > 0.55 ? 1 : 0
    const flick = on * (0.5 + 0.5 * Math.abs(Math.sin(t * 61)) * Math.abs(Math.sin(t * 23)))
    if (light.current) light.current.intensity = 6 * flick
    if (arc.current) arc.current.color.copy(arcColor).multiplyScalar(0.2 + 7 * flick)
  })
  return (
    <group position={position} quaternion={q}>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[1.1, 0.06, 0.8]} />
        <meshStandardMaterial attach="material-0" color="#2b3240" />
        <meshStandardMaterial attach="material-1" color="#2b3240" />
        <meshStandardMaterial attach="material-2" map={pduTex()} roughness={0.6} metalness={0.3} />
        <meshStandardMaterial attach="material-3" color="#2b3240" />
        <meshStandardMaterial attach="material-4" color="#2b3240" />
        <meshStandardMaterial attach="material-5" color="#2b3240" />
      </mesh>
      {shorted && (
        <>
          <mesh position={[0.05, 0.064, 0.05]} rotation={[-Math.PI / 2, 0, 0.6]} renderOrder={2}>
            <planeGeometry args={[1.25, 1.25]} />
            <meshStandardMaterial map={scorchTex()} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} roughness={0.95} />
          </mesh>
          <mesh position={[0.05, 0.08, 0.05]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshBasicMaterial ref={arc} color="#ffb36b" toneMapped={false} />
          </mesh>
          <pointLight ref={light} position={[0.05, 0.4, 0.05]} color="#ff9a4a" distance={6} decay={2} intensity={0} />
          <Plume position={[0.05, 0.08, 0.05]} dir={[0, 1, 0]} count={320} life={0.55} speed={2.6} spread={1.4} size={0.035} grow={0} burstRate={3} colorA="#fff6d8" colorB="#ff7a1a" intensity={6} />
        </>
      )}
    </group>
  )
}

// ─── Swap shimmer (generation change) ─────────────────────────────────────────────────────────────

function SwapShimmer({ size, generation }: { size: Vec3; generation: Generation }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uP: { value: 0 }, uC: { value: new THREE.Color('#bdf3ff') }, uH: { value: size[1] } },
        vertexShader: /* glsl */ `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uP; uniform vec3 uC; uniform float uH; varying vec3 vP;
          void main() {
            float y = vP.y / uH + 0.5;
            float dy = (y - uP * 1.3 + 0.15) * 9.0;
            float band = exp(-dy * dy);
            float a = (band * 1.6 + 0.12) * (1.0 - smoothstep(0.75, 1.0, uP));
            gl_FragColor = vec4(uC * a * 2.0, a);
          }`,
      }),
    [size],
  )
  const mesh = useRef<THREE.Mesh>(null)
  const t0 = useRef<number | null>(null)
  const last = useRef(generation)
  useFrame((s) => {
    if (generation !== last.current) { last.current = generation; t0.current = s.clock.elapsedTime }
    const m = mesh.current
    if (!m) return
    if (t0.current === null) { m.visible = false; return }
    const p = (s.clock.elapsedTime - t0.current) / 1.6
    m.visible = p < 1
    mat.uniforms.uP.value = p
  })
  return (
    <mesh ref={mesh} material={mat} visible={false} renderOrder={8}>
      <boxGeometry args={[size[0] + 0.12, size[1] + 0.12, size[2] + 0.5]} />
    </mesh>
  )
}

// ─── Module ───────────────────────────────────────────────────────────────────────────────────────

export interface ComputeModuleProps {
  geom: ModuleGeometry
  status: ModuleStatus
  util: number
  generation: Generation
  damage: DamageKind | null
  /** Live pose (read every frame; `modules[id]` overrides the docked pose). */
  poseRef: RefObject<ScenePose>
  radiator: RadiatorState
}

const DEAD = new Set<ModuleStatus>(['failed', 'departed', 'drained', 'undocked'])

function ComputeModuleImpl({ geom, status, util, generation, damage, poseRef, radiator }: ComputeModuleProps) {
  const outer = useRef<THREE.Group>(null)
  const wobble = useRef<THREE.Group>(null)
  const first = useRef(true)
  const f = useMemo(() => featuresOf(geom, damage), [geom, damage])
  const [sx, sy, sz] = geom.size
  const [hx, hy] = [sx / 2, sy / 2]

  const skin = useMemo(() => moduleSkin(geom.id), [geom.id])
  const finish = GEN_FINISH[generation]
  const statusMat = useRef<THREE.MeshBasicMaterial>(null)
  const statusColor = useMemo(() => new THREE.Color(STATUS_COLOR[status]), [status])
  const genColor = useMemo(() => new THREE.Color(GEN_COLOR[generation]).multiplyScalar(GEN_GLOW[generation]), [generation])
  const ledTop = useMemo(() => ledMaterial(14, 4), [])
  const ledSide = useMemo(() => ledMaterial(3, 12), [])

  const tp = useMemo(() => new THREE.Vector3(), [])
  const tq = useMemo(() => new THREE.Quaternion(), [])
  useFrame((s, dt) => {
    const g = outer.current
    if (!g) return
    const t = s.clock.elapsedTime
    const override = poseRef.current?.modules[geom.id]
    const pose = override ?? { position: geom.position, quaternion: geom.quaternion, visible: true }
    g.visible = pose.visible !== false
    tp.set(...pose.position)
    tq.set(...pose.quaternion)
    if (first.current) { g.position.copy(tp); g.quaternion.copy(tq); first.current = false }
    else {
      const k = 1 - Math.exp(-dt * 10)
      g.position.lerp(tp, k)
      g.quaternion.slerp(tq, k)
    }
    // Stuck thruster: slow sway about the dock port, only while docked.
    if (wobble.current) {
      const on = damage === 'thruster-stuck' && !override
      wobble.current.rotation.set(on ? 0.012 * Math.sin(t * 1.3) : 0, on ? 0.03 * Math.sin(t * 0.9) : 0, on ? 0.008 * Math.sin(t * 0.7) : 0)
    }
    // Status strip: quiet when nominal, bright (and pulsing when failed) otherwise.
    if (statusMat.current) {
      const quiet = status === 'nominal' || status === 'spare'
      const pulse = status === 'failed' ? 0.55 + 0.45 * Math.sin(t * 4) : 1
      statusMat.current.color.copy(statusColor).multiplyScalar(quiet ? 0.85 : 3.2 * pulse)
    }
    const u = utilFraction(util)
    for (const m of [ledTop, ledSide]) {
      m.uniforms.uTime.value = t
      m.uniforms.uUtil.value = u
      m.uniforms.uDead.value = DEAD.has(status) ? 1 : 0
    }
  })

  const radA = f.radiator_a
  const radB = f.radiator_b
  const sideOf = (p: Vec3): 1 | -1 => (p[2] >= 0 ? 1 : -1)
  const panelLocal = (p: Vec3 | undefined, c: Vec3): Vec3 | null => (p ? [p[0] - c[0], p[1] - c[1], 0] : null)
  const puncture = damage === 'radiator-puncture'
  // Which radiator the damage sits on (nearest centre).
  const dmgOn: 'radiator_a' | 'radiator_b' | null = puncture && f.damage
    ? (Math.abs(f.damage[2] - radA[2]) < Math.abs(f.damage[2] - radB[2]) ? 'radiator_a' : 'radiator_b')
    : null

  const radiators: { id: 'radiator_a' | 'radiator_b'; c: Vec3; latch: Vec3; hidden: boolean; damaged: boolean }[] = [
    { id: 'radiator_a', c: radA, latch: f.radiator_latch_a, hidden: dmgOn === 'radiator_a' && radiator === 'removed', damaged: dmgOn === 'radiator_a' && radiator === 'intact' },
    { id: 'radiator_b', c: radB, latch: f.radiator_latch_b, hidden: dmgOn === 'radiator_b' && radiator === 'removed', damaged: dmgOn === 'radiator_b' && radiator === 'intact' },
  ]
  const n = (id: FeatureId) => faceNormal(geom.size, f[id])
  const heat = DEAD.has(status) ? 0.12 : 0.25 + 0.5 * utilFraction(util)

  return (
    <group ref={outer} name={geom.id}>
      <group position={[-hx, 0, 0]}>
        <group ref={wobble} userData={{ wobble: true }}>
          <group position={[hx, 0, 0]}>
            {/* Body. */}
            <mesh>
              <boxGeometry args={[sx, sy, sz]} />
              <meshStandardMaterial map={skin} color={finish.tint} roughness={finish.roughness} metalness={finish.metalness} />
            </mesh>
            {/* Status strip (wraps the module near the top). */}
            <mesh position={[0, hy - 0.16, 0]}>
              <boxGeometry args={[sx + 0.03, 0.08, sz + 0.03]} />
              <meshBasicMaterial ref={statusMat} toneMapped={false} />
            </mesh>
            {/* Generation trim (thin band near the bottom). */}
            <mesh position={[0, -hy + 0.14, 0]}>
              <boxGeometry args={[sx + 0.02, 0.035, sz + 0.02]} />
              <meshBasicMaterial color={genColor} toneMapped={false} />
            </mesh>
            {/* Server lights: two columns flanking the grapple, and a strip on top. */}
            {[-1, 1].map((s) => (
              <mesh key={s} position={[hx + 0.006, -0.12, s * 0.8]} rotation={[0, Math.PI / 2, 0]} material={ledSide}>
                <planeGeometry args={[0.36, 1.3]} />
              </mesh>
            ))}
            <mesh position={[-0.35, hy + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} material={ledTop}>
              <planeGeometry args={[2.0, 0.55]} />
            </mesh>
            {/* Dock port collar (−X). */}
            <mesh position={add(f.dock_port, [-0.08, 0, 0])} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.55, 0.55, 0.16, 28]} />
              <meshStandardMaterial color="#5b6470" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Radiators with stand-off brackets and latches. */}
            {radiators.map((r) => !r.hidden && (
              <group key={r.id} position={r.c}>
                <RadiatorPanel
                  normalSign={sideOf(r.c)}
                  latchAt={panelLocal(r.latch, r.c)}
                  damageAt={r.damaged ? panelLocal(f.damage, r.c) : null}
                  venting={r.damaged}
                  heat={r.damaged ? 0.05 : heat}
                  tone={dmgOn === r.id && radiator === 'repaired' ? 'new' : 'normal'}
                />
                {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => (
                  <mesh key={`${i}${j}`} position={[i * 1.1, j * 0.55, -sideOf(r.c) * 0.06]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.025, 0.025, 0.1, 6]} />
                    <meshStandardMaterial color="#5b6470" metalness={0.8} roughness={0.3} />
                  </mesh>
                ))}
              </group>
            ))}
            <Grapple position={f.grapple} normal={n('grapple')} />
            <PduPanel position={f.pdu_panel} normal={n('pdu_panel')} shorted={damage === 'power-bus-short'} />
            <ThrusterPod position={f.thruster_pod} stuck={damage === 'thruster-stuck'} />
            <SwapShimmer size={geom.size} generation={generation} />
          </group>
        </group>
      </group>
    </group>
  )
}

/** Memoised: re-renders only on visual changes (util quantised to 2 %); motion is read from poseRef per frame. */
export const ComputeModule = memo(ComputeModuleImpl, (a, b) =>
  a.geom === b.geom && a.status === b.status && a.generation === b.generation && a.damage === b.damage &&
  a.radiator === b.radiator && a.poseRef === b.poseRef && Math.round(utilFraction(a.util) * 50) === Math.round(utilFraction(b.util) * 50))
