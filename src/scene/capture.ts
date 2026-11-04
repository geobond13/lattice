// Off-screen inspection capture: renders the live scene (no post-processing) from fixed pinhole cameras into a
// WebGLRenderTarget, applies ACES tone mapping + sRGB in a tiny pass, reads pixels back and encodes JPEGs.
// Image convention: pixel (0,0) is TOP-LEFT (rows are flipped from GL's bottom-left origin); fov is VERTICAL.
import * as THREE from 'three'
import type { CameraFrame, ModuleId } from '@/contracts'
import { INSPECTION_HEIGHT, INSPECTION_WIDTH, type InspectionStation } from './geometry'

const W = INSPECTION_WIDTH
const H = INSPECTION_HEIGHT

let cached: { hdr: THREE.WebGLRenderTarget; ldr: THREE.WebGLRenderTarget; quad: THREE.Mesh; qs: THREE.Scene; qc: THREE.OrthographicCamera } | null = null

function resources() {
  if (cached) return cached
  const hdr = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true })
  const ldr = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false })
  const mat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: hdr.texture }, uExposure: { value: 1.0 } },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc; uniform float uExposure; varying vec2 vUv;
      // ACES fitted (Stephen Hill), same curve family as three's ACESFilmicToneMapping.
      vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c) {
        const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        c *= uExposure / 0.6;
        c = inM * c; c = RRTAndODTFit(c); c = outM * c;
        return clamp(c, 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() { vec3 c = texture2D(tSrc, vUv).rgb; gl_FragColor = vec4(toSRGB(aces(c)), 1.0); }`,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  quad.frustumCulled = false
  const qs = new THREE.Scene()
  qs.add(quad)
  const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  cached = { hdr, ldr, quad, qs, qc }
  return cached
}

/** Build the exact pinhole camera used for a station (vertical fov, 4:3, up vector honoured). */
export function stationCamera(st: InspectionStation): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(st.camera.fovDeg, W / H, 0.05, 9000)
  c.position.set(...st.camera.position)
  c.up.set(...st.camera.up)
  c.lookAt(...st.camera.target)
  c.updateMatrixWorld(true)
  c.updateProjectionMatrix()
  return c
}

export interface CaptureOptions {
  /** Objects hidden during capture (markers, servicer, HUD-ish helpers). */
  hide?: (THREE.Object3D | null | undefined)[]
  /** A light moved to each camera as an inspection floodlight. */
  flood?: THREE.PointLight | null
  /** Called before/after the renders (e.g. freeze the stuck-thruster wobble). */
  before?: () => void
  after?: () => void
}

export function captureStations(gl: THREE.WebGLRenderer, scene: THREE.Scene, module: ModuleId, stations: InspectionStation[], opts: CaptureOptions = {}): CameraFrame[] {
  const r = resources()
  const prevTarget = gl.getRenderTarget()
  const prevAutoClear = gl.autoClear
  const prevTone = gl.toneMapping
  const hidden = (opts.hide ?? []).filter((o): o is THREE.Object3D => !!o).map((o) => [o, o.visible] as const)
  const flood = opts.flood
  const floodPrev = flood ? { i: flood.intensity, p: flood.position.clone() } : null
  const pixels = new Uint8Array(W * H * 4)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const frames: CameraFrame[] = []
  try {
    opts.before?.()
    for (const [o] of hidden) o.visible = false
    gl.autoClear = true
    gl.toneMapping = THREE.NoToneMapping
    scene.updateMatrixWorld(true)
    for (const st of stations) {
      const cam = stationCamera(st)
      if (flood) {
        flood.position.copy(cam.position).add(new THREE.Vector3(...st.camera.up).multiplyScalar(0.6))
        const d = cam.position.distanceTo(new THREE.Vector3(...st.camera.target))
        flood.intensity = 0.9 * d * d
        flood.updateMatrixWorld()
      }
      gl.setRenderTarget(r.hdr)
      gl.clear(true, true, true)
      gl.render(scene, cam)
      gl.setRenderTarget(r.ldr)
      gl.render(r.qs, r.qc)
      gl.readRenderTargetPixels(r.ldr, 0, 0, W, H, pixels)
      // Flip rows: GL row 0 is the bottom; image row 0 must be the top.
      for (let y = 0; y < H; y++) {
        const src = (H - 1 - y) * W * 4
        img.data.set(pixels.subarray(src, src + W * 4), y * W * 4)
      }
      ctx.putImageData(img, 0, 0)
      frames.push({
        id: st.id,
        label: st.label,
        src: canvas.toDataURL('image/jpeg', 0.85),
        width: W,
        height: H,
        camera: { position: st.camera.position, target: st.camera.target, up: st.camera.up, fovDeg: st.camera.fovDeg },
        module,
      })
    }
  } finally {
    for (const [o, v] of hidden) o.visible = v
    if (flood && floodPrev) { flood.intensity = floodPrev.i; flood.position.copy(floodPrev.p) }
    gl.setRenderTarget(prevTarget)
    gl.autoClear = prevAutoClear
    gl.toneMapping = prevTone
    opts.after?.()
  }
  return frames
}
