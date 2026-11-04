// Live: Responses API web_search → WEB-n sources with URLs. Usage: npx tsx --env-file=.env.local scripts/smoke-search.ts ["query"]
import OpenAI from 'openai'
import { webSearch } from '../src/meta/search'
async function main() {
  const q = process.argv[2] ?? 'micrometeoroid puncture of spacecraft radiator coolant loop leak ISS radiator on-orbit robotic replacement'
  const ai = new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey: process.env.MODEL_API_KEY })
  const raw = await ai.responses.create({ model: 'muse-spark-1.3', input: `${q}. Give the source URL after each sentence.`, max_tool_calls: 2, tools: [{ type: 'web_search', search_context_size: 'low' }], include: ['web_search_call.results'], reasoning: { effort: 'low' } })
  console.log('raw output item types:', raw.output.map((o) => o.type), 'usage', JSON.stringify(raw.usage))
  const call = raw.output.find((o) => o.type === 'web_search_call') as unknown as Record<string, unknown> | undefined
  console.log('web_search_call keys:', call && Object.keys(call), JSON.stringify(call).slice(0, 600))
  const msg = raw.output.find((o) => o.type === 'message')
  if (msg?.type === 'message') for (const b of msg.content) if (b.type === 'output_text') console.log('annotations:', JSON.stringify(b.annotations.slice(0, 2)))
  const r = await webSearch(q)
  console.log('\nsummary:', r.summary)
  console.log('sources:', r.sources.map((s) => `${s.id} ${s.cited ? '*' : ' '} ${s.title} ${s.url}`).join('\n'))
  console.log(r.usage, 'queries', r.queries)
}
main().catch((e) => { console.error('FAILED', e?.status, e?.message); process.exit(1) })
