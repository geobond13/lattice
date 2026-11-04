'use client'
// A 2D stand-in for the 3D scene (mock mode only): the ring in perspective, slowly rotating, modules tinted by
// status (or generation), the servicer approaching along the corridor. Implements the same handle.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import type { ModuleStatus } from '@/contracts'
import type { LatticeSceneHandle, LatticeSceneProps } from '@/scene'
import { GEN_COLOR } from './fleet'
import { mockFrames } from './mocks'

const STATUS: Partial<Record<ModuleStatus, string>> = {
  nominal: '#7d8ca3', degraded: '#f2b84b', failed: '#ff5d5d', draining: '#59d6ff', drained: '#59d6ff', undocked: '#59d6ff', docking: '#9aa7ff', spare: '#9aa7ff', departed: '#ff5d5d',
}

function stars(n: number) {
  let s = 7
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  return Array.from({ length: n }, () => ({ x: r() * 100, y: r() * 70, o: 0.15 + r() * 0.6, s: r() < 0.08 ? 1.6 : 0.9 }))
}

export const MockScene = forwardRef<LatticeSceneHandle, LatticeSceneProps>(function MockScene({ layout, pose, modules, focus, damage, generations, view, className }, ref) {
  const [a, setA] = useState(0)
  useEffect(() => {
    let raf = 0
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = (now: number) => { setA(reduce ? 0.6 : now / 60000); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  useImperativeHandle(ref, () => ({
    captureInspection: async (module) => {
      await new Promise((r) => setTimeout(r, 1600))
      return mockFrames(module, damage ?? 'radiator-puncture')
    },
  }), [damage])
  const sky = useMemo(() => stars(160), [])

  const zoom = view === 'follow' && focus ? 1.5 : 1
  const fm = focus ? layout.modules.find((m) => m.id === focus) : undefined
  const ring = layout.modules.filter((m) => m.slot != null)
  const W = 1000, H = 640, cx = 500, cy = 300, S = 15 * zoom, tilt = 0.34
  // rotate so the focus module drifts to the front in follow view
  const rot = view === 'follow' && fm ? -Math.atan2(fm.position[2], fm.position[0]) + Math.PI / 2 : a * Math.PI * 2
  const proj = (x: number, z: number) => {
    const xr = x * Math.cos(rot) - z * Math.sin(rot)
    const zr = x * Math.sin(rot) + z * Math.cos(rot)
    return { x: cx + xr * S, y: cy + zr * S * tilt, d: zr }
  }
  const items = ring.map((m) => ({ m, p: proj(m.position[0], m.position[2]) })).sort((u, v) => u.p.d - v.p.d)

  let servicer: { x: number; y: number } | null = null
  if (fm && pose.phase) {
    const r = Math.hypot(fm.position[0], fm.position[2])
    const k = (r + 1.6 + pose.range) / r
    servicer = proj(fm.position[0] * k, fm.position[2] * k)
  }

  return (
    <div className={`overflow-hidden ${className ?? ''}`} style={{ background: 'radial-gradient(120% 70% at 50% 120%, #0d2f55 0%, #071526 35%, #05070b 62%)' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="size-full">
        {sky.map((s, i) => <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.s} fill="#cfe3ff" opacity={s.o} />)}
        <ellipse cx={cx} cy={H + 980} rx={1500} ry={1080} fill="none" stroke="#3f9bdc" strokeOpacity={0.35} strokeWidth={2} />
        <ellipse cx={cx} cy={H + 980} rx={1500} ry={1080} fill="#06182b" fillOpacity={0.6} />
        {/* solar wings along the ring axis */}
        <rect x={cx - 6} y={cy - 220 * zoom} width={12} height={440 * zoom} fill="#1b2c44" stroke="#3a5f8a" strokeOpacity={0.5} />
        <ellipse cx={cx} cy={cy} rx={14 * S} ry={14 * S * tilt} fill="none" stroke="#9fb7d6" strokeOpacity={0.22} strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={10 * zoom} fill="#0e1622" stroke="#9fb7d6" strokeOpacity={0.4} />
        {items.map(({ m, p }) => {
          const st = modules[m.id]?.status ?? 'nominal'
          if (st === 'departed') return null
          const gen = generations?.[m.id]
          const fill = gen ? GEN_COLOR[gen] : STATUS[st] ?? '#7d8ca3'
          const front = (p.d + 14) / 28
          const w = (2.4 * S) * (0.75 + 0.35 * front), h = 2 * S * 0.75 * (0.75 + 0.35 * front)
          const isFocus = m.id === focus
          return (
            <g key={m.id} opacity={0.55 + 0.45 * front}>
              {isFocus && st !== 'nominal' && <circle cx={p.x} cy={p.y} r={w * 1.1} fill={fill} opacity={0.12} />}
              <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={3} fill="#0d131c" stroke={fill} strokeWidth={isFocus ? 2 : 1.2} />
              <rect x={p.x - w / 2 + 3} y={p.y - h / 2 + 3} width={w - 6} height={3} rx={1} fill={fill} opacity={0.8} />
              <text x={p.x} y={p.y + h / 2 + 13} textAnchor="middle" fontSize={10} fontFamily="var(--font-geist-mono)" fill={isFocus ? '#e8eef7' : '#6f7d92'}>{m.id}</text>
            </g>
          )
        })}
        {servicer && (
          <g>
            <circle cx={servicer.x} cy={servicer.y} r={10} fill="#59d6ff" opacity={0.15 + pose.servicer.thrust * 0.2} />
            <rect x={servicer.x - 5} y={servicer.y - 5} width={10} height={10} rx={2} fill="#59d6ff" />
          </g>
        )}
      </svg>
    </div>
  )
})
