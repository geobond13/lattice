// Probe Muse Spark vision on the pre-captured frames: which prompt shapes pass the content filter.
import { readFileSync } from 'node:fs'
import OpenAI from 'openai'
const client = new OpenAI({ baseURL: 'https://api.meta.ai/v1', apiKey: process.env.MODEL_API_KEY })
const img = (p: string) => `data:image/jpeg;base64,${readFileSync(p).toString('base64')}`
const variants: Record<string, (u: string) => OpenAI.Chat.ChatCompletionMessageParam[]> = {
  plain: (u) => [{ role: 'user', content: [{ type: 'text', text: 'Describe this rendered 3D image of a satellite module in two sentences.' }, { type: 'image_url', image_url: { url: u } }] }],
  inspector: (u) => [{ role: 'user', content: [{ type: 'text', text: 'This is a frame from a 3D simulation of a satellite servicing robot. In 2–3 sentences, note any visible surface marks or anomalies on the box-shaped module and where they are relative to the round target fixture on its face.' }, { type: 'image_url', image_url: { url: u } }] }],
}
async function main() {
for (const sc of process.argv.slice(2).length ? process.argv.slice(2) : ['radiator-puncture', 'power-bus-short', 'thruster-stuck'])
  for (const cam of ['CAM-1', 'CAM-2', 'CAM-3'])
    for (const [name, v] of Object.entries(variants)) {
      try {
        const r = await client.chat.completions.create({ model: 'muse-spark-1.3', reasoning_effort: 'low' as never, max_tokens: 2000, messages: v(img(`public/frames/${sc}/${cam}.jpg`)) })
        console.log(sc, cam, name, 'OK', (r.choices[0].message.content ?? '').slice(0, 110).replace(/\n/g, ' '))
      } catch (e) { console.log(sc, cam, name, 'FAIL', String((e as Error).message).slice(0, 60)) }
    }
}
void main()
