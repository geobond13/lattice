// The agent's tools. Each reads the deterministic sim/policy or calls a Meta model, and returns data + citations.
// The LLM never moves hardware: propose_action only submits to the policy (`decide`), which sets the tier.
import type { ActionKind, ActionParams, CameraFrame, ChannelSpec, Decision, Segment, ToolCtx, ToolDef, ToolResult } from '@/contracts'
import { channels, decide, lattice, nearestFeature, recordById, records, sample, SCENARIOS, unproject } from '@/sim'
import { describeFrame } from '@/meta/vision'
import { segment as samSegment } from '@/meta/sam'
import { webSearch } from '@/meta/search'
import { cite } from './citations'

const ACTIONS: ActionKind[] = ['MIGRATE_WORKLOADS', 'REPAIR_FRU', 'SWAP_MODULE', 'DEORBIT_MODULE', 'INSPECT']
/** Actions that put the servicer's arm on the module: they need a SAM grasp point first. */
export const GRASP_ACTIONS: ActionKind[] = ['REPAIR_FRU', 'SWAP_MODULE', 'DEORBIT_MODULE']

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const fail = (error: string, summary = error): ToolResult => ({ data: { error }, citations: [], summary: `error: ${summary}` })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** State shared by one run's tools: decisions the policy authorised (they change lattice status). */
export interface ToolState { executed: { decision: Decision; startT: number }[] }

function findChannel(specs: ChannelSpec[], q: string): ChannelSpec | undefined {
  const s = q.trim()
  return specs.find((c) => c.id === s) ?? specs.find((c) => c.id.toUpperCase() === s.toUpperCase()) ?? specs.find((c) => c.key === s)
}

function frameOf(ctx: ToolCtx, id: string): CameraFrame | undefined {
  return ctx.frames.find((f) => f.id === id) ?? ctx.frames.find((f) => f.id.toUpperCase() === id.toUpperCase())
}

/** Least-squares slope (units per second). */
function slope(points: { t: number; v: number }[]): number {
  const n = points.length
  if (n < 2) return 0
  const mt = points.reduce((a, p) => a + p.t, 0) / n
  const mv = points.reduce((a, p) => a + p.v, 0) / n
  const num = points.reduce((a, p) => a + (p.t - mt) * (p.v - mv), 0)
  const den = points.reduce((a, p) => a + (p.t - mt) ** 2, 0)
  return den ? num / den : 0
}

/** First time the series crosses a limit, linearly interpolated between samples. */
export function firstCrossing(series: { t: number; v: number }[], limits: { lo?: number; hi?: number }): { limit: 'hi' | 'lo'; value: number; t: number } | null {
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]
    const b = series[i]
    for (const kind of ['hi', 'lo'] as const) {
      const L = limits[kind]
      if (L === undefined) continue
      const crossed = kind === 'hi' ? a.v < L && b.v >= L : a.v > L && b.v <= L
      if (crossed) return { limit: kind, value: L, t: Math.round(a.t + ((L - a.v) / (b.v - a.v || 1)) * (b.t - a.t)) }
    }
  }
  return null
}

/** Visual synonyms SAM can match when the domain phrase finds nothing (tried in order, at most three). */
export function conceptLadder(concept: string): string[] {
  const c = concept.toLowerCase()
  const ladder = /grapple|fixture|handle|target/.test(c) ? ['circular target', 'circle', 'round plate']
    : /latch|bolt|fastener/.test(c) ? ['latch', 'small square', 'yellow square']
    : /radiator|panel|fin/.test(c) ? ['panel', 'solar panel', 'rectangle']
    : /damage|hole|puncture|scorch|crater/.test(c) ? ['hole', 'dark spot', 'circle']
    : /thruster|nozzle|pod/.test(c) ? ['nozzle', 'thruster', 'small box']
    : /pdu|power|connector/.test(c) ? ['panel', 'connector', 'rectangle']
    : []
  return ladder.filter((x) => x !== c).slice(0, 3)
}

export function createTools(state: ToolState = { executed: [] }): ToolDef[] {
  const getTelemetry: ToolDef = {
    name: 'get_telemetry',
    description: 'Telemetry for one channel: recent samples, current value vs a healthy module, trend per minute, limits, and when the onboard model projects the next limit crossing.',
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel id exactly as listed, e.g. TM-M09-GPU or TM-LAT-UTL' },
        window: { type: 'number', description: 'Seconds of history before now (60-3600, default 900)' },
      },
      required: ['channel'],
    },
    run(args, ctx) {
      const specs = channels(ctx.scenario)
      const spec = findChannel(specs, str(args.channel))
      if (!spec) return fail(`unknown channel "${str(args.channel)}"; channels: ${specs.map((c) => c.id).join(', ')}`, 'unknown channel')
      const window = Math.min(3600, Math.max(60, Number(args.window) || 900))
      const t0 = Math.max(0, ctx.t - window)
      const hist = sample(ctx.scenario, spec.id, t0, ctx.t, 13)
      const now = hist.at(-1)
      if (!now) return fail(`no samples for ${spec.id}`)
      const perMin = slope(hist) * 60
      const future = sample(ctx.scenario, spec.id, ctx.t, ctx.t + 6000, 121)
      const crossing = firstCrossing([{ t: now.t, v: now.v }, ...future], spec.limits)
      const data = {
        channel: spec.id, label: spec.label, unit: spec.unit, module: spec.module, limits: spec.limits, now: ctx.t,
        current: r1(now.v), nominal: r1(now.nominal), residual: r1(now.v - now.nominal),
        trendPerMin: r2(perMin),
        samples: hist.map((p) => ({ t: Math.round(p.t), v: r1(p.v) })),
        projection: crossing
          ? { crosses: crossing.limit === 'hi' ? 'upper limit' : 'lower limit', limit: crossing.value, atT: crossing.t, inS: crossing.t - ctx.t, source: 'onboard model' }
          : { crosses: null, horizonS: 6000, source: 'onboard model' },
      }
      const summary = `${spec.id} ${data.current} ${spec.unit} (nominal ${data.nominal}), ${perMin >= 0 ? '+' : ''}${data.trendPerMin} ${spec.unit}/min` +
        (crossing ? `, ${data.projection.crosses} ${crossing.value} ${spec.unit} at t=${crossing.t}` : ', no limit crossing projected')
      return { data, citations: [cite(spec.id, spec.label)], summary }
    },
  }

  const getModuleRecord: ToolDef = {
    name: 'get_module_record',
    description: "The module's as-built pedigree: build traveler, test reports, nonconformances (NCRs), FRU catalogue entries, interface and ops records. Pass a record id, or a module id for all of its records.",
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Record id, e.g. NCR-0412, TR-1180, FRU-RAD-02' },
        module: { type: 'string', description: 'Module id, e.g. M-09 (returns all its records plus fleet-wide ones)' },
      },
    },
    run(args, ctx) {
      const id = str(args.id)
      if (id) {
        const r = recordById(id) ?? recordById(id.toUpperCase())
        if (!r) return fail(`no record ${id}`)
        return { data: r, citations: [cite(r.id, r.title)], summary: `${r.id}: ${r.title}` }
      }
      const mod = str(args.module) || SCENARIOS[ctx.scenario].module
      const own = records(mod)
      const fleet = records().filter((r) => r.module === '*' && !own.some((o) => o.id === r.id))
      const list = [...own, ...fleet].slice(0, 16)
      if (!list.length) return fail(`no records for ${mod}`)
      return { data: { module: mod, records: list }, citations: list.map((r) => cite(r.id, r.title)), summary: `${list.length} records: ${list.map((r) => r.id).join(', ')}` }
    },
  }

  const getLatticeStatus: ToolDef = {
    name: 'get_lattice_status',
    description: 'Status and compute utilisation of every module and spare, total lattice load (TM-LAT-UTL, must stay ≤ 95 %), and the ground contact schedule.',
    parameters: { type: 'object', properties: {} },
    run(_args, ctx) {
      const mods = lattice(ctx.scenario, ctx.t, state.executed)
      const total = sample(ctx.scenario, 'TM-LAT-UTL', ctx.t, ctx.t, 1).at(-1)?.v
      const s = SCENARIOS[ctx.scenario]
      const next = s.contacts.filter((c) => c.aos > ctx.t).sort((a, b) => a.aos - b.aos)[0]
      const data = {
        now: ctx.t,
        modules: Object.fromEntries(Object.entries(mods).map(([id, m]) => [id, { status: m.status, util: r1(m.util) }])),
        latticeUtil: total === undefined ? null : r1(total), latticeUtilLimit: 95,
        nextContact: next ? { aos: next.aos, los: next.los, station: next.station, inS: next.aos - ctx.t } : null,
        contacts: s.contacts,
        executed: state.executed.map((e) => ({ action: e.decision.action, tier: e.decision.tier, startT: e.startT })),
      }
      return {
        data, citations: [cite('TM-LAT-UTL', 'Lattice compute utilisation')],
        summary: `lattice ${data.latticeUtil ?? '?'} %, ${Object.keys(mods).length} modules; next AOS ${next ? `t=${next.aos} (${next.station})` : 'none'}`,
      }
    },
  }

  const inspectCamera: ToolDef = {
    name: 'inspect_camera',
    description: "Muse Spark vision reads one servicer camera frame (CAM-n) and answers a question about it: visible damage, where it is relative to named features, whether the grapple fixture is clear.",
    parameters: {
      type: 'object',
      properties: {
        frame: { type: 'string', description: 'Frame id, e.g. CAM-2' },
        question: { type: 'string', description: 'What to look for' },
      },
      required: ['frame', 'question'],
    },
    async run(args, ctx) {
      const frame = frameOf(ctx, str(args.frame))
      if (!frame) return fail(`no frame "${str(args.frame)}"; frames: ${ctx.frames.map((f) => `${f.id} (${f.label})`).join(', ') || 'none'}`, 'unknown frame')
      const question = str(args.question).slice(0, 400) || 'Describe visible damage and whether the grapple fixture is clear.'
      const { findings, usage } = await describeFrame(frame, question, { signal: ctx.signal })
      ctx.emit({ type: 'usage', usage })
      const citations = [cite(frame.id, frame.label)]
      ctx.emit({ type: 'vision', callId: '', frame: frame.id, findings, citations })
      return { data: { frame: frame.id, label: frame.label, findings }, citations, summary: findings.slice(0, 160) }
    },
  }

  const segmentTool: ToolDef = {
    name: 'segment',
    description: 'SAM 3.1 segments every instance of a concept (a short concrete noun phrase, e.g. "grapple fixture", "radiator latch", "radiator panel") in a camera frame. Each match gets a SEG id, a 3D point on the module and its nearest named feature with distance. Grasp targets for propose_action come from here.',
    parameters: {
      type: 'object',
      properties: {
        frame: { type: 'string', description: 'Frame id, e.g. CAM-3' },
        concept: { type: 'string', description: 'Short noun phrase naming one kind of object' },
      },
      required: ['frame', 'concept'],
    },
    async run(args, ctx) {
      const frame = frameOf(ctx, str(args.frame))
      if (!frame) return fail(`no frame "${str(args.frame)}"; frames: ${ctx.frames.map((f) => `${f.id} (${f.label})`).join(', ') || 'none'}`, 'unknown frame')
      const concept = str(args.concept).slice(0, 60)
      if (!concept) return fail('concept is required, e.g. "grapple fixture"')
      // SAM 3.1 matches concrete visual nouns; domain phrases ("grapple fixture") often return nothing on rendered
      // frames. Walk a ladder of visual synonyms until something matches (verified live: "circle" found the fixture).
      let matchedAs = concept
      let res = await samSegment(frame.src, concept, { signal: ctx.signal })
      ctx.emit({ type: 'usage', usage: res.usage })
      for (const alt of conceptLadder(concept)) {
        if (res.matches.length) break
        matchedAs = alt
        res = await samSegment(frame.src, alt, { signal: ctx.signal })
        ctx.emit({ type: 'usage', usage: res.usage })
      }
      const label = matchedAs === concept ? concept : `${concept} (matched as "${matchedAs}")`
      // On-module matches first, then most confident; a handful is enough to target.
      const best = [...res.matches]
        .map((m) => {
          const sx = frame.width / (m.frameW || frame.width)
          const sy = frame.height / (m.frameH || frame.height)
          return { m, point: unproject(frame, { x: ((m.box.x1 + m.box.x2) / 2) * sx, y: ((m.box.y1 + m.box.y2) / 2) * sy }) }
        })
        .sort((a, b) => Number(b.point !== null) - Number(a.point !== null) || (b.m.confidence ?? 0) - (a.m.confidence ?? 0))
        .slice(0, 4)
      const segments: Segment[] = best.map(({ m, point }, i) => {
        // The box centre ray (SAM boxes are source pixels, rescaled above if the metadata size differs) hits the module here.
        const feature = point ? nearestFeature(frame.module, point) : undefined
        return {
          id: `SEG-${ctx.segments.length + i + 1}`, frame: frame.id, concept: label, box: m.box,
          ...(m.confidence !== undefined ? { confidence: r2(m.confidence) } : {}),
          ...(m.maskPath ? { maskPath: m.maskPath } : {}),
          point: point ? (point.map(r2) as Segment['point']) : null,
          ...(feature ? { feature: { id: feature.id, distance: r2(feature.distance) } } : {}),
        }
      })
      ctx.segments.push(...segments)
      ctx.emit({ type: 'segments', callId: '', frame: frame.id, concept: label, segments })
      const data = {
        frame: frame.id, concept, ...(matchedAs !== concept ? { matchedAs } : {}), matches: segments.length,
        segments: segments.map((s) => ({ id: s.id, confidence: s.confidence, box: s.box, onModule: s.point !== null, point: s.point, nearestFeature: s.feature ?? null })),
        ...(segments.length ? {} : { hint: 'No match. Try another frame or a more concrete noun phrase.' }),
      }
      const summary = segments.length
        ? segments.map((s) => `${s.id} ${s.feature ? `${s.feature.distance} m from ${s.feature.id}` : 'off-module'}${s.confidence !== undefined ? ` (c=${s.confidence})` : ''}`).join('; ')
        : `no "${concept}" in ${frame.id}`
      return { data, citations: [cite(frame.id, frame.label), ...segments.map((s) => cite(s.id, `${label} in ${frame.id}`))], summary: matchedAs !== concept && segments.length ? `as "${matchedAs}": ${summary}` : summary }
    },
  }

  const proposeAction: ToolDef = {
    name: 'propose_action',
    description: 'Submit an action to the deterministic safety envelope and autonomy policy, which returns its checks and a tier: auto (runs now), gated (waits for an operator) or refused. REPAIR_FRU, SWAP_MODULE and DEORBIT_MODULE need a grapple SEG id from segment in params.grasp.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ACTIONS },
        params: {
          type: 'object',
          properties: {
            module: { type: 'string', description: 'Target module, e.g. M-09' },
            fru: { type: 'string', enum: ['radiator_a', 'radiator_b'], description: 'REPAIR_FRU: which unit' },
            grasp: { type: 'array', items: { type: 'string' }, description: 'SEG ids to grasp, grapple fixture first' },
            spare: { type: 'string', description: 'SWAP_MODULE: spare id, e.g. S-1' },
            targets: { type: 'array', items: { type: 'string' }, description: 'MIGRATE_WORKLOADS: modules to receive the load' },
          },
          required: ['module'],
        },
      },
      required: ['kind', 'params'],
    },
    run(args, ctx) {
      const kind = str(args.kind).toUpperCase() as ActionKind
      if (!ACTIONS.includes(kind)) return fail(`kind must be one of ${ACTIONS.join(', ')}`, 'bad kind')
      const p = (args.params && typeof args.params === 'object' ? args.params : {}) as Record<string, unknown>
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : typeof v === 'string' && v ? [v.trim()] : undefined)
      const params: ActionParams = {
        module: str(p.module) || SCENARIOS[ctx.scenario].module,
        ...(p.fru === 'radiator_a' || p.fru === 'radiator_b' ? { fru: p.fru } : {}),
        ...(list(p.grasp)?.length ? { grasp: list(p.grasp) } : {}),
        ...(str(p.spare) ? { spare: str(p.spare) } : {}),
        ...(list(p.targets)?.length ? { targets: list(p.targets) } : {}),
      }
      if (GRASP_ACTIONS.includes(kind)) {
        if (!ctx.segments.length) return fail('no grasp point yet: call segment on a camera frame (e.g. concept "grapple fixture") first, then pass its SEG id in params.grasp', 'segment first')
        if (!params.grasp?.length) return fail(`params.grasp is required: pass the grapple fixture SEG id (known: ${ctx.segments.map((s) => `${s.id} ${s.concept}`).join(', ')})`, 'grasp missing')
        const unknown = params.grasp.filter((g) => !ctx.segments.some((s) => s.id === g))
        if (unknown.length) return fail(`unknown SEG ids ${unknown.join(', ')}; known: ${ctx.segments.map((s) => s.id).join(', ')}`, 'unknown SEG id')
      }
      const decision = decide(kind, params, { scenario: ctx.scenario, t: ctx.t, segments: ctx.segments })
      if (decision.tier === 'auto') state.executed.push({ decision, startT: ctx.t })
      ctx.emit({ type: 'decision', callId: '', decision })
      const failed = decision.checks.filter((c) => !c.pass)
      const data = {
        action: decision.action, params: decision.params, tier: decision.tier, reason: decision.reason,
        deadline: decision.deadline, nextContact: decision.nextContact,
        checks: decision.checks.map((c) => ({ id: c.id, pass: c.pass, detail: c.detail })),
        ...(decision.tier === 'refused'
          ? { next: `Refused by ${failed.map((c) => c.id).join(', ') || 'policy'}. Fix the cause (e.g. segment a different grasp concept away from the damage, or migrate workloads first) and propose once more.` }
          : decision.tier === 'auto' ? { status: 'authorised: the timeline runs now' } : { status: 'queued for operator approval' }),
      }
      return { data, citations: [], decision, summary: `${decision.action} → ${decision.tier}: ${decision.reason}` }
    },
  }

  return [getTelemetry, getModuleRecord, getLatticeStatus, inspectCamera, segmentTool, proposeAction]
}

/** Server-run precedent search (not a planned tool; see loop preload). */
export const searchPrecedents: ToolDef = {
  name: 'search_precedents',
  description: 'Public web sources on the same failure mode or servicing technique.',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  async run(args, ctx) {
    const res = await webSearch(str(args.query), { signal: ctx.signal })
    ctx.emit({ type: 'usage', usage: res.usage })
    return {
      data: { summary: res.summary, sources: res.sources.map((s) => ({ id: s.id, title: s.title, url: s.url, snippet: s.snippet?.slice(0, 400), cited: s.cited })) },
      citations: res.citations,
      summary: `${res.sources.length} public sources (${res.sources.filter((s) => s.cited).length} cited)`,
    }
  },
}
