'use client'
// Space backdrop: procedural Earth with atmospheric rim, star field, sun glow, key/fill lights, reflection env.
import { memo, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'

/** Unit vector toward the sun (lattice frame). Low sun so the Earth below shows a day/terminator gradient. */
export const SUN_DIR = new THREE.Vector3(0.82, 0.36, 0.45).normalize()
export const EARTH_RADIUS = 1300
export const EARTH_CENTER = new THREE.Vector3(0, -1440, 0)

const NOISE_GLSL = /* glsl */ `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
                 mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                 mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
`

function Earth({ detail }: { detail: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: SUN_DIR.clone() }, uCenter: { value: EARTH_CENTER.clone() }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vWorld; varying vec3 vN;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun; uniform vec3 uCenter; uniform float uTime;
          varying vec3 vWorld; varying vec3 vN;
          ${NOISE_GLSL}
          void main() {
            vec3 n = normalize(vN);
            vec3 sp = normalize(vWorld - uCenter);
            vec3 V = normalize(cameraPosition - vWorld);
            float ndl = dot(n, uSun);
            float day = smoothstep(-0.12, 0.35, ndl);
            float h = fbm(sp * 5.0 + vec3(3.0, 1.0, 7.0), ${detail});
            float land = smoothstep(0.50, 0.535, h);
            float tone = fbm(sp * 22.0, ${Math.max(2, detail - 1)});
            vec3 ocean = mix(vec3(0.010, 0.045, 0.12), vec3(0.02, 0.10, 0.22), smoothstep(0.35, 0.5, h));
            vec3 ground = mix(vec3(0.10, 0.14, 0.06), vec3(0.32, 0.26, 0.16), tone);
            ground = mix(ground, vec3(0.75, 0.78, 0.8), smoothstep(0.62, 0.7, h)); // ice / high ground
            vec3 albedo = mix(ocean, ground, land);
            float cl = fbm(sp * 9.0 + vec3(uTime * 0.002, 0.0, 0.0), ${detail});
            float clouds = smoothstep(0.53, 0.78, cl) * 0.85;
            albedo = mix(albedo, vec3(0.78, 0.8, 0.84), clouds);
            vec3 col = albedo * (0.03 + 1.1 * day * max(ndl + 0.12, 0.0));
            // Ocean sun glint.
            vec3 R = reflect(-uSun, n);
            float glint = pow(max(dot(R, V), 0.0), 80.0) * (1.0 - land) * (1.0 - clouds) * day;
            col += vec3(1.0, 0.86, 0.66) * glint * 1.6;
            // City lights on the night side.
            float city = smoothstep(0.78, 0.86, vnoise(sp * 260.0)) * land * (1.0 - clouds) * (1.0 - smoothstep(-0.2, 0.05, ndl));
            col += vec3(1.0, 0.62, 0.3) * city * 0.6;
            // Atmospheric haze toward the limb.
            float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
            col = mix(col, vec3(0.30, 0.58, 1.0) * (0.15 + 0.9 * day), fres * 0.85);
            // Terminator warm band.
            col += vec3(0.6, 0.25, 0.08) * fres * (1.0 - smoothstep(0.0, 0.25, abs(ndl))) * 0.35;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [detail],
  )
  const atmo = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: SUN_DIR.clone() }, uCenter: { value: EARTH_CENTER.clone() } },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec3 vWorld; varying vec3 vN;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun; uniform vec3 uCenter; varying vec3 vWorld; varying vec3 vN;
          void main() {
            vec3 n = normalize(vN);
            vec3 V = normalize(cameraPosition - vWorld);
            float rim = 1.0 - abs(dot(n, V));
            float glow = pow(rim, 5.0) * 1.6 + pow(rim, 18.0) * 2.5;
            float day = smoothstep(-0.35, 0.45, dot(normalize(vWorld - uCenter), uSun));
            vec3 col = mix(vec3(0.25, 0.55, 1.0), vec3(0.55, 0.8, 1.0), pow(rim, 12.0));
            gl_FragColor = vec4(col * glow * (0.08 + day), 1.0);
          }`,
      }),
    [],
  )
  useFrame((s) => { material.uniforms.uTime.value = s.clock.elapsedTime })
  return (
    <group position={EARTH_CENTER.toArray()}>
      <mesh material={material} renderOrder={-2}>
        <sphereGeometry args={[EARTH_RADIUS, 160, 96]} />
      </mesh>
      <mesh material={atmo} renderOrder={-1}>
        <sphereGeometry args={[EARTH_RADIUS * 1.022, 128, 64]} />
      </mesh>
    </group>
  )
}

function StarField({ count }: { count: number }) {
  const [geometry, material] = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const mag = new Float32Array(count)
    const tint = new Float32Array(count)
    let s = 12345
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < count; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, q = Math.sqrt(1 - u * u)
      pos.set([q * Math.cos(a) * 4200, u * 4200, q * Math.sin(a) * 4200], i * 3)
      mag[i] = Math.pow(r(), 3.5)
      tint[i] = r()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('mag', new THREE.BufferAttribute(mag, 1))
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 1))
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float mag; attribute float tint; varying float vB; varying vec3 vC;
        void main() {
          vB = 0.25 + 1.6 * mag;
          vC = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.88, 0.75), tint);
          gl_PointSize = 1.2 + 2.2 * mag;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vB; varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = 1.0 - smoothstep(0.0, 0.5, d);
          gl_FragColor = vec4(vC * vB, a);
        }`,
    })
    return [g, m]
  }, [count])
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-3} />
}

function Sun() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float core = (1.0 - smoothstep(0.05, 0.08, d)) * 30.0;
            float halo = pow(max(1.0 - d, 0.0), 6.0) * 2.0;
            gl_FragColor = vec4(vec3(1.0, 0.93, 0.82) * (core + halo), 1.0);
          }`,
      }),
    [],
  )
  const p = SUN_DIR.clone().multiplyScalar(4000)
  return (
    <mesh position={p.toArray()} material={mat} onUpdate={(m) => m.lookAt(0, 0, 0)} renderOrder={-2}>
      <planeGeometry args={[1400, 1400]} />
    </mesh>
  )
}

function SpaceEnvironmentImpl({ quality }: { quality: 'high' | 'low' }) {
  const key = SUN_DIR.clone().multiplyScalar(60)
  return (
    <>
      <color attach="background" args={['#020309']} />
      <StarField count={quality === 'high' ? 3500 : 1500} />
      <Sun />
      <Earth detail={quality === 'high' ? 5 : 3} />
      {/* Key: the sun. Fill: earthshine from below + a whisper of ambient. */}
      <directionalLight position={key.toArray()} intensity={3.4} color="#fff3e2" />
      <hemisphereLight args={['#1c222c', '#2a4560', 0.3]} />
      <ambientLight intensity={0.05} />
      <directionalLight position={[-40, -10, -30]} intensity={0.22} color="#8fb8e8" />
      <Environment frames={1} resolution={128}>
        <Lightformer form="rect" intensity={6} color="#fff1dc" position={SUN_DIR.clone().multiplyScalar(10).toArray()} scale={[6, 6, 1]} onUpdate={(m) => m.lookAt(0, 0, 0)} />
        <Lightformer form="rect" intensity={0.45} color="#2d5a8a" position={[0, -10, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[60, 60, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#d8dde4" position={[-10, 4, -6]} scale={[8, 3, 1]} onUpdate={(m) => m.lookAt(0, 0, 0)} />
        <Lightformer form="ring" intensity={0.8} color="#59d6ff" position={[6, 8, -10]} scale={3} onUpdate={(m) => m.lookAt(0, 0, 0)} />
      </Environment>
    </>
  )
}

export const SpaceEnvironment = memo(SpaceEnvironmentImpl)
