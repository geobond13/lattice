// As-built pedigree: build travelers, test reports, NCRs, FRU catalogue, ICDs and ops records.
// Includes deliberate distractors (closed, unrelated NCRs) so the agent has to read, not pattern-match.
import type { ModuleId, ModuleRecord } from '@/contracts'

const R: ModuleRecord[] = [
  // ── Lattice-wide ──
  {
    id: 'ICD-DOCK-01', kind: 'icd', module: '*', title: 'Module-to-truss docking interface', date: '2025-03-14',
    body: 'Each slot mates through 4 motorised dock latches carrying power (2 × 120 V buses), coolant QDs and 400 Gb/s data. Max sustained latch load 4500 N per latch ring; above it the ring may shear. Undock requires a drained module (util 0 %).',
    values: { latches: 4, latchLimitN: 4500, busV: 120, dataGbps: 400, undockUtilPct: 0 },
  },
  {
    id: 'ICD-GRP-01', kind: 'icd', module: '*', title: 'Grapple fixture standard', date: '2025-03-14',
    body: 'Probe-and-cone grapple fixture at the centre of every module +X face. Capture envelope ±0.10 m, ±5°; contact closing speed ≤ 0.05 m/s. Rated for towing a 9 t module at 0.05 m/s².',
    values: { captureM: 0.1, captureDeg: 5, contactSpeedMs: 0.05, towMassT: 9, towAccelMs2: 0.05 },
  },
  {
    id: 'FRU-RAD-02', kind: 'fru', module: '*', title: 'Radiator panel: field-replaceable unit', date: '2025-06-02',
    body: 'Radiator panels A and B are field-replaceable by the servicer. 4 latches along the outer edge, torqued to 12 N·m. Swap time 22 min including loop refill. The servicer carries 2 spare panels.',
    values: { latches: 4, torqueNm: 12, swapMin: 22, sparesCarried: 2, panelM: '2.8 x 1.6' },
  },
  {
    id: 'FRU-PDU-01', kind: 'fru', module: '*', title: 'Power distribution unit: field-replaceable unit (generic catalogue)', date: '2025-06-02',
    body: 'The PDU on the −Y face is field-replaceable: 8 blind-mate connectors, 6 captive fasteners. Swap time 35 min with the module drained and bus A safed. Applies unless an as-built record says otherwise.',
    values: { connectors: 8, fasteners: 6, swapMin: 35 },
  },
  {
    id: 'OPS-SEP-03', kind: 'ops', module: '*', title: 'Module separation procedure', date: '2025-09-20',
    body: 'Emergency separation uses the dock-port spring stack: 0.3 m/s along −corridor (radially out). Expect up to 0.05 °/s tumble. Checkpoint and drain first; separation is irreversible without servicer recapture.',
    values: { springMs: 0.3, maxTumbleDegS: 0.05 },
  },
  {
    id: 'OPS-PRX-01', kind: 'ops', module: '*', title: 'Proximity operations rules', date: '2025-09-20',
    body: 'Approach along the target slot radial corridor (10° half-angle) with holds at 30 m and 10 m. Closing speed ≤ 0.01·range + 0.02 m/s. No entry into the 20 m keep-out sphere without a go at the 10 m hold.',
    values: { holdsM: '30, 10', corridorHalfAngleDeg: 10, vSlope: 0.01, vFloorMs: 0.02, keepOutM: 20 },
  },
  {
    id: 'OPS-DSP-02', kind: 'ops', module: '*', title: 'Disposal burn and reentry corridor', date: '2025-10-01',
    body: 'Servicer tugs a separated module into the disposal corridor: 120 s burn at 0.03 m/s², release, climb clear. Screen the corridor before the burn: conjunction Pc must be below 1e-5.',
    values: { burnS: 120, accelMs2: 0.03, maxPc: '1e-5' },
  },
  {
    id: 'TR-0640', kind: 'test', module: '*', title: 'Servicer arm reach and grapple qualification', date: '2025-08-11',
    body: 'Two 3-segment arms on the bus front face, shoulders ±0.5 m. Demonstrated reach 2.6 m at full torque; planned standoff 1.6 m from the module face. 200 grapple cycles, no failures.',
    values: { reachM: 2.6, shoulderOffsetM: 0.5, standoffM: 1.6, cycles: 200 },
  },
  // ── M-09 ──
  {
    id: 'BLD-M09', kind: 'build', module: 'M-09', title: 'M-09 build traveler', date: '2026-01-22',
    body: 'Gen-1 compute module, 8 GPU trays, dual coolant loops A/B, radiator panels SN RP-0917 (A) and RP-0918 (B). Integrated 2026-01-22, launched 2026-03-30. Open items at ship: none.',
    values: { generation: 1, gpuTrays: 8, radiatorA: 'RP-0917', radiatorB: 'RP-0918', launched: '2026-03-30' },
  },
  {
    id: 'TR-1180', kind: 'test', module: 'M-09', title: 'M-09 thermal-vacuum test: single-loop rejection', date: '2026-02-09',
    body: 'With loop B valved off, loop A alone rejected 6.1 kW at 85 °C GPU. The module dissipates 7.4 kW at 92 % util, so one loop holds only at ≤ 74 % util.',
    values: { singleLoopKw: 6.1, atGpuC: 85, dissipationKw: 7.4, atUtilPct: 92, singleLoopMaxUtilPct: 74 },
  },
  {
    id: 'TR-1176', kind: 'test', module: 'M-09', title: 'M-09 coolant loop proof-pressure and leak test', date: '2026-02-03',
    body: 'Both loops proofed to 465 kPa, operating at 310 kPa. Leak rate below 0.1 kPa/h. Isolation valves close in 0.8 s.',
    values: { proofKPa: 465, operatingKPa: 310, leakKPaPerH: 0.1, isoValveS: 0.8 },
  },
  {
    id: 'TR-1191', kind: 'test', module: 'M-09', title: 'M-09 acceptance vibration', date: '2026-02-17',
    body: 'Random vibration 6.8 grms, 3 axes. No resonance shifts above 5 %. Pass.',
    values: { grms: 6.8, result: 'pass' },
  },
  {
    id: 'NCR-0356', kind: 'ncr', module: 'M-09', title: 'Radiator A coating scratch (closed)', date: '2026-01-28',
    body: 'A 40 mm scratch in the radiator A white coating; emissivity loss below 0.2 %. Disposition: use as is. Closed.',
    values: { status: 'closed', disposition: 'use as is' },
  },
  {
    id: 'NCR-0371', kind: 'ncr', module: 'M-09', title: 'Connector J14 torque out of spec (closed)', date: '2026-02-05',
    body: 'Data connector J14 found at 0.6 N·m against 0.9 N·m. Re-torqued and witnessed. Closed.',
    values: { status: 'closed', disposition: 'rework' },
  },
  // ── M-04 ──
  {
    id: 'BLD-M04', kind: 'build', module: 'M-04', title: 'M-04 build traveler', date: '2025-12-04',
    body: 'Gen-1 compute module, dual 120 V buses A/B. PDU SN PD-0433 reworked under NCR-0412 before integration. Launched 2026-03-30.',
    values: { generation: 1, pdu: 'PD-0433', reworkNcr: 'NCR-0412', launched: '2026-03-30' },
  },
  {
    id: 'NCR-0412', kind: 'ncr', module: 'M-04', title: 'PDU harness potted during rework: PDU not field-replaceable', date: '2025-11-26',
    body: 'During rework of a chafed bus A harness, the PDU harness was potted into the module frame. The PDU on M-04 is NOT field-replaceable; this overrides FRU-PDU-01 for this unit. Disposition: use as is, swap the module if the PDU fails.',
    values: { status: 'closed', disposition: 'use as is', fieldReplaceable: 'no', overrides: 'FRU-PDU-01' },
  },
  {
    id: 'TR-0977', kind: 'test', module: 'M-04', title: 'M-04 single-bus endurance test', date: '2025-12-12',
    body: 'Bus B alone carried 3.6 kW for 72 h, stable within ±0.4 V. Util capped at 48 % on one bus. No hazard on single-bus operation.',
    values: { busBKw: 3.6, hours: 72, utilCapPct: 48, hazard: 'none' },
  },
  {
    id: 'TR-0962', kind: 'test', module: 'M-04', title: 'M-04 power quality acceptance', date: '2025-12-08',
    body: 'Bus ripple 0.8 % at full load, transient recovery 2.1 ms. Pass.',
    values: { ripplePct: 0.8, recoveryMs: 2.1, result: 'pass' },
  },
  {
    id: 'NCR-0398', kind: 'ncr', module: 'M-04', title: 'Bus A ripple out of spec at first test (closed)', date: '2025-11-14',
    body: 'Bus A ripple 2.3 % against 1.5 %. Filter capacitor C41 replaced, retest passed (TR-0962). Closed.',
    values: { status: 'closed', disposition: 'rework' },
  },
  {
    id: 'NCR-0405', kind: 'ncr', module: 'M-04', title: 'Thermal blanket tear (closed)', date: '2025-11-20',
    body: 'A 25 mm tear in the −Z blanket, repaired with tape per process spec. Closed.',
    values: { status: 'closed', disposition: 'repair' },
  },
  // ── Spares ──
  {
    id: 'TR-1302', kind: 'test', module: 'S-1', title: 'Spare S-1 burn-in: qualified (Gen-2)', date: '2026-08-19',
    body: 'Gen-2 spare S-1 completed 168 h powered burn-in with no GPU faults and passed docking-interface checkout (ICD-DOCK-01). Qualified for flight swap. Gen-2 delivers 2.4× the compute per kW of Gen-1.',
    values: { generation: 2, perfPerKw: 2.4, burnInH: 168, result: 'pass', qualified: 'yes' },
  },
  {
    id: 'TR-1303', kind: 'test', module: 'S-2', title: 'Spare S-2 burn-in: retest open (Gen-2)', date: '2026-08-21',
    body: 'Gen-2 spare S-2 failed GPU tray 5 at 131 h of burn-in. Tray replaced; 168 h retest not yet run. Not qualified for flight swap.',
    values: { generation: 2, perfPerKw: 2.4, burnInH: 131, result: 'fail', qualified: 'no' },
  },
  // ── M-11 ──
  {
    id: 'BLD-M11', kind: 'build', module: 'M-11', title: 'M-11 build traveler', date: '2026-01-30',
    body: 'Gen-1 compute module with 4 RCS pods for station-keeping assist; thruster 3 latch valve SN LV-1107 accepted under NCR-0388. Launched 2026-03-30.',
    values: { generation: 1, rcsPods: 4, valve: 'LV-1107', launched: '2026-03-30' },
  },
  {
    id: 'NCR-0388', kind: 'ncr', module: 'M-11', title: 'Thruster 3 latch valve accepted with slow actuation', date: '2026-01-19',
    body: 'Latch valve LV-1107 closed in 340 ms against a 200 ms spec. Accepted as is with a slow-actuation waiver; recommended monitoring for sticking.',
    values: { status: 'closed', closeMs: 340, specMs: 200, disposition: 'use as is' },
  },
  {
    id: 'OPS-VALVE-07', kind: 'ops', module: 'M-11', title: 'Thruster 3 valve close command: no response', date: '2026-11-04',
    body: 'Close command sent to thruster 3 latch valve at t = 70 s and repeated at t = 95 s; valve position telemetry unchanged (open). Upstream isolation not available on this pod.',
    values: { commandT: 70, retryT: 95, response: 'none' },
  },
  {
    id: 'TR-1244', kind: 'test', module: 'M-11', title: 'M-11 RCS hot-fire acceptance', date: '2026-01-26',
    body: 'All 4 pods fired 50 pulses each. Thruster 3 response time 340 ms (see NCR-0388); others 180 ms. Pass with waiver.',
    values: { pulses: 50, t3ResponseMs: 340, result: 'pass with waiver' },
  },
  {
    id: 'NCR-0379', kind: 'ncr', module: 'M-11', title: 'MLI blanket stitching (closed)', date: '2026-01-12',
    body: 'Two stitches missing on the +Y blanket closeout. Restitched. Closed.',
    values: { status: 'closed', disposition: 'rework' },
  },
  {
    id: 'NCR-0391', kind: 'ncr', module: 'M-11', title: 'Star tracker baffle dent (closed)', date: '2026-01-21',
    body: '1 mm dent on the star tracker baffle, outside the optical path. Use as is. Closed.',
    values: { status: 'closed', disposition: 'use as is' },
  },
]

export function records(module?: ModuleId): ModuleRecord[] {
  const list = module === undefined ? R : R.filter((r) => r.module === module)
  return list.map((r) => ({ ...r, ...(r.values ? { values: { ...r.values } } : {}) }))
}
export function recordById(id: string): ModuleRecord | undefined {
  const key = id.trim().toUpperCase()
  const r = R.find((x) => x.id === key)
  return r ? { ...r, ...(r.values ? { values: { ...r.values } } : {}) } : undefined
}
