// Plan parsing and progress tracking, shared by the loop and the UI.
import type { PlanStep } from '@/contracts'

/**
 * Which plan steps are done, given the tools called so far (in order).
 * Step i is done once its tool has been called as many times as it appears in steps 0..i.
 */
export function planProgress(plan: PlanStep[], called: string[]): boolean[] {
  const counts = new Map<string, number>()
  for (const name of called) counts.set(name, (counts.get(name) ?? 0) + 1)
  const needed = new Map<string, number>()
  return plan.map((s) => {
    needed.set(s.tool, (needed.get(s.tool) ?? 0) + 1)
    return (counts.get(s.tool) ?? 0) >= needed.get(s.tool)!
  })
}

/**
 * Parse the planner's JSON. Unknown tools are dropped. The safety rule is enforced on the plan too: a
 * segment step must come before the first propose_action that could move hardware.
 */
export function parsePlan(content: string, toolNames: string[], opts: { max?: number; fallback?: PlanStep[] } = {}): PlanStep[] {
  const names = new Set(toolNames)
  const json = content.match(/\{[\s\S]*\}/)?.[0]
  let steps: PlanStep[] = []
  try {
    const parsed = JSON.parse(json ?? '') as { steps?: { goal?: unknown; tool?: unknown }[] }
    steps = (parsed.steps ?? [])
      .filter((s) => typeof s.goal === 'string' && typeof s.tool === 'string' && names.has(s.tool))
      .map((s) => ({ goal: (s.goal as string).slice(0, 200), tool: s.tool as string }))
  } catch { /* fall through */ }
  if (!steps.length) return (opts.fallback ?? []).filter((s) => names.has(s.tool))
  const firstPropose = steps.findIndex((s) => s.tool === 'propose_action' && !/migrat/i.test(s.goal))
  if (firstPropose >= 0 && names.has('segment') && !steps.slice(0, firstPropose).some((s) => s.tool === 'segment')) {
    steps.splice(firstPropose, 0, { goal: 'Segment the grapple fixture on a camera frame to get a grasp point', tool: 'segment' })
  }
  return steps.slice(0, opts.max ?? 8)
}
