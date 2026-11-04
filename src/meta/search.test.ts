import { describe, expect, it } from 'vitest'
import { numberSources, webCitations } from './search'
import { transcriptOf, wavProblem } from './transcribe'
import { tokenCost, usageInfo } from './client'

describe('WEB numbering', () => {
  const results = [
    { title: 'Soyuz leak', url: 'https://gizmodo.com/soyuz-leak', snippet: '' },
    { title: 'P6 radiator', url: 'https://spacetoday.net/Summary/5776', snippet: 'rerouted ammonia' },
    { title: 'Engadget rescue', url: 'https://www.engadget.com/rescue.html', snippet: '' },
    { title: 'Uncited', url: 'https://example.org/x', snippet: '' },
  ]

  it('maps inline URLs to WEB-n in order of first citation, then lists uncited results', () => {
    const text = 'Soyuz MS-22 leaked after a strike (https://gizmodo.com/soyuz-leak). Crews rerouted coolant https://spacetoday.net/Summary/5776. Again (https://gizmodo.com/soyuz-leak/).'
    const { summary, sources } = numberSources(text, [], results)
    expect(summary).toBe('Soyuz MS-22 leaked after a strike [WEB-1]. Crews rerouted coolant [WEB-2]. Again [WEB-1].')
    expect(sources.map((s) => [s.id, s.cited, s.url])).toEqual([
      ['WEB-1', true, 'https://gizmodo.com/soyuz-leak'],
      ['WEB-2', true, 'https://spacetoday.net/Summary/5776'],
      ['WEB-3', false, 'https://www.engadget.com/rescue.html'],
      ['WEB-4', false, 'https://example.org/x'],
    ])
    expect(sources[1].snippet).toBe('rerouted ammonia')
  })

  it('resolves a bare-site URL to the result on that host', () => {
    const { summary, sources } = numberSources('The radiator was hit. https://www.engadget.com', [], results)
    expect(summary).toBe('The radiator was hit. [WEB-1]')
    expect(sources[0].url).toBe('https://www.engadget.com/rescue.html')
  })

  it('inserts markers after url_citation spans and dedupes repeated URLs', () => {
    const text = 'Fact one. Fact two.'
    const ann = [
      { type: 'url_citation', url: 'https://a.example/1', title: 'A', start_index: 0, end_index: 9 },
      { type: 'url_citation', url: 'https://a.example/1', title: 'A', start_index: 10, end_index: 19 },
    ]
    const { summary, sources } = numberSources(text, ann, [])
    expect(summary).toBe('Fact one. [WEB-1] Fact two. [WEB-1]')
    expect(sources).toHaveLength(1)
    expect(webCitations(sources)[0]).toEqual({ type: 'web', id: 'WEB-1', label: 'A', url: 'https://a.example/1' })
  })

  it('caps the source list', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ url: `https://s${i}.example/`, title: `S${i}` }))
    expect(numberSources('x', [], many, 6).sources).toHaveLength(6)
  })
})

describe('transcribe', () => {
  it('reads the verified response shape', () => {
    expect(transcriptOf({ sessionId: 'voyager/transcribe/X', transcript: 'Approve the swap. Bring in spare S1.', audioDurationMs: 4800, turns: [] }))
      .toEqual({ text: 'Approve the swap. Bring in spare S1.', audioMs: 4800, sessionId: 'voyager/transcribe/X' })
    expect(transcriptOf({ turns: [{ transcript: 'a' }, { transcript: 'b' }] }).text).toBe('a b')
    expect(transcriptOf(null).text).toBe('')
  })

  const wav = (rate: number, channels = 1, bits = 16) => {
    const b = new Uint8Array(48)
    const v = new DataView(b.buffer)
    const s = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)))
    s(0, 'RIFF'); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true)
    v.setUint32(24, rate, true); v.setUint16(34, bits, true); s(36, 'data')
    return b
  }
  it('validates WAV headers', () => {
    expect(wavProblem(wav(16000))).toBeUndefined()
    expect(wavProblem(wav(44100))).toMatch(/16 or 24 kHz/)
    expect(wavProblem(wav(16000, 2))).toMatch(/mono/)
    expect(wavProblem(new Uint8Array(10))).toMatch(/short/)
  })
})

describe('cost accounting', () => {
  it('prices tokens at $1.25/M in, $4.25/M out, cached input at $0.15/M', () => {
    expect(tokenCost(1_000_000, 1_000_000)).toBeCloseTo(5.5, 6)
    expect(tokenCost(1_000_000, 0, 1_000_000)).toBeCloseTo(0.15, 6)
    const u = usageInfo('plan', 'planner', { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 1500 }, 10)
    expect(u).toMatchObject({ model: 'muse-spark-1.3', effort: 'high', reasoningTokens: 1500 })
    expect(u.costUsd).toBeCloseTo(0.00125 + 0.0085, 8)
  })
})
