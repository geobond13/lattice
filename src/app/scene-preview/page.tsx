'use client'
// Dev-only: 3D scene preview (scene workstream). Safe to delete.
import dynamic from 'next/dynamic'

const ScenePreview = dynamic(() => import('@/scene/__preview'), { ssr: false })

export default function Page() {
  return <ScenePreview />
}
