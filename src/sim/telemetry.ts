// Telemetry channels, sampling and FDIR events. Values come from the physical models in models.ts and the
// load model in lattice.ts, plus small deterministic sensor noise (the `nominal` field is noise-free).
//
// `resolvedAt` = end of the scenario's resolving ops. The canonical timeline for the expected outcome is
// placed so it ends there, and its own milestones drive the curves: REPAIR drains M-09 to 70 % then
// restores loop B at latch end (channels return to nominal); SWAP disconnects M-04 at undock start
// (its channels end there); DEORBIT unloads the latches at separation (TM-M11-LATCH ends at separation,
// the rest when the module leaves after the disposal burn).
import type { ChannelSpec, FdirEvent, ModuleId, ScenarioId, TelemetryPoint } from '@/contracts'
import { latticeModel, resolutionExec, type Exec, m09Profile } from './lattice'
import {
  at, BUS, bodyRate, busA, COOLANT, latchCrossing, latchLoad, rateCrossing, runM09, THERMAL, THRUSTER, T_LATCH_LIMIT, baseDemand,
} from './models'
import { phaseSpan } from './ops'
import { noise } from './vec'

const ch = (id: string, module: ModuleId, key: ChannelSpec['key'], label: string, unit: string, limits: ChannelSpec['limits']): ChannelSpec =>
  ({ id, module, key, label, unit, limits })

const LAT = ch('TM-LAT-UTL', '*', 'util', 'Lattice compute utilisation', '%', { hi: 95 })
const CHANNELS: Record<ScenarioId, ChannelSpec[]> = {
  'radiator-puncture': [
    ch('TM-M09-GPU', 'M-09', 'gpuC', 'M-09 GPU temperature (throttle 85 °C, shutdown 95 °C)', '°C', { hi: THERMAL.throttleC }),
    ch('TM-M09-CLT', 'M-09', 'coolantKPa', 'M-09 coolant loop B pressure', 'kPa', { lo: COOLANT.loLimit }),
    ch('TM-M09-RAD', 'M-09', 'radiatorC', 'M-09 radiator B panel temperature', '°C', { lo: -40 }),
    ch('TM-M09-UTL', 'M-09', 'util', 'M-09 compute utilisation', '%', { hi: 95 }),
    LAT,
  ],
  'power-bus-short': [
    ch('TM-M04-BUS', 'M-04', 'busV', 'M-04 primary bus A voltage', 'V', { lo: BUS.loLimit }),
    ch('TM-M04-UTL', 'M-04', 'util', 'M-04 compute utilisation', '%', { hi: 95 }),
    LAT,
  ],
  'thruster-stuck': [
    ch('TM-M11-RATE', 'M-11', 'rateDegS', 'M-11 body rate', '°/s', { hi: THRUSTER.rateLimit }),
    ch('TM-M11-LATCH', 'M-11', 'latchLoadN', 'M-11 dock latch load (ICD-DOCK-01 limit)', 'N', { hi: THRUSTER.limit }),
    ch('TM-M11-UTL', 'M-11', 'util', 'M-11 compute utilisation', '%', { hi: 95 }),
    LAT,
  ],
}

export function channels(scenario: ScenarioId): ChannelSpec[] {
  return CHANNELS[scenario].map((c) => ({ ...c, limits: { ...c.limits } }))
}

interface Ctx { scenario: ScenarioId; execs: Exec[] }
/** Value (noise-free), nominal, or undefined when the channel has ended. */
type Reader = (t: number, c: Ctx) => { v: number; nominal: number } | undefined

const span = (c: Ctx, kind: Parameters<typeof phaseSpan>[1]): [number, number] | null => {
  const e = c.execs[0]
  const s = e ? phaseSpan(e.ops, kind) : null
  return e && s ? [e.startT + s[0], e.startT + s[1]] : null
}
const utilOf = (id: ModuleId, t: number, c: Ctx) => {
  const x = latticeModel(c.scenario, t, c.execs).ents[id]
  return (100 * x.load) / x.cap
}
const m09 = (c: Ctx) => runM09(m09Profile(c.execs))
/** Separation of M-11 (if the resolving DEORBIT undocks it before the latch limit). */
const m11Sep = (c: Ctx) => {
  const u = span(c, 'undock')
  return u && u[1] <= T_LATCH_LIMIT ? u : null
}

const READERS: Record<string, Reader> = {
  'TM-M09-GPU': (t, c) => ({ v: at(m09(c).gpu, t), nominal: THERMAL.nominalC }),
  'TM-M09-CLT': (t, c) => ({ v: at(m09(c).clt, t), nominal: COOLANT.p0 }),
  'TM-M09-RAD': (t, c) => ({ v: at(m09(c).rad, t), nominal: 18 }),
  'TM-M09-UTL': (t, c) => ({ v: at(m09(c).util, t), nominal: THERMAL.utilBase }),
  'TM-M04-BUS': (t, c) => {
    const u = span(c, 'undock')
    return u && t > u[0] ? undefined : { v: busA(t), nominal: BUS.v0 }
  },
  'TM-M04-UTL': (t, c) => {
    const u = span(c, 'undock')
    return u && t > u[0] ? undefined : { v: utilOf('M-04', t, c), nominal: baseDemand(3, t) }
  },
  'TM-M11-LATCH': (t, c) => {
    const sep = m11Sep(c)
    if (sep) {
      if (t > sep[1]) return undefined
      const k = t <= sep[0] ? 1 : 1 - (t - sep[0]) / (sep[1] - sep[0])
      return { v: latchLoad(Math.min(t, sep[0])) * k, nominal: THRUSTER.preload }
    }
    // Unmitigated: the latch ring yields above the limit for ~60 s, then shears (load drops to 0).
    const v = t < T_LATCH_LIMIT ? latchLoad(t) : t < T_LATCH_LIMIT + 60 ? THRUSTER.limit + 8 * (t - T_LATCH_LIMIT) : 0
    return { v, nominal: THRUSTER.preload }
  },
  'TM-M11-RATE': (t, c) => {
    const sep = m11Sep(c)
    const gone = span(c, 'dispose_burn')
    if (sep && gone && t > gone[1]) return undefined
    if (sep && t > sep[0]) {
      const r0 = bodyRate(sep[0])
      return { v: 0.04 + (r0 - 0.04) * Math.exp(-(t - sep[0]) / 20), nominal: 0.002 }
    }
    // Unmitigated: the latch ring shears at the limit and M-11 tumbles free on the stuck thruster.
    const v = t < T_LATCH_LIMIT ? bodyRate(t) : bodyRate(T_LATCH_LIMIT) + 0.004 * (t - T_LATCH_LIMIT)
    return { v, nominal: 0.002 }
  },
  'TM-M11-UTL': (t, c) => {
    const gone = span(c, 'dispose_burn')
    if (m11Sep(c) && gone && t > gone[1]) return undefined
    return { v: utilOf('M-11', t, c), nominal: baseDemand(10, t) }
  },
  'TM-LAT-UTL': (t, c) => {
    const healthy = RING.reduce((a, k) => a + baseDemand(k, t), 0) / 12
    return { v: latticeModel(c.scenario, t, c.execs).latUtil, nominal: healthy }
  },
}
const RING = Array.from({ length: 12 }, (_, k) => k)
const NOISE: Record<string, number> = {
  'TM-M09-GPU': 0.12, 'TM-M09-CLT': 0.6, 'TM-M09-RAD': 0.3, 'TM-M09-UTL': 0.4, 'TM-M04-BUS': 0.15, 'TM-M04-UTL': 0.4,
  'TM-M11-RATE': 0.0006, 'TM-M11-LATCH': 10, 'TM-M11-UTL': 0.4, 'TM-LAT-UTL': 0.12,
}
const seedOf = (id: string) => [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 9973, 7)

/** Noise-free model value (tests and FDIR use this). */
export function modelValue(scenario: ScenarioId, channelId: string, t: number, resolvedAt?: number): { v: number; nominal: number } | undefined {
  if (!CHANNELS[scenario].some((c) => c.id === channelId)) return undefined
  return READERS[channelId]?.(t, { scenario, execs: resolutionExec(scenario, resolvedAt) })
}

export function sample(scenario: ScenarioId, channelId: string, t0: number, t1: number, n: number, resolvedAt?: number): TelemetryPoint[] {
  const spec = CHANNELS[scenario].find((c) => c.id === channelId)
  const read = READERS[channelId]
  if (!spec || !read || !(n >= 1)) return []
  const c: Ctx = { scenario, execs: resolutionExec(scenario, resolvedAt) }
  const out: TelemetryPoint[] = []
  const count = Math.floor(n)
  const seed = seedOf(channelId)
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? t1 : t0 + ((t1 - t0) * i) / (count - 1)
    const r = read(t, c)
    if (!r) continue
    let v = r.v + (NOISE[channelId] ?? 0) * noise(seed, t)
    if (channelId === 'TM-M04-BUS' && r.v < 1) v = Math.max(0, r.v + 0.05 * noise(seed, t))
    if (spec.key === 'util') v = Math.max(0, v)
    out.push({ t, v, nominal: r.nominal })
  }
  return out
}

/** First t in [a, b] (1 s steps) where pred holds on the noise-free unmitigated model. */
function scan(scenario: ScenarioId, id: string, a: number, b: number, pred: (v: number) => boolean): number | null {
  for (let t = a; t <= b; t++) {
    const r = modelValue(scenario, id, t)
    if (r && pred(r.v)) return t
  }
  return null
}

const fdirCache: Partial<Record<ScenarioId, FdirEvent[]>> = {}
export function fdirEvents(scenario: ScenarioId): FdirEvent[] {
  const hit = fdirCache[scenario]
  if (hit) return hit.map((e) => ({ ...e }))
  type Ev = Omit<FdirEvent, 'id'>
  const ev: Ev[] = []
  const push = (t: number | null, module: ModuleId, channel: string, severity: FdirEvent['severity'], summary: string) => {
    if (t !== null) ev.push({ t: Math.round(t), module, channel, severity, summary })
  }
  let base = 0
  if (scenario === 'radiator-puncture') {
    base = 921
    const run = runM09()
    const p0 = at(run.clt, 130)
    const rate = (at(run.clt, 129) - at(run.clt, 131)) / 2
    push(130, 'M-09', 'TM-M09-CLT', 'watch', `Loop B pressure falling ${rate.toFixed(2)} kPa/s (trend limit 0.2 kPa/s), now ${p0.toFixed(0)} kPa`)
    push(scan(scenario, 'TM-M09-CLT', 120, 480, (v) => v < COOLANT.loLimit), 'M-09', 'TM-M09-CLT', 'warning', `Loop B pressure below ${COOLANT.loLimit} kPa: coolant leak`)
    push(COOLANT.tIso, 'M-09', 'TM-M09-CLT', 'warning', `FDIR closed loop B isolation valve at ${COOLANT.pIso} kPa; loop A now carries the full ${THERMAL.P92} kW`)
    const t85 = run.t85 as number
    push(COOLANT.tIso + 20, 'M-09', 'TM-M09-GPU', 'warning', `GPU trend +${((at(run.gpu, 520) - at(run.gpu, 500)) / 20 * 60).toFixed(2)} °C/min on one loop at 92 % util; projects 85 °C throttle at t≈${t85}`)
    push(scan(scenario, 'TM-M09-RAD', 120, 3000, (v) => v < -40), 'M-09', 'TM-M09-RAD', 'watch', 'Radiator B panel below −40 °C: no coolant flow, freezing risk')
    push(t85, 'M-09', 'TM-M09-GPU', 'warning', 'GPU at 85 °C: throttle limit reached')
    push(run.t95, 'M-09', 'TM-M09-GPU', 'critical', 'GPU at 95 °C: thermal shutdown, M-09 offline')
  } else if (scenario === 'power-bus-short') {
    base = 814
    push(BUS.tFault, 'M-04', 'TM-M04-BUS', 'critical', `Primary bus A short: breaker tripped, ${BUS.v0} V → 0 V`)
    push(BUS.tFault + 1, 'M-04', 'TM-M04-UTL', 'warning', `Failover to bus B complete; compute capped at ${BUS.capPct} % (bus B ${BUS.busBkW} kW)`)
  } else {
    base = 736
    push(THRUSTER.tFault + 12, 'M-11', 'TM-M11-RATE', 'warning', 'Uncommanded body rate +0.003 °/s: RCS thruster 3 valve open')
    push(95, 'M-11', 'TM-M11-RATE', 'critical', 'Valve close command sent, no response (OPS-VALVE-07)')
    push(120, 'M-11', 'TM-M11-LATCH', 'warning', `Latch load ${latchLoad(120).toFixed(0)} N and rising; projects ${THRUSTER.limit} N limit (ICD-DOCK-01) at t≈${Math.round(T_LATCH_LIMIT)}`)
    push(latchCrossing(THRUSTER.watchN), 'M-11', 'TM-M11-LATCH', 'warning', `Latch load above ${THRUSTER.watchN} N`)
    push(rateCrossing(THRUSTER.rateLimit), 'M-11', 'TM-M11-RATE', 'critical', `Body rate above ${THRUSTER.rateLimit} °/s`)
    push(T_LATCH_LIMIT, 'M-11', 'TM-M11-LATCH', 'critical', `Latch load at ${THRUSTER.limit} N limit: latch failure, M-11 breaks free toward M-10 and M-12`)
  }
  ev.sort((a, b) => a.t - b.t)
  const out = ev.map((e, i) => ({ id: `FE-${String(base + i).padStart(4, '0')}`, ...e }))
  fdirCache[scenario] = out
  return out.map((e) => ({ ...e }))
}
