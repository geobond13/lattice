'use client'
/* eslint-disable @next/next/no-img-element -- frame thumbnails are data URLs */

import { useState } from 'react'
import type { CameraFrame, Segment } from '@/contracts'
import { FrameOverlay } from './frame-overlay'

export function CameraFeed({ frames, segments, capturing, onOpen }: { frames: CameraFrame[]; segments: Segment[]; capturing: boolean; onOpen: (id: string) => void }) {
  // Follow the frame SAM last worked on until the operator picks one.
  const [picked, setPicked] = useState<string | null>(null)
  const latestSeg = segments[segments.length - 1]?.frame
  const activeId = picked ?? latestSeg ?? frames[frames.length - 1]?.id
  const frame = frames.find((f) => f.id === activeId) ?? frames[0]

  if (!frame) {
    return (
      <div className="glass overflow-hidden rounded-xl">
        <div className="relative flex aspect-video items-center justify-center bg-black/40">
          <div className="absolute inset-0 overflow-hidden"><div className="lt-scan h-1/3 w-full bg-gradient-to-b from-transparent via-accent/10 to-transparent" /></div>
          <span className="font-mono text-[0.66rem] tracking-wider text-accent uppercase">{capturing ? 'Fly-around · capturing' : 'Servicer cam standby'}</span>
        </div>
      </div>
    )
  }

  const segs = segments.filter((s) => s.frame === frame.id)
  return (
    <div className="glass overflow-hidden rounded-xl">
      <div className="relative">
        <FrameOverlay key={`${frame.id}:${segs.length}`} frame={frame} segments={segs} />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-2.5 pt-2 pb-5">
          <span className="flex items-center gap-1.5 rounded-[4px] bg-black/50 px-1.5 py-0.5 font-mono text-[0.58rem] tracking-[0.12em] text-ink uppercase">
            <span className="lt-pulse size-1.5 rounded-full bg-failed" /> Live · servicer cam
          </span>
          <span className="ml-auto truncate font-mono text-[0.6rem] text-ink-2">{frame.id}<span className="hidden sm:inline"> · {frame.label}</span></span>
        </div>
        {segs.length > 0 && (
          <div className="absolute right-2 bottom-2 flex gap-1">
            {segs.map((s) => (
              <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="rounded-[4px] bg-black/60 px-1.5 py-0.5 font-mono text-[0.58rem] text-ink-2 hover:text-accent">
                SAM 3.1 · {s.id}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1.5 p-1.5" role="tablist" aria-label="Camera frames">
        {frames.map((f) => {
          const on = f.id === frame.id
          const n = segments.filter((s) => s.frame === f.id).length
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPicked(f.id)}
              className={`group relative flex-1 overflow-hidden rounded-md border transition-colors ${on ? 'border-accent/60' : 'border-line hover:border-line-2'}`}
            >
              <img src={f.src} alt="" className={`aspect-video w-full object-cover transition-opacity ${on ? 'opacity-100' : 'opacity-50 group-hover:opacity-80'}`} />
              <span className="absolute bottom-0.5 left-1 font-mono text-[0.55rem] text-ink">{f.id}</span>
              {n > 0 && <span className="absolute top-0.5 right-1 font-mono text-[0.55rem] text-accent">{n} seg</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
