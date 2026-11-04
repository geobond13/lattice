// Fleet economics helpers (illustrative numbers, docs/DESIGN.md "Why modular").
import type { FleetModule, FleetYear, Generation, ModuleId } from '@/contracts'

export const GEN_PERF: Record<Generation, number> = { 1: 1.0, 2: 2.4, 3: 5.2, 4: 10 }
export const GEN_GPU: Record<Generation, string> = { 1: '2026-class GPU', 2: '2028-class GPU', 3: '2031-class GPU', 4: '2034-class GPU' }
/** Sequential single-hue ramp (dim steel → cyan-white): older reads quieter, newer brighter. Lightness monotonic. */
export const GEN_COLOR: Record<Generation, string> = { 1: '#3a6680', 2: '#2f8fbb', 3: '#4cc3ec', 4: '#b4efff' }

/** Spares at the depot are next-generation (Gen-2); docked modules start at Gen-1. */
export const defaultGeneration = (id: ModuleId): Generation => (id.startsWith('S-') ? 2 : 1)

/** Mock of sim `fleetTimeline()`: rolling refresh, each module serves ~4 years, then the newest generation goes in. */
export function mockFleetTimeline(): FleetYear[] {
  const avail = (y: number): Generation => (y >= 2035 ? 4 : y >= 2032 ? 3 : y >= 2029 ? 2 : 1)
  const ids = Array.from({ length: 12 }, (_, k) => `M-${String(k + 1).padStart(2, '0')}`)
  let fleet: FleetModule[] = ids.map((module) => ({ module, generation: 1, gpu: `Gen-1 · ${GEN_GPU[1]}`, installedYear: 2027, perfPerKw: 1 }))
  const out: FleetYear[] = []
  for (let year = 2027; year <= 2037; year++) {
    let swaps = 0
    fleet = fleet.map((m, k) => {
      // stagger: first refresh between 2029 and 2032, then every 4 years
      const due = m.installedYear === 2027 ? year >= 2029 + (k % 4) : year - m.installedYear >= 4
      if (!due || avail(year) <= m.generation) return m
      swaps++
      const g = avail(year)
      return { module: m.module, generation: g, gpu: `Gen-${g} · ${GEN_GPU[g]}`, installedYear: year, perfPerKw: GEN_PERF[g] }
    })
    const capacity = Math.round((fleet.reduce((a, m) => a + m.perfPerKw, 0) / 12) * 100)
    const age = year - 2027
    const monolithCapacity = age <= 2 ? 100 : age >= 8 ? 0 : Math.round(100 * Math.pow(0.8, age - 2))
    out.push({ year, modules: fleet, capacity, monolithCapacity, swaps })
  }
  return out
}
