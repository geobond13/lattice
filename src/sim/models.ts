// Physical models behind the telemetry. Pure and deterministic; heavy runs are memoised.
//
// M-09 thermal (radiator-puncture). One lumped GPU/cold-plate node:
//   C dT/dt = P(u) − (T − Ts) / R(t),   R = Rcp + Rloop / (1 + gB)
// linearised about the operating point (valid for ~60–100 % util). Calibration:
//   two loops, 92 % util (7.4 kW)  → 62 °C            (healthy reading)
//   one loop rejects 6.1 kW at 85 °C (TR-1180)        → one loop holds up to ~76 %; spec margin ≤ 74 %
//   C = 115.6 kJ/K                                    → throttle 85 °C at t≈2040, shutdown 95 °C at t≈3020
// Loop B degrades as its pressure leaks through the puncture (orifice flow: √p falls linearly) and is
// isolated at t = 480.
export const HORIZON = 10800

export const THERMAL = {
  Ts: -150, // effective sink of the linearised radiator, °C
  R1: (85 - -150) / 6.1, // single loop, K/kW
  R2: (62 - -150) / 7.4, // two loops, K/kW
  C: 115.6, // kJ/K
  P92: 7.4, // kW at 92 %
  utilBase: 92,
  throttleC: 85,
  shutdownC: 95,
  nominalC: 62,
}
export const RCP = 2 * THERMAL.R2 - THERMAL.R1
export const RLOOP = THERMAL.R1 - RCP
export const COOLANT = { p0: 310, pIso: 180, tFault: 120, tIso: 480, loLimit: 250 }
const SQRT_A = (Math.sqrt(COOLANT.p0) - Math.sqrt(COOLANT.pIso)) / (COOLANT.tIso - COOLANT.tFault)

export interface M09Profile {
  /** Workload shed: util ramps from 92 to `to` between start and end. */
  drain?: { start: number; end: number; to: number }
  /** New radiator panel latched (loop B refilled and back in service). */
  restoreT?: number
}

export interface M09Run {
  gpu: Float64Array
  rad: Float64Array
  clt: Float64Array
  util: Float64Array
  t85: number | null
  t95: number | null
}

const smooth01 = (x: number) => {
  const u = Math.min(1, Math.max(0, x))
  return u * u * (3 - 2 * u)
}

function coolantUnrestored(t: number): number {
  if (t < COOLANT.tFault) return COOLANT.p0
  if (t < COOLANT.tIso) return (Math.sqrt(COOLANT.p0) - SQRT_A * (t - COOLANT.tFault)) ** 2
  // isolated: the pump side holds, with a slow creep as trapped coolant cools
  return COOLANT.pIso - 2 * (1 - Math.exp(-(t - COOLANT.tIso) / 1800))
}

const cache = new Map<string, M09Run>()
export function runM09(profile: M09Profile = {}): M09Run {
  const key = JSON.stringify(profile)
  const hit = cache.get(key)
  if (hit) return hit
  const n = HORIZON + 1
  const gpu = new Float64Array(n), rad = new Float64Array(n), clt = new Float64Array(n), util = new Float64Array(n)
  const { Ts, C, P92, utilBase } = THERMAL
  let T = THERMAL.nominalC
  let Tr = 18
  let shutdown: number | null = null
  let t85: number | null = null
  let t95: number | null = null
  const restore = profile.restoreT ?? Infinity
  for (let t = 0; t < n; t++) {
    // coolant loop B
    let p = coolantUnrestored(t)
    let gB = t < COOLANT.tFault ? 1 : t < COOLANT.tIso ? Math.min(1, Math.max(0, (p - 150) / 160)) : 0
    if (t >= restore) {
      const k = smooth01((t - restore) / 120)
      const pr = coolantUnrestored(restore)
      p = pr + (COOLANT.p0 - pr) * k
      gB = k
    }
    // workload
    let u = utilBase
    if (profile.drain && t >= profile.drain.start) {
      const d = profile.drain
      u = utilBase + (d.to - utilBase) * smooth01((t - d.start) / Math.max(1, d.end - d.start))
    }
    if (t >= restore) u = u + (utilBase - u) * smooth01((t - restore) / 60)
    if (shutdown !== null && t < restore) u = 0
    gpu[t] = T; rad[t] = Tr; clt[t] = p; util[t] = u
    // integrate one second (Heun)
    const R = RCP + RLOOP / (1 + gB)
    const P = (P92 * u) / utilBase
    const f = (x: number) => (shutdown !== null && t < restore ? (20 - x) / 900 : (P - (x - Ts) / R) / C)
    const k1 = f(T)
    T = T + 0.5 * (k1 + f(T + k1))
    if (t85 === null && T >= THERMAL.throttleC) t85 = t + 1
    if (t95 === null && T >= THERMAL.shutdownC) { t95 = t + 1; shutdown = t + 1 }
    // radiator B panel: flow carries heat in; without flow it radiates toward −75 °C
    const target = -75 + (18 + 75) * gB
    Tr += (target - Tr) / (gB > 0.5 ? 200 : 400)
  }
  const run = { gpu, rad, clt, util, t85, t95 }
  cache.set(key, run)
  return run
}
export const at = (arr: Float64Array, t: number): number => {
  if (t <= 0) return arr[0]
  if (t >= arr.length - 1) return arr[arr.length - 1]
  const i = Math.floor(t)
  return arr[i] + (arr[i + 1] - arr[i]) * (t - i)
}

// ─── M-11 stuck thruster ─────────────────────────────────────────────────────────────────────────
// The slow-actuating valve (NCR-0388) creeps open, so thrust ramps. Latch load = preload + thrust moment
// reacted across the latch ring (∝ s) + rate-coupled structural load (∝ s²). Body rate integrates the
// growing torque. Fitted to reach the 4500 N ICD-DOCK-01 limit at t ≈ 900.
export const THRUSTER = { tFault: 60, preload: 800, a: 2.6, b: 0.00215, limit: 4500, rateLimit: 0.2, watchN: 3000 }
export function latchLoad(t: number): number {
  const s = Math.max(0, t - THRUSTER.tFault)
  return THRUSTER.preload + THRUSTER.a * s + THRUSTER.b * s * s
}
export function bodyRate(t: number): number {
  const s = Math.max(0, t - THRUSTER.tFault)
  return 0.002 + 0.00025 * s + 1.2e-7 * s * s
}
/** Closed-form crossing of latchLoad = L. */
export function latchCrossing(L: number): number {
  const { a, b, preload, tFault } = THRUSTER
  return tFault + (-a + Math.sqrt(a * a + 4 * b * (L - preload))) / (2 * b)
}
export function rateCrossing(r: number): number {
  const a = 1.2e-7, b = 0.00025, c = 0.002 - r
  return THRUSTER.tFault + (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
}
export const T_LATCH_LIMIT = latchCrossing(THRUSTER.limit)

// ─── M-04 bus short ──────────────────────────────────────────────────────────────────────────────
export const BUS = { tFault: 90, v0: 120, loLimit: 100, capPct: 48, busBkW: 3.6 }
export function busA(t: number): number {
  return t < BUS.tFault ? BUS.v0 : BUS.v0 * Math.exp(-(t - BUS.tFault) / 1.5)
}

/** Hazard time per scenario in the unmitigated model (s), or null. */
export const T_THROTTLE = () => runM09().t85 as number
export const T_SHUTDOWN = () => runM09().t95 as number

// ─── Workload demand ─────────────────────────────────────────────────────────────────────────────
/** Demand on a ring module, in % of one Gen-1 module (= its util % on a Gen-1 module). */
export function baseDemand(slot: number, t: number): number {
  if (slot === 8) return THERMAL.utilBase // M-09 runs hot: 92 %
  return 66 + 6 * Math.sin(1.3 * slot + 0.7) + 1.2 * Math.sin((2 * Math.PI * t) / 1500 + slot)
}
