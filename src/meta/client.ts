// Meta Model API access: one OpenAI-compatible client, the model + effort per agent role, and cost accounting.
// Every model call in LATTICE goes through here (server-side only: the key never reaches the browser).
import OpenAI from 'openai'
import type { Effort, ModelRole, UsageInfo } from '@/contracts'

export const META_BASE_URL = process.env.MODEL_API_BASE_URL ?? 'https://api.meta.ai/v1'

export const hasMetaKey = () => Boolean(process.env.MODEL_API_KEY)

let cached: OpenAI | undefined
/** The shared client. Tests replace it with `setMetaClient`. */
export function metaClient(): OpenAI {
  if (cached) return cached
  const apiKey = process.env.MODEL_API_KEY
  if (!apiKey) throw new Error('MODEL_API_KEY is not set')
  cached = new OpenAI({ baseURL: META_BASE_URL, apiKey, maxRetries: 2, timeout: 120_000 })
  return cached
}
export function setMetaClient(client: OpenAI | undefined) { cached = client }

/** Which Meta model (and reasoning effort) plays each role. */
export const MODELS: Record<ModelRole, { model: string; effort?: Effort }> = {
  planner: { model: 'muse-spark-1.3', effort: 'high' },
  executor: { model: 'muse-spark-1.3', effort: 'minimal' },
  vision: { model: 'muse-spark-1.3', effort: 'medium' },
  segmenter: { model: 'sam-3.1' },
  search: { model: 'muse-spark-1.3', effort: 'low' },
  answer: { model: 'muse-spark-1.3', effort: 'high' },
  transcribe: { model: 'muse-voice-transcribe-1.0' },
}

/** Muse Spark standard-mode prices, USD per token, plus the per-unit prices of the non-token models. */
export const PRICE = {
  input: 1.25 / 1e6,
  cachedInput: 0.15 / 1e6,
  output: 4.25 / 1e6,
  webSearch: 2.5 / 1000, // per search query
  samImage: 2.5 / 1000, // per segmented image
  transcribeSecond: 0.18 / 3600, // per second of audio
}

/** Token cost. Cached prompt tokens bill at the cached rate; reasoning tokens are already inside completion tokens. */
export function tokenCost(promptTokens: number, completionTokens: number, cachedTokens = 0): number {
  const cachedN = Math.min(cachedTokens, promptTokens)
  return (promptTokens - cachedN) * PRICE.input + cachedN * PRICE.cachedInput + completionTokens * PRICE.output
}

export interface TokenCounts { promptTokens: number; completionTokens: number; reasoningTokens?: number; cachedTokens?: number }

/** Chat Completions usage → counts. */
export function chatUsage(u: OpenAI.CompletionUsage | null | undefined): TokenCounts {
  return {
    promptTokens: u?.prompt_tokens ?? 0,
    completionTokens: u?.completion_tokens ?? 0,
    reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? undefined,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? undefined,
  }
}

/** Responses API usage → counts. */
export function responsesUsage(u: OpenAI.Responses.ResponseUsage | null | undefined): TokenCounts {
  return {
    promptTokens: u?.input_tokens ?? 0,
    completionTokens: u?.output_tokens ?? 0,
    reasoningTokens: u?.output_tokens_details?.reasoning_tokens ?? undefined,
    cachedTokens: u?.input_tokens_details?.cached_tokens ?? undefined,
  }
}

/** Build the UsageInfo for one model call. `extraUsd` adds per-unit charges (search queries, SAM images, audio). */
export function usageInfo(label: string, role: ModelRole, counts: TokenCounts, ms: number, extraUsd = 0, model = MODELS[role].model): UsageInfo {
  return {
    label, role, model, effort: MODELS[role].effort, ms,
    promptTokens: counts.promptTokens,
    completionTokens: counts.completionTokens,
    ...(counts.reasoningTokens !== undefined ? { reasoningTokens: counts.reasoningTokens } : {}),
    costUsd: tokenCost(counts.promptTokens, counts.completionTokens, counts.cachedTokens) + extraUsd,
  }
}

/** The API's prompt classifier (400 content_policy_violation). It is stochastic: an identical request often passes on retry. */
export function isContentFiltered(e: unknown): boolean {
  if (e instanceof OpenAI.APIError) return e.code === 'content_policy_violation' || /content management policy/i.test(e.message)
  return e instanceof Error && /content management policy/i.test(e.message)
}

/** Retry a call that the content filter rejected (verified flaky: the same thruster-stuck planner prompt passed 1 in 4 plain, 3 in 4 framed). */
export async function retryFiltered<T>(fn: (attempt: number) => Promise<T>, onRetry?: (attempt: number, tries: number) => void, tries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      if (!isContentFiltered(e) || attempt + 1 >= tries) throw e
      onRetry?.(attempt + 2, tries)
    }
  }
}

/** Short, client-safe message from an API error (never echoes headers or the key). */
export function errorMessage(e: unknown): string {
  if (e instanceof OpenAI.APIError) return `${e.status ?? ''} ${e.message}`.trim().slice(0, 300)
  return e instanceof Error ? e.message.slice(0, 300) : 'unknown error'
}
