// Camera frames for a run (server-only): validate client frames, or fall back to the pre-captured set in
// public/frames/<scenario>/ (frames.json + CAM-n.jpg). Public paths are resolved to data URLs for the models.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CameraFrame, ScenarioId, Vec3 } from '@/contracts'

export const FRAME_LIMITS = { count: 4, bytes: 1_200_000 }

const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/
const FRAME_PATH = /^\/frames\/[a-z0-9-]+\/[A-Za-z0-9_-]+\.(?:jpe?g|png)$/
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
const dataUrlBytes = (s: string) => Math.floor((s.length - s.indexOf(',') - 1) * 3 / 4)

/** Validate one client frame. Returns an error string or the clean frame (only known fields kept). */
export function validateFrame(raw: unknown, i: number): CameraFrame | string {
  const f = raw as Partial<CameraFrame> | null
  if (!f || typeof f !== 'object') return `frame ${i}: not an object`
  if (typeof f.id !== 'string' || !/^CAM-\d{1,2}$/.test(f.id)) return `frame ${i}: id must be CAM-n`
  if (typeof f.src !== 'string') return `frame ${f.id}: src missing`
  if (f.src.startsWith('data:')) {
    if (!JPEG_DATA_URL.test(f.src)) return `frame ${f.id}: src must be a data:image/jpeg;base64 URL`
    if (dataUrlBytes(f.src) > FRAME_LIMITS.bytes) return `frame ${f.id}: larger than ${FRAME_LIMITS.bytes / 1e6} MB`
  } else if (!FRAME_PATH.test(f.src) || f.src.includes('..')) return `frame ${f.id}: src must be a JPEG data URL or a /frames/ path`
  if (!(Number(f.width) > 0 && Number(f.height) > 0 && Number(f.width) <= 4096 && Number(f.height) <= 4096)) return `frame ${f.id}: bad size`
  const c = f.camera
  if (!c || !isVec3(c.position) || !isVec3(c.target) || !isVec3(c.up) || !(c.fovDeg > 1 && c.fovDeg < 179)) return `frame ${f.id}: bad camera`
  if (typeof f.module !== 'string' || !/^(M-\d{2}|S-\d)$/.test(f.module)) return `frame ${f.id}: bad module`
  return {
    id: f.id, label: String(f.label ?? f.id).slice(0, 80), src: f.src, width: Number(f.width), height: Number(f.height),
    camera: { position: c.position, target: c.target, up: c.up, fovDeg: c.fovDeg }, module: f.module,
  }
}

export function validateFrames(raw: unknown): { frames: CameraFrame[] } | { error: string } {
  if (raw === undefined || raw === null) return { frames: [] }
  if (!Array.isArray(raw)) return { error: 'frames must be an array' }
  if (raw.length > FRAME_LIMITS.count) return { error: `at most ${FRAME_LIMITS.count} frames` }
  const frames: CameraFrame[] = []
  for (const [i, r] of raw.entries()) {
    const v = validateFrame(r, i)
    if (typeof v === 'string') return { error: v }
    frames.push(v)
  }
  if (new Set(frames.map((f) => f.id)).size !== frames.length) return { error: 'frame ids must be unique' }
  return { frames }
}

const publicDir = () => path.join(process.cwd(), 'public')

/** Pre-captured frames for a scenario, or [] when the set has not been generated yet. */
export async function defaultFrames(scenario: ScenarioId): Promise<CameraFrame[]> {
  try {
    const raw = JSON.parse(await readFile(path.join(publicDir(), 'frames', scenario, 'frames.json'), 'utf8')) as unknown
    const v = validateFrames(Array.isArray(raw) ? raw.slice(0, FRAME_LIMITS.count) : raw)
    return 'frames' in v ? v.frames : []
  } catch {
    return []
  }
}

/** Replace /frames/ paths with data URLs (the models need the bytes). Frames whose file is missing are dropped. */
export async function resolveFrames(frames: CameraFrame[]): Promise<CameraFrame[]> {
  const out: CameraFrame[] = []
  for (const f of frames) {
    if (f.src.startsWith('data:')) { out.push(f); continue }
    const file = path.join(publicDir(), ...f.src.split('/').filter(Boolean))
    if (!file.startsWith(path.join(publicDir(), 'frames'))) continue
    try {
      const bytes = await readFile(file)
      if (bytes.length > FRAME_LIMITS.bytes) continue
      const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg'
      out.push({ ...f, src: `data:${mime};base64,${bytes.toString('base64')}` })
    } catch { /* not generated yet */ }
  }
  return out
}
