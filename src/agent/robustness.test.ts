import { describe, expect, it, vi } from 'vitest'
import OpenAI from 'openai'
import { isContentFiltered, retryFiltered } from '@/meta/client'
import { conceptLadder } from './tools'
import { eventLog, wakeEvent } from './prompts'

const filtered = () => new OpenAI.APIError(400, { code: 'content_policy_violation', message: 'The response was filtered due to the prompt triggering our content management policy.' }, undefined, new Headers())

describe('content-filter retry', () => {
  it('recognises the API filter error', () => {
    expect(isContentFiltered(filtered())).toBe(true)
    expect(isContentFiltered(new Error('500 server error'))).toBe(false)
  })
  it('retries filtered calls and reports each retry', async () => {
    const fn = vi.fn().mockRejectedValueOnce(filtered()).mockRejectedValueOnce(filtered()).mockResolvedValue('ok')
    const seen: string[] = []
    await expect(retryFiltered(fn, (a, n) => seen.push(`${a}/${n}`))).resolves.toBe('ok')
    expect(seen).toEqual(['2/4', '3/4'])
  })
  it('gives up after the last try and never retries other errors', async () => {
    await expect(retryFiltered(() => Promise.reject(filtered()), undefined, 2)).rejects.toThrow(/filtered/)
    const other = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(retryFiltered(other)).rejects.toThrow('boom')
    expect(other).toHaveBeenCalledTimes(1)
  })
})

describe('SAM concept ladder', () => {
  it('maps domain phrases to visual synonyms SAM can match', () => {
    expect(conceptLadder('grapple fixture')[0]).toBe('circular target')
    expect(conceptLadder('radiator latch')).toContain('small square')
    expect(conceptLadder('puncture')).toContain('hole')
    expect(conceptLadder('teapot')).toEqual([])
    expect(conceptLadder('circle')).not.toContain('circle')
  })
})

describe('wake event (real sim)', () => {
  it('wakes when the hazard is projected, or after the first cascade settles', () => {
    expect(wakeEvent('radiator-puncture')).toMatchObject({ id: 'FE-0924', t: 500 })
    expect(wakeEvent('power-bus-short')).toMatchObject({ id: 'FE-0815', t: 91 })
    expect(wakeEvent('thruster-stuck')).toMatchObject({ id: 'FE-0738', t: 120 })
    expect(eventLog('radiator-puncture', wakeEvent('radiator-puncture')).map((e) => e.id)).toEqual(['FE-0921', 'FE-0922', 'FE-0923', 'FE-0924'])
  })
})
