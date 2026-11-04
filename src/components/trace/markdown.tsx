'use client'

import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { RECORD_ID, normalizeIds } from '@/agent/citations'
import { CitationChip } from './citation-chip'

/** Turn ids (bare or [bracketed]) into #cite: links; the renderer swaps them for chips. */
function linkify(md: string): string {
  const re = new RegExp(`\\[?(${RECORD_ID.source})\\]?(?!\\()`, 'g')
  return normalizeIds(md).replace(re, (_m, id: string) => `[${id}](#cite:${id})`)
}

export const Markdown = memo(function Markdown({ text, onOpen, unknownIds = [] }: { text: string; onOpen: (id: string) => void; unknownIds?: string[] }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(u) => u}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#cite:')) {
              const id = href.slice(6)
              return <CitationChip id={id} unknown={unknownIds.includes(id)} onOpen={onOpen} />
            }
            return <a href={href} className="text-accent underline decoration-accent/40 underline-offset-2" target="_blank" rel="noreferrer">{children}</a>
          },
        }}
      >
        {linkify(text)}
      </ReactMarkdown>
    </div>
  )
})
