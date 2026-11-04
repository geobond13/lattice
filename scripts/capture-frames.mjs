// Pre-captures the servicer's inspection frames for each scenario from the live 3D console, so the agent API and
// eval have real frames when a client sends none. Usage: dev server on :3100, then `node scripts/capture-frames.mjs [scenario…]`.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const TITLES = { 'radiator-puncture': /M-09/, 'power-bus-short': /M-04/, 'thruster-stuck': /M-11/ }
const only = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
for (const [scenario, title] of Object.entries(TITLES)) {
  if (only.length && !only.includes(scenario)) continue
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.locator('button', { hasText: title }).first().click()
  await page.getByRole('button', { name: /Run scenario/ }).first().click()
  await page.waitForFunction((s) => window.__latticeFrames?.scenario === s && window.__latticeFrames.frames.length > 0, scenario, { timeout: 120_000 })
  const { frames } = await page.evaluate(() => window.__latticeFrames)
  const dir = path.join('public', 'frames', scenario)
  mkdirSync(dir, { recursive: true })
  const out = frames.map((f) => {
    writeFileSync(path.join(dir, `${f.id}.jpg`), Buffer.from(f.src.split(',')[1], 'base64'))
    return { ...f, src: `/frames/${scenario}/${f.id}.jpg` }
  })
  writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(scenario, out.map((f) => f.id).join(' '))
}
await browser.close()
