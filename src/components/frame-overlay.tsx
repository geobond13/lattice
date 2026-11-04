'use client'
/* eslint-disable @next/next/no-img-element -- frames are data URLs rendered from the live scene */

import type { CameraFrame, Segment } from '@/contracts'

/**
 * A camera frame with SAM 3.1 overlays drawn in source-pixel space (the SVG viewBox is the frame's own size,
 * so boxes and mask paths scale with the image). Overlays draw themselves in on mount.
 */
export function FrameOverlay({ frame, segments = [], compact = false, highlight, className = '' }: {
  frame: CameraFrame
  segments?: Segment[]
  compact?: boolean
  highlight?: string
  className?: string
}) {
  const segs = segments.filter((s) => s.frame === frame.id)
  const fs = Math.max(14, frame.width / 34)
  const sw = frame.width / (compact ? 240 : 420)
  return (
    <div className={`relative overflow-hidden bg-black ${className}`} style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
      <img src={frame.src} alt={`${frame.id}: ${frame.label}`} className="absolute inset-0 size-full object-cover" draggable={false} />
      <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
        {segs.map((s, i) => {
          const { x1, y1, x2, y2 } = s.box
          const w = x2 - x1, h = y2 - y1
          const bad = s.feature?.id === 'damage'
          const col = bad ? 'var(--failed)' : 'var(--accent)'
          const dim = highlight && highlight !== s.id
          const delay = `${0.15 + i * 0.35}s`
          const per = 2 * (w + h)
          const tick = Math.min(w, h) * 0.22
          const label = `${s.concept}${s.confidence != null ? ` ${s.confidence.toFixed(2)}` : ''}`
          const lw = fs * (label.length * 0.55 + 4.4)
          const lx = Math.max(4, Math.min(x1, frame.width - lw - 4))
          return (
            <g key={s.id} opacity={dim ? 0.35 : 1}>
              {s.maskPath && (
                <path d={s.maskPath} fill={col} fillOpacity={0.16} className="lt-fade" style={{ animationDelay: `calc(${delay} + 0.5s)` }} />
              )}
              <rect
                x={x1} y={y1} width={w} height={h} rx={4} fill="none" stroke={col} strokeWidth={sw}
                className="lt-draw" style={{ ['--len' as string]: per, animationDelay: delay }}
              />
              {/* corner ticks */}
              <path
                d={`M${x1} ${y1 + tick}V${y1}H${x1 + tick} M${x2 - tick} ${y1}H${x2}V${y1 + tick} M${x2} ${y2 - tick}V${y2}H${x2 - tick} M${x1 + tick} ${y2}H${x1}V${y2 - tick}`}
                stroke={col} strokeWidth={sw * 2.2} fill="none"
                className="lt-fade" style={{ animationDelay: delay }}
              />
              {!compact && (
                <g className="lt-fade" style={{ animationDelay: `calc(${delay} + 0.6s)` }} transform={`translate(${lx} ${Math.max(fs * 1.5, y1 - fs * 0.5)})`}>
                  <rect x={0} y={-fs * 1.25} width={lw} height={fs * 1.5} rx={3} fill="rgba(5,7,11,0.82)" stroke={col} strokeOpacity={0.5} />
                  <text x={fs * 0.4} y={-fs * 0.1} fontSize={fs} fontFamily="var(--font-geist-mono), monospace" fill={col}>{s.id}</text>
                  <text x={fs * 3.7} y={-fs * 0.1} fontSize={fs} fontFamily="var(--font-geist-sans), sans-serif" fill="#e8eef7">
                    {label}
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
