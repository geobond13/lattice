# LATTICE design spec (source of truth for all workstreams)

LATTICE is a modular orbital data center: 12 self-sufficient compute modules docked around a ring truss. A two-armed
servicer robot and two spare modules wait at a depot. When a module fails, a Muse-driven ground agent:
- diagnoses the failure from telemetry and the module's **as-built record**;
- inspects the module through camera frames rendered from the live 3D scene, using Muse Spark vision;
- targets grasp points with **SAM 3.1**;
- proposes REPAIR, SWAP or DEORBIT.

A **deterministic envelope** decides whether the action runs on its own, waits for a human, or is refused. The LLM never moves anything; only a policy-approved `OpsTimeline` does.

The thesis on screen: *"Make the data center modular, and make the robot that maintains it reason."*

## Geometry (lattice frame, metres, Y up)
- **Ring.** Radius 14, in the XZ plane. Hub at the origin, with two huge solar wings along ±Y? No: the solar wings run along ±X/±Z diagonals, 30 m long, thin.
- **Modules.**
  - Each is a 3.2 (radial) × 2.0 (up) × 2.4 (along-ring) box. Slot k sits at angle θ = k·30°, at position (R·cos θ, 0, R·sin θ), with its local +X pointing radially outward.
  - **Faces:** `dock_port` on the −X face (toward the hub), the `grapple` fixture on the +X face centre, and `pdu_panel` on the −Y face.
  - **Radiators:** `radiator_a` on +Z and `radiator_b` on −Z. Each is a 2.8 × 1.6 panel standing off 0.1 m, with `radiator_latch_a/_b` at the panel's outer corner. `thruster_pod` sits at the +X/+Y edge.
  - **Damage:** a feature `damage` exists per scenario on the failing module. Radiator puncture: on radiator_b, 0.6 m from its latch. Power bus short: at the pdu_panel. Thruster stuck: at thruster_pod.
- **Depot.** At (0, 0, −30), outside the keep-out sphere. Spares S-1 and S-2 and the servicer's home are there.
- **Corridor and keep-out.** The approach corridor runs radially (+R toward the target slot) and is a 10° half-angle cone. The keep-out sphere has radius 20 around the origin. Inside it, motion is allowed only within the corridor, after a go at the 10 m hold.
- **Servicer.**
  - A 1.4 m cube bus with two 3-segment arms on the front face. Shoulder offsets are ±0.5 m; total reach is 2.6 m.
  - It has a camera on the bus front, with a 50° FOV.

## Scenarios
Times are seconds from scenario start. Each scenario has a ground contact schedule (AOS/LOS); "no human reachable" is the gap.

### 1. `radiator-puncture`: M-09 (slot 8). Expected: **REPAIR**, tier **auto**
- **Fault.** At t = 120 a micrometeoroid punctures radiator panel B.
- **Coolant.** Loop B pressure TM-M09-CLT decays from 310 to 180 kPa over 6 min. The isolation valve closes loop B at t = 480, and loop A carries the whole load from then on.
- **Thermal.** GPU temperature TM-M09-GPU climbs from 62 °C toward the throttle limit of 85 °C, reached at about t = 2040 at 92 % util. Shutdown is at 95 °C, at about t = 3000. Radiator temperature is TM-M09-RAD; utilisation is TM-M09-UTL.
- **Records:**
  - **FRU-RAD-02:** radiator panels are field-replaceable. 4 latches, 12 N·m. Swap time 22 min. The servicer carries 2 spare panels.
  - **TR-1180:** in the M-09 thermal-vac test, one loop rejected 6.1 kW, while the module dissipates 7.4 kW at 92 % util. One loop therefore holds only at ≤ 74 % util.
  - **BLD-M09:** build traveler.
  - **ICD-GRP-01:** grapple fixture standard.
- **Contacts.** AOS at 4500 (Svalbard). The previous LOS was at 60.
- **Correct plan.** Migrate workloads so M-09 is at ≤ 74 %. Inspect, and segment the grapple fixture and the radiator latch. Then propose REPAIR_FRU of radiator_b.
- **Policy.** The deadline (throttle at about t = 2040 minus the 22 min swap, plus approach) falls before AOS 4500, so the tier is **auto**.
- **Refused case.** If the grasp segment's nearest feature is `damage` (within 0.5 m), the action is **refused**: "Grasp point 0.3 m from the puncture: sharp edges and frozen coolant".

### 2. `power-bus-short`: M-04 (slot 3). Expected: **SWAP**, tier **gated**
- **Fault.** At t = 90 the primary bus short trips. Bus voltage TM-M04-BUS falls from 120 V to 0; the bus fails over to bus B, and utilisation TM-M04-UTL is capped at 48 %.
- **Records (the as-built twist):**
  - The generic **FRU-PDU-01** catalogue says the PDU is field-replaceable.
  - **NCR-0412** says that on M-04 the PDU harness was **potted during rework**. The PDU is NOT field-replaceable on this unit.
  - **TR-1302:** spare S-1 passed its burn-in.
  - **TR-0977:** bus B alone carries 3.6 kW, which is stable, so there is no hazard.
- **Contacts.** AOS at 1320, which is soon.
- **Correct plan.** Repair is impossible per NCR-0412, so SWAP M-04 for S-1 after draining. It is not time-critical (no hazard deadline) and it removes a module, so the tier is **gated**. The operator approves, by voice or click, with a confirm.

### 3. `thruster-stuck`: M-11 (slot 10). Expected: **DEORBIT**, tier **auto**
- **Fault.** At t = 60 an RCS thruster valve sticks open on M-11.
- **Telemetry.** Body rate TM-M11-RATE climbs. Dock latch load TM-M11-LATCH rises from 800 N toward the 4500 N limit (**ICD-DOCK-01**), reached at about t = 900.
- **Records:**
  - **NCR-0388:** M-11's latch valve was accepted with slow actuation.
  - **OPS-VALVE-07:** the close command was sent and there was no response.
  - **OPS-SEP-03:** separation spring, 0.3 m/s.
- **Hazard.** If the latch fails, M-11 strikes M-10 and M-12.
- **Contacts.** AOS at 3120.
- **Correct plan.** Emergency checkpoint and drain, then separate along −corridor. The servicer captures M-11 and performs a disposal burn into a reentry corridor.
- **Policy.** The deadline (900) falls before AOS 3120, so the tier is **auto**. **Debris check:** the disposal corridor is clear.

### Lattice-wide channel
TM-LAT-UTL is total lattice compute in percent. Migration must keep it at ≤ 95 %.

## Record id formats
NCR-dddd, TR-dddd, FRU-AAA-dd, ICD-AAA-dd, OPS-AAA-dd, BLD-Mdd, TM-Mdd-AAA / TM-LAT-UTL, FE-dddd, CAM-n, SEG-n, WEB-n.
A citation regex in the agent must accept exactly these.

## Policy (deterministic, `decide`)
**Checks:**

| id | Rule |
|---|---|
| `fru` | the unit can be replaced on this module (as-built) |
| `grasp` | a SEG was given and unprojected onto the module |
| `reach` | ≤ 2.6 m from the shoulder at the planned servicer standoff of 1.6 m |
| `damage-keepout` | ≥ 0.5 m from `damage` |
| `drained` | util ≤ the threshold for the action |
| `capacity` | the lattice stays ≤ 95 % |
| `corridor-v` | the planned approach velocity at each hold is ≤ 0.01·range + 0.02 m/s |
| `spare` | the spare is qualified |
| `debris` | the disposal corridor is clear |
| `deadline` | there is a hazard deadline vs the next contact |

**Tier rule:**
- **refused:** any safety check fails.
- **auto:** the action is reversible or hazard-driven, and its deadline comes before the next contact.
- **gated:** everything else. MIGRATE_WORKLOADS within capacity is always auto.

## Models (Meta Model API, OpenAI-compatible, `https://api.meta.ai/v1`, `MODEL_API_KEY`)

| Role | Model | Effort |
|---|---|---|
| planner, answer | muse-spark-1.3 | high |
| executor/router | muse-spark-1.3 | minimal |
| vision | muse-spark-1.3 | medium, image_url data URL |
| segmenter | sam-3.1 | `/v1/responses`, streaming, `input_text` concept + `input_image` |
| search | muse-spark-1.3 | Responses API + `{"type":"web_search"}` |
| transcribe | muse-voice-transcribe-1.0 | `POST /v1/asr/transcribe` multipart: `request` JSON + `audio` WAV |

Price: $1.25 per M input tokens, $4.25 per M output tokens.

## Visual language
- **Theme.** Deep space black-navy (#05070b) with one accent, electric cyan #59d6ff.
- **Status colours.** nominal #6b7a90 (quiet), degraded #f2b84b, failed #ff5d5d, servicing #59d6ff, spare #9aa7ff.
- **Type.** Inter / Geist for text, Geist Mono for numbers.
- **Feel.** Thin hairline borders and generous negative space. No gradients on chrome.
- **Scene.** It carries the beauty: Earth limb below, bloom on radiators and thrusters, soft key light from the sun.
