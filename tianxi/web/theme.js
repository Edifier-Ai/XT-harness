// 深色 / 浅色. Like the reference video: the switch swells into a bubble, then the new theme pours out of it
// as a liquid that runs across the window in fingers and drips, and swallows the last dark corners.
// Drawn as a wavy shoreline plus metaball drops on a small canvas that masks the View Transition's new snapshot.
const themeNow = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
const themeResolve = (t) => t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t
const LIQ_MS = 1300
let liquidBusy = false

function liquidMask(ox, oy) {
  const W = innerWidth, H = innerHeight, K = 5                       // field at 1/5 size; the mask is scaled up smoothly
  const cw = Math.ceil(W / K), ch = Math.ceil(H / K)
  const out = document.createElement('canvas'); out.width = cw; out.height = ch
  const octx = out.getContext('2d'), img = octx.createImageData(cw, ch), px = img.data
  const corners = [[0, 0], [W, 0], [0, H], [W, H]]
  const far = corners.reduce((a, c) => Math.hypot(c[0] - ox, c[1] - oy) > Math.hypot(a[0] - ox, a[1] - oy) ? c : a)
  const D = Math.hypot(far[0] - ox, far[1] - oy) / K
  const ux = (far[0] - ox) / K / D, uy = (far[1] - oy) / K / D, vx = -uy, vy = ux
  const O = [ox / K, oy / K]
  // the front is a wavy shoreline sweeping toward the far corner; its troughs leave dark tongues that get swallowed last
  const waves = [[1.6, 0.11, 0.4], [3.7, 0.07, 2.2], [8.3, 0.03, 4.1]]          // [cycles over D, amplitude, phase]
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  // drops running ahead of the front, fused to it by the field
  const drops = Array.from({ length: 9 }, () => ({ l: (rnd() - 0.5) * 1.6, lead: 0.05 + rnd() * 0.1, r: 0.025 + rnd() * 0.03, ph: rnd() * 6.28, lag: rnd() * 0.25 }))
  const ease = (p) => p * p * (3 - 2 * p)
  const bx = new Float32Array(48), by = new Float32Array(48), br = new Float32Array(48)
  const edge = Math.max(4, D * 0.03)
  return (p) => {
    p = Math.min(1, p)
    const t = ease(p), now = p * LIQ_MS / 1000
    const front = D * (1.4 * t - 0.12), amp = D * Math.sin(Math.PI * Math.min(1, p * 1.1)) // waves calm down as it settles
    let n = 0
    const ball = (x, y, r) => { if (r > 0.5 && n < 48) { bx[n] = x; by[n] = y; br[n] = r * r; n++ } }
    ball(O[0], O[1], Math.min(1, p * 5) * D * 0.06)                                   // the bubble at the switch
    for (const d of drops) {
      const q = Math.max(0, Math.min(1, (p - d.lag) / (1 - d.lag)))
      const life = Math.sin(Math.PI * q), r = D * d.r * life
      const ahead = front + D * d.lead * life * (1 + 0.3 * Math.sin(now * 7 + d.ph))
      const l = d.l * D * (0.3 + 0.7 * t)
      for (let k = 0; k < 3; k++) {
        const s = ahead - k * r * 0.9
        ball(O[0] + ux * s + vx * l, O[1] + uy * s + vy * l, r * (1 - k * 0.2))
      }
    }
    for (let y = 0, o = 3; y < ch; y++) for (let x = 0; x < cw; x++, o += 4) {
      const dx = x - O[0], dy = y - O[1], s = dx * ux + dy * uy, l = (dx * vx + dy * vy) / D
      let f = front
      for (const w of waves) f += amp * w[1] * Math.sin(l * w[0] * 6.283 + w[2] + now * 2.4)
      let F = Math.exp((f - s) / edge)                                                 // 1 on the shoreline
      for (let i = 0; i < n && F < 1.3; i++) { const ex = x - bx[i], ey = y - by[i]; F += br[i] / (ex * ex + ey * ey + 0.01) }
      px[o] = F < 0.95 ? 0 : F > 1.05 ? 255 : (F - 0.95) * 2550
    }
    octx.putImageData(img, 0, 0)
    return out.toDataURL()
  }
}

function setTheme(pref, from) {
  store.set('theme', pref)
  const t = themeResolve(pref)
  if (t === themeNow() || liquidBusy) return
  const root = document.documentElement
  const apply = () => { root.dataset.theme = t }
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return apply()
  const r = from?.getBoundingClientRect?.()
  const x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : innerHeight / 2
  const frame = liquidMask(x, y)
  liquidBusy = true
  // 1. the switch swells into a bubble of the coming color
  const btn = from?.closest?.('#bTheme')
  const swell = btn ? btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.32)', background: t === 'light' ? '#f4f3fb' : '#16161c', color: t === 'light' ? '#16161c' : '#f4f3fb' }],
    { duration: 170, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' }) : null
  const go = () => {
    root.style.setProperty('--liq', `url(${frame(0)})`)
    const vt = document.startViewTransition(apply)
    vt.ready.then(() => {
      // keeps the transition alive while the canvas drives the mask
      root.animate({ opacity: [1, 1] }, { duration: LIQ_MS, pseudoElement: '::view-transition-new(root)' })
      const t0 = performance.now()
      const step = (now) => {
        const p = (now - t0) / LIQ_MS
        root.style.setProperty('--liq', `url(${frame(p)})`)
        if (p < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }).catch(() => {})
    vt.finished.finally(() => { liquidBusy = false; root.style.removeProperty('--liq'); swell?.cancel() })
  }
  swell ? swell.finished.then(go) : go()
}
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act=theme-flip]'); if (el) setTheme(themeNow() === 'dark' ? 'light' : 'dark', el) })
document.addEventListener('change', (e) => { if (e.target.dataset?.set === 'theme') setTheme(e.target.value, e.target) })
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (store.get('theme', 'dark') === 'system') setTheme('system') })
