// The moment the onboard event log is complete enough for the ground agent to act on (shared by server and UI).
import type { FdirEvent, ScenarioId } from '@/contracts'
import { SCENARIOS } from './scenarios'
import { channels, fdirEvents } from './telemetry'

/**
 * The FDIR event that wakes the agent: the moment the picture is complete enough to act on.
 * That is the first event that projects a hazard ("projects 85 °C throttle at t≈2040"); failing that, the last event
 * of the first warning/critical cascade (events within 60 s of it, e.g. a bus trip and its failover).
 * Verified on the sim: radiator-puncture FE-0924 t=500, power-bus-short FE-0815 t=91, thruster-stuck FE-0738 t=120.
 */
export function wakeEvent(scenario: ScenarioId): FdirEvent {
  const events = [...fdirEvents(scenario)].sort((a, b) => a.t - b.t)
  const s = SCENARIOS[scenario]
  const projecting = events.find((e) => /\bproject/i.test(e.summary) && e.severity !== 'watch')
  if (projecting) return projecting
  const first = events.find((e) => e.severity !== 'watch')
  if (first) return events.filter((e) => e.t >= first.t && e.t <= first.t + 60).at(-1) ?? first
  return events[0] ?? { id: 'FE-0000', t: s.faultT, module: s.module, channel: channels(scenario)[0]?.id ?? 'TM-LAT-UTL', severity: 'warning', summary: s.title }
}

