// Runs each scenario headless against the live Meta API and checks the outcome.
// Usage: npx tsx --env-file=.env.local scripts/eval.ts [scenario] [--frames <dir of synth-frames.ts output>]
// Checks: the expected action and tier (SCENARIOS.expected + the DESIGN.md tier), no unknown citation ids,
// SAM 3.1 was called (when frames exist), every WEB citation carries a URL. Prints the cost.
import type { ActionKind, AgentEvent, Outcome, ScenarioId, Tier } from '../src/contracts'
import { SCENARIO_IDS, SCENARIOS } from '../src/sim'
import { runAgent } from '../src/agent/loop'
import { readFileSync } from 'node:fs'
import type { CameraFrame } from '../src/contracts'
import { defaultFrames, resolveFrames } from '../src/agent/frames'

const ACTION: Record<Outcome, ActionKind> = { REPAIR: 'REPAIR_FRU', SWAP: 'SWAP_MODULE', DEORBIT: 'DEORBIT_MODULE' }
/** Tier per docs/DESIGN.md scenarios. */
const TIER: Record<ScenarioId, Tier> = { 'radiator-puncture': 'auto', 'power-bus-short': 'gated', 'thruster-stuck': 'auto' }

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s)
function log(e: AgentEvent) {
  if (e.type === 'plan') console.log('plan:', e.steps.map((s) => s.tool).join(' → '))
  else if (e.type === 'tool_call') console.log(`  call r${e.round} ${e.name} ${short(JSON.stringify(e.args), 160)}`)
  else if (e.type === 'tool_result') console.log(`    → ${short(e.summary)} (${e.ms} ms)`)
  else if (e.type === 'segments') console.log(`  SAM ${e.frame} "${e.concept}": ${e.segments.map((s) => `${s.id}@${s.feature?.id ?? '-'} ${s.feature?.distance ?? ''}m`).join(', ') || 'none'}`)
  else if (e.type === 'vision') console.log(`  VISION ${e.frame}: ${short(e.findings, 200)}`)
  else if (e.type === 'decision') console.log(`  DECISION ${e.decision.action} → ${e.decision.tier}: ${e.decision.reason}`)
  else if (e.type === 'notice') console.log('  notice:', e.message)
  else if (e.type === 'error') console.log('  ERROR:', e.message)
  else if (e.type === 'thinking') console.log(`  thinking (${e.label}): ${short(e.text.replace(/\n/g, ' '), 200)}`)
}

async function main() {
  const args = process.argv.slice(2)
  const framesDir = args.includes('--frames') ? args[args.indexOf('--frames') + 1] : undefined
  const only = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--frames')
  const load = async (id: string) => framesDir ? (JSON.parse(readFileSync(`${framesDir}/${id}.json`, 'utf8')) as CameraFrame[]) : resolveFrames(await defaultFrames(id as never))
  let grand = 0
  let failures = 0
  for (const id of SCENARIO_IDS.filter((s) => !only || s === only)) {
    const s = SCENARIOS[id]
    const frames = await load(id)
    console.log(`\n=== ${id}: ${s.title} (${frames.length} frames)`)
    const events: AgentEvent[] = []
    try {
      await runAgent({ scenario: id, frames }, (e) => { events.push(e); log(e) })
    } catch (e) {
      console.log('RUN FAILED', e)
    }
    const answer = events.find((e): e is Extract<AgentEvent, { type: 'answer' }> => e.type === 'answer')
    const decisions = events.flatMap((e) => (e.type === 'decision' ? [e.decision] : []))
    const final = decisions.filter((d) => d.action === ACTION[s.expected]).at(-1)
    const problems: string[] = []
    if (!final) problems.push(`no ${ACTION[s.expected]} proposed`)
    else if (final.tier !== TIER[id]) problems.push(`${final.action} tier ${final.tier}, expected ${TIER[id]}`)
    if (!answer) problems.push('no answer')
    else {
      console.log('\n' + answer.markdown + '\n')
      console.log('cited:', answer.citations.map((c) => c.id).join(', '))
      console.log('numbers:', answer.numbers?.checked, 'checked; unsupported:', answer.numbers?.unsupported.join(', ') || 'none')
      if (answer.unknownIds.length) problems.push(`unknown ids: ${answer.unknownIds.join(', ')}`)
      const web = answer.citations.filter((c) => c.type === 'web')
      if (web.some((c) => !c.url)) problems.push('WEB citation without url')
      if (!web.length) console.log('  (warning: no WEB citation in the answer)')
    }
    const samCalled = events.some((e) => e.type === 'usage' && e.usage.role === 'segmenter')
    if (frames.length && !samCalled) problems.push('SAM 3.1 was not called')
    if (!frames.length) console.log('  (warning: no frames in public/frames; SAM and vision were not exercised)')
    if (problems.length) { failures++; console.log('PROBLEMS:', problems.join('; ')) } else console.log('checks: ok')
    const done = events.find((e): e is Extract<AgentEvent, { type: 'done' }> => e.type === 'done')
    if (done) {
      grand += done.totals.costUsd
      const byRole = new Map<string, number>()
      for (const e of events) if (e.type === 'usage') byRole.set(e.usage.role, (byRole.get(e.usage.role) ?? 0) + e.usage.costUsd)
      console.log(`totals: ${done.totals.promptTokens}+${done.totals.completionTokens} tok, ${done.totals.toolCalls} tool calls, ${(done.totals.ms / 1000).toFixed(1)} s, $${done.totals.costUsd.toFixed(4)}`,
        `(${[...byRole].map(([r, c]) => `${r} $${c.toFixed(4)}`).join(', ')})`)
    }
  }
  console.log(`\nAll scenarios: $${grand.toFixed(4)}, ${failures} with problems`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
