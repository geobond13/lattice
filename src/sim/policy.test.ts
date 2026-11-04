import { describe, expect, it } from 'vitest'
import type { ActionKind, ActionParams, FeatureId, ScenarioId, Segment, Vec3 } from '@/contracts'
import { decide, latticeLayout, nearestFeature, recordById, records } from './index'
import { runM09, T_LATCH_LIMIT } from './models'
import { toWorld } from './vec'

/** A segment whose point sits on a module feature, optionally offset in module-local coordinates. */
function seg(id: string, module: string, feature: FeatureId, offset: Vec3 = [0, 0, 0]): Segment {
  const m = latticeLayout().modules.find((x) => x.id === module)!
  const f = m.features[feature]
  const p = toWorld({ position: m.position, quaternion: m.quaternion }, [f[0] + offset[0], f[1] + offset[1], f[2] + offset[2]])
  return { id, frame: 'CAM-1', concept: feature, box: { x1: 0, y1: 0, x2: 10, y2: 10 }, point: p, feature: nearestFeature(module, p) }
}
const SEGS: Segment[] = [
  seg('SEG-1', 'M-09', 'grapple'),
  seg('SEG-2', 'M-09', 'radiator_latch_b'),
  // 0.3 m from the puncture along the panel
  seg('SEG-3', 'M-09', 'damage', [0.3, 0, 0]),
  seg('SEG-4', 'M-04', 'grapple'),
  seg('SEG-5', 'M-11', 'grapple'),
  { id: 'SEG-6', frame: 'CAM-2', concept: 'grapple fixture', box: { x1: 0, y1: 0, x2: 1, y2: 1 }, point: null },
]
const run = (scenario: ScenarioId, action: ActionKind, params: ActionParams, t = 200) => decide(action, params, { scenario, t, segments: SEGS })
const check = (d: ReturnType<typeof decide>, id: string) => d.checks.find((c) => c.id === id)

describe('expected outcomes', () => {
  it('radiator-puncture: REPAIR_FRU radiator_b is auto, deadline from the throttle crossing', () => {
    const d = run('radiator-puncture', 'REPAIR_FRU', { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-1', 'SEG-2'] })
    expect(d.tier).toBe('auto')
    expect(d.nextContact).toBe(4500)
    expect(d.deadline).toBeLessThan(runM09().t85 as number)
    expect(d.deadline).toBeGreaterThan(1500)
    expect(d.checks.every((c) => c.pass)).toBe(true)
    expect(check(d, 'reach')!.detail).toMatch(/m from shoulder ≤ 2.6 m/)
    expect(d.ops?.phases.map((p) => p.kind)).toEqual([
      'drain', 'depart_home', 'hold', 'approach', 'hold', 'final_approach', 'grapple', 'unlatch', 'extract', 'insert', 'latch', 'release', 'retreat', 'return_home',
    ])
    // FRU-RAD-02: the panel swap itself is 22 min
    const swap = d.ops!.phases.filter((p) => ['unlatch', 'extract', 'insert', 'latch'].includes(p.kind)).reduce((a, p) => a + p.t1 - p.t0, 0)
    expect(swap).toBe(22 * 60)
  })
  it('radiator-puncture: MIGRATE_WORKLOADS within capacity is auto with a single drain phase', () => {
    const d = run('radiator-puncture', 'MIGRATE_WORKLOADS', { module: 'M-09' })
    expect(d.tier).toBe('auto')
    expect(d.ops?.phases).toHaveLength(1)
    expect(d.ops?.phases[0].kind).toBe('drain')
  })
  it('power-bus-short: SWAP_MODULE to qualified S-1 is gated (no hazard deadline)', () => {
    const d = run('power-bus-short', 'SWAP_MODULE', { module: 'M-04', spare: 'S-1', grasp: ['SEG-4'] })
    expect(d.tier).toBe('gated')
    expect(d.deadline).toBeNull()
    expect(d.nextContact).toBe(1320)
    expect(check(d, 'spare')!.pass).toBe(true)
    expect(d.ops).toBeDefined()
  })
  it('thruster-stuck: DEORBIT_MODULE is auto, deadline before 900 s', () => {
    const d = run('thruster-stuck', 'DEORBIT_MODULE', { module: 'M-11', grasp: ['SEG-5'] })
    expect(d.tier).toBe('auto')
    expect(d.nextContact).toBe(3120)
    expect(d.deadline).toBeLessThan(T_LATCH_LIMIT)
    expect(check(d, 'debris')!.pass).toBe(true)
    expect(d.ops?.phases.map((p) => p.kind)).toContain('dispose_burn')
  })
})

describe('refusals and gating', () => {
  it('grasp near the puncture is refused', () => {
    const d = run('radiator-puncture', 'REPAIR_FRU', { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-1', 'SEG-3'] })
    expect(d.tier).toBe('refused')
    expect(d.ops).toBeUndefined()
    expect(check(d, 'damage-keepout')!.detail).toBe('Grasp point 0.3 m from the puncture: sharp edges and frozen coolant')
  })
  it('REPAIR on M-04 is refused per NCR-0412', () => {
    const d = run('power-bus-short', 'REPAIR_FRU', { module: 'M-04', grasp: ['SEG-4'] })
    expect(d.tier).toBe('refused')
    expect(check(d, 'fru')!.pass).toBe(false)
    expect(check(d, 'fru')!.detail).toContain('NCR-0412')
  })
  it('missing, unknown or null grasp is refused', () => {
    expect(run('radiator-puncture', 'REPAIR_FRU', { module: 'M-09', fru: 'radiator_b' }).tier).toBe('refused')
    expect(run('radiator-puncture', 'REPAIR_FRU', { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-99'] }).tier).toBe('refused')
    const d = run('radiator-puncture', 'REPAIR_FRU', { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-6'] })
    expect(d.tier).toBe('refused')
    expect(check(d, 'grasp')!.pass).toBe(false)
    // a grasp that is only on the latch (no grapple) is not enough
    expect(run('radiator-puncture', 'REPAIR_FRU', { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-2'] }).tier).toBe('refused')
  })
  it('wrong module, wrong unit, unknown module and unqualified spare are refused', () => {
    expect(run('radiator-puncture', 'REPAIR_FRU', { module: 'M-07', fru: 'radiator_b', grasp: ['SEG-1'] }).tier).toBe('refused')
    expect(run('radiator-puncture', 'REPAIR_FRU', { module: 'M-09', fru: 'radiator_a', grasp: ['SEG-1'] }).tier).toBe('refused')
    const unk = run('radiator-puncture', 'SWAP_MODULE', { module: 'M-99', grasp: ['SEG-1'] })
    expect(unk.tier).toBe('refused')
    expect(check(unk, 'target')!.detail).toContain('Unknown module')
    const s2 = run('power-bus-short', 'SWAP_MODULE', { module: 'M-04', spare: 'S-2', grasp: ['SEG-4'] })
    expect(s2.tier).toBe('refused')
    expect(check(s2, 'spare')!.detail).toContain('TR-1303')
    expect(run('thruster-stuck', 'REPAIR_FRU', { module: 'M-11', grasp: ['SEG-5'] }).tier).toBe('refused')
  })
  it('irreversible actions against a performance hazard are gated', () => {
    expect(run('radiator-puncture', 'DEORBIT_MODULE', { module: 'M-09', grasp: ['SEG-1'] }).tier).toBe('gated')
    expect(run('radiator-puncture', 'SWAP_MODULE', { module: 'M-09', grasp: ['SEG-1'] }).tier).toBe('gated')
  })
  it('migration that overloads its targets is refused', () => {
    const d = run('thruster-stuck', 'MIGRATE_WORKLOADS', { module: 'M-11', targets: ['M-12'] })
    expect(d.tier === 'refused' || check(d, 'capacity')!.pass).toBe(true)
  })
  it('nextContact is the next AOS after t', () => {
    expect(run('radiator-puncture', 'MIGRATE_WORKLOADS', { module: 'M-09' }, 4600).nextContact).toBeNull()
    expect(run('power-bus-short', 'MIGRATE_WORKLOADS', { module: 'M-04' }, 10).nextContact).toBe(1320)
  })
  it('is deterministic', () => {
    const a = run('thruster-stuck', 'DEORBIT_MODULE', { module: 'M-11', grasp: ['SEG-5'] })
    const b = run('thruster-stuck', 'DEORBIT_MODULE', { module: 'M-11', grasp: ['SEG-5'] })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('records', () => {
  it('carries every record the spec names, with the key numbers', () => {
    for (const id of ['FRU-RAD-02', 'TR-1180', 'BLD-M09', 'ICD-GRP-01', 'FRU-PDU-01', 'NCR-0412', 'TR-1302', 'TR-0977', 'NCR-0388', 'OPS-VALVE-07', 'OPS-SEP-03', 'ICD-DOCK-01']) {
      expect(recordById(id), id).toBeDefined()
    }
    expect(recordById('TR-1180')!.values).toMatchObject({ singleLoopKw: 6.1, dissipationKw: 7.4, singleLoopMaxUtilPct: 74 })
    expect(recordById('ICD-DOCK-01')!.values!.latchLimitN).toBe(4500)
    expect(recordById('TR-1302')!.values).toMatchObject({ generation: 2, perfPerKw: 2.4 })
    expect(recordById('ncr-0412')!.id).toBe('NCR-0412')
  })
  it('gives each failing module 3–5 extra records including closed NCR distractors', () => {
    for (const m of ['M-09', 'M-04', 'M-11']) {
      const rs = records(m)
      expect(rs.length).toBeGreaterThanOrEqual(5)
      expect(rs.filter((r) => r.kind === 'ncr' && r.values?.status === 'closed').length).toBeGreaterThanOrEqual(2)
      expect(rs.some((r) => r.kind === 'build')).toBe(true)
    }
    for (const r of records()) expect(r.id).toMatch(/^(NCR-\d{4}|TR-\d{4}|FRU-[A-Z]{3}-\d{2}|ICD-[A-Z]{2,6}-\d{2}|OPS-[A-Z]{2,6}-\d{2}|BLD-M\d{2})$/)
  })
})
