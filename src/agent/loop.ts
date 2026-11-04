// LATTICE agent loop on the Meta Model API:
//   preload  public precedent web search (server, round 0, in parallel with planning)
//   plan     Muse Spark 1.3, effort high, Responses API with a reasoning summary
//   act      Muse Spark 1.3, effort minimal, Chat Completions tool calling (vision, SAM 3.1, sim policy)
//   answer   Muse Spark 1.3, effort high, streamed Responses API, then citation + number provenance checks
// Every model call emits a usage event (model, effort, reasoning tokens, cost).
import type OpenAI from 'openai'
import type {
  AgentEvent, AgentRequest, Citation, Decision, PlanStep, ScenarioId, Segment, ToolCtx, ToolDef, ToolResult, UsageInfo,
} from '@/contracts'
import { chatUsage, errorMessage, metaClient, MODELS, responsesUsage, retryFiltered, usageInfo } from '@/meta/client'
import { cite, citationType, idsIn, normalizeIds, validateCitations } from './citations'
import { checkNumbers } from './numbers'
import { parsePlan, planProgress } from './plan'
import { answerSystem, briefing, eventLog, executorSystem, plannerSystem, PRECEDENT_QUERIES, wakeEvent } from './prompts'
import { createTools, GRASP_ACTIONS, searchPrecedents, type ToolState } from './tools'

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam
type Emit = (e: AgentEvent) => void

export const CAPS = {
  maxRounds: 12,
  /** Prompt + completion tokens across every call in a run. */
  maxTokensPerRun: 400_000,
  toolResultChars: 8_000,
  /** Proposals of one action kind (the first, plus one adjusted retry after a refusal). */
  proposalsPerKind: 2,
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

const LATEX: [RegExp, string][] = [
  [/\\\(|\\\)|\\\[|\\\]/g, ''], [/\\times/g, '×'], [/\\approx/g, '≈'], [/\\leq?(?![a-z])/g, '≤'], [/\\geq?(?![a-z])/g, '≥'],
  [/\^\{?\\circ\}?/g, '°'], [/\\(?:text|mathrm)\{([^}]*)\}/g, '$1'], [/\\%/g, '%'], [/\\,/g, ' '], [/\\to(?![a-z])/g, '→'],
]
/** Strip typesetting and stray markers; name tools as sources; normalise ids. */
export function cleanAnswer(s: string, tools: string[] = []): string {
  let out = LATEX.reduce((t, [re, to]) => t.replace(re, to), normalizeIds(s))
  out = out.replace(/\$([^$\n]{1,80})\$/g, '$1').replace(/【[^】]*】/g, '').replace(/\[\^?\d+\]/g, '')
  out = out.replace(/\b(web|cam|seg)-(\d{1,3})\b/gi, (_m, p: string, n: string) => `${p.toUpperCase()}-${n}`)
  for (const t of tools) out = out.replace(new RegExp(`\\s?\\[${t}[^\\]]*\\]`, 'g'), '')
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

interface ToolLog { name: string; args: Record<string, unknown>; data: unknown }

export interface RunOptions {
  signal?: AbortSignal
  /** Inject a client (tests). Defaults to the Meta client. */
  client?: OpenAI
  /** Skip the precedent web search (tests, offline). */
  skipSearch?: boolean
}

/** Run one agent pass for a scenario (autonomous wake-up, or an operator question) and stream events. */
export async function runAgent(req: AgentRequest, emit: Emit, opts: RunOptions = {}): Promise<void> {
  const ai = opts.client ?? metaClient()
  const { signal } = opts
  const scenario: ScenarioId = req.scenario
  const question = req.question?.trim() || undefined
  const t0 = Date.now()
  const totals = { promptTokens: 0, completionTokens: 0, costUsd: 0, toolCalls: 0 }

  // Every event goes through here: usage events are totalled wherever they come from (tools emit their own).
  const out: Emit = (e) => {
    if (e.type === 'usage') {
      totals.promptTokens += e.usage.promptTokens
      totals.completionTokens += e.usage.completionTokens
      totals.costUsd += e.usage.costUsd
    }
    emit(e)
  }
  const filtered = (what: string) => (attempt: number, tries: number) =>
    out({ type: 'notice', message: `Meta content filter rejected the ${what} prompt; retrying (${attempt}/${tries}).` })
  const overBudget = () => totals.promptTokens + totals.completionTokens > CAPS.maxTokensPerRun

  const event = wakeEvent(scenario)
  const frames = req.frames ?? []
  const brief = briefing(scenario, event, frames, question)
  const state: ToolState = { executed: [] }
  // Without frames, the camera tools cannot succeed: keep them out of the plan and the executor's choices.
  const tools = createTools(state).filter((t) => frames.length || (t.name !== 'inspect_camera' && t.name !== 'segment'))
  const toolNames = tools.map((t) => t.name)
  const segments: Segment[] = []
  const ctx: ToolCtx = { scenario, t: event.t, frames, segments, emit: out, signal }
  const seen = new Map<string, Citation>()
  const addCitations = (cs: Citation[]) => { for (const c of cs) if (!seen.has(c.id)) seen.set(c.id, c) }
  for (const e of eventLog(scenario, event)) addCitations([cite(e.id, e.summary), cite(e.channel, `${e.channel} (FDIR channel)`)])
  // The briefing lists the frames, so they are citable even if a vision call on one fails.
  addCitations(frames.map((f) => ({ type: 'camera' as const, id: f.id, label: f.label })))
  const toolLog: ToolLog[] = []
  const decisions: Decision[] = []

  out({
    type: 'run_start', runId: crypto.randomUUID(), scenario, event,
    models: Object.fromEntries((['planner', 'executor', 'vision', 'segmenter', 'search', 'answer'] as const).map((r) => [r, MODELS[r]])),
  })
  if (!frames.length) out({ type: 'notice', message: 'No camera frames for this run: inspection and SAM targeting are unavailable.' })

  /** Run one tool with a per-call ctx whose side-channel events carry the call id. */
  const runTool = async (tool: ToolDef, args: Record<string, unknown>, callId: string): Promise<ToolResult> => {
    const callCtx: ToolCtx = {
      ...ctx,
      emit: (e) => out(e.type === 'vision' || e.type === 'segments' || e.type === 'decision' ? { ...e, callId } : e),
    }
    try {
      return await tool.run(args, callCtx)
    } catch (e) {
      if (signal?.aborted) throw e
      return { data: { error: errorMessage(e) }, citations: [], summary: `error: ${errorMessage(e)}` }
    }
  }
  const record = (name: string, args: Record<string, unknown>, res: ToolResult) => {
    addCitations(res.citations)
    // Ids a result mentions (a record body naming NCR-0412) are grounded too.
    for (const id of idsIn(res.data)) {
      const type = citationType(id)
      if (!seen.has(id) && (type === 'record' || type === 'telemetry' || type === 'event')) seen.set(id, cite(id, `mentioned by ${name}`))
    }
    toolLog.push({ name, args, data: res.data })
  }

  // 0. Precedent search runs on the server while the planner thinks; its sources reach only the answer step.
  const search = (async () => {
    if (opts.skipSearch || question) return
    const args = { query: PRECEDENT_QUERIES[scenario] }
    const callId = 'preload-search'
    out({ type: 'tool_call', callId, name: searchPrecedents.name, args, model: 'server', round: 0 })
    const started = Date.now()
    const res = await runTool(searchPrecedents, args, callId)
    record(searchPrecedents.name, args, res)
    out({ type: 'tool_result', callId, name: searchPrecedents.name, summary: res.summary, citations: res.citations, ms: Date.now() - started })
  })()
  search.catch(() => { /* handled where it is awaited; avoids an unhandled rejection if planning throws first */ })

  // 1. Plan.
  let plan: PlanStep[]
  {
    const started = Date.now()
    const res = (await retryFiltered(() => ai.responses.create({
      model: MODELS.planner.model,
      reasoning: { effort: MODELS.planner.effort ?? 'high', summary: 'detailed' },
      max_output_tokens: 16_000,
      // One user message: verified live, a system message plus the frame list tripped the content filter 3/3, this shape 0/3.
      input: [{ role: 'user', content: `${plannerSystem(tools, question)}

---
${brief}` }],
    }, { signal }), filtered('planner'))) as OpenAI.Responses.Response
    out({ type: 'usage', usage: usageInfo('plan', 'planner', responsesUsage(res.usage), Date.now() - started) })
    const thought = reasoningSummary(res)
    if (thought) out({ type: 'thinking', label: 'plan', model: MODELS.planner.model, effort: MODELS.planner.effort, text: clip(thought, 1500) })
    const fallback: PlanStep[] = question
      ? [{ goal: 'Check the affected module status', tool: 'get_lattice_status' }]
      : [
        { goal: 'Read the FDIR channel trend', tool: 'get_telemetry' },
        { goal: "Read the module's as-built records", tool: 'get_module_record' },
        { goal: 'Inspect the damage', tool: 'inspect_camera' },
        { goal: 'Find the grapple fixture', tool: 'segment' },
        { goal: 'Propose the corrective action', tool: 'propose_action' },
      ]
    plan = parsePlan(res.output_text ?? '', toolNames, { fallback, max: question ? 4 : 8 })
    out({ type: 'plan', steps: plan })
  }

  // 2. Act.
  const specs: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
    type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
  // No system role: verified live, system + briefing-with-frames tripped the content filter; one user message did not.
  // The leading user message carries the rules, the plan status and the briefing, rebuilt every round.
  const messages: Msg[] = [{ role: 'user', content: '' }]
  const cache = new Map<string, string>()
  const called: string[] = []
  const proposals = new Map<string, number>()
  let finished = false
  let extended = false
  for (let round = 1; round <= CAPS.maxRounds && !finished; round++) {
    if (signal?.aborted) throw new Error('aborted')
    let done = planProgress(plan, called)
    if (done.every(Boolean)) {
      // A wake-up must end in a corrective action. If the plan ran out first (e.g. a step went to a second
      // record read), extend it once rather than report without acting.
      const acted = decisions.some((d) => d.tier !== 'refused' && GRASP_ACTIONS.includes(d.action))
      if (question || acted || extended || !frames.length) break
      extended = true
      plan = [...plan, { goal: 'Propose the corrective action (REPAIR_FRU, SWAP_MODULE or DEORBIT_MODULE) with the grapple SEG id in params.grasp', tool: 'propose_action' }]
      out({ type: 'notice', message: 'Plan complete without a corrective action; adding a proposal step.' })
      out({ type: 'plan', steps: plan })
      done = planProgress(plan, called)
    }
    if (overBudget()) { out({ type: 'notice', message: 'Token budget reached; reporting with the evidence gathered so far.' }); break }
    messages[0] = { role: 'user', content: `${executorSystem(plan, done)}

---
${brief}` }

    let msg = await retryFiltered(() => route(ai, messages, specs, round, 'minimal', out, signal), filtered('executor'))
    if (!msg?.tool_calls?.length) {
      // tool_choice must be "auto" on this API, so a turn can come back as prose: nudge once with more reasoning.
      const next = plan[done.indexOf(false)]
      out({ type: 'notice', message: `Executor returned no tool call; retrying step ${done.indexOf(false) + 1} (${next?.tool}) with more reasoning.` })
      msg = await retryFiltered(() => route(ai, [...messages, { role: 'user', content: `Call ${next?.tool} now for: ${next?.goal}` }], specs, round, 'low', out, signal), filtered('executor'))
    }
    const calls = (msg?.tool_calls ?? []).filter((c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === 'function')
    if (!calls.length) { out({ type: 'notice', message: 'No tool call after retry; moving to the report.' }); break }
    messages.push({ role: 'assistant', content: msg?.content ?? '', tool_calls: calls })

    for (const call of calls) {
      const name = call.function.name
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch { /* tool reports missing args */ }
      out({ type: 'tool_call', callId: call.id, name, args, model: MODELS.executor.model, effort: MODELS.executor.effort, round })
      const started = Date.now()
      const reply = (content: string, summary: string, citations: Citation[] = []) => {
        messages.push({ role: 'tool', tool_call_id: call.id, content })
        out({ type: 'tool_result', callId: call.id, name, summary, citations, ms: Date.now() - started })
      }
      const key = `${name}:${call.function.arguments}`
      if (cache.has(key)) { reply(cache.get(key)!, 'repeat call: reused the earlier result'); continue }
      const tool = tools.find((t) => t.name === name)
      if (!tool) { reply(JSON.stringify({ error: `unknown tool ${name}` }), `guardrail: unknown tool ${name}`); continue }

      // Guardrail: one adjusted retry per action kind after a refusal, and never re-propose an accepted action.
      if (name === 'propose_action') {
        const kind = String(args.kind ?? '').toUpperCase()
        const prior = decisions.filter((d) => d.action === kind)
        if (prior.some((d) => d.tier !== 'refused')) { reply(JSON.stringify({ error: `${kind} was already accepted (${prior.find((d) => d.tier !== 'refused')!.tier}); do not propose it again` }), `guardrail: ${kind} already accepted`); continue }
        if ((proposals.get(kind) ?? 0) >= CAPS.proposalsPerKind) { reply(JSON.stringify({ error: `${kind} was refused ${CAPS.proposalsPerKind} times; stop and report to the operator` }), `guardrail: ${kind} retry limit`); continue }
      }

      const res = await runTool(tool, args, call.id)
      totals.toolCalls++
      record(name, args, res)
      const failed = typeof res.data === 'object' && res.data !== null && 'error' in res.data
      if (!failed) called.push(name)
      if (res.decision) {
        const d = res.decision
        decisions.push(d)
        proposals.set(d.action, (proposals.get(d.action) ?? 0) + 1)
        if (d.tier === 'refused' && (proposals.get(d.action) ?? 0) < CAPS.proposalsPerKind) {
          // Re-plan the tail: fix the cause, then propose once more.
          const fixGrasp = d.checks.some((c) => !c.pass && ['grasp', 'reach', 'damage-keepout'].includes(c.id))
          const failedChecks = d.checks.filter((c) => !c.pass).map((c) => c.id).join(', ') || 'policy'
          const extra: PlanStep[] = [
            ...(fixGrasp ? [{ goal: `Re-segment a grasp point away from the damage (refused by ${failedChecks})`, tool: 'segment' }] : []),
            { goal: `Re-propose ${d.action} after fixing ${failedChecks}`, tool: 'propose_action' },
          ]
          const doneNow = planProgress(plan, called)
          const at = doneNow.indexOf(false) === -1 ? plan.length : doneNow.indexOf(false)
          plan = [...plan.slice(0, at), ...extra, ...plan.slice(at)]
          out({ type: 'notice', message: `Policy refused ${d.action} (${failedChecks}); adjusting and trying once more.` })
          out({ type: 'plan', steps: plan })
        }
        // A terminal action the policy accepted ends the action phase.
        if (d.tier !== 'refused' && GRASP_ACTIONS.includes(d.action)) finished = true
      }
      const content = clip(JSON.stringify(res.data), CAPS.toolResultChars)
      cache.set(key, content)
      reply(content, res.summary, res.citations)
    }
  }

  await search.catch((e) => {
    if (signal?.aborted) throw e
    out({ type: 'notice', message: `Precedent search unavailable: ${errorMessage(e)}` })
  })

  // 3. Answer (streamed).
  const started = Date.now()
  const stream = await retryFiltered(() => ai.responses.create({
    model: MODELS.answer.model,
    reasoning: { effort: MODELS.answer.effort ?? 'high', summary: 'detailed' },
    max_output_tokens: 16_000,
    stream: true,
    input: [{ role: 'user', content: `${answerSystem(question)}

---
${answerInput(brief, toolLog, decisions)}` }],
  }, { signal }), filtered('answer'))
  let raw = ''
  let thought = ''
  let usage: OpenAI.Responses.ResponseUsage | undefined
  for await (const ev of stream) {
    if (ev.type === 'response.output_text.delta') {
      raw += ev.delta
      out({ type: 'answer_delta', text: ev.delta })
    } else if (ev.type === 'response.reasoning_summary_text.delta') {
      thought += ev.delta
    } else if (ev.type === 'response.reasoning_summary_text.done') {
      thought += '\n'
    } else if (ev.type === 'response.completed' || ev.type === 'response.incomplete') {
      usage = ev.response.usage ?? undefined
      if (!thought) thought = reasoningSummary(ev.response)
    } else if (ev.type === 'response.failed') {
      throw new Error(`answer failed: ${ev.response.error?.message ?? 'unknown'}`)
    }
  }
  out({ type: 'usage', usage: usageInfo('answer', 'answer', responsesUsage(usage), Date.now() - started) })
  if (thought.trim()) out({ type: 'thinking', label: 'answer', model: MODELS.answer.model, effort: MODELS.answer.effort, text: clip(thought.trim(), 1500) })

  const markdown = cleanAnswer(raw, [...toolNames, searchPrecedents.name])
  const { cited, unknownIds } = validateCitations(markdown, seen)
  const numbers = checkNumbers(markdown, [brief, ...toolLog.map((l) => l.data), decisions])
  out({ type: 'answer', markdown, citations: cited, unknownIds, numbers })
  out({ type: 'done', totals: { ...totals, ms: Date.now() - t0 } })
}

async function route(
  ai: OpenAI, messages: Msg[], tools: OpenAI.Chat.Completions.ChatCompletionTool[], round: number,
  effort: 'minimal' | 'low', emit: Emit, signal?: AbortSignal,
) {
  const started = Date.now()
  const res = await ai.chat.completions.create({
    model: MODELS.executor.model, reasoning_effort: effort, max_tokens: 4000, tools, messages, parallel_tool_calls: false,
  }, { signal })
  const u: UsageInfo = { ...usageInfo(`route ${round}${effort !== 'minimal' ? ' (retry)' : ''}`, 'executor', chatUsage(res.usage), Date.now() - started), effort }
  emit({ type: 'usage', usage: u })
  return res.choices[0]?.message
}

/** The reasoning summary text of a Responses result (Muse Spark keeps raw reasoning private). */
export function reasoningSummary(res: { output?: unknown[] } | undefined): string {
  return (res?.output ?? [])
    .flatMap((o) => {
      const r = o as { type?: string; summary?: { text?: string }[] }
      return r.type === 'reasoning' ? (r.summary ?? []).map((s) => s.text ?? '') : []
    })
    .filter(Boolean)
    .join('\n')
}

function answerInput(brief: string, log: ToolLog[], decisions: Decision[]): string {
  const results = log.map((l, i) => `### ${i + 1}. ${l.name} ${JSON.stringify(l.args)}\n${clip(JSON.stringify(l.data), CAPS.toolResultChars)}`).join('\n\n')
  const decided = decisions.map((d) => `- ${d.action} ${JSON.stringify(d.params)}: ${d.tier}. ${d.reason} Deadline ${d.deadline === null ? 'none' : `t=${d.deadline} s`}, next contact ${d.nextContact === null ? 'none' : `t=${d.nextContact} s`}.${d.tier === 'refused' ? ` Failed: ${d.checks.filter((c) => !c.pass).map((c) => `${c.id} (${c.detail})`).join('; ')}` : ''}`)
  return [
    `Briefing:\n${brief}`,
    '',
    `Policy decisions, in order:\n${decided.join('\n') || '- none'}`,
    '',
    `Tool results:\n${results || '(no tools were called)'}`,
  ].join('\n')
}
