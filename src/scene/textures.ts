// Procedural canvas textures (client only, created lazily and cached). No image assets to load.
import * as THREE from 'three'

const cache = new Map<string, THREE.Texture>()

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function finish(key: string, c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.needsUpdate = true
  cache.set(key, t)
  return t
}

/** Deterministic PRNG so textures look the same every load. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/** Module skin: light anodised panels, seams, rivets, the module id stencilled top-left. */
export function moduleSkin(id: string): THREE.Texture {
  const key = `skin:${id}`
  const hit = cache.get(key)
  if (hit) return hit
  const [c, g] = canvas(1024, 640)
  const r = rng(id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7))
  g.fillStyle = '#c9cfd6'
  g.fillRect(0, 0, 1024, 640)
  // Panel tiles with slight tone variation.
  const cols = 6, rows = 4
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const v = 196 + Math.floor(r() * 26)
    g.fillStyle = `rgb(${v},${v + 4},${v + 10})`
    g.fillRect(i * (1024 / cols) + 3, j * (640 / rows) + 3, 1024 / cols - 6, 640 / rows - 6)
  }
  // Seams.
  g.strokeStyle = '#5d6672'
  g.lineWidth = 3
  for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * (1024 / cols), 0); g.lineTo(i * (1024 / cols), 640); g.stroke() }
  for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, j * (640 / rows)); g.lineTo(1024, j * (640 / rows)); g.stroke() }
  // Rivets.
  g.fillStyle = '#8a929c'
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x0 = i * (1024 / cols), y0 = j * (640 / rows)
    for (const [dx, dy] of [[12, 12], [1024 / cols - 12, 12], [12, 640 / rows - 12], [1024 / cols - 12, 640 / rows - 12]]) {
      g.beginPath(); g.arc(x0 + dx, y0 + dy, 3, 0, Math.PI * 2); g.fill()
    }
  }
  // ID stencil + small placards.
  g.fillStyle = '#1b2230'
  g.font = 'bold 92px Arial, Helvetica, sans-serif'
  g.textBaseline = 'top'
  g.fillText(id, 40, 96)
  g.font = 'bold 26px Arial, Helvetica, sans-serif'
  g.fillText('LATTICE COMPUTE MODULE', 44, 198)
  g.fillStyle = '#f2b84b'
  g.fillRect(44, 236, 120, 10)
  g.fillStyle = '#1b2230'
  g.font = '22px Arial, Helvetica, sans-serif'
  g.fillText('7.4 kW · 2-LOOP · FRU', 44, 256)
  return finish(key, c)
}

/** Radiator panel: bright white face with coolant tubes and a frame. */
export function radiatorTex(): THREE.Texture {
  const hit = cache.get('rad')
  if (hit) return hit
  const [c, g] = canvas(512, 320)
  g.fillStyle = '#eef2f6'
  g.fillRect(0, 0, 512, 320)
  g.strokeStyle = '#b8c2cd'
  g.lineWidth = 2
  for (let x = 24; x < 500; x += 20) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x, 304); g.stroke() }
  g.strokeStyle = '#8f9aa6'
  g.lineWidth = 6
  g.beginPath(); g.moveTo(14, 18); g.lineTo(498, 18); g.moveTo(14, 302); g.lineTo(498, 302); g.stroke()
  g.strokeStyle = '#6b7684'
  g.lineWidth = 8
  g.strokeRect(4, 4, 504, 312)
  return finish('rad', c)
}

/** Emissive pattern for radiators (faint warm tubes). */
export function radiatorGlowTex(): THREE.Texture {
  const hit = cache.get('radGlow')
  if (hit) return hit
  const [c, g] = canvas(512, 320)
  g.fillStyle = '#000'
  g.fillRect(0, 0, 512, 320)
  g.strokeStyle = '#ffffff'
  g.lineWidth = 3
  for (let x = 24; x < 500; x += 40) { g.globalAlpha = 0.6; g.beginPath(); g.moveTo(x, 20); g.lineTo(x, 300); g.stroke() }
  g.globalAlpha = 1
  return finish('radGlow', c)
}

/** Solar cells: deep blue cells, silver grid lines, repeatable. */
export function solarTex(): THREE.Texture {
  const hit = cache.get('solar')
  if (hit) return hit
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#c4ccd6'
  g.fillRect(0, 0, 512, 512)
  const n = 8, s = 512 / n
  const r = rng(42)
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = r() * 14
    const grd = g.createLinearGradient(i * s, j * s, i * s + s, j * s + s)
    grd.addColorStop(0, `rgb(${18 + v},${34 + v},${92 + v * 2})`)
    grd.addColorStop(1, `rgb(${10 + v},${22 + v},${66 + v * 2})`)
    g.fillStyle = grd
    g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6)
    g.strokeStyle = 'rgba(160,180,220,0.35)'
    g.lineWidth = 1
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(i * s + 3, j * s + (k * s) / 4); g.lineTo(i * s + s - 3, j * s + (k * s) / 4); g.stroke() }
  }
  return finish('solar', c, true, true)
}

/** Crinkled foil bump map for MLI blankets. */
export function crinkleTex(): THREE.Texture {
  const hit = cache.get('crinkle')
  if (hit) return hit
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#808080'
  g.fillRect(0, 0, 256, 256)
  const r = rng(7)
  for (let i = 0; i < 900; i++) {
    const x = r() * 256, y = r() * 256, l = 6 + r() * 26, a = r() * Math.PI
    const v = Math.floor(80 + r() * 120)
    g.strokeStyle = `rgb(${v},${v},${v})`
    g.lineWidth = 1 + r() * 3
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke()
  }
  return finish('crinkle', c, false, true)
}

/** Micrometeoroid puncture: dark hole, torn petals, scorched halo, transparent edges. */
export function punctureTex(): THREE.Texture {
  const hit = cache.get('puncture')
  if (hit) return hit
  const [c, g] = canvas(512, 512)
  const r = rng(1180)
  const cx = 256, cy = 256
  // Scorched halo.
  const halo = g.createRadialGradient(cx, cy, 20, cx, cy, 250)
  halo.addColorStop(0, 'rgba(25,14,8,0.98)')
  halo.addColorStop(0.25, 'rgba(60,34,18,0.9)')
  halo.addColorStop(0.55, 'rgba(110,70,40,0.45)')
  halo.addColorStop(1, 'rgba(120,90,60,0)')
  g.fillStyle = halo
  g.beginPath(); g.arc(cx, cy, 250, 0, Math.PI * 2); g.fill()
  // Soot streaks.
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, l = 60 + r() * 150
    g.strokeStyle = `rgba(20,12,6,${0.15 + r() * 0.3})`
    g.lineWidth = 2 + r() * 5
    g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.stroke()
  }
  // Torn petals (bright bent metal) around the hole.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.3
    const r0 = 52, r1 = 88 + r() * 30, w = 0.22 + r() * 0.12
    g.fillStyle = `rgba(${170 + r() * 60},${160 + r() * 50},${150 + r() * 40},0.95)`
    g.beginPath()
    g.moveTo(cx + Math.cos(a - w) * r0, cy + Math.sin(a - w) * r0)
    g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    g.lineTo(cx + Math.cos(a + w) * r0, cy + Math.sin(a + w) * r0)
    g.closePath(); g.fill()
  }
  // The hole itself: jagged black.
  g.fillStyle = '#020202'
  g.beginPath()
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2, rr = 52 + (r() - 0.5) * 22
    if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  g.closePath(); g.fill()
  // Frost rim (frozen coolant).
  g.strokeStyle = 'rgba(220,240,255,0.85)'
  g.lineWidth = 4
  g.setLineDash([6, 5])
  g.beginPath(); g.arc(cx, cy, 64, 0, Math.PI * 2); g.stroke()
  return finish('puncture', c)
}

/** Generic scorch decal (PDU short). */
export function scorchTex(): THREE.Texture {
  const hit = cache.get('scorch')
  if (hit) return hit
  const [c, g] = canvas(512, 512)
  const r = rng(412)
  const grd = g.createRadialGradient(256, 256, 10, 256, 256, 250)
  grd.addColorStop(0, 'rgba(8,5,3,1)')
  grd.addColorStop(0.35, 'rgba(35,20,10,0.92)')
  grd.addColorStop(0.7, 'rgba(70,45,25,0.45)')
  grd.addColorStop(1, 'rgba(70,45,25,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, l = 40 + r() * 200
    g.strokeStyle = `rgba(10,6,3,${0.2 + r() * 0.4})`
    g.lineWidth = 1 + r() * 6
    g.beginPath(); g.moveTo(256, 256); g.lineTo(256 + Math.cos(a) * l, 256 + Math.sin(a) * l); g.stroke()
  }
  // Molten copper beads.
  for (let i = 0; i < 18; i++) {
    g.fillStyle = `rgba(${200 + r() * 55},${110 + r() * 60},40,0.9)`
    g.beginPath(); g.arc(200 + r() * 112, 200 + r() * 112, 3 + r() * 6, 0, Math.PI * 2); g.fill()
  }
  return finish('scorch', c)
}

/** PDU panel face: dark box, breakers and connectors, label. */
export function pduTex(): THREE.Texture {
  const hit = cache.get('pdu')
  if (hit) return hit
  const [c, g] = canvas(512, 384)
  g.fillStyle = '#2b3240'
  g.fillRect(0, 0, 512, 384)
  g.strokeStyle = '#f2b84b'
  g.lineWidth = 10
  g.strokeRect(8, 8, 496, 368)
  g.fillStyle = '#dfe6ee'
  g.font = 'bold 54px Arial, Helvetica, sans-serif'
  g.fillText('PDU', 30, 80)
  g.font = '24px Arial, Helvetica, sans-serif'
  g.fillText('120 V  BUS A / B', 30, 118)
  for (let i = 0; i < 6; i++) {
    g.fillStyle = '#121720'
    g.fillRect(40 + i * 74, 160, 56, 90)
    g.fillStyle = i % 2 ? '#6b7a90' : '#9aa7b6'
    g.fillRect(52 + i * 74, 176, 32, 22)
  }
  for (let i = 0; i < 4; i++) {
    g.fillStyle = '#c4ccd6'
    g.beginPath(); g.arc(80 + i * 118, 310, 26, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#20262f'
    g.beginPath(); g.arc(80 + i * 118, 310, 14, 0, Math.PI * 2); g.fill()
  }
  return finish('pdu', c)
}

/** Grapple base plate: high-contrast quadrant target with a yellow ring. */
export function grappleTex(): THREE.Texture {
  const hit = cache.get('grapple')
  if (hit) return hit
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 512, 512)
  g.fillStyle = '#0a0a0a'
  g.fillRect(0, 0, 256, 256)
  g.fillRect(256, 256, 256, 256)
  g.strokeStyle = '#ffd400'
  g.lineWidth = 40
  g.beginPath(); g.arc(256, 256, 170, 0, Math.PI * 2); g.stroke()
  g.strokeStyle = '#0a0a0a'
  g.lineWidth = 16
  g.strokeRect(8, 8, 496, 496)
  return finish('grapple', c)
}

/** Yellow/black hazard stripes for latches. */
export function hazardTex(): THREE.Texture {
  const hit = cache.get('hazard')
  if (hit) return hit
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#ffd400'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#0a0a0a'
  for (let i = -256; i < 512; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 + 256, 256); g.lineTo(i + 256, 256); g.closePath(); g.fill()
  }
  return finish('hazard', c)
}
