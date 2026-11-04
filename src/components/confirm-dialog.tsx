'use client'

import { useEffect, useRef } from 'react'
import type { Decision } from '@/contracts'
import { ACTION_LABEL } from '@/ui/format'

export function ConfirmDialog({ decision, via, transcript, onConfirm, onCancel }: {
  decision: Decision; via: 'voice' | 'click'; transcript?: string; onConfirm: () => void; onCancel: () => void
}) {
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ok.current?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onCancel])
  const d = decision
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <button type="button" className="lt-fade absolute inset-0 cursor-default bg-black/55 backdrop-blur-[2px]" onClick={onCancel} aria-label="Cancel" />
      <div className="glass lt-rise relative w-full max-w-[400px] rounded-xl bg-panel-solid/90 p-5">
        <p className="eyebrow text-degraded">Operator approval</p>
        {via === 'voice' && transcript && (
          <p className="mt-3 rounded-md border border-line bg-sunken px-3 py-2 text-[0.8rem] text-ink-2">
            <span className="font-mono text-[0.6rem] text-faint">heard · muse-voice-transcribe-1.0</span><br />“{transcript}”
          </p>
        )}
        <h2 id="confirm-title" className="mt-3 text-[1.05rem] font-medium tracking-tight text-ink">
          {ACTION_LABEL[d.action]} {d.params.module}{d.params.spare ? ` → ${d.params.spare}` : ''}?
        </h2>
        <p className="mt-1.5 text-[0.76rem] leading-5 text-muted">
          The servicer will execute the policy-approved ops timeline. {d.checks.filter((c) => c.pass).length}/{d.checks.length} envelope checks pass.
        </p>
        <div className="mt-5 flex gap-2">
          <button ref={ok} type="button" onClick={onConfirm} className="flex-1 rounded-lg bg-degraded px-3 py-2 text-[0.82rem] font-medium text-bg hover:brightness-110">Confirm and execute</button>
          <button type="button" onClick={onCancel} className="rounded-lg border border-line-2 px-3 py-2 text-[0.82rem] text-ink-2 hover:text-ink">Cancel</button>
        </div>
      </div>
    </div>
  )
}
