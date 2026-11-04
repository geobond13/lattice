// POST /api/transcribe: a push-to-talk WAV (mono 16-bit PCM, 16 kHz) → { text } via Muse Voice Transcribe.
// Body: raw audio/wav, or multipart with an `audio` part.
import { errorMessage, hasMetaKey } from '@/meta/client'
import { transcribe, wavProblem } from '@/meta/transcribe'

export const maxDuration = 60

const MAX_BYTES = 2_000_000 // ~60 s at 16 kHz mono 16-bit
const hits = new Map<string, number[]>()
function limited(ip: string): boolean {
  const minuteAgo = Date.now() - 60_000
  const recent = (hits.get(ip) ?? []).filter((t) => t > minuteAgo)
  if (recent.length >= 20) { hits.set(ip, recent); return true }
  hits.set(ip, [...recent, Date.now()])
  return false
}

export async function POST(req: Request) {
  if (!hasMetaKey()) return Response.json({ error: 'Voice unavailable: MODEL_API_KEY is not set on the server.' }, { status: 503 })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (limited(ip)) return Response.json({ error: 'Too many voice requests; wait a minute.' }, { status: 429 })
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES + 10_000) return Response.json({ error: 'Clip too long (max ~60 s).' }, { status: 413 })

  let bytes: Uint8Array
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const audio = (await req.formData().catch(() => null))?.get('audio')
    if (!(audio instanceof Blob)) return Response.json({ error: 'missing audio part' }, { status: 400 })
    bytes = new Uint8Array(await audio.arrayBuffer())
  } else {
    bytes = new Uint8Array(await req.arrayBuffer())
  }
  if (bytes.length > MAX_BYTES) return Response.json({ error: 'Clip too long (max ~60 s).' }, { status: 413 })
  const problem = wavProblem(bytes)
  if (problem) return Response.json({ error: problem }, { status: 400 })
  try {
    const res = await transcribe(new Blob([bytes as BlobPart], { type: 'audio/wav' }), { signal: req.signal })
    return Response.json({ text: res.text, audioMs: res.audioMs, costUsd: res.usage.costUsd, ms: res.usage.ms })
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 502 })
  }
}
