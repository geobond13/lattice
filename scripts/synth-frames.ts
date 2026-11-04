// Synthetic servicer camera frames for headless eval before the scene's real captures exist.
// Flat-shaded module, radiator panels, latches, grapple fixture and damage, projected with the sim's own pinhole model,
// so SAM boxes unproject onto the right features. Writes <out>/<scenario>.json (CameraFrame[] with PNG data URLs)
// and the PNGs for a look.
// Usage: npx tsx scripts/synth-frames.ts <outDir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import path from 'node:path'
import type { CameraFrame, ScenarioId, Vec3 } from '../src/contracts'
import { latticeLayout, SCENARIO_IDS, SCENARIOS } from '../src/sim'
import { projectPoint } from '../src/sim/geometry'
import { HALF, latchPoints, PANEL } from '../src/sim/layout'
import { add, cross, dot, norm, scale, sub, toWorld, type Pose } from '../src/sim/vec'

const W = 960
const H = 540

function png(rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1) }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Even-odd scanline fill of a pixel polygon. */
function fill(img: Uint8Array, pts: { x: number; y: number }[], c: [number, number, number]) {
  const ys = pts.map((p) => p.y)
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) {
    const xs: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      if ((a.y <= y + 0.5 && b.y > y + 0.5) || (b.y <= y + 0.5 && a.y > y + 0.5)) xs.push(a.x + ((y + 0.5 - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) img.set(c, (y * W + x) * 3)
    }
  }
}

type Poly = { pts: Vec3[]; color: [number, number, number]; normal: Vec3; bias?: number }

/** The six faces of a local box as polygons in lattice frame. */
function box(pose: Pose, c: Vec3, h: Vec3, color: [number, number, number]): Poly[] {
  const out: Poly[] = []
  for (let axis = 0; axis < 3; axis++) for (const s of [-1, 1]) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3
    const corner = (a: number, b: number): Vec3 => { const p: Vec3 = [...c]; p[axis] += s * h[axis]; p[u] += a * h[u]; p[v] += b * h[v]; return toWorld(pose, p) }
    const n: Vec3 = [0, 0, 0]; n[axis] = s
    out.push({ pts: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], color, normal: sub(toWorld(pose, n), toWorld(pose, [0, 0, 0])) })
  }
  return out
}

/** A disc of radius r on a local face point with local normal n. */
function disc(pose: Pose, at: Vec3, n: Vec3, r: number, color: [number, number, number], bias: number): Poly {
  const a = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]))
  const b = cross(n, a)
  const pts = Array.from({ length: 28 }, (_, i) => {
    const t = (i / 28) * 2 * Math.PI
    return toWorld(pose, add(add(at, scale(n, 0.012 * bias)), add(scale(a, r * Math.cos(t)), scale(b, r * Math.sin(t)))))
  })
  return { pts, color, normal: sub(toWorld(pose, n), toWorld(pose, [0, 0, 0])), bias }
}

function render(scenario: ScenarioId, frame: Omit<CameraFrame, 'src'>): Buffer {
  const layout = latticeLayout()
  const img = new Uint8Array(W * H * 3)
  for (let i = 0; i < 400; i++) { const x = (i * 7919) % W, y = (i * 104729) % H; img.set([150, 160, 180], (y * W + x) * 3) } // stars
  const polys: Poly[] = []
  const sun = norm([0.6, 0.7, 0.4])
  for (const m of layout.modules.filter((x) => x.slot !== null)) {
    const pose: Pose = { position: m.position, quaternion: m.quaternion }
    const focus = m.id === frame.module
    polys.push(...box(pose, [0, 0, 0], HALF, [176, 182, 192]))
    for (const z of [PANEL.z, -PANEL.z]) polys.push(...box(pose, [0, 0, z], scale(PANEL.size, 0.5), [222, 226, 232]))
    if (!focus) continue
    polys.push(disc(pose, [HALF[0], 0, 0], [1, 0, 0], 0.32, [40, 44, 52], 1)) // grapple fixture plate
    polys.push(disc(pose, [HALF[0], 0, 0], [1, 0, 0], 0.08, [235, 235, 240], 2)) // grapple pin
    for (const side of ['a', 'b'] as const) for (const p of latchPoints(side)) polys.push(disc(pose, p, [0, 0, side === 'a' ? 1 : -1], 0.07, [242, 196, 64], 1))
    polys.push(...box(pose, [HALF[0] - 0.15, HALF[1] - 0.12, 0.8], [0.18, 0.14, 0.2], [120, 110, 100])) // thruster pod
    polys.push(...box(pose, [0, -HALF[1] - 0.02, 0], [0.7, 0.02, 0.5], [70, 90, 120])) // PDU panel
    const dmg = m.features.damage
    if (dmg) {
      const n: Vec3 = scenario === 'radiator-puncture' ? [0, 0, -1] : scenario === 'power-bus-short' ? [0, -1, 0] : [1, 0, 0]
      polys.push(disc(pose, dmg, n, 0.2, [110, 64, 30], 3))
      polys.push(disc(pose, dmg, n, 0.11, [12, 10, 8], 4))
    }
  }
  const cam = frame.camera.position
  const fwd = norm(sub(frame.camera.target, cam))
  const visible = polys
    .filter((p) => dot(p.normal, sub(p.pts[0], cam)) < 0) // back-face cull
    .map((p) => ({ p, depth: p.pts.reduce((a, q) => a + dot(sub(q, cam), fwd), 0) / p.pts.length - (p.bias ?? 0) * 0.05 }))
    .sort((a, b) => b.depth - a.depth)
  for (const { p } of visible) {
    const px = p.pts.map((q) => projectPoint(frame, q))
    if (px.some((q) => q === null)) continue
    const shade = 0.45 + 0.55 * Math.max(0, dot(norm(p.normal), sun))
    fill(img, px as { x: number; y: number }[], p.color.map((c) => Math.min(255, Math.round(c * shade))) as [number, number, number])
  }
  return png(img)
}

function stations(scenario: ScenarioId): Omit<CameraFrame, 'src'>[] {
  const layout = latticeLayout()
  const id = SCENARIOS[scenario].module
  const m = layout.modules.find((x) => x.id === id)!
  const pose: Pose = { position: m.position, quaternion: m.quaternion }
  const w = (p: Vec3) => toWorld(pose, p)
  const dmg = m.features.damage ?? m.features.grapple
  const dmgOut: Vec3 = scenario === 'radiator-puncture' ? [2.2, 0.8, -3.2] : scenario === 'power-bus-short' ? [2.4, -3.2, 0.8] : [3.4, 2.4, 1.4]
  const cam = (pos: Vec3, target: Vec3) => ({ position: w(pos), target: w(target), up: [0, 1, 0] as Vec3, fovDeg: 50 })
  return [
    { id: 'CAM-1', label: `Fly-around, 12 m, +R of ${id}`, width: W, height: H, module: id, camera: cam([11, 3.5, 4], [0, 0, 0]) },
    { id: 'CAM-2', label: `Damage close-up, ${id}`, width: W, height: H, module: id, camera: cam(add(dmg, dmgOut), dmg) },
    { id: 'CAM-3', label: `Grapple fixture close-up, ${id}`, width: W, height: H, module: id, camera: cam([5.2, 1.3, 1.6], [HALF[0], 0, 0]) },
  ]
}

const out = process.argv[2]
if (!out) { console.error('usage: synth-frames.ts <outDir>'); process.exit(1) }
mkdirSync(out, { recursive: true })
for (const s of SCENARIO_IDS) {
  const frames: CameraFrame[] = stations(s).map((f) => {
    const bytes = render(s, f)
    writeFileSync(path.join(out, `${s}-${f.id}.png`), bytes)
    return { ...f, src: `data:image/png;base64,${bytes.toString('base64')}` }
  })
  writeFileSync(path.join(out, `${s}.json`), JSON.stringify(frames))
  console.log(s, frames.map((f) => f.id).join(', '))
}
