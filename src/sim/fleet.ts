// Fleet economics 2027–2037 (DESIGN.md "Why modular"). Illustrative, deterministic.
// Rolling refresh: every module serves ~4 years, then is swapped for the newest generation available.
// First refreshes are staggered 2/3/4/3 modules a year from 2029 so capacity steps up smoothly.
// The monolith of equal launch mass keeps its Gen-1 chips, loses ~6 %/yr to unrepaired failures, and is
// stranded (0) after its 2032 end of design life.
import type { FleetModule, FleetYear, Generation } from '@/contracts'
import { RING_IDS } from './lattice'

export const FLEET_START = 2027
export const FLEET_END = 2037
export const GEN_PERF_KW: Record<Generation, number> = { 1: 1.0, 2: 2.4, 3: 5.2, 4: 10 }
const GEN_FROM: Record<Generation, number> = { 1: 2027, 2: 2029, 3: 2032, 4: 2035 }
const GEN_GPU: Record<Generation, string> = { 1: '2026-class GPU', 2: '2028-class GPU', 3: '2031-class GPU', 4: '2034-class GPU' }
export const SERVICE_YEARS = 4
export const MONOLITH = { attritionPerYear: 0.06, endOfLife: 2032 }
/** Refresh cohort sizes 2029, 2030, 2031, 2032; each cohort then refreshes again 4 years later. */
const COHORTS = [2, 3, 4, 3]

export const newestGen = (year: number): Generation => ([4, 3, 2, 1] as Generation[]).find((g) => year >= GEN_FROM[g]) as Generation
const mk = (module: string, g: Generation, year: number): FleetModule => ({ module, generation: g, gpu: `Gen-${g} · ${GEN_GPU[g]}`, installedYear: year, perfPerKw: GEN_PERF_KW[g] })

let cache: FleetYear[] | null = null
export function fleetTimeline(): FleetYear[] {
  if (!cache) {
    // first refresh year per module
    const first: number[] = []
    COHORTS.forEach((n, i) => { for (let j = 0; j < n; j++) first.push(2029 + i) })
    let fleet = RING_IDS.map((id) => mk(id, 1, FLEET_START))
    const out: FleetYear[] = []
    for (let year = FLEET_START; year <= FLEET_END; year++) {
      let swaps = 0
      fleet = fleet.map((m, k) => {
        const due = m.installedYear === FLEET_START ? year === first[k] : year - m.installedYear >= SERVICE_YEARS
        const g = newestGen(year)
        if (!due || g <= m.generation) return m
        swaps++
        return mk(m.module, g, year)
      })
      const capacity = Math.round((1000 * fleet.reduce((a, m) => a + m.perfPerKw, 0)) / RING_IDS.length) / 10
      const monolithCapacity = year > MONOLITH.endOfLife ? 0 : Math.round(1000 * Math.pow(1 - MONOLITH.attritionPerYear, year - FLEET_START)) / 10
      out.push({ year, modules: fleet, capacity, monolithCapacity, swaps })
    }
    cache = out
  }
  return cache.map((y) => ({ ...y, modules: y.modules.map((m) => ({ ...m })) }))
}
export function fleetAt(year: number): FleetYear | undefined {
  return fleetTimeline().find((y) => y.year === year)
}
