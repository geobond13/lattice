// Live check: chat completions with tools + reasoning_effort, and the Responses API with a reasoning summary.
// Usage: npx tsx --env-file=.env.local scripts/smoke-chat.ts
import OpenAI from 'openai'

const ai = new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey: process.env.MODEL_API_KEY })

async function main() {
  let t = Date.now()
  const chat = await ai.chat.completions.create({
    model: 'muse-spark-1.3', reasoning_effort: 'minimal', max_tokens: 1000,
    tools: [{ type: 'function', function: { name: 'get_telemetry', description: 'Telemetry for a channel', parameters: { type: 'object', properties: { channel: { type: 'string' } }, required: ['channel'] } } }],
    messages: [{ role: 'system', content: 'Call tools to gather data.' }, { role: 'user', content: 'Check channel TM-M09-GPU.' }],
  })
  console.log('chat ms', Date.now() - t, JSON.stringify({ msg: chat.choices[0].message, finish: chat.choices[0].finish_reason, usage: chat.usage }, null, 1))

  t = Date.now()
  const r = await ai.responses.create({
    model: 'muse-spark-1.3', reasoning: { effort: 'low', summary: 'concise' }, max_output_tokens: 2000,
    instructions: 'Reply with JSON only.', input: 'Plan 2 steps to diagnose a radiator leak: {"steps":[{"goal":"","tool":""}]}',
  })
  console.log('responses ms', Date.now() - t, JSON.stringify({ output: r.output, text: r.output_text, usage: r.usage }, null, 1).slice(0, 3000))

  t = Date.now()
  const s = await ai.responses.create({
    model: 'muse-spark-1.3', reasoning: { effort: 'low', summary: 'concise' }, max_output_tokens: 1000, stream: true, input: 'Say hello in five words.',
  })
  const types = new Map<string, number>()
  let usage: unknown
  for await (const ev of s) {
    types.set(ev.type, (types.get(ev.type) ?? 0) + 1)
    if (ev.type === 'response.completed') usage = ev.response.usage
  }
  console.log('stream ms', Date.now() - t, Object.fromEntries(types), JSON.stringify(usage))
}
main().catch((e) => { console.error('FAILED', e?.status, e?.message); process.exit(1) })
