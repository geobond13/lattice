'use client'
// GPU-only particle plumes (stateless: every particle's age is a function of time) and exhaust cones.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Vec3 } from '@/contracts'

/** Same hash as the GLSL `burst()` below, so JS-driven flicker matches spark bursts. */
export function burstHash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const Y = new THREE.Vector3(0, 1, 0)
/** Quaternion that rotates +Y onto `dir`. */
export function alignY(dir: Vec3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(...dir).normalize())
}

export interface PlumeProps {
  position: Vec3
  dir: Vec3
  count?: number
  life?: number
  speed?: number
  spread?: number
  /** World-space point size (m). */
  size?: number
  colorA?: string
  colorB?: string
  intensity?: number
  /** >0: emit only in bursts (rate per second); ~45 % of slots fire. */
  burstRate?: number
  /** Linear growth of particle size with age (vapour expanding). */
  grow?: number
  /** Live 0..1 multiplier read every frame. */
  level?: () => number
  blending?: THREE.Blending
}

export function Plume({
  position, dir, count = 400, life = 2, speed = 1.5, spread = 0.3, size = 0.06,
  colorA = '#e8f6ff', colorB = '#7fd0ff', intensity = 1.5, burstRate = 0, grow = 0.5, level, blending = THREE.AdditiveBlending,
}: PlumeProps) {
  const pts = useRef<THREE.Points>(null)
  const [geometry, material] = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const rnd = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    let s = 99 + count
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < count; i++) {
      rnd.set([r(), r(), r()], i * 3)
      seed[i] = i / count + r() * 0.002
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 3))
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), speed * life * 1.5 + 1)
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: {
        uTime: { value: 0 }, uLife: { value: life }, uSpeed: { value: speed }, uSpread: { value: spread },
        uSize: { value: size }, uViewH: { value: 800 }, uDir: { value: new THREE.Vector3(...dir).normalize() },
        uA: { value: new THREE.Color(colorA) }, uB: { value: new THREE.Color(colorB) }, uI: { value: intensity },
        uBurst: { value: burstRate }, uGrow: { value: grow }, uLevel: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 rnd; attribute float seed;
        uniform float uTime, uLife, uSpeed, uSpread, uSize, uViewH, uBurst, uGrow;
        uniform vec3 uDir;
        varying float vAge; varying float vOn; varying float vR;
        float burst(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
        void main() {
          float cyc = uTime / uLife + seed;
          float age = fract(cyc);
          float birth = (floor(cyc) - seed) * uLife;
          vOn = uBurst > 0.0 ? step(0.55, burst(floor(birth * uBurst))) : 1.0;
          vec3 d = normalize(uDir);
          vec3 a = abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 t1 = normalize(cross(d, a)); vec3 t2 = cross(d, t1);
          float ang = rnd.x * 6.2831853; float rr = sqrt(rnd.y) * uSpread;
          vec3 v = normalize(d + (t1 * cos(ang) + t2 * sin(ang)) * rr) * uSpeed * (0.55 + 0.9 * rnd.z);
          float tt = age * uLife;
          vec3 p = position + v * tt;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float sz = uSize * (0.5 + rnd.z) * (1.0 + uGrow * age * 4.0);
          gl_PointSize = max(1.0, sz * uViewH * projectionMatrix[1][1] / (2.0 * max(-mv.z, 0.05)));
          vAge = age; vR = rnd.x;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uA; uniform vec3 uB; uniform float uI; uniform float uLevel;
        varying float vAge; varying float vOn; varying float vR;
        void main() {
          if (vOn < 0.5) discard;
          float d = length(gl_PointCoord - 0.5);
          float a = 1.0 - smoothstep(0.05, 0.5, d);
          float fade = pow(clamp(1.0 - vAge, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.04, vAge);
          vec3 c = mix(uA, uB, clamp(vAge * 1.3 + vR * 0.2, 0.0, 1.0));
          float tw = 0.75 + 0.25 * step(0.82, fract(vR * 37.0 + vAge * 9.0)) * 2.0;
          gl_FragColor = vec4(c * uI * tw * uLevel, a * fade * uLevel);
        }`,
    })
    return [g, m]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, life, speed, spread, size, colorA, colorB, intensity, burstRate, grow, blending, dir[0], dir[1], dir[2]])

  useFrame((s) => {
    const l = level ? level() : 1
    material.uniforms.uTime.value = s.clock.elapsedTime
    material.uniforms.uLevel.value = l
    if (pts.current) pts.current.visible = l > 0.01
  })
  return (
    <points
      ref={pts}
      position={position}
      geometry={geometry}
      material={material}
      renderOrder={5}
      onBeforeRender={(renderer) => {
        const rt = renderer.getRenderTarget()
        material.uniforms.uViewH.value = rt ? rt.height : renderer.domElement.height
      }}
    />
  )
}

/** Additive flickering exhaust cone with its nozzle at `position`, pointing along `dir`. */
export function ExhaustCone({ position, dir, length = 2, radius = 0.35, color = '#9fd8ff', intensity = 2, level }: {
  position: Vec3; dir: Vec3; length?: number; radius?: number; color?: string; intensity?: number; level?: () => number
}) {
  const q = useMemo(() => alignY(dir), [dir])
  const [outer, inner] = useMemo(() => {
    const make = (k: number) =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uC: { value: new THREE.Color(color) }, uI: { value: intensity * k }, uLevel: { value: 1 } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main() { vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uC; uniform float uI; uniform float uLevel;
          varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main() {
            float along = clamp(vUv.y, 0.0, 1.0);
            float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.5);
            float flick = 0.8 + 0.2 * sin(uTime * 53.0 + along * 20.0) * sin(uTime * 31.0);
            float a = pow(1.0 - along, 2.2) * edge * flick * uLevel;
            vec3 c = mix(vec3(1.0), uC, smoothstep(0.0, 0.35, along));
            gl_FragColor = vec4(c * uI * a, a);
          }`,
      })
    return [make(1), make(1.8)]
  }, [color, intensity])
  const geoOuter = useMemo(() => new THREE.CylinderGeometry(radius, radius * 0.18, length, 24, 1, true).translate(0, length / 2, 0).scale(1, 1, 1), [length, radius])
  const geoInner = useMemo(() => new THREE.CylinderGeometry(radius * 0.45, radius * 0.1, length * 0.5, 16, 1, true).translate(0, length * 0.25, 0), [length, radius])
  const group = useRef<THREE.Group>(null)
  useFrame((s) => {
    const l = level ? level() : 1
    if (group.current) group.current.visible = l > 0.01
    for (const m of [outer, inner]) { m.uniforms.uTime.value = s.clock.elapsedTime; m.uniforms.uLevel.value = l }
  })
  // CylinderGeometry uv.y runs 0 at the bottom (nozzle, after the translate) to 1 at the far end.
  return (
    <group ref={group} position={position} quaternion={q}>
      <mesh geometry={geoOuter} material={outer} renderOrder={6} />
      <mesh geometry={geoInner} material={inner} renderOrder={7} />
    </group>
  )
}
