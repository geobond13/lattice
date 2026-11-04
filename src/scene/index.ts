// Public surface of the 3D scene (owned by the scene workstream). STUB: signatures frozen.
import type { CameraFrame, LatticeLayout, ModuleId, ModuleStatus, ScenePose, Segment } from '@/contracts'

export interface LatticeSceneProps {
  layout: LatticeLayout
  pose: ScenePose
  /** Per-module status drives colour/emissive; util drives the server-light shimmer. */
  modules: Record<ModuleId, { status: ModuleStatus; util: number }>
  /** Module the camera should frame (the failing one) and show the damage on. */
  focus: ModuleId | null
  /** Show visible damage for this scenario on the focus module. */
  damage: 'radiator-puncture' | 'power-bus-short' | 'thruster-stuck' | null
  /** Optional: SEG points to draw as 3D markers on the module. */
  markers?: Segment[]
  /** Camera mode: cinematic overview orbit, follow the servicer, or the servicer's own camera. */
  view: 'overview' | 'follow' | 'servicer'
  className?: string
}

export interface LatticeSceneHandle {
  /**
   * Fly-around inspection: render the servicer camera at fixed stations around `module`
   * and return JPEG frames with their pinhole cameras (CAM-1 wide, CAM-2 damage close-up, CAM-3 grapple/FRU close-up).
   */
  captureInspection(module: ModuleId): Promise<CameraFrame[]>
}

export { LatticeScene } from './lattice-scene'
