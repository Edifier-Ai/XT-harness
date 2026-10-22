// Generative UI inside agent replies: OpenUI's own (github.com/thesysdev/openui, MIT).
// An agent writes an ```openui-lang block in its reply; OpenUI's chat component library and React renderer
// (genui/openui.js, window.OpenUI, built by build/genui) draw it as the text streams in.
// The chat is drawn as HTML strings, so a card is a slot in that HTML; each message's card lives in an element of its
// own that is moved into its slot after every redraw, so the card keeps what the user typed, picked and opened.
// Buttons and forms answer the agent the way OpenUI's @ToAssistant does: a user message with the button's words,
// the form's values and the button's context.
// The page's esc comes from app.js (or widget.html).
'use strict'
const GU = (() => {
  const O = window.OpenUI
  const FENCE = /```[ \t]*(openui-lang|openui)[^\n]*\n/
  const SKEY = 'tx.genui2'

  // per message: what the user set on its card, and what it was answered with
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(SKEY) || '{}') } catch {}
  const st = (mid) => (saved[mid] ||= {})
  let pT = null
  const persist = () => { clearTimeout(pT); pT = setTimeout(() => { try { const k = Object.keys(saved); if (k.length > 300) for (const x of k.slice(0, k.length - 300)) delete saved[x]; localStorage.setItem(SKEY, JSON.stringify(saved)) } catch {} }, 300) }

  // ---------- reply text → prose and interface parts ----------
  function split(text, live) {
    const out = []; let s = String(text || '')
    // a reply that is nothing but code still renders
    if (/^\s*root\s*=\s*[A-Z]\w*\(/.test(s)) return [{ ui: s, open: live }]
    for (;;) {
      const m = FENCE.exec(s)
      if (!m) {
        // code written without its fence after some text
        const bare = /^root\s*=\s*Card\(/m.exec(s)
        if (bare) { if (s.slice(0, bare.index).trim()) out.push({ md: s.slice(0, bare.index) }); out.push({ ui: s.slice(bare.index), open: live }); break }
        // while streaming, hide a fence that is still being typed
        if (live) s = s.replace(/`{1,3}(o(p(e(n(u(i(-(l(a(n(g)?)?)?)?)?)?)?)?)?)?)?$/, '')
        if (s.trim()) out.push({ md: s }); break
      }
      if (s.slice(0, m.index).trim()) out.push({ md: s.slice(0, m.index) })
      const rest = s.slice(m.index + m[0].length)
      const end = /^[ \t]*```[ \t]*$/m.exec(rest)
      if (!end) { out.push({ ui: rest, open: true }); break }
      out.push({ ui: rest.slice(0, end.index) })
      s = rest.slice(end.index + end[0].length)
    }
    return out
  }
  // what a reply says without its interface: previews, copy, export, read aloud
  const plain = (text, mark = '［界面］') => split(text, false).map((p) => p.md != null ? p.md.trim() : mark).filter(Boolean).join('\n').trim()

  // ---------- cards ----------
  const mode = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  const want = new Map()     // mid -> { code, live } from the last render()
  const views = new Map()    // slot key -> { el, h, mid, code, live, mode, seen }

  /** The slot for one message's card; mount() fills it. live: still streaming. */
  function render(mid, code, live) {
    if (!O) return `<div class="ou ou-bad">这一版没有装好生成式界面的组件</div>`
    want.set(mid, { code: String(code || ''), live: !!live })
    const S = st(mid)
    return `<div class="ou${live ? ' live' : ''}${S.used ? ' used' : ''}" data-mid="${esc(mid)}" data-ou-slot="1">${S.used ? `<div class="ou-used">已发送：${esc(S.used)}</div>` : ''}</div>`
  }

  function view(key, mid) {
    let v = views.get(key)
    if (v) return v
    const el = document.createElement('div'); el.className = 'ou-v'
    v = { el, mid, code: null, live: null, mode: null, ok: true, seen: Date.now() }
    const S = st(mid)
    v.h = O.mount(el, {
      code: '', live: true, mode: mode(), initial: S.state,
      onAction: (ev) => act(v, ev),
      onState: (s) => { st(mid).state = s; persist() },
      onParse: (r) => { v.ok = !!r?.root; badge(v) },
    })
    new ResizeObserver(() => dispatchEvent(new CustomEvent('gu-resize', { detail: { mid } }))).observe(el)
    views.set(key, v)
    return v
  }
  // a finished card that would not draw: say so, with the code behind it
  function badge(v) {
    const slot = v.el.parentElement; if (!slot) return
    const bad = !v.ok && !v.live && v.code
    let b = slot.querySelector(':scope>.ou-badnote')
    if (bad && !b) { b = document.createElement('div'); b.className = 'ou-badnote'; b.innerHTML = `这段界面没能画出来<details><summary>看原文</summary><pre></pre></details>`; b.querySelector('pre').textContent = v.code; slot.append(b) }
    else if (!bad && b) b.remove()
  }

  /** Puts every card into its slot on the page, and brings it up to date. */
  function mount() {
    if (!O) return
    const seen = new Set()
    for (const slot of document.querySelectorAll('[data-ou-slot]')) {
      const mid = slot.dataset.mid; let key = mid, n = 1
      while (seen.has(key)) key = mid + '#' + (++n)
      seen.add(key)
      const v = view(key, mid), w = want.get(mid) || { code: v.code || '', live: false }
      if (v.el.parentElement !== slot) slot.prepend(v.el)
      v.seen = Date.now()
      if (v.code !== w.code || v.live !== w.live || v.mode !== mode()) {
        v.code = w.code; v.live = w.live; v.mode = mode()
        v.h.update({ code: w.code, live: w.live, mode: v.mode })
      }
      badge(v)
    }
  }
  // cards drawn into the page outside keepFocus are filled too
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('[data-ou-slot]:not(:has(.ou-v))') || n.querySelector('[data-ou-slot]:not(:has(.ou-v))'))) return mount()
  }).observe(document.documentElement, { childList: true, subtree: true })
  // the theme changed: every card follows
  new MutationObserver(() => mount()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  // cards no longer on the page are let go after a while
  setInterval(() => { const t = Date.now(); for (const [k, v] of views) if (!v.el.isConnected && t - v.seen > 120e3) { v.h.unmount(); views.delete(k) } }, 60e3)

  // ---------- a button or form on a card ----------
  const valueOf = (x) => x && typeof x === 'object' && 'value' in x ? x.value : x
  async function act(v, ev) {
    const mid = v.mid, p = ev?.params || {}
    if (ev.type === 'open_url') { const u = String(p.url || ''); if (/^https?:\/\//.test(u)) window.APP ? APP.open(u) : window.open(u); return }
    if (ev.type !== 'continue_conversation') return
    const msg = String(ev.humanFriendlyMessage || p.message || p.llmFriendlyMessage || '好')
    const form = ev.formName ? ev.formState?.[ev.formName] : null
    const vals = form && typeof form === 'object' ? Object.fromEntries(Object.entries(form).map(([k, x]) => [k, valueOf(x)])) : null
    const ctx = p.context
    const hidden = [p.llmFriendlyMessage || msg, vals || ctx !== undefined ? '\n[界面回传]' : '', vals ? `表单 ${ev.formName}：${JSON.stringify(vals)}` : '', ctx !== undefined ? `context：${JSON.stringify(ctx)}` : ''].filter(Boolean).join('\n')
    // a desktop widget or a tool (mid w:<id>:<version>) is used again and again; a card in the chat is answered once
    if (!mid.startsWith('w:')) {
      st(mid).used = msg; persist()
      const slot = v.el.parentElement
      if (slot) { slot.classList.add('used'); if (!slot.querySelector(':scope>.ou-used')) slot.insertAdjacentHTML('beforeend', `<div class="ou-used">已发送：${esc(msg)}</div>`) }
    }
    await (GU.route?.(mid) || GU.send)(hidden, msg)
  }

  // keep focus and caret across a re-render of the chat, and fill the cards in
  function keepFocus(fn) {
    const a = document.activeElement, inCard = a && a.closest?.('.ou-v')
    const sel = inCard ? [a.selectionStart, a.selectionEnd] : null
    fn()
    mount()
    if (inCard && a.isConnected && document.activeElement !== a) { a.focus({ preventScroll: true }); try { if (sel[0] != null) a.setSelectionRange(sel[0], sel[1]) } catch {} }
  }

  // the kind of card a reply carries: the name after its fence (```openui-lang 城市天气), else its title
  const kindOf = (text) => {
    const m = /```[ \t]*(?:openui-lang|openui)([^\n]*)\n/.exec(String(text || ''))
    const k = (m ? m[1] : '').replace(/[`"'“”‘’《》「」]/g, '').replace(/^\s*(用途|类型|kind|name)\s*[:：]\s*/i, '').trim().slice(0, 16)
    if (k) return k
    const t = /CardHeader\(\s*"((?:[^"\\]|\\.)*)"/.exec(String(text || ''))
    return t ? t[1].replace(/[`"'“”‘’《》「」]/g, '').trim().slice(0, 16) : '卡片'
  }

  return { split, plain, render, mount, keepFocus, kindOf, send: async () => {}, route: null, ready: !!O }
})()
