import type { ActionKind, Effort, Tier } from '@/contracts'

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')

/** Mission time: T+hh:mm:ss (negative → T−). */
export function fmtClock(t: number): string {
  const sign = t < 0 ? 'T−' : 'T+'
  const a = Math.abs(t)
  return `${sign}${pad(a / 3600)}:${pad((a % 3600) / 60)}:${pad(a % 60)}`
}

/** Short mission time: T+mm:ss (hours folded into minutes). */
export function fmtT(t: number): string {
  const sign = t < 0 ? 'T−' : 'T+'
  const a = Math.abs(t)
  return `${sign}${pad(a / 60)}:${pad(a % 60)}`
}

export function fmtDur(s: number): string {
  if (s < 60) return `${Math.round(s)} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(1)} h`
}

export const ACTION_LABEL: Record<ActionKind, string> = {
  MIGRATE_WORKLOADS: 'Migrate workloads',
  REPAIR_FRU: 'Repair FRU',
  SWAP_MODULE: 'Swap module',
  DEORBIT_MODULE: 'Deorbit module',
  INSPECT: 'Inspect',
}

export const TIER_LABEL: Record<Tier, string> = {
  auto: 'Executing autonomously',
  gated: 'Awaiting operator',
  refused: 'Refused',
}

export function modelBadge(model: string, effort?: Effort, tool?: string): string {
  if (model === 'server') return `server · ${(tool ?? 'tool').replace(/_/g, ' ')}`
  return effort ? `${model} · ${effort}` : model
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
