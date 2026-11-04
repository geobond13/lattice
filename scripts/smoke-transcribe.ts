// Live: Muse Voice Transcribe on a WAV file; prints the raw JSON body. Usage: npx tsx --env-file=.env.local scripts/smoke-transcribe.ts <file.wav>
import { readFileSync } from 'node:fs'
import { transcribe } from '../src/meta/transcribe'
async function main() {
  const wav = readFileSync(process.argv[2])
  const form = new FormData()
  form.append('request', new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], { type: 'application/json' }))
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'clip.wav')
  const res = await fetch('https://api.meta.ai/v1/asr/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, Accept: 'application/json' }, body: form })
  console.log('raw', res.status, await res.text())
  console.log('wrapper (with keywords):', await transcribe(new Blob([wav])))
}
main().catch((e) => { console.error('FAILED', e?.message); process.exit(1) })
