'use client'
// Client hook for agent runs (owned by the agent workstream). STUB: signature frozen.
import type { AgentEvent, CameraFrame, ScenarioId } from '@/contracts'

export type RunSource = 'live' | 'recorded'
export interface AgentRun {
  id: string
  scenario: ScenarioId
  question?: string
  source: RunSource
  events: AgentEvent[]
  status: 'running' | 'done' | 'error'
}

export interface UseAgentRuns {
  runs: AgentRun[]
  running: boolean
  /** Start the autonomous wake-up run (or a follow-up question). Recorded = replay /recordings/<scenario>.json with original pacing. */
  start(opts: { scenario: ScenarioId; frames?: CameraFrame[]; question?: string; source: RunSource }): Promise<void>
  stop(): void
  reset(): void
}

export declare function useAgentRuns(): UseAgentRuns
