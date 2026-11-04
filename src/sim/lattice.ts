// Per-module status and compute load over time. Load is in "Gen-1 %" (100 = one Gen-1 module flat out);
// a Gen-2 spare has 2.4× the compute per kW, so the same workload reads 2.4× lower util on it.
//
// Representation of a SWAP in lattice(): the spare keeps its own key (e.g. 'S-1'): 'spare' at the depot,
// 'docking' from the moment the servicer grapples it until the dock latches close, then 'nominal' and
// serving the slot's workload (ramping in over 5 min). The original module keeps its key: 'drained' →
// 'undocked' (from undock until berthed at the depot) → 'departed' (off the ring, parked at berth B3).
// After a DEORBIT the module is 'undocked' through the disposal burn, then 'departed'.
import type { ActionKind, ActionParams, Decision, ModuleId, ModuleStatus, OpsTimeline, ScenarioId } from '@/contracts'
import { baseDemand, BUS, runM09, T_LATCH_LIMIT, type M09Profile } from './models'
import { canonicalPlan, drainFrom, drainTarget, phaseSpan, toTimeline } from './ops'
import { FAULTS, SCENARIOS } from './scenarios'
import { smooth } from './vec'

/** Perf per kW by generation (Gen-1 = 1.0), DESIGN.md "Why modular". */
export const GEN_PERF = { 1: 1.0, 2: 2.4, 3: 5.2, 4: 10 } as const
export const SPARE_GEN: Record<string, 1 | 2 | 3 | 4> = { 'S-1': 2, 'S-2': 2 }
export const RING_IDS: ModuleId[] = Array.from({ length: 12 }, (_, k) => `M-${String(k + 1).padStart(2, '0')}`)
export const SPARE_IDS: ModuleId[] = ['S-1', 'S-2']
export const UTIL_LIMIT = 95

export interface Exec { action: ActionKind; params: ActionParams; ops: OpsTimeline; startT: number }

interface Ent {
  id: ModuleId
  /** Ring slot it occupies (a docked spare inherits the slot). */
  slot: number | null
  status: ModuleStatus
  /** Full capacity, Gen-1 % units. */
  cap: number
  /** Max load it may carry right now (fault caps, drains). */
  limit: number
  demand: number
  present: boolean
  load: number
}

export interface LatticeModel {
  ents: Record<ModuleId, Ent>
  /** Σ load / Σ online capacity, %. */
  latUtil: number
  /** Load that found no receiver (queued), Gen-1 %. */
  unserved: number
  maxReceiver: { id: ModuleId; util: number } | null
}

/** Thermal profile of M-09 implied by the executed actions (drain to 70 %, panel restored at latch end). */
export function m09Profile(execs: Exec[]): M09Profile {
  const p: M09Profile = {}
  for (const e of [...execs].sort((a, b) => a.startT - b.startT)) {
    if (e.params.module !== 'M-09') continue
    const d = phaseSpan(e.ops, 'drain')
    if (d && !p.drain) p.drain = { start: e.startT + d[0], end: e.startT + d[1], to: drainTarget(e.action, 'M-09') }
    const l = phaseSpan(e.ops, 'latch')
    if (e.action === 'REPAIR_FRU' && l && p.restoreT === undefined) p.restoreT = e.startT + l[1]
  }
  return p
}

const ringDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 12
  return Math.min(d, 12 - d)
}

export function latticeModel(scenario: ScenarioId, t: number, execs: Exec[]): LatticeModel {
  const ents: Record<ModuleId, Ent> = {}
  RING_IDS.forEach((id, k) => {
    ents[id] = { id, slot: k, status: 'nominal', cap: 100, limit: 100, demand: baseDemand(k, t), present: true, load: 0 }
  })
  for (const id of SPARE_IDS) ents[id] = { id, slot: null, status: 'spare', cap: 100 * GEN_PERF[SPARE_GEN[id]], limit: 0, demand: 0, present: false, load: 0 }

  const sorted = [...execs].sort((a, b) => a.startT - b.startT)
  const fault = FAULTS[scenario]
  const m = ents[fault.module]
  // ── fault (unmitigated unless an executed action intervenes) ──
  if (t >= SCENARIOS[scenario].faultT) m.status = 'degraded'
  if (scenario === 'radiator-puncture') {
    const run = runM09(m09Profile(sorted))
    const prof = m09Profile(sorted)
    if (run.t95 !== null && t >= run.t95 && !(prof.restoreT !== undefined && t >= prof.restoreT)) { m.status = 'failed'; m.limit = 0 }
  } else if (scenario === 'power-bus-short') {
    if (t >= BUS.tFault) m.limit = BUS.capPct
  } else {
    const separated = sorted.some((e) => {
      const u = e.params.module === 'M-11' ? phaseSpan(e.ops, 'undock') : null
      return u !== null && e.startT + u[1] <= T_LATCH_LIMIT
    })
    if (!separated && t >= T_LATCH_LIMIT) {
      m.status = 'departed'; m.limit = 0; m.present = false
      for (const id of ['M-10', 'M-12']) { ents[id].status = 'failed'; ents[id].limit = 0 }
    }
  }
  // ── executed actions ──
  for (const e of sorted) {
    const tau = t - e.startT
    const id = e.params.module
    const x = ents[id]
    if (tau < 0 || !x || e.action === 'INSPECT') continue
    const span = (k: Parameters<typeof phaseSpan>[1], n = 0) => phaseSpan(e.ops, k, n)
    const d = span('drain')
    if (d && x.present && x.status !== 'failed') {
      const from = Math.min(x.limit, x.demand)
      const to = Math.min(from, drainTarget(e.action, id))
      if (tau < d[1]) { x.limit = from + (to - from) * smooth((tau - d[0]) / Math.max(1, d[1] - d[0])); x.status = 'draining' }
      else { x.limit = to; if (e.action !== 'MIGRATE_WORKLOADS' || to === 0) x.status = 'drained' }
    }
    if (e.action === 'REPAIR_FRU') {
      const l = span('latch')
      if (l && tau >= l[1]) { x.status = 'nominal'; x.limit = 100 }
    } else if (e.action === 'SWAP_MODULE' || e.action === 'DEORBIT_MODULE') {
      const u = span('undock')
      const gone = e.action === 'SWAP_MODULE' ? span('tow') : span('dispose_burn')
      if (u && tau >= u[0]) { x.present = false; x.limit = 0; x.status = gone && tau >= gone[1] ? 'departed' : 'undocked' }
      if (e.action === 'SWAP_MODULE') {
        const sp = ents[e.params.spare ?? 'S-1']
        const g = span('grapple', 1)
        const l = span('latch')
        if (sp && g && l) {
          if (tau >= g[0] && tau < l[1]) sp.status = 'docking'
          if (tau >= l[1]) {
            sp.status = 'nominal'; sp.present = true; sp.slot = x.slot
            sp.demand = x.demand; x.demand = 0
            sp.limit = sp.cap * smooth((tau - l[1]) / 300)
          }
        }
      }
    }
  }
  // ── load flow: each module serves what it can; the rest goes to nominal neighbours by proximity × headroom ──
  const all = Object.values(ents)
  for (const x of all) x.load = x.present ? Math.min(x.demand, x.limit) : 0
  let unserved = 0
  const migrateTargets = new Map<ModuleId, ModuleId[]>()
  for (const e of sorted) if (e.action === 'MIGRATE_WORKLOADS' && e.params.targets?.length && t >= e.startT) migrateTargets.set(e.params.module, e.params.targets)
  for (const x of all) {
    let shed = x.demand - x.load
    if (shed <= 1e-9 || x.slot === null) continue
    const only = migrateTargets.get(x.id)
    for (let pass = 0; pass < 4 && shed > 1e-9; pass++) {
      const recv = all.filter((r) => r !== x && r.present && r.status === 'nominal' && r.slot !== null && (!only || only.includes(r.id) || pass >= 2))
      const head = (r: Ent) => Math.max(0, (UTIL_LIMIT / 100) * r.cap - r.load)
      const w = recv.map((r) => head(r) / Math.max(1, ringDist(r.slot as number, x.slot as number)))
      const W = w.reduce((a, b) => a + b, 0)
      if (W <= 1e-9) break
      let moved = 0
      recv.forEach((r, i) => {
        const give = Math.min(head(r), (shed * w[i]) / W)
        r.load += give
        moved += give
      })
      shed -= moved
    }
    unserved += Math.max(0, shed)
  }
  let num = 0
  let den = 0
  let maxReceiver: LatticeModel['maxReceiver'] = null
  for (const x of all) {
    if (!x.present) continue
    num += x.load
    den += Math.min(x.cap, x.limit)
    const util = (100 * x.load) / x.cap
    if (x.status === 'nominal' && (!maxReceiver || util > maxReceiver.util)) maxReceiver = { id: x.id, util }
  }
  return { ents, latUtil: den > 0 ? (100 * num) / den : 0, unserved, maxReceiver }
}

export const execOf = (d: Pick<Decision, 'action' | 'params' | 'ops'>, startT: number): Exec | null =>
  d.ops ? { action: d.action, params: d.params, ops: d.ops, startT } : null

export function lattice(scenario: ScenarioId, t: number, executed: { decision: Decision; startT: number }[]): Record<ModuleId, { status: ModuleStatus; util: number }> {
  const execs = executed.map((e) => execOf(e.decision, e.startT)).filter((e): e is Exec => e !== null && e.ops.duration >= 0)
  const { ents } = latticeModel(scenario, t, execs)
  const out: Record<ModuleId, { status: ModuleStatus; util: number }> = {}
  for (const x of Object.values(ents)) out[x.id] = { status: x.status, util: Math.round((1000 * x.load) / x.cap) / 10 }
  return out
}

/** The canonical resolving action, started so that it ends at `resolvedAt` (telemetry's view of the fix). */
export function resolutionExec(scenario: ScenarioId, resolvedAt: number | undefined): Exec[] {
  if (resolvedAt === undefined || !Number.isFinite(resolvedAt)) return []
  const p = canonicalPlan(scenario)
  const ops = toTimeline(p)
  return [{ action: p.action, params: { module: p.module, ...(p.spare ? { spare: p.spare } : {}), ...(p.fru ? { fru: p.fru } : {}) }, ops, startT: resolvedAt - p.duration }]
}

export { drainFrom }
