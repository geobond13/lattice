import { describe, expect, it } from 'vitest'
import { channels, fdirEvents, lattice, sample, SCENARIO_IDS, SCENARIOS } from './index'
import { runM09, T_LATCH_LIMIT, RCP, RLOOP, THERMAL } from './models'
import { modelValue } from './telemetry'
import { canonicalPlan } from './ops'

const first = (s: Parameters<typeof sample>[0], id: string, pred: (v: number) => boolean, t0 = 0, t1 = 6000, resolvedAt?: number) => {
  for (let t = t0; t <= t1; t++) {
    const r = modelValue(s, id, t, resolvedAt)
    if (r && pred(r.v)) return t
  }
  return null
}

describe('radiator-puncture telemetry', () => {
  it('calibrates the thermal model to the spec and TR-1180', () => {
    // two loops at 92 % → 62 °C; one loop at 85 °C rejects 6.1 kW
    expect(THERMAL.Ts + THERMAL.P92 * (RCP + RLOOP / 2)).toBeCloseTo(62, 6)
    expect((85 - THERMAL.Ts) / (RCP + RLOOP)).toBeCloseTo(6.1, 6)
    // one loop at 74 % holds below the throttle limit; at 92 % it does not
    expect(THERMAL.Ts + ((THERMAL.P92 * 74) / 92) * (RCP + RLOOP)).toBeLessThan(85)
  })
  it('loop B decays 310 → 180 kPa over 6 min and isolates at 480', () => {
    expect(modelValue('radiator-puncture', 'TM-M09-CLT', 100)!.v).toBeCloseTo(310, 6)
    expect(modelValue('radiator-puncture', 'TM-M09-CLT', 480)!.v).toBeCloseTo(180, 0)
    expect(modelValue('radiator-puncture', 'TM-M09-CLT', 3000)!.v).toBeGreaterThan(177)
  })
  it('GPU crosses the 85 °C throttle at ~2040 s and 95 °C shutdown at ~3000 s', () => {
    const run = runM09()
    expect(run.t85).toBeGreaterThan(2010)
    expect(run.t85).toBeLessThan(2070)
    expect(run.t95).toBeGreaterThan(2950)
    expect(run.t95).toBeLessThan(3080)
    expect(modelValue('radiator-puncture', 'TM-M09-GPU', 60)!.v).toBeCloseTo(62, 1)
    expect(first('radiator-puncture', 'TM-M09-GPU', (v) => v >= 85)).toBe(run.t85)
  })
  it('M-09 sits at 92 % util until thermal shutdown', () => {
    expect(modelValue('radiator-puncture', 'TM-M09-UTL', 1000)!.v).toBeCloseTo(92, 6)
    expect(modelValue('radiator-puncture', 'TM-M09-UTL', 3100)!.v).toBe(0)
  })
  it('REPAIR resolution returns channels to nominal and averts the throttle', () => {
    const dur = canonicalPlan('radiator-puncture').duration
    const resolvedAt = 200 + dur
    expect(first('radiator-puncture', 'TM-M09-GPU', (v) => v >= 85, 0, 6000, resolvedAt)).toBeNull()
    const late = sample('radiator-puncture', 'TM-M09-GPU', resolvedAt + 4000, resolvedAt + 4000, 1, resolvedAt)[0]
    expect(Math.abs(late.v - 62)).toBeLessThan(1.5)
    expect(sample('radiator-puncture', 'TM-M09-CLT', resolvedAt + 600, resolvedAt + 600, 1, resolvedAt)[0].v).toBeGreaterThan(300)
  })
})

describe('power-bus-short telemetry', () => {
  it('bus A falls 120 → 0 V at t = 90 and util caps at 48 %', () => {
    expect(modelValue('power-bus-short', 'TM-M04-BUS', 80)!.v).toBe(120)
    expect(modelValue('power-bus-short', 'TM-M04-BUS', 100)!.v).toBeLessThan(1)
    const u = modelValue('power-bus-short', 'TM-M04-UTL', 400)!.v
    expect(u).toBeCloseTo(48, 6)
    expect(lattice('power-bus-short', 400, [])['M-04']).toEqual({ status: 'degraded', util: 48 })
  })
  it('M-04 channels end when it is disconnected by the swap', () => {
    const resolvedAt = 300 + canonicalPlan('power-bus-short').duration
    const pts = sample('power-bus-short', 'TM-M04-BUS', 0, resolvedAt + 100, 200, resolvedAt)
    expect(pts.length).toBeGreaterThan(10)
    expect(pts.length).toBeLessThan(200)
    expect(pts.at(-1)!.t).toBeLessThan(resolvedAt)
  })
})

describe('thruster-stuck telemetry', () => {
  it('latch load rises from 800 N to the 4500 N limit at ~900 s', () => {
    expect(modelValue('thruster-stuck', 'TM-M11-LATCH', 30)!.v).toBe(800)
    expect(T_LATCH_LIMIT).toBeGreaterThan(880)
    expect(T_LATCH_LIMIT).toBeLessThan(920)
    const t = first('thruster-stuck', 'TM-M11-LATCH', (v) => v >= 4500)
    expect(Math.abs((t as number) - T_LATCH_LIMIT)).toBeLessThanOrEqual(1)
    // monotone, roughly quadratic
    const a = modelValue('thruster-stuck', 'TM-M11-LATCH', 300)!.v
    const b = modelValue('thruster-stuck', 'TM-M11-LATCH', 600)!.v
    expect(b - a).toBeGreaterThan(a - 800)
  })
  it('body rate climbs after the fault', () => {
    expect(modelValue('thruster-stuck', 'TM-M11-RATE', 500)!.v).toBeGreaterThan(modelValue('thruster-stuck', 'TM-M11-RATE', 100)!.v)
  })
  it('a DEORBIT that separates before 900 s unloads the latch', () => {
    const resolvedAt = 150 + canonicalPlan('thruster-stuck').duration
    expect(first('thruster-stuck', 'TM-M11-LATCH', (v) => v >= 4500, 0, 3000, resolvedAt)).toBeNull()
    expect(sample('thruster-stuck', 'TM-M11-LATCH', 0, 3000, 301, resolvedAt).at(-1)!.t).toBeLessThan(900)
  })
})

describe('channels and FDIR', () => {
  it('channel ids follow the spec and include TM-LAT-UTL', () => {
    for (const s of SCENARIO_IDS) {
      const ids = channels(s).map((c) => c.id)
      expect(ids).toContain('TM-LAT-UTL')
      for (const id of ids) expect(id).toMatch(/^(TM-M\d{2}-[A-Z]{2,6}|TM-LAT-UTL)$/)
    }
    expect(channels('radiator-puncture').map((c) => c.id)).toEqual(expect.arrayContaining(['TM-M09-GPU', 'TM-M09-RAD', 'TM-M09-UTL', 'TM-M09-CLT']))
  })
  it('FDIR events are ordered, well-formed and fire at the crossings', () => {
    for (const s of SCENARIO_IDS) {
      const ev = fdirEvents(s)
      expect(ev.length).toBeGreaterThan(1)
      ev.forEach((e, i) => {
        expect(e.id).toMatch(/^FE-\d{4}$/)
        expect(e.t).toBeGreaterThanOrEqual(SCENARIOS[s].faultT)
        if (i) expect(e.t).toBeGreaterThanOrEqual(ev[i - 1].t)
      })
    }
    expect(fdirEvents('radiator-puncture').some((e) => e.channel === 'TM-M09-GPU' && e.t === runM09().t85)).toBe(true)
    expect(fdirEvents('thruster-stuck').at(-1)!.t).toBe(Math.round(T_LATCH_LIMIT))
    expect(fdirEvents('power-bus-short')[0]).toMatchObject({ id: 'FE-0814', t: 90, channel: 'TM-M04-BUS', severity: 'critical' })
  })
  it('sample returns n points over [t0, t1] with noise-free nominal', () => {
    const pts = sample('radiator-puncture', 'TM-M09-GPU', 0, 600, 61)
    expect(pts).toHaveLength(61)
    expect(pts[0].t).toBe(0)
    expect(pts.at(-1)!.t).toBe(600)
    expect(pts.every((p) => p.nominal === 62)).toBe(true)
    expect(sample('radiator-puncture', 'TM-M04-BUS', 0, 10, 5)).toEqual([])
  })
  it('is deterministic', () => {
    for (const s of SCENARIO_IDS) for (const c of channels(s)) expect(sample(s, c.id, 0, 4000, 50)).toEqual(sample(s, c.id, 0, 4000, 50))
    expect(fdirEvents('thruster-stuck')).toEqual(fdirEvents('thruster-stuck'))
  })
})
