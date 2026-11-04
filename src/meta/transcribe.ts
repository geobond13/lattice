// Muse Voice Transcribe: one push-to-talk WAV clip → text. POST /v1/asr/transcribe, multipart (request JSON + audio).
import type { UsageInfo } from '@/contracts'
import { META_BASE_URL, MODELS, PRICE, usageInfo } from './client'

/** Ops vocabulary biased into recognition (ids and verbs the operator says). */
export const OPS_KEYWORDS = [
  'approve', 'reject', 'abort', 'hold', 'LATTICE', 'servicer', 'grapple', 'radiator', 'keep-out', 'corridor', 'deorbit', 'swap',
  'M-04', 'M-09', 'M-11', 'S-1', 'S-2', 'FRU', 'NCR', 'PDU',
]

export interface TranscribeResult { text: string; audioMs?: number; sessionId?: string; usage: UsageInfo }

/** Read the transcript out of the JSON body (documented: { sessionId, transcript, audioDurationMs, turns[] }). */
export function transcriptOf(body: unknown): { text: string; audioMs?: number; sessionId?: string } {
  const b = (body ?? {}) as { transcript?: unknown; text?: unknown; audioDurationMs?: unknown; sessionId?: unknown; turns?: { transcript?: unknown }[] }
  let text = typeof b.transcript === 'string' ? b.transcript : typeof b.text === 'string' ? b.text : ''
  if (!text && Array.isArray(b.turns)) text = b.turns.map((t) => (typeof t.transcript === 'string' ? t.transcript : '')).join(' ')
  return {
    text: text.trim(),
    ...(typeof b.audioDurationMs === 'number' ? { audioMs: b.audioDurationMs } : {}),
    ...(typeof b.sessionId === 'string' ? { sessionId: b.sessionId } : {}),
  }
}

/** Transcribe mono 16-bit PCM WAV (16 or 24 kHz). */
export async function transcribe(wav: Blob, opts: { signal?: AbortSignal; keywords?: string[] } = {}): Promise<TranscribeResult> {
  const apiKey = process.env.MODEL_API_KEY
  if (!apiKey) throw new Error('MODEL_API_KEY is not set')
  const started = Date.now()
  const form = new FormData()
  const request = { model: MODELS.transcribe.model, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', keywords: opts.keywords ?? OPS_KEYWORDS }
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }))
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'clip.wav')
  const res = await fetch(`${META_BASE_URL}/asr/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    body: form,
    signal: opts.signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`transcribe failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  const parsed = transcriptOf(await res.json())
  const seconds = Math.floor((parsed.audioMs ?? 0) / 1000)
  return { ...parsed, usage: usageInfo('transcribe', 'transcribe', { promptTokens: 0, completionTokens: 0 }, Date.now() - started, seconds * PRICE.transcribeSecond) }
}

/** RIFF/WAVE, PCM, mono, 16-bit, 16 or 24 kHz. */
export function wavProblem(b: Uint8Array): string | undefined {
  if (b.length < 44) return 'audio too short'
  const ascii = (o: number) => String.fromCharCode(...b.slice(o, o + 4))
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') return 'not a WAV file'
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let o = 12
  while (o + 8 <= b.length) {
    const id = ascii(o)
    const size = v.getUint32(o + 4, true)
    if (id === 'fmt ') {
      const format = v.getUint16(o + 8, true)
      const channels = v.getUint16(o + 10, true)
      const rate = v.getUint32(o + 12, true)
      const bits = v.getUint16(o + 22, true)
      if (format !== 1 || channels !== 1 || bits !== 16 || (rate !== 16000 && rate !== 24000)) return 'WAV must be PCM mono 16-bit at 16 or 24 kHz'
      return undefined
    }
    o += 8 + size + (size % 2)
  }
  return 'WAV has no fmt chunk'
}
