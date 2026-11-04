import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeOneBitMask, maskPathOf, parseSamLine, parseSamText, rasterToSvgPath, SamStreamParser, unpackBase85 } from './sam'

const fixture = (f: string) => readFileSync(path.join(__dirname, '__fixtures__', f), 'utf8')

describe('SAM token parser', () => {
  it('parses a real SAM 3.1 response (4 yellow squares, confidence, one_bit masks)', () => {
    const m = parseSamText(fixture('sam-yellow-square.txt'))
    expect(m).toHaveLength(4)
    expect(m.map((x) => x.objectId)).toEqual([0, 1, 2, 3])
    expect(m[0]).toMatchObject({ frame: 0, box: { x1: 861, y1: 181, x2: 879, y2: 199 }, frameW: 960, frameH: 540 })
    expect(m[0].confidence).toBeCloseTo(0.906, 3)
    expect(m[0].mask).toMatchObject({ height: 19, width: 19, encoding: 'one_bit' })
    expect(m[0].mask!.payload.startsWith('!')).toBe(true)
  })

  it('parses the docs example without confidence or decodable masks', () => {
    const line = '<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~...|>,1<|box;x1=260;y1=382;x2=340;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,81,~...|>,2<|box;x1=516;y1=117;x2=536;y2=150;w=537;h=561|><|mask;x=0;y=0;data=34,21,~...|>'
    const m = parseSamLine(line)
    expect(m.map((x) => x.objectId)).toEqual([0, 1, 2])
    expect(m[2].box).toEqual({ x1: 516, y1: 117, x2: 536, y2: 150 })
    expect(m[0].confidence).toBeUndefined()
    expect(m[0].mask?.encoding).toBe('lossless')
    expect(maskPathOf(m[0])).toBeUndefined()
  })

  it('keys sparse object ids and reads fields by name', () => {
    const m = parseSamLine('<3f>0<|box;h=10;w=20;y2=5;x2=6;y1=1;x1=2;c=0.5|><|mask;x=0;y=0;c=0.5;data=5,5,!abc|>,2<|box;x1=1;y1=1;x2=2;y2=2;w=20;h=10|><|mask;x=0;y=0;data=2,2,!x|>')
    expect(m.map((x) => [x.frame, x.objectId])).toEqual([[3, 0], [3, 2]])
    expect(m[0].box).toEqual({ x1: 2, y1: 1, x2: 6, y2: 5 })
  })

  it('treats an empty lane as zero matches and skips malformed records', () => {
    expect(parseSamText('')).toEqual([])
    expect(parseSamLine('<0f>0<|box;x1=a;y1=1;x2=2;y2=2;w=9;h=9|><|mask;x=0;y=0;data=1,1,!x|>')).toEqual([])
    expect(parseSamLine('garbage')).toEqual([])
  })

  it('stream parser is independent of chunk boundaries', () => {
    const text = fixture('sam-circle.txt')
    for (const size of [1, 7, 50, text.length]) {
      const p = new SamStreamParser()
      for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size))
      p.end()
      expect(p.matches).toEqual(parseSamText(text))
    }
  })

  it('splits multi-frame output on frame markers and newlines', () => {
    const rec = (id: number) => `${id}<|box;x1=1;y1=1;x2=3;y2=3;w=9;h=9|><|mask;x=0;y=0;data=3,3,!q|>`
    const m = parseSamText(`<0f>${rec(1)}\n<2f>${rec(1)},${rec(4)}<5f>${rec(4)}`)
    expect(m.map((x) => `${x.frame}:${x.objectId}`)).toEqual(['0:1', '2:1', '2:4', '5:4'])
  })
})

describe('one_bit mask decoding', () => {
  // Payloads produced by Meta's reference encoder (@meta-sam/parser encodeSegmentationMask).
  const masks = JSON.parse(fixture('one-bit-masks.json')) as { w: number; h: number; raster: string; payload: string }[]
  it.each(masks.map((m) => [`${m.w}x${m.h}`, m] as const))('decodes the reference payload %s exactly', (_n, m) => {
    expect(Array.from(decodeOneBitMask(m.payload, m.w, m.h)).join('')).toBe(m.raster)
  })

  it('decodes real SAM masks: a full 19×19 square and a corner-clipped one', () => {
    const [a, b] = parseSamText(fixture('sam-yellow-square.txt'))
    const ra = decodeOneBitMask(a.mask!.payload, 19, 19)
    expect(ra.reduce((s, x) => s + x, 0)).toBe(361)
    const rb = decodeOneBitMask(b.mask!.payload, 19, 19)
    expect(rb.reduce((s, x) => s + x, 0)).toBe(359)
    expect(rb[18]).toBe(0) // top-right pixel clipped
  })

  it('decodes the real circle masks to a plausible disc', () => {
    for (const m of parseSamText(fixture('sam-circle.txt'))) {
      const r = decodeOneBitMask(m.mask!.payload, m.mask!.width, m.mask!.height)
      const fill = r.reduce((s, x) => s + x, 0) / r.length
      expect(fill).toBeGreaterThan(0.6) // π/4 ≈ 0.785 for a disc in its box
      expect(fill).toBeLessThan(0.9)
      expect(r[0]).toBe(0) // corners are outside the disc
      expect(r[Math.floor(m.mask!.height / 2) * m.mask!.width + Math.floor(m.mask!.width / 2)]).toBe(1)
    }
  })

  it('rejects bad payloads', () => {
    expect(() => decodeOneBitMask('~abc', 2, 2)).toThrow()
    expect(() => unpackBase85('!!!!')).toThrow(/prefix/)
    expect(() => unpackBase85('!!!!#')).toThrow(/length/) // says 1 byte, carries none
  })
})

describe('mask → SVG path', () => {
  it('traces a full square as one rectangle in source pixels', () => {
    const [a] = parseSamText(fixture('sam-yellow-square.txt'))
    expect(maskPathOf(a)).toBe('M861 181L880 181L880 200L861 200Z')
  })

  it('traces a hole as a second contour and scales into the box', () => {
    const r = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1])
    const d = rasterToSvgPath(r, 3, 3, { x1: 10, y1: 20, x2: 15, y2: 25 })
    expect(d.match(/M/g)).toHaveLength(2)
    expect(d).toContain('M10 20')
    expect(d).toContain('L16 26')
  })

  it('returns an empty path for an empty mask', () => {
    expect(rasterToSvgPath(new Uint8Array(4), 2, 2, { x1: 0, y1: 0, x2: 1, y2: 1 })).toBe('')
  })
})
