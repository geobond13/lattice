// The deterministic envelope + autonomy policy (DESIGN.md "Policy"). Never calls a model.
//
// Tier rule:
//   refused  any safety check fails (every check except `deadline`, which only informs the tier)
//   auto     MIGRATE_WORKLOADS within capacity; or (reversible, or irreversible against a structural hazard)
//            with a hazard deadline that falls before the next ground contact
//   gated    everything else
// Deadline = hazard time (from the telemetry model) − time from ops start to the step that removes it:
// the drain for a performance hazard (TR-1180: one loop holds at ≤ 74 %), separation for a structural one.
import type { ActionKind, ActionParams, Check, Decision, ScenarioId, Segment, Vec3 } from '@/contracts'
import { nearestFeature, onModule } from './geometry'
import { latticeModel, UTIL_LIMIT, type Exec } from './lattice'
import { DAMAGE, moduleGeom, SERVICER, shoulders, slotOf } from './layout'
import { runM09, T_LATCH_LIMIT } from './models'
import { buildPlan, corridorCheck, drainFrom, drainTarget, phaseSpan, toTimeline } from './ops'
import { recordById } from './records'
import { FAULTS, nextContact, SCENARIOS } from './scenarios'
import { dist, toWorld } from './vec'

const REVERSIBLE: Record<ActionKind, boolean> = {
  MIGRATE_WORKLOADS: true, REPAIR_FRU: true, INSPECT: true, SWAP_MODULE: false, DEORBIT_MODULE: false,
}
const GRASP_ACTIONS: ActionKind[] = ['REPAIR_FRU', 'SWAP_MODULE', 'DEORBIT_MODULE']
const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1)
const f2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2)
const pct = (x: number) => `${Math.round(x)} %`

type Ctx = { scenario: ScenarioId; t: number; segments: Segment[] }

/** Hazard time in the unmitigated model, s. */
export function hazardTime(scenario: ScenarioId): number | null {
  if (scenario === 'radiator-puncture') return runM09().t85
  if (scenario === 'thruster-stuck') return Math.round(T_LATCH_LIMIT)
  return null
}

export function decide(action: ActionKind, params: ActionParams, ctx: Ctx): Decision {
  const checks: Check[] = []
  const add = (id: string, label: string, pass: boolean, detail: string) => checks.push({ id, label, pass, detail })
  const fault = FAULTS[ctx.scenario]
  const sc = SCENARIOS[ctx.scenario]
  const mod = params.module
  const geom = moduleGeom(mod)
  const contact = nextContact(ctx.scenario, ctx.t)
  const nc = contact ? contact.aos : null
  const finish = (tier: Decision['tier'], reason: string, deadline: number | null, ops?: Decision['ops']): Decision => ({
    action, params, tier, reason, deadline, nextContact: nc, checks, ...(tier !== 'refused' && ops ? { ops } : {}),
  })

  // ── target ──
  const ringModule = geom !== undefined && slotOf(mod) !== null
  if (!ringModule) {
    add('target', 'Action targets a docked lattice module', false, geom ? `${mod} is a spare at the depot, not on the ring` : `Unknown module ${mod}`)
    return finish('refused', `Refused: ${checks[0].detail}.`, null)
  }
  if (action !== 'INSPECT') {
    const unitOk = action !== 'REPAIR_FRU' || !params.fru || params.fru === fault.unit
    const ok = mod === fault.module && unitOk
    add('target', 'Action targets the faulted module and unit', ok,
      mod !== fault.module ? `${mod} is healthy; the fault is on ${fault.module} (${sc.title})`
        : !unitOk ? `${params.fru} is intact on ${mod}; the failed unit is the ${fault.unitLabel}`
          : `${mod}: ${fault.unitLabel} failed at t=${sc.faultT} s`)
  }

  const plan = buildPlan(action, mod, { spare: params.spare, fru: params.fru })
  const ops = toTimeline(plan)

  // ── fru (as-built) ──
  if (action === 'REPAIR_FRU') {
    const unit = params.fru ?? fault.unit
    if (unit === 'radiator_a' || unit === 'radiator_b') {
      add('fru', 'Unit is field-replaceable on this module (as-built)', true, `${unit} is an FRU on ${mod} (FRU-RAD-02: 4 latches, 12 N·m, 22 min; 2 panels carried); no NCR against it`)
    } else if (unit === 'pdu') {
      const ncr = mod === 'M-04' ? recordById('NCR-0412') : undefined
      add('fru', 'Unit is field-replaceable on this module (as-built)', !ncr,
        ncr ? `PDU harness potted during rework (NCR-0412): not field-replaceable on ${mod}; overrides FRU-PDU-01` : `PDU is an FRU on ${mod} (FRU-PDU-01)`)
    } else {
      add('fru', 'Unit is field-replaceable on this module (as-built)', false, `The ${fault.unitLabel} has no FRU catalogue entry: it cannot be replaced in orbit`)
    }
  }

  // ── grasp / reach / damage keep-out ──
  if (GRASP_ACTIONS.includes(action)) {
    const ids = params.grasp ?? []
    const segs = ids.map((id) => ({ id, seg: ctx.segments.find((s) => s.id === id) }))
    const missing = segs.filter((s) => !s.seg).map((s) => s.id)
    const nulls = segs.filter((s) => s.seg && !s.seg.point).map((s) => s.id)
    const pts = segs.filter((s) => s.seg?.point).map((s) => ({ id: s.id, p: s.seg!.point as Vec3, concept: s.seg!.concept }))
    const off = pts.filter((s) => !onModule(mod, s.p)).map((s) => s.id)
    const onGrapple = pts.find((s) => nearestFeature(mod, s.p)?.id === 'grapple' && dist(s.p, toWorld({ position: geom.position, quaternion: geom.quaternion }, geom.features.grapple)) <= 0.5)
    const graspOk = ids.length > 0 && !missing.length && !nulls.length && !off.length && !!onGrapple
    add('grasp', 'Grasp point segmented and unprojected onto the module', graspOk,
      !ids.length ? 'No SEG given: segment the grapple fixture first'
        : missing.length ? `Unknown ${missing.join(', ')}`
          : nulls.length ? `${nulls.join(', ')} did not unproject onto ${mod} (ray missed the module)`
            : off.length ? `${off.join(', ')} lands off ${mod}`
              : !onGrapple ? `None of ${ids.join(', ')} is on the grapple fixture (within 0.5 m)`
                : `${pts.map((s) => s.id).join(', ')} on ${mod}; ${onGrapple.id} on the grapple fixture`)
    if (pts.length) {
      const sh = shoulders(mod)
      const reach = pts.map((s) => ({ ...s, d: Math.min(...sh.map((q) => dist(q, s.p))) }))
      const worst = reach.reduce((a, b) => (b.d > a.d ? b : a))
      add('reach', `Grasp point within arm reach (${SERVICER.standoff} m standoff)`, worst.d <= SERVICER.reach,
        `${f2(worst.d)} m from shoulder ${worst.d <= SERVICER.reach ? '≤' : '>'} ${SERVICER.reach} m (${worst.id}, TR-0640)`)
      const dmg = DAMAGE[mod] ? toWorld({ position: geom.position, quaternion: geom.quaternion }, DAMAGE[mod]) : null
      if (dmg) {
        const near = pts.map((s) => ({ ...s, d: dist(s.p, dmg) })).reduce((a, b) => (b.d < a.d ? b : a))
        add('damage-keepout', 'Grasp ≥ 0.5 m from damage', near.d >= 0.5,
          near.d >= 0.5 ? `Closest grasp ${near.id} is ${f2(near.d)} m from ${fault.damageLabel.split(':')[0]} ≥ 0.5 m`
            : `Grasp point ${f1(near.d)} m from ${fault.damageLabel}`)
      } else {
        add('damage-keepout', 'Grasp ≥ 0.5 m from damage', true, `No damage site on ${mod}`)
      }
    } else {
      add('reach', `Grasp point within arm reach (${SERVICER.standoff} m standoff)`, false, 'No grasp point to check')
      add('damage-keepout', 'Grasp ≥ 0.5 m from damage', false, 'No grasp point to check')
    }
  }

  // ── drained / capacity ──
  if (action !== 'INSPECT') {
    const from = drainFrom(mod)
    const to = drainTarget(action, mod)
    const threshold = action === 'REPAIR_FRU' ? fault.serviceUtil : action === 'MIGRATE_WORKLOADS' ? Math.max(to, fault.serviceUtil) : 0
    const d = phaseSpan(ops, 'drain')
    const exec: Exec = { action, params, ops, startT: ctx.t }
    // Worst point for the rest of the lattice: module drained (REPAIR/MIGRATE) or off the ring (SWAP/DEORBIT).
    const u = phaseSpan(ops, 'undock')
    const probeT = ctx.t + (u ? u[0] + 1 : d ? d[1] : 0)
    const lm = latticeModel(ctx.scenario, probeT, [exec])
    const thrRec = threshold > 0 && fault.unit === 'radiator_b' ? ' (TR-1180)' : threshold === 0 ? ' (ICD-DOCK-01)' : ''
    add('drained', 'Module drained to the action threshold', to <= threshold && lm.unserved < 0.5,
      `${mod} ${pct(from)} → ${pct(to)} ≤ ${pct(threshold)}${thrRec} in ${d ? d[1] - d[0] : 0} s` + (lm.unserved >= 0.5 ? `; ${f1(lm.unserved)} % of load has no receiver` : ''))
    const capOk = lm.latUtil <= UTIL_LIMIT && (!lm.maxReceiver || lm.maxReceiver.util <= UTIL_LIMIT + 1e-6) && lm.unserved < 0.5
    add('capacity', 'Lattice compute stays ≤ 95 %', capOk,
      `TM-LAT-UTL ${f1(lm.latUtil)} % ≤ 95 %` + (lm.maxReceiver ? `; busiest receiver ${lm.maxReceiver.id} at ${f1(lm.maxReceiver.util)} %` : ''))
  }

  // ── corridor velocity ──
  if (action !== 'MIGRATE_WORKLOADS') {
    const cv = corridorCheck(ops)
    const w = cv.worst
    add('corridor-v', 'Approach velocity within corridor limit', cv.ok,
      w ? `Peak closing ${f2(cv.peak!.v)} m/s at ${f1(cv.peak!.range)} m; tightest ${f2(w.v)} m/s at ${f1(w.range)} m ≤ ${f2(w.limit)} m/s (OPS-PRX-01)` : 'No corridor approach in this plan')
  }

  // ── spare ──
  if (action === 'SWAP_MODULE') {
    const spare = params.spare ?? 'S-1'
    const tr = spare === 'S-1' ? recordById('TR-1302') : spare === 'S-2' ? recordById('TR-1303') : undefined
    const ok = tr?.values?.qualified === 'yes'
    add('spare', 'Spare module qualified', ok,
      !tr ? `${spare} is not a depot spare` : ok ? `${spare} burn-in passed, ${tr.values?.burnInH} h (${tr.id}); Gen-${tr.values?.generation}, ${tr.values?.perfPerKw}× perf/kW`
        : `${spare} not qualified: ${tr.body.split('.')[0]} (${tr.id})`)
  }

  // ── debris ──
  if (action === 'DEORBIT_MODULE') add('debris', 'Disposal corridor clear of debris', fault.debris.clear, fault.debris.detail)

  // ── deadline (informs the tier, never refuses) ──
  const hz = fault.hazard
  const hT = hazardTime(ctx.scenario)
  let deadline: number | null = null
  let mitigated = false
  if (mod === fault.module && hz && hT !== null && action !== 'INSPECT') {
    const span = hz.kind === 'structural' ? phaseSpan(ops, 'undock') : phaseSpan(ops, 'drain')
    if (span) { deadline = hT - span[1]; mitigated = true }
  }
  if (action !== 'INSPECT') {
    const ncTxt = contact ? `next contact AOS ${contact.aos} s (${contact.station})` : 'no further contact scheduled'
    if (!hz) add('deadline', 'Hazard deadline vs next ground contact', true, `No hazard deadline${ctx.scenario === 'power-bus-short' ? ' (TR-0977: bus B stable at 3.6 kW)' : ''}; ${ncTxt}`)
    else if (!mitigated || deadline === null) add('deadline', 'Hazard deadline vs next ground contact', true, `${action} does not remove the hazard (${hz.label} at t≈${hT} s); ${ncTxt}`)
    else add('deadline', 'Hazard deadline vs next ground contact', deadline >= ctx.t,
      `${hz.label} at t≈${hT} s (${hz.record}); start by t=${deadline} s ${nc !== null && deadline < nc ? '<' : '≥'} ${ncTxt}` + (deadline < ctx.t ? ` — ${ctx.t - deadline} s late` : ''))
  }

  // ── tier ──
  const failed = checks.filter((c) => !c.pass && c.id !== 'deadline')
  if (failed.length) return finish('refused', `Refused by ${failed.map((c) => c.id).join(', ')}: ${failed[0].detail}.`, deadline)
  if (action === 'INSPECT') return finish('auto', 'Inspection fly-around is always allowed: no contact, outside the keep-out sphere.', null, ops)
  if (action === 'MIGRATE_WORKLOADS') return finish('auto', 'Workload migration within lattice capacity is always autonomous.', deadline, ops)
  const reversible = REVERSIBLE[action]
  const beforeContact = deadline !== null && (nc === null || deadline < nc)
  const justified = reversible || hz?.kind === 'structural'
  if (beforeContact && justified) {
    return finish('auto', `${reversible ? 'Reversible' : 'Hazard-driven'} ${action}: must start by t=${deadline} s, before ${contact ? `AOS ${contact.aos} s` : 'any contact'}. No human reachable in time: act now.`, deadline, ops)
  }
  const why = deadline === null
    ? `no hazard deadline before ${contact ? `AOS ${contact.aos} s` : 'next contact'}`
    : !justified ? `irreversible, and the hazard (${hz?.label}) is not structural` : `deadline t=${deadline} s falls after ${contact ? `AOS ${contact.aos} s` : 'contact'}`
  return finish('gated', `${reversible ? '' : 'Removes a module; '}${why}: waits for operator approval.`, deadline, ops)
}

