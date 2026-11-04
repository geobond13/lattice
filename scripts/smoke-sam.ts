// Live check: SAM 3.1 streaming segmentation + our parser and one_bit decoder, and Muse Spark vision on the same image.
// Usage: npx tsx --env-file=.env.local scripts/smoke-sam.ts <image.jpg> ["concept"] [--raw out.txt]
import { readFileSync, writeFileSync } from 'node:fs'
import OpenAI from 'openai'
import { decodeOneBitMask, parseSamText } from '../src/meta/sam'
import { segment } from '../src/meta/sam'
import { describeFrame } from '../src/meta/vision'

async function main() {
  const [file, concept = 'grapple fixture'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const rawOut = process.argv.includes('--raw') ? process.argv[process.argv.indexOf('--raw') + 1] : undefined
  const url = `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`
  // 1. Raw event stream, to see the wire shape.
  const ai = new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey: process.env.MODEL_API_KEY })
  const t = Date.now()
  const stream = await ai.responses.create({
    model: 'sam-3.1', stream: true,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: concept }, { type: 'input_image', image_url: url, detail: 'auto' }] }],
    metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
  })
  const types: Record<string, number> = {}
  let text = ''
  let completed: unknown
  for await (const ev of stream) {
    types[ev.type] = (types[ev.type] ?? 0) + 1
    if (ev.type === 'response.output_text.delta') text += ev.delta
    if (ev.type === 'response.completed') completed = { usage: ev.response.usage, status: ev.response.status }
  }
  console.log('sam ms', Date.now() - t, types, JSON.stringify(completed))
  console.log('raw (first 600):', text.slice(0, 600))
  if (rawOut) writeFileSync(rawOut, text)
  for (const m of parseSamText(text)) {
    let ones = -1
    if (m.mask?.encoding === 'one_bit') ones = decodeOneBitMask(m.mask.payload, m.mask.width, m.mask.height).reduce((a, b) => a + b, 0)
    console.log('match', m.objectId, m.box, m.frameW, m.frameH, m.confidence, m.mask && `${m.mask.height}x${m.mask.width} ${m.mask.encoding}`, 'filled', ones)
  }
  // 2. Our wrapper end to end.
  const res = await segment(url, concept)
  console.log('wrapper:', res.matches.map((m) => ({ box: m.box, c: m.confidence, path: m.maskPath?.slice(0, 80), pathLen: m.maskPath?.length })), res.usage)
  // 3. Vision.
  const v = await describeFrame({ id: 'CAM-1', label: 'test frame', src: url, width: 960, height: 540, camera: { position: [0, 0, 0], target: [0, 0, 1], up: [0, 1, 0], fovDeg: 50 }, module: 'M-09' }, 'Is there damage, and is the grapple fixture clear?')
  console.log('vision:', v.findings, v.usage)
}
main().catch((e) => { console.error('FAILED', e?.status, e?.message, e?.error); process.exit(1) })
