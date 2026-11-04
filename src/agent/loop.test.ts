import { beforeEach, describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import type { ActionKind, ActionParams, AgentEvent, CameraFrame, Decision, Segment } from '@/contracts'

// ─── Mocked sim (the real one is built in parallel) ───────────────────────────────────────────────
const decideCalls: { action: ActionKind; params: ActionParams; segments: Segment[] }[] = []
vi.mock('@/sim', () => ({
  SCENARIOS: {
    'radiator-puncture': { id: 'radiator-puncture', title: 'Micrometeoroid hit on M-09', blurb: '', module: 'M-09', faultT: 120, contacts: [{ aos: 4500, los: 5100, station: 'Svalbard' }], expected: 'REPAIR' },
  },
  channels: () => [
    { id: 'TM-M09-GPU', module: 'M-09', key: 'gpuC', label: 'GPU temperature', unit: '°C', limits: { hi: 85 } },
    { id: 'TM-LAT-UTL', module: '*', key: 'util', label: 'Lattice compute', unit: '%', limits: { hi: 95 } },
  ],
  sample: (_s: string, id: string, t0: number, t1: number, n: number) => Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? t1 : t0 + ((t1 - t0) * i) / (n - 1)
    return { t, v: id === 'TM-M09-GPU' ? 62 + (23 * (t - 120)) / 1920 : 80, nominal: 62 }
  }),
  fdirEvents: () => [{ id: 'FE-0921', t: 480, module: 'M-09', channel: 'TM-M09-GPU', severity: 'warning', summary: 'Loop B isolated' }],
  wakeEvent: () => ({ id: 'FE-0921', t: 480, module: 'M-09', channel: 'TM-M09-GPU', severity: 'warning', summary: 'Loop B isolated' }),
  records: (m?: string) => (m === undefined ? [{ id: 'ICD-GRP-01', kind: 'icd', module: '*', title: 'Grapple fixture standard', date: '2026-01-01', body: 'Standard grapple.' }] : [
    { id: 'TR-1180', kind: 'test', module: 'M-09', title: 'Thermal vac', date: '2026-01-01', body: 'One loop rejected 6.1 kW; holds at ≤ 74 % util.' },
    { id: 'FRU-RAD-02', kind: 'fru', module: 'M-09', title: 'Radiator FRU', date: '2026-01-01', body: '4 latches, swap 22 min.' },
  ]),
  recordById: () => undefined,
  lattice: () => ({ 'M-09': { status: 'degraded', util: 92 } }),
  unproject: () => [14, 0, 0],
  nearestFeature: () => ({ id: 'grapple', distance: 0.05 }),
  decide: (action: ActionKind, params: ActionParams, ctx: { segments: Segment[] }): Decision => {
    decideCalls.push({ action, params, segments: [...ctx.segments] })
    const refused = action === 'REPAIR_FRU' && params.grasp?.[0] === 'SEG-1'
    return {
      action, params, tier: refused ? 'refused' : 'auto', reason: refused ? 'Grasp point 0.3 m from the puncture' : 'Deadline before AOS',
      deadline: 2040, nextContact: 4500,
      checks: [{ id: 'damage-keepout', label: 'Clear of damage', pass: !refused, detail: refused ? '0.3 m < 0.5 m' : '0.9 m ≥ 0.5 m' }],
    }
  },
}))
vi.mock('@/meta/vision', () => ({
  describeFrame: async (f: CameraFrame) => ({ findings: `Puncture on radiator B; grapple clear [${f.id}]`, usage: { label: 'vision', role: 'vision', model: 'muse-spark-1.3', effort: 'medium', promptTokens: 900, completionTokens: 100, costUsd: 0.001, ms: 5 } }),
}))
vi.mock('@/meta/sam', () => ({
  segment: async () => ({ matches: [{ frame: 0, objectId: 0, box: { x1: 100, y1: 100, x2: 140, y2: 140 }, frameW: 640, frameH: 360, confidence: 0.91, maskPath: 'M100 100L141 100L141 141Z' }], raw: '', usage: { label: 'segment', role: 'segmenter', model: 'sam-3.1', promptTokens: 0, completionTokens: 0, costUsd: 0.0025, ms: 5 } }),
}))
vi.mock('@/meta/search', () => ({
  webSearch: async () => ({
    summary: 'ISS radiators are replaceable units [WEB-1].', queries: 2,
    sources: [{ id: 'WEB-1', title: 'ISS ORUs', url: 'https://example.org/oru', cited: true }],
    citations: [{ type: 'web', id: 'WEB-1', label: 'ISS ORUs', url: 'https://example.org/oru' }],
    usage: { label: 'precedent search', role: 'search', model: 'muse-spark-1.3', effort: 'low', promptTokens: 3000, completionTokens: 500, costUsd: 0.0105, ms: 5 },
  }),
}))

const { runAgent } = await import('./loop')

// ─── Fake Meta client ─────────────────────────────────────────────────────────────────────────────
type Call = { name: string; args: Record<string, unknown> }
function fakeClient(script: Call[], answer: string[]) {
  let i = 0
  const chatBodies: OpenAI.Chat.Completions.ChatCompletionCreateParams[] = []
  const client = {
    chat: { completions: { create: vi.fn(async (body: OpenAI.Chat.Completions.ChatCompletionCreateParams) => {
      chatBodies.push(body)
      const c = script[i++]
      return {
        choices: [{ finish_reason: c ? 'tool_calls' : 'stop', message: { role: 'assistant', content: '', tool_calls: c ? [{ id: `call_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] : undefined } }],
        usage: { prompt_tokens: 500, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 10 } },
      }
    }) } },
    responses: { create: vi.fn(async (body: { stream?: boolean }) => {
      const usage = { input_tokens: 1200, output_tokens: 800, output_tokens_details: { reasoning_tokens: 600 }, input_tokens_details: { cached_tokens: 0 } }
      if (!body.stream) {
        return {
          output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Thermal margin first, then grasp.' }] }],
          output_text: JSON.stringify({ steps: [
            { goal: 'GPU trend', tool: 'get_telemetry' }, { goal: 'As-built', tool: 'get_module_record' }, { goal: 'Look', tool: 'inspect_camera' },
            { goal: 'Grapple', tool: 'segment' }, { goal: 'Migrate to ≤ 74 %', tool: 'propose_action' }, { goal: 'Repair radiator_b', tool: 'propose_action' },
          ] }),
          usage,
        }
      }
      return (async function* () {
        yield { type: 'response.reasoning_summary_text.delta', delta: 'Summarise.' }
        for (const d of answer) yield { type: 'response.output_text.delta', delta: d }
        yield { type: 'response.completed', response: { usage, output: [] } }
      })()
    }) },
  }
  return { client: client as unknown as OpenAI, chatBodies, responses: client.responses.create }
}

const frames: CameraFrame[] = [{ id: 'CAM-1', label: 'Close-up radiator B', src: 'data:image/jpeg;base64,AAAA', width: 640, height: 360, camera: { position: [20, 0, 0], target: [14, 0, 0], up: [0, 1, 0], fovDeg: 50 }, module: 'M-09' }]

const SCRIPT: Call[] = [
  { name: 'get_telemetry', args: { channel: 'TM-M09-GPU', window: 600 } },
  { name: 'get_module_record', args: { module: 'M-09' } },
  { name: 'inspect_camera', args: { frame: 'CAM-1', question: 'Damage? Grapple clear?' } },
  { name: 'propose_action', args: { kind: 'REPAIR_FRU', params: { module: 'M-09', fru: 'radiator_b' } } }, // before segment: guardrail
  { name: 'segment', args: { frame: 'CAM-1', concept: 'grapple fixture' } },
  { name: 'propose_action', args: { kind: 'MIGRATE_WORKLOADS', params: { module: 'M-09', targets: ['M-08', 'M-10'] } } },
  { name: 'propose_action', args: { kind: 'REPAIR_FRU', params: { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-1'] } } }, // refused
  { name: 'segment', args: { frame: 'CAM-1', concept: 'grapple fixture plate' } },
  { name: 'propose_action', args: { kind: 'REPAIR_FRU', params: { module: 'M-09', fru: 'radiator_b', grasp: ['SEG-2'] } } }, // auto
]
const ANSWER = ['**Diagnosis** GPU rises toward 85 °C [TM-M09-GPU]; one loop holds ≤ 74 % [TR-1180] [NCR-9999].\n', '**Decision** REPAIR_FRU radiator_b, auto: deadline t=2040 s before AOS t=4500 s [SEG-2].\n', '**Public precedent** ISS radiators are ORUs [WEB-1].']

describe('runAgent', () => {
  beforeEach(() => { decideCalls.length = 0 })

  it('plans, acts with guardrails and a refusal retry, then streams a checked answer', async () => {
    const { client, chatBodies } = fakeClient(SCRIPT, ANSWER)
    const events: AgentEvent[] = []
    await runAgent({ scenario: 'radiator-puncture', frames }, (e) => events.push(e), { client })
    const types = events.map((e) => e.type)
    const idx = (pred: (e: AgentEvent) => boolean) => events.findIndex(pred)

    // Order: run_start → preload search call (round 0, server) → plan → executor calls → answer deltas → answer → done.
    expect(types[0]).toBe('run_start')
    const pre = idx((e) => e.type === 'tool_call' && e.round === 0)
    expect(events[pre]).toMatchObject({ name: 'search_precedents', model: 'server' })
    expect(pre).toBeLessThan(idx((e) => e.type === 'plan'))
    expect(idx((e) => e.type === 'plan')).toBeLessThan(idx((e) => e.type === 'tool_call' && e.round === 1))
    expect(idx((e) => e.type === 'answer_delta')).toBeGreaterThan(idx((e) => e.type === 'decision'))
    expect(types.at(-2)).toBe('answer')
    expect(types.at(-1)).toBe('done')
    expect(idx((e) => e.type === 'thinking' && e.label === 'plan')).toBeGreaterThan(0)

    // Segment-before-grasp guardrail: no decide call for the early REPAIR.
    const guard = events.find((e) => e.type === 'tool_result' && e.summary.includes('segment first'))
    expect(guard).toBeDefined()
    expect(decideCalls.map((d) => `${d.action}:${d.params.grasp?.[0] ?? ''}`)).toEqual(['MIGRATE_WORKLOADS:', 'REPAIR_FRU:SEG-1', 'REPAIR_FRU:SEG-2'])
    expect(decideCalls[0].action).toBe('MIGRATE_WORKLOADS') // migrated before the repair

    // Side-channel events carry the originating call id.
    const segEvents = events.filter((e): e is Extract<AgentEvent, { type: 'segments' }> => e.type === 'segments')
    expect(segEvents.map((e) => e.segments.map((s) => s.id))).toEqual([['SEG-1'], ['SEG-2']])
    expect(segEvents[0].segments[0]).toMatchObject({ point: [14, 0, 0], feature: { id: 'grapple', distance: 0.05 }, maskPath: expect.stringContaining('M100') })
    for (const e of events) {
      if (e.type === 'segments' || e.type === 'decision' || e.type === 'vision') {
        expect(events.some((c) => c.type === 'tool_call' && c.callId === e.callId)).toBe(true)
      }
    }
    // Refusal → notice + re-plan, then the adjusted proposal is accepted and the action phase ends.
    const decisions = events.filter((e): e is Extract<AgentEvent, { type: 'decision' }> => e.type === 'decision').map((e) => `${e.decision.action}:${e.decision.tier}`)
    expect(decisions).toEqual(['MIGRATE_WORKLOADS:auto', 'REPAIR_FRU:refused', 'REPAIR_FRU:auto'])
    expect(events.filter((e) => e.type === 'plan')).toHaveLength(2)
    expect(chatBodies).toHaveLength(SCRIPT.length)
    expect(chatBodies[0]).toMatchObject({ model: 'muse-spark-1.3', reasoning_effort: 'minimal' })

    // Answer checks.
    const answer = events.find((e): e is Extract<AgentEvent, { type: 'answer' }> => e.type === 'answer')!
    expect(answer.unknownIds).toEqual(['NCR-9999'])
    expect(answer.citations.map((c) => c.id)).toEqual(['TM-M09-GPU', 'TR-1180', 'SEG-2', 'WEB-1'])
    expect(answer.citations.find((c) => c.id === 'WEB-1')?.url).toBe('https://example.org/oru')
    expect(answer.numbers?.unsupported).toEqual([])
    expect(events.filter((e) => e.type === 'answer_delta').map((e) => (e as { text: string }).text).join('')).toBe(ANSWER.join(''))

    // Usage: one per model call, with effort and reasoning tokens; totals add up.
    const usage = events.filter((e): e is Extract<AgentEvent, { type: 'usage' }> => e.type === 'usage').map((e) => e.usage)
    expect(usage.find((u) => u.label === 'plan')).toMatchObject({ role: 'planner', effort: 'high', reasoningTokens: 600 })
    expect(usage.filter((u) => u.role === 'executor')).toHaveLength(SCRIPT.length)
    expect(usage.filter((u) => u.role === 'segmenter')).toHaveLength(2)
    expect(usage.some((u) => u.role === 'search')).toBe(true)
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>
    expect(done.totals.costUsd).toBeCloseTo(usage.reduce((a, u) => a + u.costUsd, 0), 10)
    expect(done.totals.toolCalls).toBe(SCRIPT.length)
  })

  it('retries a prose turn once with more effort, then reports', async () => {
    const { client, chatBodies } = fakeClient([], ['**Diagnosis** nothing gathered.'])
    const events: AgentEvent[] = []
    await runAgent({ scenario: 'radiator-puncture', frames: [] }, (e) => events.push(e), { client, skipSearch: true })
    expect(chatBodies.map((b) => b.reasoning_effort)).toEqual(['minimal', 'low'])
    expect(events.filter((e) => e.type === 'notice').map((e) => (e as { message: string }).message).join(' ')).toMatch(/No camera frames[\s\S]*no tool call/i)
    expect(events.at(-1)?.type).toBe('done')
  })

  it('stops on abort', async () => {
    const { client } = fakeClient(SCRIPT, ANSWER)
    const ac = new AbortController()
    ac.abort()
    await expect(runAgent({ scenario: 'radiator-puncture', frames }, () => {}, { client, signal: ac.signal, skipSearch: true })).rejects.toThrow()
  })
})
