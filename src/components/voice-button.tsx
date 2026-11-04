'use client'
// Push-to-talk: hold to record, release to transcribe with Muse Voice Transcribe (via /api/transcribe).
// Audio is captured with getUserMedia + MediaRecorder, decoded, resampled to 16 kHz mono with an OfflineAudioContext,
// and sent as 16-bit PCM WAV.
import { useCallback, useEffect, useRef, useState } from 'react'

type State = 'idle' | 'recording' | 'transcribing' | 'error'

export interface VoiceButtonProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  className?: string
  /** Accessible label and tooltip. */
  label?: string
  /** Recording stops itself after this many seconds. */
  maxSeconds?: number
}

const RATE = 16_000

/** Encode mono float samples (-1..1) as a 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, rate = RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** Decode any recorded blob and resample to 16 kHz mono. */
async function toWav16k(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const length = Math.max(1, Math.ceil(decoded.duration * RATE))
    const offline = new OfflineAudioContext(1, length, RATE)
    const src = offline.createBufferSource()
    src.buffer = decoded // a mono destination downmixes the channels
    src.connect(offline.destination)
    src.start()
    const rendered = await offline.startRendering()
    return encodeWav(rendered.getChannelData(0))
  } finally {
    void ctx.close()
  }
}

export function VoiceButton({ onTranscript, disabled, className, label = 'Hold to talk', maxSeconds = 20 }: VoiceButtonProps) {
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAt = useRef(0)

  const release = () => {
    recorder.current?.stream.getTracks().forEach((t) => t.stop())
    recorder.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => release, [])

  const send = useCallback(async (blob: Blob) => {
    setState('transcribing')
    try {
      const wav = await toWav16k(blob)
      const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav })
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? `Transcription failed (${res.status})`)
      setState('idle')
      if (body.text?.trim()) onTranscript(body.text.trim())
      else { setError('Heard nothing'); setState('error') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed')
      setState('error')
    }
  }, [onTranscript])

  const begin = useCallback(async () => {
    if (disabled || state === 'recording' || state === 'transcribing') return
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const rec = new MediaRecorder(stream)
      chunks.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: rec.mimeType })
        release()
        if (Date.now() - startedAt.current < 300 || !blob.size) { setState('idle'); return }
        void send(blob)
      }
      recorder.current = rec
      startedAt.current = Date.now()
      rec.start()
      setState('recording')
      timer.current = setTimeout(() => { if (rec.state === 'recording') rec.stop() }, maxSeconds * 1000)
    } catch (e) {
      release()
      setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Microphone blocked' : 'Microphone unavailable')
      setState('error')
    }
  }, [disabled, maxSeconds, send, state])

  const end = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  const recording = state === 'recording'
  const busy = state === 'transcribing'
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || busy}
      aria-label={label}
      aria-pressed={recording}
      title={error || label}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); void begin() }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); void begin() } }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); end() } }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999,
        border: `1px solid ${recording ? 'var(--accent)' : 'var(--line)'}`,
        background: recording ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
        color: state === 'error' ? '#ff5d5d' : recording ? 'var(--accent)' : 'var(--ink)',
        font: 'inherit', fontSize: 13, cursor: disabled || busy ? 'default' : 'pointer', userSelect: 'none', touchAction: 'none',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      <span>{recording ? 'Listening… release to send' : busy ? 'Transcribing…' : state === 'error' ? error : label}</span>
    </button>
  )
}

export default VoiceButton
