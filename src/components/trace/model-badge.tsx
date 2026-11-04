import type { Effort } from '@/contracts'
import { modelBadge } from '@/ui/format'

/** "muse-spark-1.3 · minimal", "sam-3.1", "server · web search". SAM and server tools read quieter than Muse. */
export function ModelBadge({ model, effort, tool }: { model: string; effort?: Effort; tool?: string }) {
  const muse = /muse/i.test(model)
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-[5px] border px-1.5 font-mono text-[0.62rem] leading-[1.1rem] ${
        muse ? 'border-accent/25 bg-accent-soft text-accent' : 'border-line bg-sunken text-ink-2'
      }`}
    >
      {muse && <span className="size-1 rounded-full bg-accent" aria-hidden />}
      {modelBadge(model, effort, tool)}
    </span>
  )
}
