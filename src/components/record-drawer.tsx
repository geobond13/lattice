'use client'

import { useEffect } from 'react'
import type { Citation } from '@/contracts'
import type { Mission } from '@/ui/use-mission'
import { fmtT } from '@/ui/format'
import { FrameOverlay } from './frame-overlay'
import { Strip } from './telemetry'

const KIND: Record<string, string> = { build: 'Build traveler', test: 'Test report', ncr: 'Nonconformance', fru: 'FRU catalogue', icd: 'Interface control', ops: 'Ops log' }

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 text-[0.74rem]">
      <span className="text-muted">{k}</span>
      <span className="num text-right text-ink">{v}</span>
    </div>
  )
}

function Body({ id, m, citations, onOpen }: { id: string; m: Mission; citations: Map<string, Citation>; onOpen: (id: string) => void }) {
  if (id.startsWith('TM-')) {
    const spec = m.api.channels(m.scenario).find((c) => c.id === id)
    if (!spec) return <p className="text-[0.78rem] text-muted">Channel not in this scenario.</p>
    const t1 = Math.max(m.t + 120, 900)
    const pts = m.api.sample(m.scenario, id, 0, t1, 220, m.resolvedAt)
    return (
      <div className="space-y-4">
        <p className="text-[0.95rem] text-ink">{spec.label} <span className="text-muted">· {spec.module}</span></p>
        <Strip spec={spec} pts={pts} now={m.t} t0={0} t1={t1} fdir={m.fdir.filter((f) => f.channel === id)} onOpen={onOpen} />
        <div>
          <Row k="Unit" v={spec.unit} />
          {spec.limits.lo != null && <Row k="Low limit" v={`${spec.limits.lo} ${spec.unit}`} />}
          {spec.limits.hi != null && <Row k="High limit" v={`${spec.limits.hi} ${spec.unit}`} />}
          <Row k="Window" v={`T+0 → ${fmtT(t1)}`} />
        </div>
        <p className="text-[0.7rem] leading-5 text-muted">Dashed: what a healthy module would read. Solid: the actual channel. Red dotted: hard limits that raise FDIR events.</p>
      </div>
    )
  }
  if (id.startsWith('FE-')) {
    const f = m.fdir.find((x) => x.id === id)
    if (!f) return <p className="text-[0.78rem] text-muted">Event not found.</p>
    return (
      <div className="space-y-3">
        <p className="text-[0.95rem] leading-6 text-ink">{f.summary}</p>
        <div><Row k="Raised" v={fmtT(f.t)} /><Row k="Module" v={f.module} /><Row k="Channel" v={f.channel} /><Row k="Severity" v={f.severity} /></div>
        <p className="text-[0.7rem] leading-5 text-muted">Raised by deterministic onboard FDIR. No model involved; this is what wakes the agent.</p>
      </div>
    )
  }
  if (id.startsWith('CAM-') || id.startsWith('SEG-')) {
    const seg = id.startsWith('SEG-') ? m.segments.find((s) => s.id === id) : undefined
    const frame = m.frames.find((f) => f.id === (seg?.frame ?? id))
    if (!frame) return <p className="text-[0.78rem] text-muted">Frame not captured in this session.</p>
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-line"><FrameOverlay frame={frame} segments={m.segments} highlight={seg?.id} /></div>
        <p className="text-[0.85rem] text-ink">{frame.label}</p>
        {seg ? (
          <div>
            <Row k="Concept" v={seg.concept} />
            {seg.confidence != null && <Row k="Confidence" v={seg.confidence.toFixed(2)} />}
            <Row k="Box (px)" v={`${seg.box.x1},${seg.box.y1} → ${seg.box.x2},${seg.box.y2}`} />
            <Row k="Unprojected" v={seg.point ? seg.point.map((v) => v.toFixed(2)).join(', ') + ' m' : 'missed the module'} />
            {seg.feature && <Row k="Nearest feature" v={<span className={seg.feature.id === 'damage' ? 'text-failed' : ''}>{seg.feature.id} · {seg.feature.distance.toFixed(2)} m</span>} />}
          </div>
        ) : (
          <div><Row k="Module" v={frame.module} /><Row k="FOV" v={`${frame.camera.fovDeg}°`} /><Row k="Size" v={`${frame.width} × ${frame.height}`} /></div>
        )}
        <p className="text-[0.7rem] leading-5 text-muted">Rendered from the live scene by the servicer camera; SAM 3.1 boxes are unprojected through this pinhole onto the module.</p>
      </div>
    )
  }
  if (id.startsWith('WEB-')) {
    const c = citations.get(id)
    return c?.url ? (
      <a href={c.url} target="_blank" rel="noreferrer" className="text-[0.85rem] break-all text-accent underline">{c.label || c.url}</a>
    ) : <p className="text-[0.78rem] text-muted">No URL returned for this source.</p>
  }
  const r = m.api.recordById(id)
  if (!r) return <p className="text-[0.78rem] text-muted">{citations.get(id)?.label ?? 'Record not found.'}</p>
  return (
    <div className="space-y-3">
      <p className="text-[0.95rem] leading-6 text-ink">{r.title}</p>
      <div className="flex gap-2 font-mono text-[0.62rem] text-muted">
        <span className="rounded border border-line px-1.5">{KIND[r.kind] ?? r.kind}</span>
        <span className="rounded border border-line px-1.5">{r.module === '*' ? 'all modules' : r.module}</span>
        <span className="rounded border border-line px-1.5">{r.date}</span>
      </div>
      <p className={`text-[0.8rem] leading-6 ${r.kind === 'ncr' ? 'text-ink' : 'text-ink-2'}`}>{r.body}</p>
      {r.values && <div>{Object.entries(r.values).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}</div>}
    </div>
  )
}

export function RecordDrawer({ id, m, citations, onClose, onOpen }: { id: string | null; m: Mission; citations: Map<string, Citation>; onClose: () => void; onOpen: (id: string) => void }) {
  useEffect(() => {
    if (!id) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [id, onClose])
  if (!id) return null
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={id}>
      <button type="button" className="lt-fade absolute inset-0 cursor-default bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="glass lt-rise absolute top-3 right-3 bottom-3 flex w-[min(440px,calc(100vw-24px))] flex-col rounded-xl bg-panel-solid/90">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="font-mono text-[0.78rem] text-accent">{id}</span>
          <button type="button" onClick={onClose} className="ml-auto rounded-md px-2 py-0.5 font-mono text-[0.66rem] text-muted hover:text-ink">esc</button>
        </header>
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-4">
          <Body id={id} m={m} citations={citations} onOpen={onOpen} />
        </div>
      </aside>
    </div>
  )
}
