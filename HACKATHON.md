# What was built during the hackathon

**Event:** Meta Global AI Developer Hackathon (building period Oct 27 – Nov 4, 2026). **Track:** Startups, "Push the Frontier".

## Everything in this repository is new
Every file here was written during the building period, starting from `create-next-app`. The git history shows the whole build. The first commit is the Next.js scaffold; the second freezes the shared contracts.

## Relation to prior work (disclosed)
LATTICE is a new product idea from the team behind **SpaceGrade**, an aerospace build-record and PLM product.

| Prior work (not part of this submission) | What LATTICE does instead |
|---|---|
| **SpaceGradeOS** is the commercial PLM product. It keeps an as-built record of every part: tests, non-conformances and dispositions. | No SpaceGradeOS code or data is used. LATTICE's module records are written for this project. |
| **spacegrade-agent** is an earlier agent demo on a different model provider. It covers single-spacecraft anomaly response. | It reused the *idea*: the as-built record acts as a virtual sensor, and a deterministic policy decides autonomy. It also reused the *pattern*: plan → tool calls → cited answer, streamed as NDJSON. Both were rewritten here against Meta's Model API for a new domain. No files were copied. |

## New in this hackathon
- A modular orbital data center and its servicing simulation:
  - 12 docked compute modules, a two-armed servicer and spares;
  - proximity-operations timelines with hold points, corridor velocity limits and keep-out;
  - three failure scenarios.
- A deterministic safety envelope that decides auto, gated or refused for REPAIR, SWAP and DEORBIT.
- Muse Spark 1.3 runs as planner and executor, at reasoning effort high and minimal respectively.
- Muse Spark vision reads camera frames that are **rendered live from the 3D scene**.
- **SAM 3.1** segments grapple fixtures and FRU latches in those frames. Each mask is unprojected into 3D and becomes the robot arm's grasp target, which the envelope checks.
- Muse web search adds public precedent (MEV, OSAM-1, ISS ORU swaps) with URL citations.
- Muse Voice Transcribe takes operator questions and approvals by voice, and an approval still has to be confirmed on screen.
- The console UI, the 3D scene, the telemetry and the replay recordings.
