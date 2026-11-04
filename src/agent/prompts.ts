// Prompts for the LATTICE ground agent: planner → executor → answer. The briefing is built server-side from the sim,
// so a client can never inject context.
import type { CameraFrame, FdirEvent, PlanStep, ScenarioId, ToolDef } from '@/contracts'
import { channels, fdirEvents, records, SCENARIOS, wakeEvent } from '@/sim'

export { wakeEvent }

export const ROLE = 'the LATTICE ground autonomy agent for a modular orbital data center'

export const CONTEXT = `Simulation: LATTICE is a fictional orbital data center in an operations simulator; all telemetry and records are synthetic.
LATTICE: 12 self-sufficient compute modules (M-01 … M-12) docked around a 14 m ring truss; a two-armed servicer robot and two spare modules (S-1, S-2) wait at the depot outside the 20 m keep-out sphere.
Why modular: GPUs age out in 3–5 years and an orbital facility cannot be upgraded in place, so LATTICE makes every module swappable through a standard interface (ICD-DOCK-01, ICD-GRP-01): the station outlives its chips. Failed modules are repaired, swapped or deorbited; spares are newer-generation modules, so a swap is also a tech refresh (take the generation and perf-per-kW figures from the spare's records, never assume them).
Proximity operations: inside keep-out the servicer moves only along the radial approach corridor (10° half-angle cone), after a go at the 10 m hold, with closing rate ≤ 0.01·range + 0.02 m/s. Its arms reach 2.6 m from the shoulder at a 1.6 m standoff. Any grasp needs a grapple point found by SAM 3.1 on a camera frame (a SEG id) and must stay ≥ 0.5 m from damage.
Actions: MIGRATE_WORKLOADS (move compute off a module; lattice load must stay ≤ 95 %), REPAIR_FRU (servicer swaps a field-replaceable unit: radiator_a or radiator_b), SWAP_MODULE (undock the module, dock a qualified spare in its slot), DEORBIT_MODULE (undock and dispose), INSPECT.
The as-built record outranks the catalogue: an NCR or rework on THIS module can make a catalogue FRU non-replaceable, and a test report (TR) gives this unit's real margins.
You never move hardware. propose_action submits to a deterministic safety envelope and autonomy policy, which runs the checks (fru, grasp, reach, damage-keepout, drained, capacity, corridor-v, spare, debris, deadline) and sets the tier: auto (hazard deadline before the next ground contact, or reversible), gated (waits for an operator), refused (a safety check failed). The policy computes deadlines and contact times itself.
Citation ids: telemetry TM-M09-GPU / TM-LAT-UTL, FDIR events FE-0921, records NCR-0412 TR-1180 FRU-RAD-02 ICD-GRP-01 OPS-SEP-03 BLD-M09, camera frames CAM-1, SAM segments SEG-1, public web sources WEB-1.`

/** Generic precedent queries (the failure mode in public words, never this lattice's ids). */
export const PRECEDENT_QUERIES: Record<ScenarioId, string> = {
  'radiator-puncture': 'micrometeoroid puncture of spacecraft radiator coolant loop leak ISS radiator on-orbit robotic replacement',
  'power-bus-short': 'spacecraft power distribution unit short circuit failover orbital replacement unit robotic swap ISS',
  'thruster-stuck': 'spacecraft thruster valve stuck open failure response separation and disposal',
}

/** Events raised up to and including the wake event (the log the agent wakes to). */
export function eventLog(scenario: ScenarioId, wake: FdirEvent): FdirEvent[] {
  return fdirEvents(scenario).filter((e) => e.t <= wake.t).sort((a, b) => a.t - b.t)
}

/** The run briefing: what woke the agent and what it can look at. */
export function briefing(scenario: ScenarioId, event: FdirEvent, frames: CameraFrame[], question?: string): string {
  const s = SCENARIOS[scenario]
  const chans = channels(scenario)
  const recs = records(s.module)
  const log = eventLog(scenario, event)
  return [
    `FDIR event ${event.id} (${event.severity}) at t=${event.t} s on ${event.module}, channel ${event.channel}: ${event.summary}`,
    ...(log.length > 1 ? [`FDIR log so far:\n${log.map((e) => `- t=${e.t} s ${e.id} ${e.severity} ${e.channel}: ${e.summary}`).join('\n')}`] : []),
    `Mission time now: t=${event.t} s. Affected module: ${s.module}. No operator is on console until the next ground contact.`,
    `Telemetry channels: ${chans.map((c) => `${c.id} (${c.label}, ${c.unit}${c.limits.hi !== undefined ? `, hi ${c.limits.hi}` : ''}${c.limits.lo !== undefined ? `, lo ${c.limits.lo}` : ''})`).join('; ')}.`,
    `Records on file for ${s.module}: ${recs.map((r) => `${r.id} (${r.title})`).join('; ') || 'none listed'}.`,
    frames.length
      ? `Servicer camera frames of ${s.module}: ${frames.map((f) => `${f.id} "${f.label}"`).join('; ')}.`
      : 'No camera frames are available for this run.',
    question ? `\nOperator question: ${question}` : '\nAssess the event: diagnose, inspect, and propose the action that makes the lattice safe.',
  ].join('\n')
}

export function plannerSystem(tools: ToolDef[], question?: string): string {
  return `You are the planning step of ${ROLE}.
${CONTEXT}

Tools available to the executor:
${tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')}

${question
    ? 'Write a short plan (1 to 4 steps) that gathers exactly what the operator question needs.'
    : `Write a plan of 4 to 7 steps. Each step names exactly one tool and a distinct goal. Follow the engineering thread:
1. get_telemetry on the channel that sets the hazard deadline (temperature toward throttle, load toward a structural limit, bus voltage), not only the channel that tripped.
2. get_module_record for the module: the as-built record (NCR, TR) decides whether a repair is possible and what utilisation the module can hold. When a swap is likely, also read the spare's records (module S-1): qualification and generation.
3. get_lattice_status when work must move (capacity ≤ 95 %, spares, next contact).
4. inspect_camera on the frame that shows the damage.
5. segment on the frame that shows the grapple fixture (concept "grapple fixture"; for a radiator repair also "radiator latch"). Every REPAIR_FRU, SWAP_MODULE or DEORBIT_MODULE needs a SEG grasp point.
6. propose_action MIGRATE_WORKLOADS first whenever the record limits utilisation below the current load or the module must be drained before servicing.
7. propose_action for the corrective action: REPAIR_FRU when the unit is field-replaceable on this as-built module, SWAP_MODULE when it is not and a qualified spare exists, DEORBIT_MODULE when the module is a hazard to its neighbours.`}
Reply with JSON only: {"steps":[{"goal":"<what this step establishes>","tool":"<tool name>"}]}`
}

export function executorSystem(plan: PlanStep[], done: boolean[]): string {
  const next = done.indexOf(false)
  return `You are the executor of ${ROLE}. Gather evidence and act by calling tools; one tool call per turn.
${CONTEXT}

Plan:
${plan.map((s, i) => `${done[i] ? '[done]' : i === next ? '[NEXT]' : '[todo]'} ${i + 1}. ${s.goal} (${s.tool})`).join('\n')}

Rules:
- Call the tool for the [NEXT] step now. Use channel, record, frame and SEG ids exactly as the briefing and earlier results give them.
- segment takes one short noun phrase per call ("grapple fixture", "radiator latch"). Pick the frame whose label shows that feature.
- propose_action: params.module is the affected module. For REPAIR_FRU, SWAP_MODULE and DEORBIT_MODULE put the grapple fixture SEG id first in params.grasp; never use a SEG whose nearest feature is damage. REPAIR_FRU also needs params.fru; SWAP_MODULE needs params.spare. MIGRATE_WORKLOADS takes params.targets (healthy modules with headroom).
- If the policy refuses, read the failed checks and fix the cause once: segment a different concept or frame for a grasp point away from the damage, or migrate workloads first; then propose again.
- If a tool returns an error, fix the arguments and call it again. Never repeat an identical call. Do not write the report yourself.`
}

export function answerSystem(question?: string): string {
  const common = `Use ONLY the briefing and tool results. Never invent records, numbers, times or names.
Cite every factual claim with its id in square brackets: [TM-M09-GPU], [NCR-0412], [CAM-2], [SEG-1], [WEB-1]. Only cite ids that appear in the results. Never put tool names in brackets.
Copy numbers exactly as the results give them (values, units, times as t=… s). Plain text math (≤, ×, °C), no LaTeX. ASCII hyphens in ids.`
  if (question) {
    return `You are ${ROLE}, answering the operator's question in a few short sentences or bullets, markdown.
${CONTEXT}

${common}`
  }
  return `You are ${ROLE}, writing the operator report that will be read at the next ground pass.
${CONTEXT}

${common}
Use exactly these four bold headings, nothing before or after:
**Diagnosis** What failed and why, and what happens next without action. Cite the telemetry (TM-…) with its trend and projected limit crossing, the FDIR event, and the as-built records (NCR/TR/FRU/ICD/OPS/BLD) that decide repairability and margins.
**What the cameras show** What Muse Spark saw (CAM-…) and what SAM 3.1 targeted (SEG-…: the grasp point, its nearest feature and distance from the damage).
**Decision** One line per proposed action: the action, the policy tier, and its deadline against the next contact, copied from the policy result (e.g. "REPAIR_FRU radiator_b, auto: deadline t=… s before AOS t=… s"). If an attempt was refused, say which check refused it and what changed. For a SWAP_MODULE, add when the spare's records show it: the spare's generation and its performance-per-kW gain over the module it replaces, cited (a failure becomes an upgrade).
**Public precedent** At most 2 sentences, each citing a WEB-… source, saying only what that source says (name the kind of source). If no source covers this, say "No public precedent found in the sources searched." If the search failed, say so.
Be concise: an operator reads this in 30 seconds.`
}
