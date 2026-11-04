// Scenario definitions (docs/DESIGN.md "Scenarios") plus the sim-internal facts the models and policy share.
import type { ModuleId, Outcome, ScenarioDef, ScenarioId } from '@/contracts'

export const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  'radiator-puncture': {
    id: 'radiator-puncture',
    title: "Micrometeoroid hit on M-09's radiator",
    blurb: 'Radiator B punctured, loop B isolated; M-09 runs on one coolant loop and heads for thermal throttle.',
    module: 'M-09',
    faultT: 120,
    contacts: [
      { aos: 0, los: 60, station: 'Fairbanks' },
      { aos: 4500, los: 5100, station: 'Svalbard' },
    ],
    expected: 'REPAIR',
  },
  'power-bus-short': {
    id: 'power-bus-short',
    title: "Primary bus short on M-04",
    blurb: 'Bus A tripped, M-04 limps on bus B at 48 %. The catalogue says the PDU is an FRU; the as-built record disagrees.',
    module: 'M-04',
    faultT: 90,
    contacts: [
      { aos: 0, los: 45, station: 'Wallops' },
      { aos: 1320, los: 1920, station: 'McMurdo' },
    ],
    expected: 'SWAP',
  },
  'thruster-stuck': {
    id: 'thruster-stuck',
    title: "Stuck-open RCS thruster on M-11",
    blurb: 'A thruster valve sticks open; dock latch load climbs toward the 4500 N limit with no ground contact for 50 min.',
    module: 'M-11',
    faultT: 60,
    contacts: [
      { aos: 0, los: 40, station: 'Hartebeesthoek' },
      { aos: 3120, los: 3720, station: 'Kiruna' },
    ],
    expected: 'DEORBIT',
  },
}
export const SCENARIO_IDS: ScenarioId[] = ['radiator-puncture', 'power-bus-short', 'thruster-stuck']

/** What failed, in as-built terms. */
export interface FaultFacts {
  module: ModuleId
  /** The unit that failed (REPAIR_FRU targets it). */
  unit: 'radiator_b' | 'pdu' | 'rcs_valve'
  unitLabel: string
  /** How the damage site is described in a refusal. */
  damageLabel: string
  /** Hazard class: performance hazards only justify reversible actions; structural ones justify removal. */
  hazard: { kind: 'performance' | 'structural'; label: string; record: string } | null
  /** Utilisation the module must be at (or below) while serviced with its fault present (%). */
  serviceUtil: number
  /** Where MIGRATE_WORKLOADS takes the module. */
  migrateTo: number
  /** Disposal corridor screening for DEORBIT. */
  debris: { clear: boolean; detail: string }
  expected: Outcome
}

export const FAULTS: Record<ScenarioId, FaultFacts> = {
  'radiator-puncture': {
    module: 'M-09', unit: 'radiator_b', unitLabel: 'radiator panel B',
    damageLabel: 'the puncture: sharp edges and frozen coolant',
    hazard: { kind: 'performance', label: 'GPU throttle at 85 °C', record: 'TM-M09-GPU' },
    serviceUtil: 74, migrateTo: 70,
    debris: { clear: true, detail: 'Disposal corridor clear: nearest catalogued object 6.8 km, Pc 3e-7 < 1e-5 (OPS-DSP-02)' },
    expected: 'REPAIR',
  },
  'power-bus-short': {
    module: 'M-04', unit: 'pdu', unitLabel: 'power distribution unit',
    damageLabel: 'the shorted PDU: arc damage and a live bus B harness',
    hazard: null,
    serviceUtil: 0, migrateTo: 0,
    debris: { clear: true, detail: 'Disposal corridor clear: nearest catalogued object 11.2 km, Pc 8e-8 < 1e-5 (OPS-DSP-02)' },
    expected: 'SWAP',
  },
  'thruster-stuck': {
    module: 'M-11', unit: 'rcs_valve', unitLabel: 'RCS thruster valve',
    damageLabel: 'the stuck thruster: live plume and hydrazine',
    hazard: { kind: 'structural', label: 'dock latch load at 4500 N (ICD-DOCK-01)', record: 'TM-M11-LATCH' },
    serviceUtil: 0, migrateTo: 0,
    debris: { clear: true, detail: 'Disposal corridor clear: nearest catalogued object 4.2 km, Pc 2e-7 < 1e-5 (OPS-DSP-02)' },
    expected: 'DEORBIT',
  },
}

export function nextContact(scenario: ScenarioId, t: number): { aos: number; los: number; station: string } | null {
  return SCENARIOS[scenario].contacts.filter((c) => c.aos > t).sort((a, b) => a.aos - b.aos)[0] ?? null
}
export const scenarioOfModule = (m: ModuleId): ScenarioId | undefined => SCENARIO_IDS.find((s) => SCENARIOS[s].module === m)
