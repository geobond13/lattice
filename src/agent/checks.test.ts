import { describe, expect, it } from 'vitest'
import { RECORD_ID, validateCitations, citationType, normalizeIds } from './citations'
import { checkNumbers } from './numbers'
import { parseVoiceCommand, parseNdjson, answerText } from './client'
import { parsePlan, planProgress } from './plan'
import { cleanAnswer } from './loop'
import type { Citation } from '@/contracts'

describe('citation ids (DESIGN.md formats)', () => {
  const valid = ['NCR-0412', 'TR-1180', 'FE-0921', 'FRU-RAD-02', 'FRU-PDU-01', 'ICD-GRP-01', 'ICD-DOCK-01', 'OPS-SEP-03', 'OPS-VALVE-07',
    'BLD-M09', 'TM-M09-CLT', 'TM-M11-LATCH', 'TM-M11-RATE', 'TM-LAT-UTL', 'CAM-1', 'CAM-12', 'SEG-3', 'WEB-1', 'WEB-10']
  it.each(valid)('accepts %s', (id) => {
    expect(`see [${id}].`.match(RECORD_ID)).toEqual([id])
  })
  const invalid = ['NCR-41', 'TR-118', 'FRU-RAD-2', 'BLD-09', 'TM-09-GPU', 'CAM-', 'M-09', 'S-1', 'XNCR-0412', 'NCR-04123', 'TM-M09-GPU-X']
  it.each(invalid)('rejects %s', (id) => {
    expect(`see ${id} here`.match(RECORD_ID)).toBeNull()
  })

  it('types ids by prefix', () => {
    expect(['TM-M09-GPU', 'FE-0921', 'NCR-0412', 'CAM-2', 'SEG-1', 'WEB-3'].map(citationType)).toEqual(['telemetry', 'event', 'record', 'camera', 'segment', 'web'])
  })

  it('splits cited and unknown ids, in order, deduplicated, with Unicode hyphens normalised', () => {
    const seen = new Map<string, Citation>([
      ['TM-M09-GPU', { type: 'telemetry', id: 'TM-M09-GPU', label: 'GPU' }],
      ['TR-1180', { type: 'record', id: 'TR-1180', label: 'TVAC' }],
    ])
    const r = validateCitations('GPU climbs [TM‑M09‑GPU] per [TR-1180] and [NCR-9999]; again [TM-M09-GPU].', seen)
    expect(r.cited.map((c) => c.id)).toEqual(['TM-M09-GPU', 'TR-1180'])
    expect(r.unknownIds).toEqual(['NCR-9999'])
    expect(normalizeIds('TR‐1180')).toBe('TR-1180')
  })
})

describe('number provenance', () => {
  const tools = [{ current: 71.4, unit: '°C', projection: { limit: 85, atT: 2040 } }, { body: 'one loop rejected 6.1 kW; module dissipates 7.4 kW at 92 % util; holds at ≤ 74 % util. Swap time 22 min.' }]
  it('accepts values present in tool output, including unit conversions and mission times', () => {
    const r = checkNumbers('GPU at 71.4 °C [TM-M09-GPU] reaches 85 °C at t = 2040 s; one loop rejects 6.1 kW vs 7.4 kW, so ≤ 74 % [TR-1180]. Swap takes 1320 s (22 min).', tools)
    expect(r.unsupported).toEqual([])
    expect(r.checked).toBeGreaterThanOrEqual(7)
  })
  it('flags invented quantities and ignores ids and bare counts', () => {
    const r = checkNumbers('Throttle at 88 °C by t = 1900; M-09 has 4 latches [FRU-RAD-02], TR-1180 says 71 °C.', tools)
    expect(r.unsupported).toEqual(expect.arrayContaining(['88 °C', 't = 1900']))
    expect(r.unsupported).not.toContain('4')
    expect(r.unsupported.some((u) => u.includes('1180') || u.includes('09'))).toBe(false)
  })
  it('respects stated precision', () => {
    expect(checkNumbers('pressure 180 kPa', [{ v: 180.4 }]).unsupported).toEqual([])
    expect(checkNumbers('pressure 182 kPa', [{ v: 180.4 }]).unsupported).toEqual(['182 kPa'])
  })
})

describe('voice commands', () => {
  it.each([
    ['Approve.', 'approve'], ['approve the swap. bring in spare S1.', 'approve'], ['Approved', 'approve'], ['Go ahead', 'approve'],
    ['Yes, proceed with the repair', 'approve'], ['confirm', 'approve'], ['yes', 'approve'],
    ['Reject', 'reject'], ['abort the swap', 'reject'], ["don't approve that", 'reject'], ['No-go.', 'reject'], ['hold', 'reject'], ['no', 'reject'],
  ])('%s → %s', (t, kind) => {
    expect(parseVoiceCommand(t).kind).toBe(kind)
  })
  it.each(['Why not repair the PDU?', 'what is the deadline', 'Should we approve the swap?', 'Tell me about NCR-0412', 'the radiator looks bad'])('%s → question', (t) => {
    expect(parseVoiceCommand(t)).toEqual({ kind: 'question', text: t })
  })
  it('ignores silence', () => {
    expect(parseVoiceCommand('  ... ').kind).toBe('empty')
  })
})

describe('plan', () => {
  const tools = ['get_telemetry', 'get_module_record', 'get_lattice_status', 'inspect_camera', 'segment', 'propose_action']
  it('drops unknown tools and inserts a segment step before the first hardware proposal', () => {
    const plan = parsePlan('Here: {"steps":[{"goal":"trend","tool":"get_telemetry"},{"goal":"x","tool":"fly"},{"goal":"migrate load","tool":"propose_action"},{"goal":"repair radiator","tool":"propose_action"}]}', tools)
    expect(plan.map((s) => s.tool)).toEqual(['get_telemetry', 'propose_action', 'segment', 'propose_action'])
  })
  it('falls back on unparseable output', () => {
    expect(parsePlan('nope', tools, { fallback: [{ goal: 'g', tool: 'get_telemetry' }] })).toEqual([{ goal: 'g', tool: 'get_telemetry' }])
  })
  it('tracks repeated tools', () => {
    const plan = [{ goal: 'a', tool: 'segment' }, { goal: 'b', tool: 'propose_action' }, { goal: 'c', tool: 'propose_action' }]
    expect(planProgress(plan, ['segment', 'propose_action'])).toEqual([true, true, false])
  })
})

describe('client helpers', () => {
  it('parses NDJSON with a partial tail', () => {
    const { events, rest } = parseNdjson('{"type":"notice","message":"a"}\n{"type":"answer_delta","text":"x"}\n{"type":"ans')
    expect(events.map((e) => e.type)).toEqual(['notice', 'answer_delta'])
    expect(rest).toBe('{"type":"ans')
  })
  it('assembles answer text from deltas until the final answer arrives', () => {
    expect(answerText({ events: [{ type: 'answer_delta', text: 'Hel' }, { type: 'answer_delta', text: 'lo' }] })).toBe('Hello')
    expect(answerText({ events: [{ type: 'answer_delta', text: 'x' }, { type: 'answer', markdown: 'Final', citations: [], unknownIds: [] }] })).toBe('Final')
  })
  it('cleans LaTeX, footnotes and tool-name brackets from answers', () => {
    expect(cleanAnswer('Temp $85^\\circ$C \\leq limit [1] [segment SEG-1] see web-2', ['segment'])).toBe('Temp 85°C ≤ limit see WEB-2')
  })
})
