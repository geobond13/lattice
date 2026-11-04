// Muse Spark vision: read one servicer camera frame and report what is visible, citing the frame as CAM-n.
import type { CameraFrame, UsageInfo } from '@/contracts'
import { chatUsage, metaClient, MODELS, retryFiltered, usageInfo } from './client'

const SYSTEM = `You are the imagery analyst for an on-orbit servicing robot in an operations simulator (rendered frames, synthetic scene). You look at one rendered frame from the servicer's camera and report only what is visible.
Vocabulary: compute module (box body), radiator panels (flat fins on the ±Z sides), radiator latches (corner fittings), grapple fixture (the +X face centre target the arm grasps), PDU panel (underside), thruster pod (top outer edge), dock port (hub side).
Write 2 to 4 short sentences. Describe visible damage (holes, scorch, debris, venting, discoloration), its location relative to named features, and whether the grapple fixture is clear and unobstructed. Give distances only as rough visual estimates ("about a panel-width"), never as measurements.
Cite the frame id in square brackets after each claim, e.g. [CAM-2]. If the image does not show something, say so; never guess hidden structure.`

/** Ask Muse Spark about a frame. `frame.src` must be a data URL (the server resolves public paths first). */
export async function describeFrame(frame: CameraFrame, question: string, opts: { signal?: AbortSignal } = {}): Promise<{ findings: string; usage: UsageInfo }> {
  const started = Date.now()
  const res = await retryFiltered(() => metaClient().chat.completions.create({
    model: MODELS.vision.model,
    reasoning_effort: MODELS.vision.effort,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: [
        { type: 'text', text: `Frame ${frame.id}: ${frame.label}. Module in view: ${frame.module}. ${frame.width}×${frame.height} px.\nQuestion: ${question}` },
        { type: 'image_url', image_url: { url: frame.src } },
      ] },
    ],
  }, { signal: opts.signal }))
  let findings = (res.choices[0]?.message?.content ?? '').trim()
  // Every finding carries its frame, even if the model forgot the bracket.
  if (findings && !findings.includes(`[${frame.id}]`)) findings += ` [${frame.id}]`
  return { findings: findings || `No usable read of ${frame.id}.`, usage: usageInfo(`vision ${frame.id}`, 'vision', chatUsage(res.usage), Date.now() - started) }
}
