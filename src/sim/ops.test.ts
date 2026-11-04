import { describe, expect, it } from 'vitest'
import type { ActionKind, OpsTimeline, ScenePose } from '@/contracts'
import { lattice, poseAt, SCENARIOS } from './index'
import { buildPlan, corridorCheck, toTimeline } from './ops'
import { KEEP_OUT_RADIUS, SERVICER_HOME } from './layout'
import { dist, len } from './vec'

const PLANS: [ActionKind, string, Record<string, string>][] = [
  ['REPAIR_FRU', 'M-09', { fru: 'radiator_b' }],
  ['SWAP_MODULE', 'M-04', { spare: 'S-1' }],
  ['DEORBIT_MODULE', 'M-11', {}],
  ['INSPECT', 'M-09', {}],
  ['MIGRATE_WORKLOADS', 'M-09', {}],
]
const tl = (a: ActionKind, m: string, o: Record<string, string>) => toTimeline(buildPlan(a, m, o))
const qAngle = (a: number[], b: number[]) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])))

describe('ops timelines', () => {
  it('are contiguous, tens of minutes long, and obey corridor-v', () => {
    for (const [a, m, o] of PLANS) {
      const ops = tl(a, m, o)
      ops.phases.forEach((p, i) => {
        expect(p.t1).toBeGreaterThan(p.t0)
        if (i) expect(p.t0).toBe(ops.phases[i - 1].t1)
      })
      expect(ops.duration).toBe(ops.phases.at(-1)!.t1)
      if (a === 'REPAIR_FRU' || a === 'SWAP_MODULE' || a === 'DEORBIT_MODULE') {
        expect(ops.duration).toBeGreaterThan(20 * 60)
        expect(ops.duration).toBeLessThan(90 * 60)
      }
      expect(corridorCheck(ops).ok, `${a} corridor`).toBe(true)
    }
  })

  it('poseAt is continuous: no teleports of servicer, modules, FRU or arms', () => {
    for (const [a, m, o] of PLANS) {
      const ops = tl(a, m, o)
      const dt = 0.25
      let prev: ScenePose = poseAt(ops, -1)
      let maxStep = 0
      for (let tau = 0; tau <= ops.duration + 2; tau += dt) {
        const p = poseAt(ops, tau)
        const step = dist(p.servicer.position, prev.servicer.position)
        maxStep = Math.max(maxStep, step)
        expect(step, `${a} servicer @${tau}`).toBeLessThan(1.5) // < 6 m/s
        expect(qAngle(p.servicer.quaternion, prev.servicer.quaternion), `${a} attitude @${tau}`).toBeLessThan(0.1)
        for (const [id, b] of Object.entries(p.modules)) {
          const q = prev.modules[id]
          if (q) expect(dist(b.position, q.position), `${a} ${id} @${tau}`).toBeLessThan(1.5)
        }
        if (p.fru && prev.fru) expect(dist(p.fru.position, prev.fru.position)).toBeLessThan(0.5)
        p.servicer.arms.forEach((arm, i) => {
          const pa = prev.servicer.arms[i]
          // null ↔ point is a stow/deploy (the scene's IK animates it); point → point must be continuous
          if (arm.target && pa.target) {
            expect(dist(arm.target, pa.target), `${a} arm${i} @${tau}`).toBeLessThan(1.5)
            expect(Math.abs(arm.grip - pa.grip), `${a} grip${i} @${tau}`).toBeLessThanOrEqual(0.2)
          }
        })
        prev = p
      }
      expect(maxStep).toBeGreaterThanOrEqual(0)
    }
  })

  it('servicer stays outside the keep-out sphere except on a corridor', () => {
    for (const [a, m, o] of PLANS) {
      const ops = tl(a, m, o)
      for (let tau = 0; tau <= ops.duration; tau += 2) {
        const p = poseAt(ops, tau)
        if (len(p.servicer.position) < KEEP_OUT_RADIUS) {
          expect(['approach', 'final_approach', 'grapple', 'unlatch', 'extract', 'insert', 'latch', 'release', 'retreat', 'undock', 'tow', 'dock', 'spare_approach', 'hold']).toContain(p.phase)
        }
      }
    }
  })

  it('REPAIR carries the damaged panel out and the new one in', () => {
    const ops = tl('REPAIR_FRU', 'M-09', { fru: 'radiator_b' })
    const ph = (k: string) => ops.phases.find((p) => p.kind === k)!
    const ex = poseAt(ops, (ph('extract').t0 + ph('extract').t1) / 2)
    expect(ex.fru).toMatchObject({ kind: 'radiator_b', damaged: true, visible: true })
    expect(poseAt(ops, (ph('insert').t0 + ph('insert').t1) / 2).fru?.damaged).toBe(false)
    expect(poseAt(ops, ph('unlatch').t0 + 10).servicer.arms[0].grip).toBe(1)
    expect(poseAt(ops, ph('final_approach').t1 - 0.01).range).toBeCloseTo(1.6, 1)
    expect(poseAt(ops, ph('approach').t0 + 1).rangeRate).toBeLessThan(0)
    expect(poseAt(null, 0).servicer.arms.every((x) => x.target === null)).toBe(true)
  })

  it('SWAP leaves the spare in the slot and the module at the depot; DEORBIT hides the module', () => {
    const swap = tl('SWAP_MODULE', 'M-04', { spare: 'S-1' })
    const end = poseAt(swap, swap.duration + 10)
    expect(dist(end.modules['S-1'].position, [0, 0, 14])).toBeLessThan(1e-6)
    expect(len(end.modules['M-04'].position)).toBeGreaterThan(25)
    expect(dist(end.servicer.position, SERVICER_HOME)).toBeLessThan(1e-6)
    expect(end.phase).toBeNull()
    const deo = tl('DEORBIT_MODULE', 'M-11', {})
    const burn = deo.phases.find((p) => p.kind === 'dispose_burn')!
    expect(poseAt(deo, burn.t0 + 30).servicer.thrust).toBe(1)
    expect(poseAt(deo, burn.t1 + 1).modules['M-11'].visible).toBe(false)
    expect(poseAt(deo, burn.t0 - 1).modules['M-11'].visible).toBe(true)
  })

  it('poseAt survives JSON round-trips (spare / FRU recovered from labels) and is deterministic', () => {
    const ops = tl('SWAP_MODULE', 'M-04', { spare: 'S-1' })
    const copy = JSON.parse(JSON.stringify(ops)) as OpsTimeline
    for (const tau of [0, 500, 1500, 2500, 3500]) expect(poseAt(copy, tau)).toEqual(poseAt(ops, tau))
  })
})

describe('lattice()', () => {
  const exec = (a: ActionKind, m: string, o: Record<string, string>, startT: number) => ({
    decision: { action: a, params: { module: m, ...o }, tier: 'auto' as const, reason: '', deadline: null, nextContact: null, checks: [], ops: tl(a, m, o) },
    startT,
  })
  it('healthy modules sit at ~60–75 % util', () => {
    const s = lattice('radiator-puncture', 50, [])
    for (const [id, x] of Object.entries(s)) {
      if (id.startsWith('S-')) expect(x).toEqual({ status: 'spare', util: 0 })
      else if (id !== 'M-09') { expect(x.util).toBeGreaterThanOrEqual(58); expect(x.util).toBeLessThanOrEqual(76) }
    }
    expect(s['M-09'].util).toBe(92)
  })
  it('a swap puts S-1 (Gen-2) in M-04’s slot with higher capacity', () => {
    const e = exec('SWAP_MODULE', 'M-04', { spare: 'S-1' }, 300)
    const ops = e.decision.ops
    const at = (k: string) => 300 + ops.phases.find((p) => p.kind === k)!.t0 + 1
    expect(lattice('power-bus-short', at('drain'), [e])['M-04'].status).toBe('draining')
    expect(lattice('power-bus-short', at('tow'), [e])['M-04'].status).toBe('undocked')
    expect(lattice('power-bus-short', at('dock'), [e])['S-1'].status).toBe('docking')
    const after = lattice('power-bus-short', 300 + ops.duration + 600, [e])
    expect(after['M-04']).toEqual({ status: 'departed', util: 0 })
    expect(after['S-1'].status).toBe('nominal')
    // M-04's ~60 % workload on a 2.4× module
    expect(after['S-1'].util).toBeGreaterThan(20)
    expect(after['S-1'].util).toBeLessThan(30)
  })
  it('migration sheds load to neighbours; DEORBIT departs M-11 and saves M-10/M-12', () => {
    const before = lattice('radiator-puncture', 400, [])
    const mig = exec('MIGRATE_WORKLOADS', 'M-09', {}, 200)
    const after = lattice('radiator-puncture', 400, [mig])
    expect(after['M-09'].util).toBeCloseTo(70, 0)
    expect(after['M-08'].util + after['M-10'].util).toBeGreaterThan(before['M-08'].util + before['M-10'].util)
    // migration also averts the thermal shutdown
    expect(lattice('radiator-puncture', 3500, [mig])['M-09'].status).toBe('degraded')
    expect(lattice('radiator-puncture', 3500, [])['M-09'].status).toBe('failed')
    const deo = exec('DEORBIT_MODULE', 'M-11', {}, 150)
    expect(lattice('thruster-stuck', 3000, [deo])['M-11'].status).toBe('departed')
    expect(lattice('thruster-stuck', 3000, [deo])['M-10'].status).toBe('nominal')
    expect(lattice('thruster-stuck', 1000, [])['M-10'].status).toBe('failed')
    expect(SCENARIOS['thruster-stuck'].expected).toBe('DEORBIT')
  })
})
