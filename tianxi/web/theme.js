// 深色 / 浅色. The new theme pours in from the button that asked for it, as a liquid blob that wobbles
// while it grows (View Transitions + an animated SVG mask). Loaded after app.js.
const BLOB = (() => {
  const a = 'M100 8C140 6 186 40 192 92C198 146 160 192 104 194C48 196 8 156 8 104C8 52 52 10 100 8Z'
  const b = 'M104 4C156 14 194 52 188 104C182 160 146 196 96 192C42 188 4 150 10 96C16 44 56 -4 104 4Z'
  const c = 'M96 10C148 2 198 50 190 100C182 150 152 198 100 196C50 194 2 160 6 108C10 56 46 16 96 10Z'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path fill="#000" d="${a}"><animate attributeName="d" dur="0.9s" repeatCount="indefinite" values="${a};${b};${c};${a}"/></path></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
})()
const themeNow = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
const themeResolve = (t) => t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t
function setTheme(pref, from) {
  store.set('theme', pref)
  const t = themeResolve(pref)
  if (t === themeNow()) return
  const apply = () => { document.documentElement.dataset.theme = t }
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return apply()
  const r = from?.getBoundingClientRect?.()
  const x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : innerHeight / 2
  const S = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) * 2.5
  document.documentElement.style.setProperty('--blob', BLOB)
  const vt = document.startViewTransition(apply)
  vt.ready.then(() => {
    document.documentElement.animate({
      maskSize: ['0px 0px', `${S * 0.18}px ${S * 0.18}px`, `${S}px ${S}px`],
      maskPosition: [`${x}px ${y}px`, `${x - S * 0.09}px ${y - S * 0.09}px`, `${x - S / 2}px ${y - S / 2}px`],
      offset: [0, 0.25, 1],
    }, { duration: 950, easing: 'cubic-bezier(.65,0,.25,1)', pseudoElement: '::view-transition-new(root)', fill: 'both' })
  }).catch(() => {})
}
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act=theme-flip]'); if (el) setTheme(themeNow() === 'dark' ? 'light' : 'dark', el) })
document.addEventListener('change', (e) => { if (e.target.dataset?.set === 'theme') setTheme(e.target.value, e.target) })
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (store.get('theme', 'dark') === 'system') setTheme('system') })
