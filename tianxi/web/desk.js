// 同场共创: the document or slide deck beside the chat (plugins/cowrite.js keeps it). The Bot's paragraph grows live
// with its cursor while it writes; you type in the same document at the same time. The paragraph your cursor is in
// is yours (the Bot waits), marks show who wrote what, 续写提示 offers half a sentence more where you stop (Tab takes
// it), and a deck plays full screen. Uses app.js's helpers.
'use strict'
;(() => {

const DK = {
  open: store.get('desk', {}),       // agent -> the doc open beside its chat
  docs: new Map(),                   // id -> the whole doc, as the runtime last sent it
  live: new Map(),                   // agent -> what it is writing now { doc, op, after, block, blocks }
  wait: null,                        // { doc, block, agent, until }: it wanted the paragraph you are in
  marks: store.get('deskMarks', true),
  ghostOn: store.get('deskGhost', true),
  saving: new Map(),                 // block -> timer of your typing not yet sent
  saved: 0, procWas: null, loading: new Set(), follow: true,
}
const DKI = {
  doc: '<path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5V8.5H18"/><path d="M8.5 12.5h7M8.5 16h5"/>',
  slides: '<rect x="3" y="4.5" width="18" height="12.5" rx="2"/><path d="M12 17v3.5M8.5 20.5h7"/><path d="M7 9h6M7 12.5h9"/>',
  chev: '<path d="M7 10l5 5 5-5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  marks: '<path d="M5 5v14M10 7h9M10 12h9M10 17h6"/>',
  ghost: '<path d="M4 17h6"/><path d="M13 17h7" stroke-dasharray="2 2.6"/><path d="M4 12h16M4 7h16"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  save: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
}
const dki = (k, w = 17, sw = 1.8) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${DKI[k]}</svg>`
const kindName = (d) => d.kind === 'slides' ? '幻灯片' : '文档'
const unitOf = (d) => d.kind === 'slides' ? '页' : '段'
// the colour of a Bot's cursor: 小天's violet, or its own colour (never one that vanishes on the page)
function inkOf(aid) {
  const c = colorOf(agentOf(aid))
  if (c === 'tx') return '#6a4cf0'
  const v = [1, 3, 5].reduce((n, i) => n + parseInt(c.slice(i, i + 2), 16), 0)
  return v > 660 ? '#8a8a8f' : c
}
const whoName = (by) => by === 'me' ? (S.settings?.callMe || '你') : agentOf(by)?.name || 'Bot'

// ---------- which doc, and opening it ----------
function deskId() {
  if (view !== 'chat') return ''
  const id = DK.open[cur]
  return id && (DK.docs.has(id) || (S.docs || []).some((d) => d.id === id)) ? id : ''
}
async function loadDoc(id) {
  if (DK.loading.has(id)) return
  DK.loading.add(id)
  try {
    const r = await api('doc/get', { id })
    if (r.doc) { DK.docs.set(id, r.doc); for (const l of r.live || []) DK.live.set(l.agent, l) }
    else if (DK.open[cur] === id) { delete DK.open[cur]; store.set('desk', DK.open) }
  } finally { DK.loading.delete(id) }
  deskRender()
}
function deskShow(id, agent = cur) {
  DK.open[agent] = id; store.set('desk', DK.open)
  if (agent !== cur) return
  if (procPref !== 'closed') { DK.procWas = procPref; closeProc() }
  api('doc/active', { id })
  if (!DK.docs.has(id)) loadDoc(id); else deskRender()
}
function deskHide() {
  const id = deskId(); if (!id) return
  flushAll()
  delete DK.open[cur]; store.set('desk', DK.open)
  api('doc/focus', { id, block: null })
  deskRender()
  if (DK.procWas && DK.procWas !== 'closed') openProc()
  DK.procWas = null
}
window.deskDoc = () => deskId()

// ---------- the pane ----------
function deskRender() {
  const el = $('#desk'), id = deskId(), d = id && DK.docs.get(id)
  $('#app').classList.toggle('deskon', !!id)
  if (!id) { el.dataset.doc = ''; el.innerHTML = ''; return }
  if (!d) { loadDoc(id); return }
  if (el.dataset.doc !== id) {
    el.dataset.doc = id
    el.innerHTML = `<div class="dk-h"><button class="dk-kind" data-act="dk-list" title="一起写过的文档">${dki(d.kind === 'slides' ? 'slides' : 'doc', 18)}${dki('chev', 13)}</button>
      <input class="dk-title" id="dkTitle" maxlength="80" spellcheck="false"><div class="dk-who" id="dkWho"></div><div class="dk-drag"></div>
      <button class="rb" data-act="dk-close" title="收起">${dki('x', 18)}</button></div>
      <div class="dk-tb" id="dkActs"></div>
      <div class="dk-b" id="dkB"><div class="dk-wrap ${d.kind}"><div class="dk-paper" id="dkPaper"></div>${d.kind === 'slides' ? `<button class="dk-add" data-act="dk-add">${dki('plus', 16)}<span>新的一页</span></button>` : ''}</div><div class="dk-pad" data-act="dk-tail"></div></div>
      <button class="dk-jump" id="dkJump" data-act="dk-jump" hidden></button>
      <div class="dk-f" id="dkF"></div><div class="dk-menu" id="dkMenu" hidden></div>`
    replay(el, 'swap')
    const t = $('#dkTitle')
    t.onchange = () => api('doc/title', { id, title: t.value })
    t.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); t.blur(); const f = $('#dkPaper .bx'); if (f) caretTo(f, 0) } }
    $('#dkB').onscroll = () => { DK.follow = false; jump() }
  }
  const t = $('#dkTitle'); if (document.activeElement !== t && t.value !== d.title) t.value = d.title
  $('#desk').classList.toggle('marks', DK.marks)
  dkHead(d); paper(d); foot(d); jump()
}

// presence: you, and the Bot with what it is doing in here
function dkHead(d) {
  const a = agentOf(d.agent), l = DK.live.get(d.agent), wait = DK.wait && DK.wait.doc === d.id && DK.wait.until > Date.now()
  const t = l && l.doc === d.id ? (l.op === 'edit' ? '正在改' : '正在写') : wait ? '等你写完' : busy(a.id) ? (/doc_read/.test(nowTool(a.id)) ? '在看' : '在想') : ''
  const me = `<span class="pz me" title="${esc(whoName('me'))}"><span class="uav">${esc((S.settings?.callMe || '你').slice(0, 1))}</span></span>`
  const W = $('#dkWho'), wh = `${me}<span class="pz bot ${t ? 'on' : ''}" style="--c:${inkOf(a.id)}" title="${esc(a.name)}">${avatar(a, 26, false, false)}${t ? `<em>${esc(a.name)}${t}</em>` : ''}</span>`
  if (W.dataset.h !== wh) { W.innerHTML = wh; W.dataset.h = wh }
  const acts = [`<button class="dk-tg ${DK.marks ? 'on' : ''}" data-act="dk-marks" title="每一段旁边标出是谁写的">${dki('marks', 16)}<span>谁写的</span></button>`]
  if (d.kind === 'doc') acts.push(`<button class="dk-tg ${DK.ghostOn ? 'on' : ''}" data-act="dk-ghost" title="你停下来时，${esc(a.name)}在光标后面提示半句，按 Tab 接受">${dki('ghost', 16)}<span>续写提示</span></button>`)
  else acts.push(`<button class="dk-tg" data-act="dk-play" title="全屏放映">${dki('play', 15)}<span>放映</span></button>`)
  acts.push(`<button class="dk-tg" data-act="dk-export" title="存到“文档/小天”文件夹">${dki('save', 16)}<span>存成 ${d.kind === 'slides' ? 'PPT' : 'Word'}</span></button>`)
  const A = $('#dkActs'), h = acts.join('')
  if (A.dataset.h !== h) { A.innerHTML = h; A.dataset.h = h }
}
const nowTool = (aid) => { const t = turnsOf(aid).filter((x) => x.running).pop(); const x = t && [...toolsOf(t)].reverse().find((i) => i.state === 'running'); return x ? x.name : '' }

// what is shown: the blocks, with what a Bot is writing right now put where it goes
function layout(d) {
  const out = d.blocks.map((b) => ({ key: 'b:' + b.id, b, type: b.type, text: b.text }))
  for (const [aid, l] of DK.live) {
    if (l.doc !== d.id) continue
    if (l.op === 'edit') { const x = out.find((o) => o.b && o.b.id === l.block); if (x) Object.assign(x, { live: aid, text: l.blocks[0]?.text ?? '', type: l.blocks[0]?.type || x.type }) }
    else {
      const i = l.after === 'start' ? 0 : l.after ? out.findIndex((o) => o.b && o.b.id === l.after) + 1 : out.length
      // an empty document is replaced by what is written, as the runtime will do
      const empty = d.blocks.every((b) => !b.text.trim())
      // before its first words arrive, the cursor already sits where it will write
      const src = l.blocks.length ? l.blocks : [{ type: d.kind === 'slides' ? 'slide' : 'p', text: '' }]
      const ghosts = src.map((g, k) => ({ key: `l:${aid}:${k}`, live: aid, type: g.type, text: g.text, last: k === src.length - 1 }))
      if (empty && ghosts.length) out.splice(0, out.length, ...ghosts)
      else out.splice(i < 0 ? out.length : i, 0, ...ghosts)
    }
  }
  return out
}
const cursorHtml = (aid) => `<i class="cur" style="--c:${inkOf(aid)}"><b>${esc(agentOf(aid).name)}</b></i>`

function paper(d) {
  const P = $('#dkPaper'), items = layout(d), slides = d.kind === 'slides'
  const have = new Map([...P.children].map((e) => [e.dataset.key, e]))
  let prev = null, n = 0
  for (const it of items) {
    let e = have.get(it.key)
    if (e) have.delete(it.key)
    else { e = slides ? makeSlide(it) : makeBlock(it); e.classList.add(it.live ? 'grow' : 'enter') }
    n++
    if (slides) fillSlide(e, it, n, d); else fillBlock(e, it, d)
    const next = prev ? prev.nextSibling : P.firstChild
    if (e !== next) P.insertBefore(e, next)
    prev = e
  }
  for (const e of have.values()) { if (e.contains(document.activeElement)) continue; e.remove() }
  // a block that was just written in settles from the Bot's tint to the page
  for (const e of P.querySelectorAll('.enter')) requestAnimationFrame(() => e.classList.remove('enter'))
  const lv = P.querySelector('.live .cur')
  if (lv && DK.follow && !P.contains(document.activeElement)) {
    const B = $('#dkB'), r = lv.getBoundingClientRect(), br = B.getBoundingClientRect()
    if (r.bottom > br.bottom - 60 || r.top < br.top + 20) { B.scrollTo({ top: B.scrollTop + r.top - br.top - B.clientHeight * 0.45, behavior: 'smooth' }); setTimeout(() => { DK.follow = true }, 400) }
  }
}

// ---------- a paragraph ----------
function makeBlock(it) {
  const e = document.createElement('div')
  e.className = 'blk'; e.dataset.key = it.key
  e.innerHTML = `<span class="mk"></span><div class="bx" spellcheck="false"></div>`
  return e
}
function fillBlock(e, it, d) {
  const bx = e.querySelector('.bx'), b = it.b
  e.className = `blk t-${it.type}${it.live ? ' live' : ''}${e.classList.contains('enter') ? ' enter' : ''}${e.classList.contains('grow') ? ' grow' : ''}`
  e.style.setProperty('--c', it.live ? inkOf(it.live) : b && b.by !== 'me' ? inkOf(b.by) : '')
  const mk = e.querySelector('.mk'), by = b ? b.by : it.live
  const label = it.live ? `${agentOf(it.live).name}正在写` : b ? (b.by === 'me' ? '你写的' : `${agentOf(b.by).name}写的`) + (b.last !== b.by ? (b.last === 'me' ? '，你改过' : `，${agentOf(b.last).name}改过`) : '') : ''
  mk.dataset.by = by === 'me' ? 'me' : 'bot'; mk.title = label; mk.dataset.t = label
  if (b) e.dataset.id = b.id; else delete e.dataset.id
  if (it.live) {
    // the Bot's paragraph: its words so far and its cursor; not yours to type in while it writes
    bx.removeAttribute('contenteditable')
    const h = esc(it.text) + cursorHtml(it.live)
    if (bx.dataset.h !== h) { bx.innerHTML = h; bx.dataset.h = h }
    return
  }
  if (bx.dataset.h) { delete bx.dataset.h; bx.textContent = b.text }
  if (bx.getAttribute('contenteditable') !== 'plaintext-only') bx.setAttribute('contenteditable', 'plaintext-only')
  bx.dataset.ph = d.blocks.length === 1 && !b.text ? `在这里写，或者在左边让${agentOf(d.agent).name}写` : it.type === 'h1' ? '标题' : it.type === 'h2' ? '小标题' : ''
  // the paragraph you are typing in keeps what you typed; the rest follow the runtime
  if (document.activeElement !== bx && !DK.saving.has(b.id) && bx.innerText !== b.text) bx.textContent = b.text
  bx.classList.toggle('empty', !b.text && document.activeElement !== bx)
  const w = DK.wait && DK.wait.doc === d.id && DK.wait.block === b.id && DK.wait.until > Date.now()
  e.classList.toggle('held', !!w)
  if (w) e.dataset.wait = `${agentOf(DK.wait.agent).name}想改这段，等你写完`; else delete e.dataset.wait
}

// ---------- a slide: a title and its points, white like the deck it becomes ----------
function makeSlide(it) {
  const e = document.createElement('div')
  e.className = 'sl'; e.dataset.key = it.key
  e.innerHTML = `<div class="sl-n"></div><div class="sl-pg"><div class="sl-t bx" spellcheck="false"></div><div class="sl-p bx" spellcheck="false"></div></div><span class="mk"></span><button class="sl-x" data-act="dk-drop" title="删掉这一页">${dki('trash', 15)}</button>`
  return e
}
function fillSlide(e, it, n, d) {
  const b = it.b, [title, ...pts] = String(it.text || '').split('\n')
  e.className = `sl${it.live ? ' live' : ''}${e.classList.contains('enter') ? ' enter' : ''}${e.classList.contains('grow') ? ' grow' : ''}${n === 1 && !pts.filter(Boolean).length ? ' cover' : ''}`
  e.style.setProperty('--c', it.live ? inkOf(it.live) : b && b.by !== 'me' ? inkOf(b.by) : '')
  e.querySelector('.sl-n').textContent = n
  const mk = e.querySelector('.mk'), by = b ? b.by : it.live
  mk.dataset.by = by === 'me' ? 'me' : 'bot'; mk.dataset.t = it.live ? `${agentOf(it.live).name}正在写` : b.by === 'me' ? '你写的' : `${agentOf(b.by).name}写的`
  if (b) e.dataset.id = b.id; else delete e.dataset.id
  const T = e.querySelector('.sl-t'), P = e.querySelector('.sl-p')
  if (it.live) {
    for (const x of [T, P]) x.removeAttribute('contenteditable')
    const onT = !pts.length
    const th = esc(title) + (onT ? cursorHtml(it.live) : ''), ph = pts.map((p, i) => `<div class="spt">${esc(p)}${i === pts.length - 1 ? cursorHtml(it.live) : ''}</div>`).join('')
    if (T.dataset.h !== th) { T.innerHTML = th; T.dataset.h = th }
    if (P.dataset.h !== ph) { P.innerHTML = ph; P.dataset.h = ph }
    return
  }
  for (const x of [T, P]) if (x.getAttribute('contenteditable') !== 'plaintext-only') x.setAttribute('contenteditable', 'plaintext-only')
  delete T.dataset.h
  T.dataset.ph = n === 1 ? '标题' : '这一页的标题'; P.dataset.ph = '每行一个要点'
  const typing = DK.saving.has(b.id)
  if (document.activeElement !== T && !typing && T.innerText !== title) T.textContent = title
  // the points: one line each while you edit them, bullets otherwise
  if (document.activeElement !== P && !typing) { const h = pts.filter(Boolean).map((p) => `<div class="spt">${esc(p)}</div>`).join(''); if (P.dataset.h !== h) { P.innerHTML = h; P.dataset.h = h } }
  P.classList.toggle('empty', !pts.filter(Boolean).length && document.activeElement !== P)
  T.classList.toggle('empty', !title && document.activeElement !== T)
}
const slideText = (e) => [e.querySelector('.sl-t').innerText.replace(/\n+/g, ' ').trim(), ...pointsOf(e.querySelector('.sl-p'))].join('\n').replace(/\n+$/, '')
const pointsOf = (P) => P.querySelector('.spt') ? [...P.querySelectorAll('.spt')].map((x) => x.textContent.trim()) : P.innerText.split('\n').map((x) => x.trim()).filter(Boolean)

// status line: what the Bot is doing in here, what it just did (with 撤回), how long the document is
function foot(d) {
  const a = agentOf(d.agent), l = DK.live.get(d.agent), F = $('#dkF')
  let s = ''
  if (l && l.doc === d.id) {
    const k = l.op === 'edit' ? d.blocks.findIndex((b) => b.id === l.block) + 1 : (l.after === 'start' ? 0 : l.after ? d.blocks.findIndex((b) => b.id === l.after) + 1 : d.blocks.filter((b) => b.text.trim()).length) + Math.max(1, l.blocks.length)
    s = `<span class="dot" style="background:${inkOf(a.id)}"></span>${esc(a.name)}正在${l.op === 'edit' ? '改' : '写'}第 ${Math.max(1, k)} ${unitOf(d)}…`
  } else if (DK.wait && DK.wait.doc === d.id && DK.wait.until > Date.now()) s = `${esc(agentOf(DK.wait.agent).name)}想改你正在写的这段，等你写完再说`
  else {
    const e = [...(S.ledger || [])].reverse().find((x) => x.detail?.doc === d.id)
    if (e && e.status === 'done' && e.undo && Date.now() - Date.parse(e.at) < 10 * 60e3) s = `${esc(agentOf(e.agent || d.agent).name)} ${hhmm(e.at)} ${esc(e.title.replace(/《[^》]*》里?/, '').replace(/^在/, ''))}<button class="lk" data-act="undo" data-id="${e.id}">${esc(e.undo.label || '撤回')}</button>`
    else if (DK.ghostShown) s = `<kbd>Tab</kbd> 接受${esc(a.name)}的续写，<kbd>Esc</kbd> 不要`
    else s = DK.saving.size ? '正在保存…' : `已保存 ${hhmm(d.updatedAt)}`
  }
  const words = d.blocks.reduce((n, b) => n + b.text.replace(/\s/g, '').length, 0)
  const r = d.kind === 'slides' ? `${d.blocks.length} 页` : `${words} 字`
  const h = `<span class="st">${s}</span><span class="n">${r}</span>`
  if (F.dataset.h !== h) { F.innerHTML = h; F.dataset.h = h }
}
// the Bot is writing out of sight while you work elsewhere: a pill takes you there
function jump() {
  const J = $('#dkJump'), lv = $('#dkPaper .live'); if (!J) return
  if (!lv) { J.hidden = true; return }
  const B = $('#dkB'), r = lv.getBoundingClientRect(), br = B.getBoundingClientRect()
  const off = r.top > br.bottom - 30 ? 'down' : r.bottom < br.top + 10 ? 'up' : ''
  J.hidden = !off
  if (off) J.innerHTML = `<span class="dot" style="background:${lv.style.getPropertyValue('--c')}"></span>${esc(agentOf(DK.docs.get(deskId())?.agent || cur).name)}在${off === 'down' ? '下面' : '上面'}写 ${off === 'down' ? '↓' : '↑'}`
}

// ---------- your typing ----------
const deskD = () => DK.docs.get(deskId())
function caretAt(el) {
  const s = getSelection(); if (!s.rangeCount || !el.contains(s.focusNode)) return -1
  const r = document.createRange(); r.selectNodeContents(el); r.setEnd(s.focusNode, s.focusOffset)
  return r.toString().length
}
function caretTo(el, k) {
  el.focus()
  const s = getSelection(), r = document.createRange()
  let left = k < 0 ? Infinity : k, node = null, off = 0
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) { const t = w.currentNode; if (left <= t.length) { node = t; off = left; break } left -= t.length; node = t; off = t.length }
  if (node) r.setStart(node, off); else r.setStart(el, 0)
  r.collapse(true); s.removeAllRanges(); s.addRange(r)
}
const blockEl = (bid) => $(`#dkPaper [data-id="${bid}"]`)
function save(bid, text, extra = {}) {
  const d = deskD(); if (!d) return
  const b = d.blocks.find((x) => x.id === bid); if (b) { b.text = text; b.last = 'me'; if (extra.type) b.type = extra.type }
  clearTimeout(DK.saving.get(bid))
  DK.saving.set(bid, setTimeout(() => dkSend(d.id, bid), extra.now ? 0 : 350))
  foot(d)
}
async function dkSend(id, bid) {
  DK.saving.delete(bid)
  const d = DK.docs.get(id), b = d && d.blocks.find((x) => x.id === bid); if (!b) return
  await api('doc/edit', { id, block: bid, text: b.text, type: b.type })
  if (deskId() === id) foot(d)
}
function flushAll() { for (const [bid, t] of DK.saving) { clearTimeout(t); dkSend(deskId(), bid) } }
async function refetch(id) { const r = await api('doc/get', { id }); if (r.doc) DK.docs.set(id, r.doc); deskRender() }

// # 标题, ## 小标题, - 要点, > 引用, typed at the start of a paragraph
const SHORT = [[/^#\s/, 'h1'], [/^##\s/, 'h2'], [/^[-*•]\s/, 'li'], [/^>\s/, 'quote']]
document.addEventListener('input', (e) => {
  const bx = e.target.closest?.('#dkPaper .bx'); if (!bx) return
  const d = deskD(), host = bx.closest('[data-id]'); if (!d || !host) return
  const bid = host.dataset.id
  ghostOff(bx)
  if (d.kind === 'slides') { save(bid, slideText(host)); return }
  let t = bx.innerText.replace(/\n$/, ''), type
  for (const [re, k] of SHORT) if (re.test(t)) { type = k; t = t.replace(re, ''); bx.textContent = t; caretTo(bx, 0); break }
  save(bid, t, type ? { type, now: true } : {})
  if (type) host.className = host.className.replace(/\bt-\w+/, 't-' + type)
  ghostLater(bx, bid)
})
document.addEventListener('keydown', async (e) => {
  const bx = e.target.closest?.('#dkPaper .bx'); if (!bx || e.isComposing) return
  const d = deskD(), host = bx.closest('[data-id]'); if (!d || !host) return
  const bid = host.dataset.id, k = caretAt(bx), text = bx.innerText.replace(/\n$/, ''), sel = getSelection()
  const all = [...$('#dkPaper').querySelectorAll('[data-id] .bx[contenteditable]')], i = all.indexOf(bx)
  if (e.key === 'Tab' && bx.dataset.ghost) { e.preventDefault(); const g = bx.dataset.ghost; ghostOff(bx); bx.textContent = text + g; caretTo(bx, -1); save(bid, bx.innerText, { now: true }); return }
  if (e.key === 'Escape' && bx.dataset.ghost) { e.preventDefault(); e.stopPropagation(); ghostOff(bx); return }
  if (d.kind === 'slides') {
    // Enter in a title goes down to the points; in the points it starts a new point (the browser does that)
    if (e.key === 'Enter' && bx.classList.contains('sl-t')) { e.preventDefault(); caretTo(host.querySelector('.sl-p'), -1) }
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault(); clearTimeout(DK.saving.get(bid)); DK.saving.delete(bid)
    const r = await api('doc/split', { id: d.id, block: bid, text, at: k < 0 ? text.length : k })
    if (r.id) { await refetch(d.id); const n = blockEl(r.id); if (n) caretTo(n.querySelector('.bx'), 0) }
    return
  }
  if (e.key === 'Backspace' && k === 0 && sel.isCollapsed && i > 0) {
    e.preventDefault(); clearTimeout(DK.saving.get(bid)); DK.saving.delete(bid)
    const r = await api('doc/merge', { id: d.id, block: bid, text })
    if (r.into) { await refetch(d.id); const n = blockEl(r.into); if (n) caretTo(n.querySelector('.bx'), r.at) }
    return
  }
  // arrows walk from one paragraph into the next
  if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && k === 0 && sel.isCollapsed && i > 0) { e.preventDefault(); caretTo(all[i - 1], -1) }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && k === text.length && sel.isCollapsed && i < all.length - 1) { e.preventDefault(); caretTo(all[i + 1], 0) }
})
document.addEventListener('paste', async (e) => {
  const bx = e.target.closest?.('#dkPaper .bx'); if (!bx) return
  const d = deskD(), host = bx.closest('[data-id]'); if (!d || !host || d.kind === 'slides') return
  const t = (e.clipboardData?.getData('text/plain') || '').replace(/\r/g, '')
  if (!t.includes('\n')) return
  e.preventDefault()
  const k = caretAt(bx), cur0 = bx.innerText.replace(/\n$/, ''), at = k < 0 ? cur0.length : k
  const lines = (cur0.slice(0, at) + t + cur0.slice(at)).split(/\n+/)
  bx.textContent = lines[0]; save(host.dataset.id, lines[0], { now: true })
  if (lines.length > 1) { const r = await api('doc/insert', { id: d.id, after: host.dataset.id, lines: lines.slice(1) }); await refetch(d.id); const n = r.ids && blockEl(r.ids[r.ids.length - 1]); if (n) caretTo(n.querySelector('.bx'), -1) }
})
// where your cursor is: that paragraph is yours while you are in it (the runtime keeps it for 15 s after each sign)
let beat = null
document.addEventListener('focusin', (e) => {
  const bx = e.target.closest?.('#dkPaper .bx'); if (!bx) return
  const d = deskD(), host = bx.closest('[data-id]'); if (!d || !host) return
  bx.classList.remove('empty')
  if (bx.classList.contains('sl-p') && bx.querySelector('.spt')) { const t = pointsOf(bx).join('\n'); bx.textContent = t; delete bx.dataset.h; caretTo(bx, -1) }
  api('doc/focus', { id: d.id, block: host.dataset.id })
  clearInterval(beat); beat = setInterval(() => { const h = document.activeElement?.closest?.('#dkPaper [data-id]'); if (h && deskD()) api('doc/focus', { id: deskD().id, block: h.dataset.id }); else clearInterval(beat) }, 5000)
})
document.addEventListener('focusout', (e) => {
  const bx = e.target.closest?.('#dkPaper .bx'); if (!bx) return
  ghostOff(bx)
  setTimeout(() => {
    const d = deskD(); if (!d) return
    if (!document.activeElement?.closest?.('#dkPaper')) { clearInterval(beat); api('doc/focus', { id: d.id, block: null }) }
    paper(d)
  }, 150)
})

// ---------- 续写提示 ----------
let ghostT = null
function ghostOff(bx) { clearTimeout(ghostT); if (bx?.dataset.ghost) { delete bx.dataset.ghost; DK.ghostShown = false; const d = deskD(); if (d) foot(d) } }
function ghostLater(bx, bid) {
  clearTimeout(ghostT)
  const d = deskD()
  if (!DK.ghostOn || !d || d.kind !== 'doc' || !/^(p|li|quote)$/.test(d.blocks.find((b) => b.id === bid)?.type || '')) return
  ghostT = setTimeout(async () => {
    const text = bx.innerText.replace(/\n$/, '')
    if (document.activeElement !== bx || caretAt(bx) !== text.length || text.replace(/\s/g, '').length < 6 || [...DK.live.values()].some((l) => l.doc === d.id)) return
    clearTimeout(DK.saving.get(bid)); await dkSend(d.id, bid)
    const r = await api('doc/suggest', { id: d.id, block: bid })
    if (r.text && document.activeElement === bx && bx.innerText.replace(/\n$/, '') === text && caretAt(bx) === text.length) { bx.dataset.ghost = r.text; DK.ghostShown = true; foot(d) }
  }, 1100)
}

// ---------- 放映 ----------
function play(d, from = 0) {
  const slides = d.blocks.filter((b) => b.text.trim()); if (!slides.length) return toastText('还没有内容可以放映')
  let i = Math.min(from, slides.length - 1)
  const ov = document.createElement('div'); ov.className = 'dk-show'
  const draw = () => {
    const [t, ...p] = slides[i].text.split('\n'), pts = p.filter(Boolean)
    ov.innerHTML = `<div class="sh-pg ${i === 0 && !pts.length ? 'cover' : ''}"><div class="sh-t">${esc(t)}</div>${pts.length ? `<div class="sh-p">${pts.map((x) => `<div class="spt">${esc(x)}</div>`).join('')}</div>` : ''}${i === 0 && !pts.length ? '' : `<div class="sh-n">${i + 1} / ${slides.length}</div>`}</div>`
    replay(ov.firstChild, 'fade')
  }
  const end = () => { document.removeEventListener('keydown', key, true); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); ov.remove() }
  const key = (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (i < slides.length - 1) { i++; draw() } else end() }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (i > 0) { i--; draw() } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end() }
  }
  ov.onclick = (e) => { if (e.clientX < innerWidth / 3) { if (i > 0) { i--; draw() } } else if (i < slides.length - 1) { i++; draw() } else end() }
  document.addEventListener('keydown', key, true)
  document.body.appendChild(ov); draw()
  ov.requestFullscreen?.().catch(() => {})
  document.addEventListener('fullscreenchange', function f() { if (!document.fullscreenElement && ov.isConnected) end(); if (!ov.isConnected) document.removeEventListener('fullscreenchange', f) })
}

// ---------- the list of documents written with this Bot ----------
function listMenu() {
  const M = $('#dkMenu'); if (!M.hidden) { M.hidden = true; return }
  const a = agentOf(cur), mine = (S.docs || []).filter((d) => d.agent === a.id), id = deskId()
  M.innerHTML = `<div class="pg">和${esc(a.name)}一起写的</div>${mine.map((d) => `<div class="row ${d.id === id ? 'on' : ''}"><button data-act="dk-open" data-id="${d.id}">${dki(d.kind === 'slides' ? 'slides' : 'doc', 16)}<span>${esc(d.title)}</span><small>${when(d.updatedAt)}</small></button><button class="x" data-act="dk-remove" data-id="${d.id}" title="删掉">${dki('trash', 15)}</button></div>`).join('')}
    <div class="sep"></div><button class="nw" data-act="dk-new" data-kind="doc">${dki('plus', 16)}<span>新文档</span></button><button class="nw" data-act="dk-new" data-kind="slides">${dki('plus', 16)}<span>新幻灯片</span></button>`
  M.hidden = false; replay(M, 'in')
}
async function newDesk(kind) {
  const r = await api('doc/new', { kind, agent: cur })
  if (!r.doc) return toastText(r.error || '没建成')
  DK.docs.set(r.doc.id, r.doc)
  // the list may already have it, if the state came back first
  if (!(S.docs ||= []).some((x) => x.id === r.doc.id)) S.docs.unshift({ id: r.doc.id, title: r.doc.title, kind: r.doc.kind, agent: r.doc.agent, updatedAt: r.doc.updatedAt, n: 0, calls: [] })
  deskShow(r.doc.id)
  setTimeout(() => { const t = $('#dkTitle'); if (t) { t.focus(); t.select() } }, 60)
}

// ---------- clicks ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]')
  const DM = $('#dkMenu'); if (DM && !DM.hidden && !e.target.closest('#dkMenu, [data-act="dk-list"]')) DM.hidden = true
  if (!el) return
  const act = el.dataset.act, d = deskD()
  if (act === 'dk-open') { e.stopPropagation(); $('#dkMenu') && ($('#dkMenu').hidden = true); const a = (S.docs || []).find((x) => x.id === el.dataset.id); if (a && a.agent !== cur) { cur = a.agent; store.set('agent', cur); setView('chat') } deskShow(el.dataset.id) }
  else if (act === 'dk-close') deskHide()
  else if (act === 'dk-list') listMenu()
  else if (act === 'dk-new') { $('#dkMenu').hidden = true; newDesk(el.dataset.kind) }
  else if (act === 'dk-marks') { DK.marks = !DK.marks; store.set('deskMarks', DK.marks); deskRender() }
  else if (act === 'dk-ghost') { DK.ghostOn = !DK.ghostOn; store.set('deskGhost', DK.ghostOn); toastText(DK.ghostOn ? '你停下来时会在光标后面提示半句，按 Tab 接受' : '续写提示关了'); deskRender() }
  else if (act === 'dk-play' && d) play(d)
  else if (act === 'dk-jump') { const lv = $('#dkPaper .live'); DK.follow = true; lv?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
  else if (act === 'dk-tail' && d) {
    // clicking below the last paragraph puts the cursor at its end (or starts a new one after a heading)
    const last = [...$('#dkPaper').querySelectorAll('[data-id] .bx[contenteditable]')].pop()
    if (last) caretTo(last, -1)
  }
  else if (act === 'dk-drop' && d) { const h = el.closest('[data-id]'); if (h) { await api('doc/drop', { id: d.id, block: h.dataset.id }); refetch(d.id) } }
  else if (act === 'dk-add' && d) { const r = await api('doc/insert', { id: d.id, after: d.blocks[d.blocks.length - 1]?.id || '', lines: [''] }); await refetch(d.id); const n = r.ids && blockEl(r.ids[0]); if (n) { caretTo(n.querySelector('.bx'), 0); n.scrollIntoView({ behavior: 'smooth', block: 'center' }) } }
  else if (act === 'panel-toggle' && deskId()) { delete DK.open[cur]; store.set('desk', DK.open); DK.procWas = null; deskRender() }
  else if (act === 'dk-export' && d) {
    flushAll()
    const r = await api('doc/export', { id: d.id })
    if (r.error) return toastText('没存成：' + r.error)
    toastText(`存好了：${r.path}`, APP?.openFile ? ['打开', () => APP.openFile(r.path)] : null)
    soon()
  }
  else if (act === 'dk-remove') {
    e.stopPropagation()
    const x = (S.docs || []).find((y) => y.id === el.dataset.id); if (!x || !confirm(`删掉《${x.title}》？在操作记录里还能找回来。`)) return
    await api('doc/remove', { id: x.id })
    const M = $('#dkMenu'); if (M) M.hidden = true
  }
})

// ---------- live from the runtime ----------
let msgsT = null
function metaFrom(doc) {
  const l = (S.docs ||= []), i = l.findIndex((x) => x.id === doc.id)
  const m = { id: doc.id, title: doc.title, kind: doc.kind, agent: doc.agent, at: doc.createdAt, updatedAt: doc.updatedAt, n: doc.blocks.filter((b) => b.text.trim()).length, calls: (doc.calls || []).slice(-20) }
  const was = i >= 0 ? l[i] : null
  if (i >= 0) l[i] = m; else l.unshift(m)
  // the card in the chat shows the title and length
  if (view === 'chat' && cur === doc.agent && (!was || was.n !== m.n || was.title !== m.title || was.calls.length !== m.calls.length)) { clearTimeout(msgsT); msgsT = setTimeout(() => renderMsgs(true), 250) }
}
window.onDesk = (m) => {
  if (m.type === 'doc') {
    DK.docs.set(m.doc.id, m.doc); metaFrom(m.doc)
    if (deskId() === m.doc.id) deskRender()
  } else if (m.type === 'doc-live') {
    if (m.live) DK.live.set(m.agent, m.live); else DK.live.delete(m.agent)
    if (m.wait) { DK.wait = { ...m.wait, agent: m.agent, until: Date.now() + 8000 }; setTimeout(() => { if (deskId()) deskRender() }, 8100) }
    const id = deskId()
    if (id && ((m.live && m.live.doc === id) || !m.live || m.wait)) { const d = DK.docs.get(id); if (d) { dkHead(d); paper(d); foot(d); jump() } }
    if (view === 'chat' && cur === m.agent && !id) { clearTimeout(msgsT); msgsT = setTimeout(() => renderMsgs(true), 250) }
  } else if (m.type === 'doc-open') {
    DK.open[m.agent] = m.id; store.set('desk', DK.open)
    if (view === 'chat' && cur === m.agent) deskShow(m.id)
    else if (looking()) toastText(`${agentOf(m.agent).name}开了一份文档，和你一起写`, ['去看', () => { cur = m.agent; store.set('agent', cur); setView('chat') }])
  } else if (m.type === 'doc-gone') {
    DK.docs.delete(m.id); S.docs = (S.docs || []).filter((x) => x.id !== m.id)
    for (const k of Object.keys(DK.open)) if (DK.open[k] === m.id) delete DK.open[k]
    store.set('desk', DK.open); deskRender()
  }
}
// app.js redraws often (every runtime change); the pane follows the Bot being chatted with
window.deskSync = () => {
  const id = deskId()
  if (id && procPref !== 'closed') { DK.procWas = procPref; closeProc() }
  deskRender()
}

// ---------- in the chat: the card of an opened document; in 资料库: the documents ----------
window.BOTCARD = Object.assign(window.BOTCARD || {}, {
  doc_open: (it) => {
    const m = (S.docs || []).find((x) => (x.calls || []).includes(it.callId)); if (!m) return ''
    const open = deskId() === m.id, l = DK.live.get(m.agent), writing = l && l.doc === m.id
    return `<button class="dkcard ${open ? 'on' : ''}" data-act="dk-open" data-id="${m.id}" data-k="dk${it.id}"><span class="ic ${m.kind}">${dki(m.kind === 'slides' ? 'slides' : 'doc', 20)}</span><span class="t"><b>${esc(m.title)}</b><small>${writing ? `<span class="tdots"><i></i><i></i><i></i></span>${esc(agentOf(m.agent).name)}正在写` : `${m.kind === 'slides' ? '幻灯片' : '文档'} · ${m.n} ${m.kind === 'slides' ? '页' : '段'} · 你们一起写的`}</small></span><span class="go">${open ? '在右边' : '打开'}</span></button>`
  },
})
window.deskFiles = (a) => {
  const l = (S.docs || []).filter((d) => d.agent === a.id); if (!l.length) return ''
  return `<div class="psec">一起写的</div><div class="lib">${l.map((d) => `<button class="li" data-act="dk-open" data-id="${d.id}"><span class="fi doc">${d.kind === 'slides' ? 'PPT' : 'DOC'}</span><span>${esc(d.title)}</span></button>`).join('')}</div>`
}
// + menu
$('#bDoc') && ($('#bDoc').onclick = () => { $('#plusMenu').hidden = true; newDesk('doc') })
$('#bDeck') && ($('#bDeck').onclick = () => { $('#plusMenu').hidden = true; newDesk('slides') })
})()
