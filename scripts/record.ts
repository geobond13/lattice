// Records one live run per scenario into public/recordings/<scenario>.json for the "recorded run" replay.
// Format: [{ dt, event }], dt = milliseconds since the previous event (the client replays with this pacing).
// Usage: npx tsx --env-file=.env.local scripts/record.ts [scenario] [--frames <dir of synth-frames.ts output>]
import { mkdirSync, writeFileSync } from 'node:fs'
import type { AgentEvent } from '../src/contracts'
import { SCENARIO_IDS } from '../src/sim'
import { runAgent } from '../src/agent/loop'
import { readFileSync } from 'node:fs'
import type { CameraFrame } from '../src/contracts'
import { defaultFrames, resolveFrames } from '../src/agent/frames'
import type { Recording } from '../src/agent/client'

/** Recordings never embed frame bytes: data URLs are replaced by the frame's public path. */
function slim(e: AgentEvent, frames: { id: string; src: string }[]): AgentEvent {
  const json = JSON.stringify(e)
  if (!json.includes('data:image')) return e
  const path = frames.find((f) => json.includes(`"${f.id}"`))?.src ?? ''
  return JSON.parse(json.replace(/"data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+"/g, JSON.stringify(path))) as AgentEvent
}

async function main() {
  const args = process.argv.slice(2)
  const framesDir = args.includes('--frames') ? args[args.indexOf('--frames') + 1] : undefined
  const only = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--frames')
  const load = async (id: string) => framesDir ? (JSON.parse(readFileSync(`${framesDir}/${id}.json`, 'utf8')) as CameraFrame[]) : resolveFrames(await defaultFrames(id as never))
  mkdirSync('public/recordings', { recursive: true })
  for (const id of SCENARIO_IDS.filter((s) => !only || s === only)) {
    const raw = framesDir ? [] : await defaultFrames(id)
    const frames = await load(id)
    const rec: Recording = []
    const t0 = Date.now()
    let last = t0
    await runAgent({ scenario: id, frames }, (event) => {
      const now = Date.now()
      rec.push({ dt: now - last, event: slim(event, raw) })
      last = now
    })
    const answer = rec.find((r) => r.event.type === 'answer')?.event
    if (answer?.type !== 'answer') { console.error(`${id}: no answer, not saved`); continue }
    writeFileSync(`public/recordings/${id}.json`, JSON.stringify(rec))
    const decisions = rec.flatMap((r) => (r.event.type === 'decision' ? [`${r.event.decision.action}:${r.event.decision.tier}`] : []))
    const done = rec.at(-1)?.event
    console.log(`${id}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${rec.length} events, ${decisions.join(', ') || 'no decision'}, unknown ids ${answer.unknownIds.length}, ` +
      `unsupported numbers ${answer.numbers?.unsupported.join(', ') || 'none'}${done?.type === 'done' ? `, $${done.totals.costUsd.toFixed(4)}` : ''}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
