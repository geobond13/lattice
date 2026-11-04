// Citation ids (docs/DESIGN.md "Record id formats") and answer validation.
import type { Citation, CitationType } from '@/contracts'

/**
 * Every citable id shape:
 * NCR-dddd, TR-dddd, FE-dddd, FRU-AAA-dd, ICD-AAA-dd, OPS-AAA-dd, BLD-Mdd, TM-Mdd-AAA, TM-LAT-UTL, CAM-n, SEG-n, WEB-n.
 * Letter groups allow 2–6 letters because the spec's own examples run past three (ICD-DOCK-01, OPS-VALVE-07, TM-M11-LATCH).
 */
export const RECORD_ID = /(?<![A-Za-z0-9-])(?:NCR-\d{4}|TR-\d{4}|FE-\d{4}|FRU-[A-Z]{2,6}-\d{2}|ICD-[A-Z]{2,6}-\d{2}|OPS-[A-Z]{2,6}-\d{2}|BLD-M\d{2}|TM-M\d{2}-[A-Z]{2,6}|TM-LAT-UTL|CAM-\d{1,2}|SEG-\d{1,3}|WEB-\d{1,2})(?![A-Za-z0-9-])/g

/** The citation type an id belongs to, from its prefix. */
export function citationType(id: string): CitationType | undefined {
  if (/^TM-/.test(id)) return 'telemetry'
  if (/^FE-/.test(id)) return 'event'
  if (/^(NCR|TR|FRU|ICD|OPS|BLD)-/.test(id)) return 'record'
  if (/^CAM-/.test(id)) return 'camera'
  if (/^SEG-/.test(id)) return 'segment'
  if (/^WEB-/.test(id)) return 'web'
  return undefined
}

export function cite(id: string, label: string, url?: string): Citation {
  return { type: citationType(id) ?? 'record', id, label, ...(url ? { url } : {}) }
}

/** Models typeset ids with Unicode hyphens (U+2010..U+2015, U+2212); citations need ASCII. */
export const normalizeIds = (s: string) => s.replace(/(?<=[A-Z0-9])[‐-―−](?=[A-Z0-9])/g, '-')

/** Ids an answer mentions, split into those a tool returned (cited, in order of first mention) and unknown ones. */
export function validateCitations(text: string, seen: Map<string, Citation>): { cited: Citation[]; unknownIds: string[] } {
  const mentioned = [...new Set(normalizeIds(text).match(RECORD_ID) ?? [])]
  return { cited: mentioned.flatMap((id) => seen.get(id) ?? []), unknownIds: mentioned.filter((id) => !seen.has(id)) }
}

/** Every id that appears anywhere in a value (tool data), e.g. a record body that mentions NCR-0412. */
export function idsIn(value: unknown): string[] {
  return [...new Set(JSON.stringify(value ?? null).match(RECORD_ID) ?? [])]
}
