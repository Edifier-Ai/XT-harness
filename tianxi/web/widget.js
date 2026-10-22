// A desktop widget: one card, drawn by genui.js, kept current by 小天 (plugins/widgets.js) and told apart only by
// its little bar: the card's kind, when it was updated, update now, and a menu (desktop/shell.js) for the rest.
'use strict'
const WID = new URLSearchParams(location.search).get('id') || ''
const $ = (s) => document.querySelector(s)
const api = async (path, body) => {
  const r = await fetch('/api/' + path, body === undefined ? { headers: { 'x-tianxi-token': TOKEN } }
    : { method: 'POST', headers: { 'content-type': 'application/json', 'x-tianxi-token': TOKEN }, body: JSON.stringify(body) })
  return r.json()
}
const pad = (n) => String(n).padStart(2, '0')
const hhmm = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()) }
let W = null, drawn = ''

function status(w) {
  if (w.status === 'updating') return '<i class="spin"></i>正在更新'
  if (w.status === 'acting') return `<i class="spin"></i>${esc(w.note || '正在做')}`
  if (w.status === 'error') return esc(w.note || '没更新成')
  const t = w.refreshedAt || w.at, today = new Date(t).toDateString() === new Date().toDateString()
  return (today ? hhmm(t) : `${new Date(t).getMonth() + 1}月${new Date(t).getDate()}日`) + ' 更新'
}
function draw() {
  if (!W) return
  $('#wname').textContent = W.kind
  document.title = W.title
  const sub = $('#wsub'); sub.innerHTML = status(W); sub.classList.toggle('bad', W.status === 'error'); sub.classList.toggle('busy', W.status === 'updating' || W.status === 'acting')
  $('#wref').disabled = W.status === 'updating' || W.status === 'acting'
  const mid = `w:${W.id}:${W.ver}`
  if (drawn !== mid) {
    const swap = !!drawn
    GU.keepFocus(() => { $('#wbody').innerHTML = GU.render(mid, W.code, false) })
    if (swap) { const b = $('#wbody'); b.classList.remove('swap'); void b.offsetWidth; b.classList.add('swap') }
    drawn = mid
  }
  const n = $('#wnote'); n.hidden = !(W.note && W.status === 'ok'); n.textContent = W.note || ''
}
// the window is as tall as its card
// (measured on the card, not the body: an open dropdown locks the body's scrolling and pads it, and resizing the
// window then would close the dropdown again)
const fit = () => {
  if (document.querySelector('[data-radix-popper-content-wrapper]')) return
  const h = Math.ceil($('#wg').getBoundingClientRect().bottom + 16); if (h > 16) APP?.widgetFit?.(h)
}
new ResizeObserver(fit).observe($('#wg'))
new MutationObserver(() => { if (!document.querySelector('[data-radix-popper-content-wrapper]')) fit() }).observe(document.body, { childList: true })

// 小天 took it away: fold up, say why, offer to keep it, then close the window
let byeT = null
function leave(why) {
  $('#byeWhy').textContent = `${why || '用不上了'}，小天把它收起来了。`
  $('#wg').classList.add('leaving')
  byeT = setTimeout(() => { $('#wg').classList.add('gone'); setTimeout(() => APP?.widgetClose?.(), 420) }, 9000)
}
$('#keep').onclick = async () => {
  clearTimeout(byeT); $('#wg').classList.remove('leaving', 'gone')
  const r = await api('widgets/restore', { id: WID }); if (r.widget) { W = r.widget; draw() }
}

GU.route = () => (hidden, shown) => api('widgets/act', { id: WID, hidden, shown, where: '电脑桌面上' })
$('#wref').onclick = () => { $('#wref').disabled = true; api('widgets/refresh', { id: WID }) }
$('#wmore').onclick = () => APP?.widgetMenu?.({ id: WID, tool: !!W?.tool, title: W?.title || '' })
// using it keeps it: 小天 takes away only what goes untouched for days
let touched = 0
const touch = () => { if (Date.now() - touched > 5 * 60e3) { touched = Date.now(); api('widgets/touch', { id: WID }).catch(() => {}) } }
addEventListener('pointerdown', touch)
let hoverT = null
document.body.addEventListener('mouseenter', () => { hoverT = setTimeout(touch, 1500) })
document.body.addEventListener('mouseleave', () => clearTimeout(hoverT))

async function start() {
  const r = await api('widgets').catch(() => null)
  W = r?.widgets?.find((w) => w.id === WID) || null
  // opened just as 小天 took it away: still say why before going
  const justGone = W?.retired && Date.now() - Date.parse(W.retired.at) < 60e3
  if (!W || (!W.pinned && !justGone)) return APP?.widgetClose?.()
  draw(); fit()
  if (!W.pinned) leave(W.retired.why)
  const es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN))
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.type === 'hello' && W) return start2()
    if (m.type !== 'widget' || m.widget.id !== WID) return
    const was = W; W = m.widget
    if (was.pinned && !W.pinned) return W.retired ? leave(W.retired.why) : APP?.widgetClose?.()
    if (W.pinned && !was.pinned) { clearTimeout(byeT); $('#wg').classList.remove('leaving', 'gone') }
    draw()
  }
}
// after a reconnect, catch up with what changed meanwhile
async function start2() {
  const r = await api('widgets').catch(() => null)
  const w = r?.widgets?.find((x) => x.id === WID)
  if (!w || !w.pinned) return w?.retired ? leave(w.retired.why) : APP?.widgetClose?.()
  W = w; draw()
}
start()
