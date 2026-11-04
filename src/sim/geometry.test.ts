import { describe, expect, it } from 'vitest'
import type { CameraFrame, FeatureId, Vec3 } from '@/contracts'
import { fleetAt, fleetTimeline, latticeLayout, nearestFeature, unproject } from './index'
import { projectPoint } from './geometry'
import { add, dist, len, qRotate, scale, toWorld } from './vec'

const layout = latticeLayout()
const mod = (id: string) => layout.modules.find((m) => m.id === id)!
const world = (id: string, f: FeatureId): Vec3 => {
  const m = mod(id)
  return toWorld({ position: m.position, quaternion: m.quaternion }, m.features[f])
}

describe('layout', () => {
  it('places 12 modules on the ring with local +X radially outward, spares at the depot', () => {
    expect(layout.modules).toHaveLength(14)
    for (let k = 0; k < 12; k++) {
      const m = mod(`M-${String(k + 1).padStart(2, '0')}`)
      expect(m.slot).toBe(k)
      const th = (k * Math.PI) / 6
      expect(dist(m.position, [14 * Math.cos(th), 0, 14 * Math.sin(th)])).toBeLessThan(1e-9)
      const x = qRotate(m.quaternion, [1, 0, 0])
      expect(dist(x, [Math.cos(th), 0, Math.sin(th)])).toBeLessThan(1e-9)
      expect(dist(qRotate(m.quaternion, [0, 1, 0]), [0, 1, 0])).toBeLessThan(1e-9)
      expect(m.size).toEqual([3.2, 2.0, 2.4])
    }
    for (const s of ['S-1', 'S-2']) {
      expect(mod(s).slot).toBeNull()
      expect(dist(mod(s).position, layout.depot)).toBeLessThan(8)
      expect(len(mod(s).position)).toBeGreaterThan(layout.keepOutRadius)
    }
    expect(len(layout.servicerHome)).toBeGreaterThan(layout.keepOutRadius)
  })
  it('puts damage on the failing modules only, per scenario', () => {
    expect(dist(mod('M-09').features.damage, mod('M-09').features.radiator_latch_b)).toBeCloseTo(0.6, 2)
    expect(mod('M-04').features.damage).toBeDefined()
    expect(mod('M-11').features.damage).toBeDefined()
    expect(mod('M-01').features.damage).toBeUndefined()
  })
})

describe('unproject', () => {
  const cam = (target: Vec3, from: Vec3): CameraFrame => ({
    id: 'CAM-1', label: 'test', src: '', width: 1024, height: 768, module: 'M-09',
    camera: { position: from, target, up: [0, 1, 0], fovDeg: 50 },
  })
  it('round-trips a projected feature to within 5 cm', () => {
    const r = qRotate(mod('M-09').quaternion, [1, 0, 0])
    const zSide = qRotate(mod('M-09').quaternion, [0, 0, -1])
    // camera ~10 m out, above and to the radiator-B side, aimed off-centre
    const from = add(add(mod('M-09').position, scale(r, 9)), add(scale(zSide, 4), [0, 2.5, 0]))
    const frame = cam(add(mod('M-09').position, [0.3, -0.2, 0.1]), from)
    for (const f of ['grapple', 'radiator_latch_b', 'damage', 'thruster_pod'] as FeatureId[]) {
      const p = world('M-09', f)
      const px = projectPoint(frame, p)!
      expect(px.x).toBeGreaterThan(0)
      expect(px.x).toBeLessThan(1024)
      const back = unproject(frame, px)
      expect(back, f).not.toBeNull()
      expect(dist(back!, p), f).toBeLessThan(0.05)
      expect(nearestFeature('M-09', back!)!.id).toBe(f)
    }
  })
  it('returns null when the ray misses the module', () => {
    const frame = cam(add(mod('M-09').position, [0, 30, 0]), add(mod('M-09').position, [10, 0, 0]))
    expect(unproject(frame, { x: 512, y: 384 })).toBeNull()
  })
  it('nearestFeature measures in lattice coordinates', () => {
    const p = add(world('M-04', 'grapple'), [0, 0.2, 0])
    expect(nearestFeature('M-04', p)).toEqual({ id: 'grapple', distance: expect.closeTo(0.2, 6) })
    expect(nearestFeature('M-99', p)).toBeUndefined()
  })
})

describe('fleet timeline', () => {
  it('steps LATTICE capacity up monotonically while the monolith decays and strands', () => {
    const f = fleetTimeline()
    expect(f.map((y) => y.year)).toEqual(Array.from({ length: 11 }, (_, i) => 2027 + i))
    expect(f[0].capacity).toBe(100)
    expect(f[0].modules.every((m) => m.generation === 1)).toBe(true)
    for (let i = 1; i < f.length; i++) {
      expect(f[i].capacity).toBeGreaterThanOrEqual(f[i - 1].capacity)
      expect(f[i].monolithCapacity).toBeLessThanOrEqual(f[i - 1].monolithCapacity)
    }
    expect(f.at(-1)!.capacity).toBeGreaterThan(500)
    expect(fleetAt(2032)!.monolithCapacity).toBeCloseTo(100 * 0.94 ** 5, 0)
    expect(fleetAt(2033)!.monolithCapacity).toBe(0)
    for (const y of f) {
      if (y.year >= 2029) { expect(y.swaps).toBeGreaterThanOrEqual(2); expect(y.swaps).toBeLessThanOrEqual(4) }
      for (const m of y.modules) {
        expect(y.year - m.installedYear).toBeLessThanOrEqual(5)
        expect(m.generation === 1 || m.installedYear >= { 2: 2029, 3: 2032, 4: 2035 }[m.generation]!).toBe(true)
      }
    }
    expect(fleetTimeline()).toEqual(fleetTimeline())
  })
})
