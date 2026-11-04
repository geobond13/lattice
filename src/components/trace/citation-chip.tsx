'use client'

const KIND_DOT: Record<string, string> = {
  TM: 'bg-accent', FE: 'bg-degraded', CAM: 'bg-ink-2', SEG: 'bg-ink-2', WEB: 'bg-spare',
}

export function CitationChip({ id, unknown, onOpen, title }: { id: string; unknown?: boolean; onOpen: (id: string) => void; title?: string }) {
  const prefix = id.split('-')[0]
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      title={unknown ? 'Not returned by any tool in this run' : title ?? `Open ${id}`}
      className={`mx-px inline-flex translate-y-[-1px] items-center gap-1 rounded-[5px] border px-1.5 align-middle font-mono text-[0.68rem] leading-[1.15rem] transition-colors ${
        unknown
          ? 'border-failed/40 bg-failed-soft text-failed'
          : 'border-line bg-sunken text-ink-2 hover:border-accent/60 hover:text-accent'
      }`}
    >
      <span className={`size-1 rounded-full ${KIND_DOT[prefix] ?? 'bg-muted'}`} aria-hidden />
      {id}
    </button>
  )
}
