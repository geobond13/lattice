// Number provenance: does every quantity in the answer appear in what the tools returned?
// Citations prove a source exists; this catches a value the model invented or carried over wrongly.

const UNIT = String.raw`(?:kPa|kW|W|V|A|°C|°\/s|deg\/s|N·m|N\s?m|Nm|N|m\/s|mm|km|m|min|h|s|%)(?![A-Za-z])`
// "t = 2040", "t=480 s", "T+2040" are mission times; plain values need a unit to count as a claim.
const QUANTITY = new RegExp(String.raw`(?:(\bt\s?=\s?|T\+)\s?)?(?<![\w.\-])(\d+(?:[.,]\d+)?)\s?(${UNIT})?`, 'g')

/** Every number anywhere in the tool data, including numbers inside strings. */
export function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
  else if (typeof value === 'string') for (const m of value.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(Number(m[0]))
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersIn(v, out)
  return out
}

/** A stated value matches if a source value rounds to it at the stated precision, or is within 0.5 %. Unit scaling (min↔s, kW↔W) is allowed. */
function matches(stated: number, decimals: number, unit: string | undefined, pool: number[]): boolean {
  const tol = 0.5 * 10 ** -decimals + 1e-9
  const candidates = [stated]
  if (unit === 'min') candidates.push(stated * 60)
  if (unit === 's') candidates.push(stated / 60)
  if (unit === 'h') candidates.push(stated * 3600, stated * 60)
  if (unit === 'kW') candidates.push(stated * 1000)
  if (unit === 'W') candidates.push(stated / 1000)
  return pool.some((s) => candidates.some((v, i) => {
    const t = i === 0 ? tol : Math.max(tol * Math.abs(v / stated || 1), 1e-9)
    return Math.abs(Math.abs(s) - v) <= t || (v !== 0 && Math.abs(Math.abs(s) - v) / v <= 0.005)
  }))
}

export interface NumberCheck { checked: number; unsupported: string[] }

export function checkNumbers(text: string, sources: unknown[]): NumberCheck {
  const pool = sources.flatMap((s) => numbersIn(s))
  const found = new Map<string, { value: number; decimals: number; unit?: string }>()
  // Bracketed citations carry digits (TR-1180, CAM-2) that are ids, not quantities.
  const body = text.replace(/\[[^\]]*\]/g, '').replace(/\b[A-Z]{1,4}-[A-Z0-9]+(?:-[A-Z0-9]+)?\b/g, '')
  for (const m of body.matchAll(QUANTITY)) {
    const [whole, time, raw, unit] = m
    if (!time && !unit) continue
    const value = Number(raw.replace(',', '.'))
    found.set(whole.trim(), { value, decimals: raw.split(/[.,]/)[1]?.length ?? 0, unit })
  }
  const unsupported = [...found].filter(([, q]) => !matches(q.value, q.decimals, q.unit, pool)).map(([k]) => k)
  return { checked: found.size, unsupported }
}
