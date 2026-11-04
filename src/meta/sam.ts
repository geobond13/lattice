// SAM 3.1 on the Meta Model API: concept-prompted segmentation of one camera frame.
//
// Wire format (docs: dev.meta.ai/docs/sam/reading-segmentation): the Responses stream carries special-token text in
// the output_text lane, one line per frame:
//   <0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=W;h=H;c=0.96|><|mask;x=0;y=0;c=0.96;data=MH,MW,!payload|>,1<|box…|><|mask…|>
// Box corners are inclusive source pixels. The mask raster (MH rows × MW columns) covers the box. Payloads are
// base85 over a custom alphabet; `!` marks the one_bit encoding (an adaptive binary range coder with a 12-pixel
// context), `~` the lossless one. We request one_bit and decode it here; lossless masks keep their box only.
import type { Segment } from '@/contracts'
import { metaClient, MODELS, PRICE, usageInfo } from './client'
import type { UsageInfo } from '@/contracts'

export interface SamMask { height: number; width: number; encoding: 'one_bit' | 'lossless'; payload: string; confidence?: number }
export interface SamMatch {
  frame: number
  objectId: number
  /** Inclusive source-pixel corners. */
  box: Segment['box']
  /** Source frame size the box refers to. */
  frameW: number
  frameH: number
  confidence?: number
  mask?: SamMask
}

// ─── Token grammar ────────────────────────────────────────────────────────────────────────────────

const FIELDS = (body: string) => {
  const out = new Map<string, string>()
  for (const part of body.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }
  return out
}
const int = (v: string | undefined) => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : NaN)

/** Parse one output line (one frame). Malformed records are skipped, never thrown. */
export function parseSamLine(line: string): SamMatch[] {
  const head = line.match(/^\s*<(\d+)f>/)
  if (!head) return []
  const frame = Number(head[1])
  const out: SamMatch[] = []
  // A record: object id, then a box token and a mask token (box first per the docs; parse by name to be safe).
  const record = /(\d+)\s*((?:<\|(?:box|mask);[^|]*\|>\s*){1,2})/g
  for (const m of line.slice(head[0].length).matchAll(record)) {
    const tokens = [...m[2].matchAll(/<\|(box|mask);([^|]*)\|>/g)]
    const boxT = tokens.find((t) => t[1] === 'box')
    if (!boxT) continue
    const b = FIELDS(boxT[2])
    const [x1, y1, x2, y2, w, h] = ['x1', 'y1', 'x2', 'y2', 'w', 'h'].map((k) => int(b.get(k)))
    if (![x1, y1, x2, y2, w, h].every(Number.isFinite) || x2 < x1 || y2 < y1) continue
    const c = b.has('c') ? Number(b.get('c')) : undefined
    const match: SamMatch = { frame, objectId: Number(m[1]), box: { x1, y1, x2, y2 }, frameW: w, frameH: h, ...(c !== undefined && Number.isFinite(c) ? { confidence: c } : {}) }
    const maskT = tokens.find((t) => t[1] === 'mask')
    if (maskT) {
      // data= is last and its payload may contain '=' or ';'-free base85, so slice rather than split.
      const at = maskT[2].indexOf('data=')
      const data = at >= 0 ? maskT[2].slice(at + 5) : ''
      const dm = data.match(/^(\d+),(\d+),([~!])([\s\S]*)$/)
      if (dm) match.mask = { height: Number(dm[1]), width: Number(dm[2]), encoding: dm[3] === '!' ? 'one_bit' : 'lossless', payload: dm[3] + dm[4] }
    }
    out.push(match)
  }
  return out
}

/** Parse the whole output_text (any number of frame lines). */
export function parseSamText(text: string): SamMatch[] {
  return text.split(/\r?\n|(?=<\d+f>)/).flatMap(parseSamLine)
}

/** Incremental parser for streamed deltas: yields the matches of each frame line once it is complete. */
export class SamStreamParser {
  private buffer = ''
  readonly matches: SamMatch[] = []
  /** Feed a delta; returns the matches completed by it. */
  push(delta: string): SamMatch[] {
    this.buffer += delta
    // A line is complete at a newline or when the next frame marker starts.
    const parts = this.buffer.split(/\r?\n|(?=<\d+f>)/)
    this.buffer = parts.pop() ?? ''
    const done = parts.flatMap(parseSamLine)
    this.matches.push(...done)
    return done
  }
  /** Flush the trailing line at response.completed. */
  end(): SamMatch[] {
    const done = parseSamLine(this.buffer)
    this.buffer = ''
    this.matches.push(...done)
    return done
  }
}

// ─── one_bit mask decoding ────────────────────────────────────────────────────────────────────────

/** Base85 alphabet: printable ASCII 0x21..0x7e minus the grammar's delimiters, first 85 characters. */
const ALPHABET = (() => {
  const excluded = new Set(['"', '\\', ',', ';', '<', '>', '|'])
  let s = ''
  for (let c = 0x21; c <= 0x7e; c++) if (!excluded.has(String.fromCharCode(c))) s += String.fromCharCode(c)
  return s.slice(0, 85)
})()
const DIGIT = new Int16Array(128).fill(-1)
for (let i = 0; i < ALPHABET.length; i++) DIGIT[ALPHABET.charCodeAt(i)] = i

const digit = (ch: string) => {
  const code = ch.charCodeAt(0)
  const v = code < 128 ? DIGIT[code] : -1
  if (v < 0) throw new Error('mask payload: invalid base85 character')
  return v
}

/** 5-digit length prefix, then 4-byte groups as 5 digits; a partial tail of r bytes as r+1 digits. */
export function unpackBase85(s: string): Uint8Array {
  if (s.length < 5) throw new Error('mask payload: missing length prefix')
  let length = 0
  for (let i = 0; i < 5; i++) length = length * 85 + digit(s[i])
  const rem = length % 4
  const expected = 5 + Math.floor(length / 4) * 5 + (rem ? rem + 1 : 0)
  if (s.length !== expected) throw new Error('mask payload: length does not match its prefix')
  const out = new Uint8Array(length)
  let src = 5
  let dst = 0
  for (; dst < length - rem; dst += 4, src += 5) {
    let v = 0
    for (let i = 0; i < 5; i++) v = v * 85 + digit(s[src + i])
    out[dst] = (v >>> 24) & 0xff; out[dst + 1] = (v >>> 16) & 0xff; out[dst + 2] = (v >>> 8) & 0xff; out[dst + 3] = v & 0xff
  }
  if (rem) {
    let v = 0
    for (let i = 0; i < 5; i++) v = v * 85 + (i < rem + 1 ? digit(s[src + i]) : 84)
    for (let i = 0; i < rem; i++) out[dst + i] = (v >>> (24 - 8 * i)) & 0xff
  }
  return out
}

const TOP = 1 << 24
const BOTTOM = 1 << 16

/** Carry-less range decoder (32-bit low/range, byte-wise renormalisation). */
class RangeDecoder {
  private pos = 0
  private low = 0
  private range = 0xffffffff
  private code = 0
  private scaled = 0
  constructor(private input: Uint8Array) {
    if (input.length < 4) throw new Error('mask payload: truncated')
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.read()) >>> 0
  }
  private read() { return this.pos < this.input.length ? this.input[this.pos++] : 0 }
  freq(total: number) {
    this.scaled = Math.floor(this.range / total)
    if (this.scaled === 0) throw new Error('mask payload: invalid coder state')
    const v = Math.floor(((this.code - this.low) >>> 0) / this.scaled)
    return v >= total ? total - 1 : v
  }
  decode(cum: number, f: number) {
    this.low = (this.low + this.scaled * cum) >>> 0
    this.range = this.scaled * f
    for (;;) {
      if (((this.low ^ (this.low + this.range)) >>> 0) >= TOP) {
        if (this.range >= BOTTOM) break
        this.range = (-this.low >>> 0) & (BOTTOM - 1)
      }
      this.code = ((this.code << 8) | this.read()) >>> 0
      this.low = (this.low << 8) >>> 0
      this.range = (this.range << 8) >>> 0
    }
  }
}

/** Decode a one_bit payload (`!…`) into a row-major 0/1 raster of width × height. */
export function decodeOneBitMask(payload: string, width: number, height: number): Uint8Array {
  if (!payload.startsWith('!')) throw new Error('not a one_bit mask')
  if (!(width > 0 && height > 0 && width * height <= 16_000_000)) throw new Error('mask payload: bad dimensions')
  const dec = new RangeDecoder(unpackBase85(payload.slice(1)))
  const PAD = 2
  const counts = new Uint16Array((1 << 12) * 2).fill(1)
  const pw = width + 2 * PAD
  const padded = new Uint8Array(pw * (height + PAD))
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = (y + PAD) * pw + PAD
    for (let x = 0; x < width; x++) {
      const p = row + x
      const a = p - pw // row above
      const b = p - 2 * pw // two rows above
      const ctx = padded[p - 1] | (padded[p - 2] << 1) | (padded[a - 2] << 2) | (padded[a - 1] << 3) | (padded[a] << 4) |
        (padded[a + 1] << 5) | (padded[a + 2] << 6) | (padded[b - 2] << 7) | (padded[b - 1] << 8) | (padded[b] << 9) |
        (padded[b + 1] << 10) | (padded[b + 2] << 11)
      const o = ctx << 1
      const zero = counts[o]
      const one = counts[o + 1]
      const bit = dec.freq(zero + one) < zero ? 0 : 1
      if (bit) dec.decode(zero, one); else dec.decode(0, zero)
      padded[p] = bit
      out[y * width + x] = bit
      counts[o + bit] += 14
      if (counts[o] + counts[o + 1] >= 4096) {
        counts[o] = counts[o] >> 1 || 1
        counts[o + 1] = counts[o + 1] >> 1 || 1
      }
    }
  }
  return out
}

// ─── Raster → SVG path ────────────────────────────────────────────────────────────────────────────

/**
 * Trace the boundary of a binary raster into a closed SVG path (outer contours clockwise, holes counter-clockwise,
 * so the default nonzero fill renders holes). Coordinates are mapped into the box in source pixels.
 */
export function rasterToSvgPath(raster: Uint8Array, width: number, height: number, box: Segment['box']): string {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? raster[y * width + x] : 0)
  // Directed boundary edges between lattice corners, keeping the filled pixel on the right.
  const next = new Map<number, number[]>()
  const key = (x: number, y: number) => y * (width + 1) + x
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0)
    const list = next.get(k)
    if (list) list.push(key(x1, y1)); else next.set(k, [key(x1, y1)])
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue
      if (!at(x, y - 1)) add(x, y, x + 1, y) // top edge, left→right
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1) // right edge, down
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1) // bottom edge, right→left
      if (!at(x - 1, y)) add(x, y + 1, x, y) // left edge, up
    }
  }
  const sx = (box.x2 - box.x1 + 1) / width
  const sy = (box.y2 - box.y1 + 1) / height
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString()
  const pt = (k: number) => [box.x1 + (k % (width + 1)) * sx, box.y1 + Math.floor(k / (width + 1)) * sy] as const
  let d = ''
  for (const [start] of next) {
    if (!next.get(start)?.length) continue
    const loop: number[] = []
    let k = start
    for (let guard = 0; guard < 4 * (width + 1) * (height + 1); guard++) {
      const outs = next.get(k)
      if (!outs?.length) break
      loop.push(k)
      k = outs.pop()!
      if (k === start) break
    }
    // Drop collinear corners.
    const pts = loop.filter((c, i) => {
      const p = loop[(i - 1 + loop.length) % loop.length]
      const n = loop[(i + 1) % loop.length]
      const dx1 = (c % (width + 1)) - (p % (width + 1)), dy1 = Math.floor(c / (width + 1)) - Math.floor(p / (width + 1))
      const dx2 = (n % (width + 1)) - (c % (width + 1)), dy2 = Math.floor(n / (width + 1)) - Math.floor(c / (width + 1))
      return dx1 * dy2 - dy1 * dx2 !== 0
    })
    if (pts.length < 3) continue
    d += pts.map((c, i) => { const [x, y] = pt(c); return `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}` }).join('') + 'Z'
  }
  return d
}

/** Decode a match's mask into an SVG path in source pixels, or undefined when it cannot be decoded. */
export function maskPathOf(m: SamMatch): string | undefined {
  if (!m.mask || m.mask.encoding !== 'one_bit') return undefined
  try {
    const raster = decodeOneBitMask(m.mask.payload, m.mask.width, m.mask.height)
    return rasterToSvgPath(raster, m.mask.width, m.mask.height, m.box) || undefined
  } catch {
    return undefined
  }
}

// ─── The API call ─────────────────────────────────────────────────────────────────────────────────

export interface SegmentResult { matches: (SamMatch & { maskPath?: string })[]; raw: string; usage: UsageInfo }

/**
 * Segment every instance of `concept` (a short noun phrase) in one image. Streams the Responses output and parses
 * frame lines as they complete. Zero matches is a valid, empty result.
 */
export async function segment(imageDataUrl: string, concept: string, opts: { signal?: AbortSignal; onMatch?: (m: SamMatch) => void } = {}): Promise<SegmentResult> {
  const started = Date.now()
  const parser = new SamStreamParser()
  let raw = ''
  const body = {
    model: MODELS.segmenter.model,
    stream: true as const,
    input: [{ type: 'message' as const, role: 'user' as const, content: [
      { type: 'input_text' as const, text: concept },
      { type: 'input_image' as const, image_url: imageDataUrl, detail: 'auto' as const },
    ] }],
    metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
  }
  const stream = await metaClient().responses.create(body, { signal: opts.signal })
  for await (const ev of stream) {
    if (ev.type === 'response.output_text.delta') {
      raw += ev.delta
      for (const m of parser.push(ev.delta)) opts.onMatch?.(m)
    } else if (ev.type === 'response.failed' || ev.type === 'error') {
      throw new Error(`SAM 3.1 failed: ${JSON.stringify((ev as { response?: { error?: unknown } }).response?.error ?? ev).slice(0, 200)}`)
    }
  }
  for (const m of parser.end()) opts.onMatch?.(m)
  const matches = parser.matches.map((m) => ({ ...m, maskPath: maskPathOf(m) }))
  return {
    matches, raw,
    usage: usageInfo(`segment "${concept}"`, 'segmenter', { promptTokens: 0, completionTokens: 0 }, Date.now() - started, PRICE.samImage),
  }
}
