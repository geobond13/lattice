// Live check of describeFrame on every pre-captured frame.
import { readFileSync } from 'node:fs'
import { describeFrame } from '../src/meta/vision'
async function main() {
  for (const sc of ['radiator-puncture', 'power-bus-short', 'thruster-stuck']) {
    const frames = JSON.parse(readFileSync(`public/frames/${sc}/frames.json`, 'utf8'))
    for (const f of frames) {
      try {
        const r = await describeFrame({ ...f, src: `data:image/jpeg;base64,${readFileSync('public' + f.src).toString('base64')}` }, 'Describe visible damage on the module and whether the grapple fixture is clear.')
        console.log(sc, f.id, 'OK', r.findings.slice(0, 140).replace(/\n/g, ' '))
      } catch (e) { console.log(sc, f.id, 'FAIL', String((e as Error).message).slice(0, 80)) }
    }
  }
}
void main()
