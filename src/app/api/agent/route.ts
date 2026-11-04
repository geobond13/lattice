// POST /api/agent: AgentRequest → NDJSON stream of AgentEvent (one JSON object per line).
import type { AgentEvent, ScenarioId } from '@/contracts'
import { runAgent } from '@/agent/loop'
import { defaultFrames, resolveFrames, validateFrames } from '@/agent/frames'
import { hasMetaKey } from '@/meta/client'

export const maxDuration = 300

const SCENARIOS: ScenarioId[] = ['radiator-puncture', 'power-bus-short', 'thruster-stuck']
const RUNS_PER_IP_PER_HOUR = Number(process.env.AGENT_RUNS_PER_HOUR ?? 12)

// Best-effort per-instance limiter: enough to stop a public demo being drained.
const hits = new Map<string, number[]>()
function limited(ip: string): boolean {
  const hourAgo = Date.now() - 3_600_000
  const recent = (hits.get(ip) ?? []).filter((t) => t > hourAgo)
  if (recent.length >= RUNS_PER_IP_PER_HOUR) { hits.set(ip, recent); return true }
  hits.set(ip, [...recent, Date.now()])
  return false
}

const NDJSON = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' }
/** A one-event stream: the client hook reads errors the same way as a live run. */
const errorStream = (message: string, status: number) => new Response(JSON.stringify({ type: 'error', message } satisfies AgentEvent) + '\n', { status, headers: NDJSON })

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { scenario?: unknown; frames?: unknown; question?: unknown } | null
  if (!body || typeof body.scenario !== 'string' || !SCENARIOS.includes(body.scenario as ScenarioId)) return errorStream('unknown scenario', 400)
  const scenario = body.scenario as ScenarioId
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 500) : undefined
  const checked = validateFrames(body.frames)
  if ('error' in checked) return errorStream(checked.error, 400)
  if (!hasMetaKey()) return errorStream('Live agent unavailable: MODEL_API_KEY is not set on the server. Use the recorded run.', 503)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
  if (limited(ip)) return errorStream(`Demo limit: ${RUNS_PER_IP_PER_HOUR} live runs per hour. Use the recorded run.`, 429)

  const frames = await resolveFrames(checked.frames.length ? checked.frames : await defaultFrames(scenario))
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + '\n')) } catch { /* client gone */ }
      }
      const started = Date.now()
      try {
        await runAgent({ scenario, frames, ...(question ? { question } : {}) }, (e) => {
          if (e.type === 'done') console.log(JSON.stringify({ event: 'agent_run', scenario, question: question?.slice(0, 80), ...e.totals, wallMs: Date.now() - started }))
          emit(e)
        }, { signal: req.signal })
      } catch (err) {
        if (!req.signal.aborted) {
          console.error('agent run failed', err)
          emit({ type: 'error', message: err instanceof Error ? err.message.slice(0, 300) : 'Agent run failed' })
        }
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })
  return new Response(stream, { headers: NDJSON })
}
