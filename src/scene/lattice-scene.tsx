'use client'
// LATTICE 3D scene. Load with next/dynamic({ ssr: false }).
import { forwardRef, Suspense, useImperativeHandle, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import type { CameraFrame, Generation, ModuleId, PhaseKind, Segment, Vec3 } from '@/contracts'
import type { LatticeSceneHandle, LatticeSceneProps } from './index'
import { featuresOf, findModule, inspectionStations, sub } from './geometry'
import { SpaceEnvironment } from './environment'
import { LatticeStructure } from './structure'
import { ComputeModule, type RadiatorState } from './module'
import { Servicer } from './servicer'
import { Markers } from './markers'
import { CameraRig } from './camera-rig'
import { captureStations } from './capture'

const NO_MARKERS: Segment[] = []

type CaptureFn = (module: ModuleId) => Promise<CameraFrame[]>

const REPAIRED_PHASES = new Set<PhaseKind>(['latch', 'release', 'retreat', 'return_home'])

function SceneContents(props: LatticeSceneProps & { captureRef: React.RefObject<CaptureFn | null> }) {
  const { layout, pose, modules, focus, damage, markers, view, generations, repaired, captureRef } = props
  const quality = props.quality ?? 'high'
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const servicerRef = useRef<THREE.Group>(null)
  const markersRef = useRef<THREE.Group>(null)
  const flood = useRef<THREE.PointLight>(null)
  const poseRef = useRef(pose)
  poseRef.current = pose

  // Radiator FRU state on the focus module, inferred from the ops pose (sticky once a carried FRU was seen).
  const sawFru = useRef(false)
  const lastDamage = useRef(damage)
  if (lastDamage.current !== damage || pose.phase === null) { sawFru.current = false; lastDamage.current = damage }
  const fruVisible = !!pose.fru && pose.fru.visible !== false
  if (fruVisible) sawFru.current = true
  const radiatorState: RadiatorState = repaired
    ? 'repaired'
    : fruVisible
      ? 'removed'
      : sawFru.current || (pose.phase !== null && REPAIRED_PHASES.has(pose.phase) && damage === 'radiator-puncture' && pose.servicer.arms.every((a) => !a.target))
        ? 'repaired'
        : 'intact'

  // Focus module world position (follows a moving module).
  const focusPos = useRef<Vec3 | null>(null)
  const focusGeom = focus ? findModule(layout, focus) : undefined
  useFrame(() => {
    if (!focusGeom) { focusPos.current = null; return }
    const o = pose.modules[focusGeom.id]
    // Overview frames the slot (after a swap the spare sits there); follow tracks the module wherever it goes.
    focusPos.current = view !== 'overview' && o && o.visible !== false ? o.position : focusGeom.position
  })

  // Ops-shot side: the side of the module where the work happens (damage / FRU), module-local ±Z.
  const sideHint: 1 | -1 = useMemo(() => {
    if (pose.fru) return pose.fru.kind === 'radiator_a' ? 1 : -1
    const dz = focusGeom ? featuresOf(focusGeom, damage).damage?.[2] : undefined
    return dz !== undefined && dz > 0.3 ? 1 : -1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusGeom, damage, pose.fru?.kind])

  // Carried-FRU decal/latch offsets in panel-local coordinates (from the focus module's features).
  const fruKind = pose.fru?.kind ?? null
  const fruOffsets = useMemo(() => {
    if (!focusGeom || !fruKind) return { dmg: null, latch: null }
    const f = featuresOf(focusGeom, damage)
    const c = f[fruKind]
    const latch = fruKind === 'radiator_a' ? f.radiator_latch_a : f.radiator_latch_b
    const d = f.damage ? sub(f.damage, c) : null
    return { dmg: d ? ([d[0], d[1], 0] as Vec3) : null, latch: [latch[0] - c[0], latch[1] - c[1], 0] as Vec3 }
  }, [focusGeom, fruKind, damage])

  captureRef.current = async (module: ModuleId) => {
    const o = pose.modules[module]
    const stations = inspectionStations(layout, module, {
      pose: o && o.visible !== false ? o : undefined,
      damage: module === focus ? damage : null,
    })
    const wobbles: [THREE.Object3D, THREE.Euler][] = []
    return captureStations(gl, scene, module, stations, {
      hide: [servicerRef.current, markersRef.current],
      flood: flood.current,
      before: () => {
        scene.traverse((ob) => {
          if (ob.userData.wobble) { wobbles.push([ob, ob.rotation.clone()]); ob.rotation.set(0, 0, 0) }
        })
      },
      after: () => { for (const [ob, r] of wobbles) ob.rotation.copy(r) },
    })
  }

  return (
    <>
      <SpaceEnvironment quality={quality} />
      <pointLight ref={flood} intensity={0} decay={2} distance={0} color="#ffffff" />
      <LatticeStructure layout={layout} />
      {layout.modules.map((m) => {
        const st = modules[m.id] ?? { status: m.slot === null ? 'spare' : 'nominal', util: m.slot === null ? 0 : 0.6 }
        const gen: Generation = generations?.[m.id] ?? (m.slot === null ? 2 : 1)
        const isFocus = m.id === focus
        return (
          <ComputeModule
            key={m.id}
            geom={m}
            status={st.status}
            util={st.util}
            generation={gen}
            damage={isFocus ? damage : null}
            poseRef={poseRef}
            radiator={isFocus ? radiatorState : 'intact'}
          />
        )
      })}
      <Servicer poseRef={poseRef} groupRef={servicerRef} fruKind={fruKind} fruDamaged={!!pose.fru?.damaged} fruDamageAt={fruOffsets.dmg} fruLatchAt={fruOffsets.latch} />
      <Markers markers={markers ?? NO_MARKERS} groupRef={markersRef} layout={layout} poseRef={poseRef} />
      <CameraRig view={view} focusPos={focusPos} servicer={servicerRef} layout={layout} poseRef={poseRef} focus={focus} sideHint={sideHint} />
      {quality === 'high' && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.95} luminanceSmoothing={0.15} radius={0.72} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.32} darkness={0.55} />
        </EffectComposer>
      )}
    </>
  )
}

export const LatticeScene = forwardRef<LatticeSceneHandle, LatticeSceneProps>(function LatticeScene(props, ref) {
  const captureRef = useRef<CaptureFn | null>(null)
  useImperativeHandle(ref, () => ({
    captureInspection: async (module: ModuleId) => {
      const fn = captureRef.current
      if (!fn) throw new Error('LatticeScene: scene not ready')
      return fn(module)
    },
  }), [])
  const quality = props.quality ?? 'high'
  return (
    <div className={props.className} style={{ position: 'relative', width: '100%', height: '100%', background: '#020309' }}>
      <Canvas
        dpr={quality === 'high' ? [1, 1.75] : 1}
        gl={{ antialias: quality !== 'high', powerPreference: 'high-performance', alpha: false, stencil: false }}
        camera={{ fov: 40, near: 0.1, far: 9000, position: [40, 20, 30] }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Suspense fallback={null}>
          <SceneContents {...props} captureRef={captureRef} />
        </Suspense>
      </Canvas>
    </div>
  )
})
