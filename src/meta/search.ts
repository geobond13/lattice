// Public-precedent web search: Muse Spark on the Responses API with the built-in `web_search` tool.
// Sources are numbered WEB-1 … so the answer can cite them; each keeps its URL for the UI.
//
// Verified live (2026-11-04):
// - Output interleaves reasoning, interim messages ("I'll search…") and web_search_call items; the LAST message is the answer.
// - web_search_call carries { action: { query }, results: [{ type: 'text_result', title, url, snippet }] } (snippets often empty).
// - url_citation annotations came back empty; asking for "the source URL after each sentence" yields inline URLs instead,
//   which we map to WEB-n. Both paths are handled.
// - `instructions`, and the phrase "cite your sources", trip a 400 content-policy filter; the query alone never did.
// - Unbounded, one call ran 7 searches over 45k input tokens; max_tool_calls: 2 keeps it near 3.4k.
import type OpenAI from 'openai'
import type { Citation, UsageInfo } from '@/contracts'
import { isContentFiltered, metaClient, MODELS, PRICE, responsesUsage, usageInfo } from './client'

export interface WebSource { id: string; title: string; url: string; snippet?: string; cited: boolean }
export interface SearchResult {
  /** The model's grounded summary, with [WEB-n] markers where it cited a source. */
  summary: string
  sources: WebSource[]
  citations: Citation[]
  usage: UsageInfo
  queries: number
}

interface Annotation { type: string; url?: string; title?: string; start_index?: number; end_index?: number }
interface RawResult { title?: string; url?: string; snippet?: string }

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
const normUrl = (url: string) => url.replace(/#.*$/, '').replace(/[/.,;:]+$/, '').toLowerCase()
const INLINE_URL = /\s*(?:\(\s*)?<?(https?:\/\/[^\s)<>\]]+)>?(?:\s*\))?/g

/**
 * Number sources and mark citations. Cited sources (url_citation annotations, or URLs written inline) come first in
 * order of first citation, then the remaining raw results; deduplicated by URL and capped. Annotation markers are
 * inserted after each cited span; inline URLs are replaced by their marker.
 */
export function numberSources(text: string, annotations: Annotation[], results: RawResult[], max = 6): { summary: string; sources: WebSource[] } {
  const byUrl = new Map<string, WebSource>()
  const resultFor = (url: string) =>
    results.find((r) => r.url && normUrl(r.url) === normUrl(url)) ??
    // Inline URLs are sometimes just the site ("https://www.engadget.com"): match a result on the same host.
    (/^https?:\/\/[^/]+\/?$/.test(url) ? results.find((r) => r.url && host(r.url) === host(url)) : undefined)
  const sourceFor = (url: string, title?: string): WebSource | undefined => {
    const r = resultFor(url)
    const canonical = r?.url ?? url
    const k = normUrl(canonical)
    const existing = byUrl.get(k)
    if (existing) { existing.cited = true; return existing }
    if (byUrl.size >= max) return undefined
    const s: WebSource = { id: `WEB-${byUrl.size + 1}`, title: title || r?.title || host(canonical), url: canonical, ...(r?.snippet ? { snippet: r.snippet } : {}), cited: true }
    byUrl.set(k, s)
    return s
  }

  // 1. Annotations (spans in the text).
  const cites = annotations.filter((a) => a.type === 'url_citation' && a.url).sort((a, b) => (a.start_index ?? 0) - (b.start_index ?? 0))
  const inserts = new Map<number, Set<string>>()
  for (const a of cites) {
    const s = sourceFor(a.url!, a.title)
    const end = Math.min(Math.max(a.end_index ?? text.length, 0), text.length)
    if (s) inserts.set(end, (inserts.get(end) ?? new Set()).add(s.id))
  }
  let summary = text
  for (const end of [...inserts.keys()].sort((a, b) => b - a)) {
    summary = `${summary.slice(0, end)} ${[...inserts.get(end)!].map((id) => `[${id}]`).join('')}${summary.slice(end)}`
  }
  // 2. Inline URLs, in reading order.
  summary = summary.replace(INLINE_URL, (_m, url: string) => {
    const trailing = url.match(/[.,;:]+$/)?.[0] ?? '' // sentence punctuation the URL pattern swallowed
    const s = sourceFor(url.slice(0, url.length - trailing.length))
    return (s ? ` [${s.id}]` : '') + trailing
  })
  // 3. Uncited raw results, for the UI's source list.
  for (const r of results) {
    if (!r.url || byUrl.size >= max) continue
    const k = normUrl(r.url)
    if (!byUrl.has(k)) byUrl.set(k, { id: `WEB-${byUrl.size + 1}`, title: r.title || host(r.url), url: r.url, ...(r.snippet ? { snippet: r.snippet } : {}), cited: false })
  }
  summary = summary.replace(/[ \t]+(\[WEB-)/g, ' $1').replace(/(\[WEB-\d+\])(?:\s*\1)+/g, '$1').replace(/[ \t]+([.,;])/g, '$1').replace(/(\[WEB-\d+\])(?=[A-Za-z])/g, '$1 ').trim()
  return { summary, sources: [...byUrl.values()] }
}

export function webCitations(sources: WebSource[]): Citation[] {
  return sources.map((s) => ({ type: 'web', id: s.id, label: s.title, url: s.url }))
}

const isFiltered = isContentFiltered

/** One grounded search (at most two queries). */
export async function webSearch(query: string, opts: { signal?: AbortSignal } = {}): Promise<SearchResult> {
  const started = Date.now()
  const call = (input: string) => metaClient().responses.create({
    model: MODELS.search.model,
    input,
    tools: [{ type: 'web_search', search_context_size: 'low' }],
    include: ['web_search_call.results'],
    max_tool_calls: 2,
    reasoning: { effort: MODELS.search.effort ?? 'low' },
    max_output_tokens: 4000,
  } as OpenAI.Responses.ResponseCreateParamsNonStreaming, { signal: opts.signal }) as Promise<OpenAI.Responses.Response>
  // The filter is not deterministic: on a filter 400 move to the next phrasing; on a turn that never searched, retry once.
  const prompts = [`${query}. Answer in at most 4 sentences from public sources. Give the source URL after each sentence.`, `${query}. Give the source URL after each sentence.`, query]
  const counts = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 }
  let parsed = { text: '', annotations: [] as Annotation[], results: [] as RawResult[], queries: 0 }
  let totalQueries = 0
  let emptyRetries = 0
  for (let i = 0; i < prompts.length; i++) {
    let res: OpenAI.Responses.Response
    try { res = await call(prompts[i]) } catch (e) {
      if (!isFiltered(e) || i === prompts.length - 1) throw e
      continue
    }
    const u = responsesUsage(res.usage)
    counts.promptTokens += u.promptTokens; counts.completionTokens += u.completionTokens
    counts.reasoningTokens += u.reasoningTokens ?? 0; counts.cachedTokens += u.cachedTokens ?? 0
    parsed = parseOutput(res)
    totalQueries += parsed.queries
    if (parsed.results.length || parsed.annotations.length || emptyRetries++ >= 1) break
    i-- // same phrasing once more
  }
  const numbered = numberSources(parsed.text, parsed.annotations, parsed.results)
  const { sources } = numbered
  let { summary } = numbered
  // An uncited essay is not evidence; keep only its opening so the answer cannot lean on it.
  if (!/\[WEB-\d+\]/.test(summary) && summary.length > 600) summary = `${summary.slice(0, 600).replace(/\s\S*$/, '')} … (uncited)`
  return {
    summary, sources, queries: totalQueries, citations: webCitations(sources),
    usage: usageInfo('precedent search', 'search', counts, Date.now() - started, totalQueries * PRICE.webSearch),
  }
}

/** Pull the final message (with annotation offsets made global) and every raw search result out of a response. */
function parseOutput(res: OpenAI.Responses.Response) {
  let text = ''
  const annotations: Annotation[] = []
  const results: RawResult[] = []
  let queries = 0
  const final = (res.output ?? []).filter((o) => o.type === 'message').at(-1)
  for (const item of res.output ?? []) {
    if (item.type === 'web_search_call') {
      queries++
      const r = (item as unknown as { results?: RawResult[] }).results
      if (Array.isArray(r)) results.push(...r)
    } else if (item.type === 'message' && item === final) {
      for (const block of item.content) {
        if (block.type !== 'output_text') continue
        const offset = text.length // annotation offsets are per block
        for (const a of block.annotations ?? []) {
          const x = a as Annotation
          annotations.push({ ...x, start_index: (x.start_index ?? 0) + offset, end_index: (x.end_index ?? 0) + offset })
        }
        text += block.text
      }
    }
  }
  return { text, annotations, results, queries }
}
