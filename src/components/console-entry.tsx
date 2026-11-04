'use client'

import dynamic from 'next/dynamic'
import { useSyncExternalStore } from 'react'
import { useAgentRuns } from '@/agent/client'
import { realApi } from '@/ui/api'
import { MockScene } from '@/ui/mock-scene'
import { mockApi, useMockAgentRuns } from '@/ui/mocks'
import { Console, type SceneComponent } from './console'
import { Wordmark } from './top-bar'

const LatticeScene3D = dynamic(() => import('@/scene').then((mod) => mod.LatticeScene), { ssr: false }) as SceneComponent

/** Re-read the query string on history changes (the demo recorder retunes replay pacing between scenes). */
const onHistory = (cb: () => void) => { window.addEventListener('popstate', cb); return () => window.removeEventListener('popstate', cb) }

/** Recorded runs keep their real pacing, but no single model pause lasts longer than `?pace=` seconds (default 6); `?speed=` fast-forwards. */
function RealConsole({ search }: { search: string }) {
  const q = new URLSearchParams(search)
  const pace = Number(q.get('pace') ?? 6)
  const speed = Number(q.get('speed') ?? 1)
  const agent = useAgentRuns({ maxGapMs: Number.isFinite(pace) && pace > 0 ? pace * 1000 : undefined, speed: speed > 0 ? speed : 1 })
  return <Console api={realApi} agent={agent} Scene={LatticeScene3D} />
}

function MockConsole({ scene3d }: { scene3d: boolean }) {
  const agent = useMockAgentRuns()
  return <Console api={mockApi} agent={agent} Scene={scene3d ? LatticeScene3D : (MockScene as SceneComponent)} mock />
}

/** `?mock=1` runs the console on the local mock layer; `&scene=3d` keeps mock data but uses the real 3D scene. */
export function ConsoleEntry() {
  const search = useSyncExternalStore(onHistory, () => window.location.search, () => null)
  if (search == null) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg">
        <span className="lt-pulse"><Wordmark /></span>
      </div>
    )
  }
  const q = new URLSearchParams(search)
  return q.get('mock') === '1' ? <MockConsole scene3d={q.get('scene') === '3d'} /> : <RealConsole search={search} />
}
