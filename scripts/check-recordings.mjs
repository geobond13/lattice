// Sanity-checks public/recordings/*.json: decision tiers vs expected, citation hygiene, Meta tooling coverage.
import { readFileSync, readdirSync } from 'node:fs'
const EXPECT = { 'radiator-puncture': 'REPAIR_FRU:auto', 'power-bus-short': 'SWAP_MODULE:gated', 'thruster-stuck': 'DEORBIT_MODULE:auto' }
let bad = 0
for (const f of readdirSync('public/recordings').filter((f) => f.endsWith('.json'))) {
  const sc = f.replace('.json', '')
  const ev = JSON.parse(readFileSync(`public/recordings/${f}`, 'utf8')).map((r) => r.event)
  const decisions = ev.filter((e) => e.type === 'decision').map((e) => `${e.decision.action}:${e.decision.tier}`)
  const answer = ev.find((e) => e.type === 'answer')
  const done = ev.find((e) => e.type === 'done')
  const problems = []
  if (!decisions.includes(EXPECT[sc])) problems.push(`expected ${EXPECT[sc]}`)
  if (!answer) problems.push('no answer')
  else {
    if (answer.unknownIds.length) problems.push(`unknown ids ${answer.unknownIds}`)
    if (answer.numbers?.unsupported?.length) problems.push(`unsupported numbers ${answer.numbers.unsupported}`)
    if (!answer.citations.some((c) => c.type === 'web' && c.url)) problems.push('no WEB citation')
  }
  if (!ev.some((e) => e.type === 'segments' && e.segments.length)) problems.push('no SAM segments')
  if (!ev.some((e) => e.type === 'vision' && !/filter|error/i.test(e.findings))) problems.push('no clean vision read')
  if (ev.some((e) => e.type === 'error')) problems.push('error event')
  bad += problems.length ? 1 : 0
  console.log(sc.padEnd(18), decisions.join(' → ').padEnd(70), done ? `${(done.totals.ms / 1000).toFixed(0)}s $${done.totals.costUsd.toFixed(3)}` : '', problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'OK')
}
process.exit(bad ? 1 : 0)
