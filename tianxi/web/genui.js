// Generative UI inside agent replies, after OpenUI (github.com/thesysdev/openui, MIT).
// An agent writes an ```openui-lang block in its reply; OpenUI's own streaming parser and evaluator
// (genui/openui.js, window.OpenUI) turn it into a component tree as the text streams in, and this file
// draws that tree in 小天's look. Buttons and forms answer the agent the way OpenUI's @ToAssistant does:
// a user message carrying the button's words, the form's values and the button's context.
// The page's esc, md, fileUrl, isImg, extOf, fileTile and say come from app.js.
'use strict'
const GU = (() => {
  const O = window.OpenUI
  const schema = O ? O.library.toJSONSchema() : null
  const FENCE = /```[ \t]*(openui-lang|openui)[^\n]*\n/
  const SKEY = 'tx.genui'

  // per message: parser, the values the user set, whether it was already answered
  const cache = new Map(), ACTS = new Map(), born = new Map()
  const INPUTS = new Set(['Input', 'TextArea', 'Select', 'DatePicker', 'Slider', 'CheckBoxGroup', 'RadioGroup', 'SwitchGroup', 'Chips', 'OptionCards'])
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(SKEY) || '{}') } catch {}
  const st = (mid) => (saved[mid] ||= { v: {}, ui: {}, used: null })
  const persist = () => { try { const k = Object.keys(saved); if (k.length > 300) for (const x of k.slice(0, k.length - 300)) delete saved[x]; localStorage.setItem(SKEY, JSON.stringify(saved)) } catch {} }

  // ---------- reply text → prose and interface parts ----------
  function split(text, live) {
    const out = []; let s = String(text || '')
    // a reply that is nothing but code still renders
    if (/^\s*root\s*=\s*[A-Z]\w*\(/.test(s)) return [{ ui: s, open: live }]
    for (;;) {
      const m = FENCE.exec(s)
      if (!m) {
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

  // ---------- parse ----------
  function parse(mid, code, complete) {
    if (!O) return null
    let c = cache.get(mid)
    if (!c) { c = { sp: O.createStreamingParser(schema, O.library.root), code: null, complete: null, root: null }; cache.set(mid, c) }
    if (c.code !== code || c.complete !== complete) {
      try {
        const r = c.sp.set(code, complete)
        const store = O.createStore(); store.initialize(r.stateDeclarations || {}, {})
        const ctx = { getState: (n) => store.get(n), resolveRef: () => undefined, functions: {}, actions: schema.actions }
        c.root = r.root ? O.evaluateRoot(r, { ctx, library: O.library, store, errors: [] }) : null
        c.meta = r.meta
      } catch (e) { c.root = null; c.err = e.message }
      c.code = code; c.complete = complete
    }
    return c
  }

  // ---------- render ----------
  const isEl = (n) => n && typeof n === 'object' && n.type === 'element'
  const arr = (x) => Array.isArray(x) ? x : x == null ? [] : [x]
  const str = (x) => x == null ? '' : typeof x === 'object' ? '' : String(x)
  const inl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[(\d+)\]/g, '<sup>$1</sup>')
  const src = (s) => /^(https?:|data:image\/)/.test(s) ? s : fileUrl(s)
  const nice = (v) => { const a = Math.abs(v); return a >= 1e8 ? (v / 1e8).toFixed(1).replace(/\.0$/, '') + '亿' : a >= 1e4 ? (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万' : String(Math.round(v * 100) / 100) }
  const niceMax = (m) => { if (m <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))), f = m / p; return ([1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((x) => f <= x)) * p }

  // one render pass over a message's tree
  function Pass(mid, live) {
    const S = st(mid), acts = [], used = !!S.used || live
    const key = (form, name) => (form || '_') + '.' + name
    const val = (form, name, dflt) => { const k = key(form, name); return k in S.v ? S.v[k] : dflt }
    const act = (steps, label, form) => { acts.push({ steps, label, form }); return `data-ou-a="${acts.length - 1}"` }
    let form = null, fields = []
    // a block that streams in rises once; re-renders carry on its animation from where it is
    const rise = (path) => {
      if (!live) return ''
      const k = mid + path, t = performance.now(); if (!born.has(k)) born.set(k, t)
      const age = t - born.get(k); return age < 420 ? `" style="animation-delay:-${age.toFixed(0)}ms" data-rise="1` : ''
    }
    const kids = (list, path) => arr(list).map((n, i) => node(n, path + '.' + i)).join('')

    function node(n, path) {
      if (Array.isArray(n)) return kids(n, path)
      if (!isEl(n)) return typeof n === 'string' && n.trim() ? `<p class="ou-t">${inl(n)}</p>` : ''
      const p = n.props || {}, f = R[n.typeName]
      return f ? f(p, path, n) : ''
    }
    const R = {
      Card: (p, path) => `<div class="ou-kids">${arr(p.children).map((c, i) => `<div class="ou-b${rise(path + '.' + i)}">${node(c, path + '.' + i)}</div>`).join('')}</div>`,
      Stack: (p, path) => `<div class="ou-stack ${p.direction === 'row' ? 'row' : ''}">${arr(p.children).map((c, i) => `<div>${node(c, path + '.' + i)}</div>`).join('')}</div>`,
      CardHeader: (p) => `<div class="ou-head">${p.title ? `<h4>${inl(p.title)}</h4>` : ''}${p.subtitle ? `<div class="sub">${inl(p.subtitle)}</div>` : ''}</div>`,
      TextContent: (p) => `<p class="ou-t ${esc(p.size || '')}">${inl(str(p.text))}</p>`,
      Callout: (p) => `<div class="ou-call ${esc(p.variant || 'neutral')}"><b>${inl(str(p.title))}</b>${p.description ? `<div>${inl(str(p.description))}</div>` : ''}</div>`,
      Separator: () => '<hr class="ou-hr">',
      Image: (p) => p.src ? `<div class="gimg ou-img"><img src="${esc(src(p.src))}" alt="${esc(p.alt)}" onerror="this.parentElement.remove()"></div>` : '',
      ImageGallery: (p) => `<div class="ou-gal">${arr(p.images).filter((x) => x && x.src).map((x) => `<figure><img src="${esc(src(x.src))}" alt="${esc(x.alt)}" onerror="this.parentElement.remove()">${x.alt || x.details ? `<figcaption>${esc(x.alt || '')}${x.details ? `<small>${esc(x.details)}</small>` : ''}</figcaption>` : ''}</figure>`).join('')}</div>`,
      TagBlock: (p) => `<div class="ou-tags ${esc(p.size || '')}">${arr(p.tags).map((t) => `<span>${esc(str(t))}</span>`).join('')}</div>`,
      Table: (p) => {
        const cols = arr(p.columns).filter(isEl).map((c) => c.props || {}), n = Math.max(0, ...cols.map((c) => arr(c.data).length))
        if (!cols.length) return ''
        const cell = (c, v) => `<td class="${c.type === 'number' || typeof v === 'number' ? 'num' : ''}">${isEl(v) ? node(v, 'x') : esc(typeof v === 'number' ? v.toLocaleString() : str(v))}</td>`
        return `<div class="ou-tw"><table class="gt ou-tab"><tr>${cols.map((c) => `<th class="${c.type === 'number' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr>${Array.from({ length: n }, (_, r) => `<tr>${cols.map((c) => cell(c, arr(c.data)[r])).join('')}</tr>`).join('')}</table></div>`
      },
      EntityList: (p) => {
        const row = (x, cls) => x && typeof x === 'object' ? `<div class="r ${cls}"><span>${esc(x.left)}</span><b class="${x.rightVariant === 'number' ? 'num' : ''}">${esc(x.right)}</b></div>` : ''
        return `<div class="ou-ent">${row(p.header, 'h')}${arr(p.rows).map((x) => row(x, '')).join('')}${row(p.footer, 'f')}</div>`
      },
      StatBlock: (p) => `<div class="metrics ou-stats">${arr(p.items).filter(isEl).map((s) => node(s, 'x')).join('')}</div>`,
      Stat: (p) => `<div class="metric"><div class="l">${esc(p.label)}</div><div class="v">${esc(p.value)}</div>${p.subtext || p.trend ? `<div class="n">${esc(p.subtext || '')}${p.trend ? ` <i class="ou-tr ${p.trend.direction === 'down' ? 'dn' : 'up'}">${p.trend.direction === 'down' ? '↓' : '↑'}${esc(p.trend.value)}%</i>` : ''}</div>` : ''}</div>`,
      BarChart: (p) => bars(p, false),
      HorizontalBarChart: (p) => hbars(p),
      LineChart: (p) => line(p),
      PieChart: (p) => pie(p),
      ListBlock: (p, path) => `<div class="ou-list ${p.variant === 'image' ? 'img' : ''}">${arr(p.items).filter(isEl).map((it, i) => {
        const x = it.props || {}, a = x.action ? act(x.action.steps, x.title) : ''
        const lead = p.variant === 'image' ? (x.image?.src ? `<img src="${esc(src(x.image.src))}" alt="">` : '<i></i>') : `<em>${i + 1}</em>`
        return `<${a ? 'button' : 'div'} class="it ${a ? 'go' : ''}" ${a}${a && used ? ' disabled' : ''}>${lead}<span class="m">${inl(str(x.title))}${x.subtitle ? `<small>${inl(str(x.subtitle))}</small>` : ''}</span>${a ? `<span class="ar">${esc(x.actionLabel || '')}›</span>` : ''}</${a ? 'button' : 'div'}>`
      }).join('')}</div>`,
      Steps: (p) => `<ol class="ou-steps">${arr(p.items).filter(isEl).map((s) => `<li><b>${inl(str(s.props?.title))}</b><div>${inl(str(s.props?.details))}</div></li>`).join('')}</ol>`,
      Timeline: (p) => `<div class="tl ou-tl">${arr(p.items).filter(isEl).map((t) => { const x = t.props || {}; return `<div class="it ${x.conflict ? 'cf' : ''}"><span class="tm">${esc(x.time)}</span><div class="m">${inl(str(x.title))}${x.subtitle ? `<small>${inl(str(x.subtitle))}</small>` : ''}</div>${x.tag ? `<span class="tag">${esc(x.tag)}</span>` : ''}${x.conflict ? '<span class="tag cf">冲突</span>' : ''}</div>` }).join('')}</div>`,
      Files: (p) => `<div class="files">${arr(p.paths).map((f) => fileTile(str(f))).join('')}</div>`,
      Buttons: (p) => `<div class="ou-btns ${p.direction === 'column' ? 'col' : ''}">${arr(p.buttons).filter(isEl).map((b) => node(b, 'x')).join('')}</div>`,
      Button: (p) => {
        const steps = p.action?.steps || [{ type: 'continue_conversation', message: p.label }]
        const onlyUrl = steps.every((s) => s.type === 'open_url')
        const cls = p.type === 'destructive' ? 'btn warn' : p.variant === 'primary' ? 'btn pri' : p.variant === 'tertiary' ? 'btn ghost' : 'btn'
        const picked = S.used && S.used === p.label ? ' picked' : ''
        return `<button type="button" class="${cls}${picked}" ${act(steps, p.label, form)}${used && !onlyUrl ? ' disabled' : ''}>${esc(p.label)}</button>`
      },
      FollowUpBlock: (p) => `<div class="ou-fu">${arr(p.items).filter(isEl).map((x) => `<button type="button" ${act([{ type: 'continue_conversation', message: x.props?.text }], x.props?.text)}${live ? ' disabled' : ''}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5v8a3 3 0 0 0 3 3h11"/><path d="M15 12l4 4-4 4"/></svg>${esc(x.props?.text)}</button>`).join('')}</div>`,
      Form: (p, path) => {
        const was = form, wasF = fields
        form = str(p.name) || 'form'; fields = []
        const body = arr(p.fields).map((c, i) => node(c, path + '.f' + i)).join('')
        const btns = node(p.buttons, path + '.b')
        const h = `<form class="ou-form" data-ou-form="${esc(form)}" onsubmit="return false"><fieldset ${used ? 'disabled' : ''}>${body}</fieldset>${btns}</form>`
        form = was; fields = wasF
        return h
      },
      FormControl: (p, path) => {
        const input = isEl(p.input) ? p.input : null, name = str(input?.props?.name)
        if (name) fields.push({ name, label: str(p.label), node: input })
        return `<div class="ou-fc" data-ou-fc="${esc(key(form, name))}"><label>${esc(p.label)}</label><div class="ctl">${input ? node(input, path + '.i') : ''}</div>${p.hint ? `<div class="hint">${esc(p.hint)}</div>` : ''}<div class="err"></div></div>`
      },
      Input: (p) => `<input class="inp" data-ou-f="${esc(key(form, p.name))}" type="${['email', 'password', 'number', 'url'].includes(p.type) ? p.type : 'text'}" placeholder="${esc(p.placeholder)}" value="${esc(val(form, p.name, ''))}">`,
      TextArea: (p) => `<textarea class="inp" data-ou-f="${esc(key(form, p.name))}" rows="${Math.min(10, +p.rows || 3)}" placeholder="${esc(p.placeholder)}">${esc(val(form, p.name, ''))}</textarea>`,
      Select: (p) => { const v = val(form, p.name, ''); return `<select class="inp" data-ou-f="${esc(key(form, p.name))}">${p.placeholder || !v ? `<option value="" ${v ? '' : 'selected'} disabled>${esc(p.placeholder || '请选择')}</option>` : ''}${arr(p.items).filter(isEl).map((o) => `<option value="${esc(o.props?.value)}" ${String(o.props?.value) === String(v) ? 'selected' : ''}>${esc(o.props?.label)}</option>`).join('')}</select>` },
      DatePicker: (p) => {
        const k = key(form, p.name), v = val(form, p.name, p.mode === 'range' ? ['', ''] : '')
        return p.mode === 'range' ? `<input type="date" class="inp" data-ou-f="${esc(k)}" data-ou-i="0" value="${esc(arr(v)[0] || '')}"><span class="to">至</span><input type="date" class="inp" data-ou-f="${esc(k)}" data-ou-i="1" value="${esc(arr(v)[1] || '')}">`
          : `<input type="date" class="inp" data-ou-f="${esc(k)}" value="${esc(v)}">`
      },
      Slider: (p) => {
        const min = +p.min || 0, max = +p.max || 100, v = arr(val(form, p.name, p.defaultValue || [min]))[0] ?? min
        return `<input type="range" data-ou-f="${esc(key(form, p.name))}" min="${min}" max="${max}" step="${+p.step || (p.variant === 'discrete' ? 1 : (max - min) / 100)}" value="${+v}" data-unit="${esc(p.label || '')}"><span class="val">${esc(+v)} ${esc(p.label || '')}</span>`
      },
      CheckBoxGroup: (p) => `<div class="ou-checks">${arr(p.items).filter(isEl).map((o) => { const x = o.props || {}, k = key(form, p.name), on = (val(form, p.name, null) || {})[x.name] ?? !!x.defaultChecked; return `<label class="ou-opt"><input type="checkbox" data-ou-f="${esc(k)}" data-ou-k="${esc(x.name)}" ${on ? 'checked' : ''}><span><b>${esc(x.label)}</b>${x.description ? `<small>${esc(x.description)}</small>` : ''}</span></label>` }).join('')}</div>`,
      RadioGroup: (p, path) => { const v = val(form, p.name, p.defaultValue ?? ''); return `<div class="ou-checks">${arr(p.items).filter(isEl).map((o) => { const x = o.props || {}; return `<label class="ou-opt"><input type="radio" name="${esc(mid + path)}" data-ou-f="${esc(key(form, p.name))}" value="${esc(x.value)}" ${String(x.value) === String(v) ? 'checked' : ''}><span><b>${esc(x.label)}</b>${x.description ? `<small>${esc(x.description)}</small>` : ''}</span></label>` }).join('')}</div>` },
      SwitchGroup: (p) => `<div class="ou-checks">${arr(p.items).filter(isEl).map((o) => { const x = o.props || {}, on = (val(form, p.name, null) || {})[x.name] ?? !!x.defaultChecked; return `<div class="ou-sw"><span><b>${esc(x.label || x.name)}</b>${x.description ? `<small>${esc(x.description)}</small>` : ''}</span><button type="button" class="sw ${on ? 'on' : ''}" data-ou-f="${esc(key(form, p.name))}" data-ou-k="${esc(x.name)}" data-ou-sw></button></div>` }).join('')}</div>`,
      Chips: (p) => pick(p, 'ou-chips', (x) => esc(x.label)),
      OptionCards: (p) => pick(p, 'ou-cards', (x) => `<b>${esc(x.title)}</b>${x.subtitle ? `<small>${esc(x.subtitle)}</small>` : ''}`, 'single'),
      Tabs: (p, path) => {
        const items = arr(p.items).filter(isEl), on = S.ui[path] ?? items[0]?.props?.value
        return `<div class="ou-tabs" data-ou-ui="${path}"><div class="strip">${items.map((t) => `<button type="button" class="${t.props?.value === on ? 'on' : ''}" data-ou-tab="${esc(t.props?.value)}">${esc(t.props?.trigger)}</button>`).join('')}</div>${items.map((t, i) => `<div class="pane" data-ou-pane="${esc(t.props?.value)}" ${t.props?.value === on ? '' : 'hidden'}>${kids(t.props?.content, path + '.' + i)}</div>`).join('')}</div>`
      },
      Accordion: (p, path) => `<div class="ou-acc">${arr(p.items).filter(isEl).map((t, i) => { const k = path + '.' + i, open = S.ui[k] ?? i === 0; return `<details data-ou-ui="${k}" ${open ? 'open' : ''}><summary>${esc(t.props?.trigger)}</summary><div class="pane">${kids(t.props?.content, k)}</div></details>` }).join('')}</div>`,
    }
    // Chips and OptionCards: buttons that toggle, single or multiple
    function pick(p, cls, label, dflt = 'multiple') {
      const multi = (p.type || dflt) === 'multiple', k = key(form, p.name)
      const d = p.defaultValue ?? (multi ? [] : '')
      const v = val(form, p.name, d), set = new Set(arr(v).map(String))
      return `<div class="${cls}" data-ou-pick="${esc(k)}" data-multi="${multi ? 1 : ''}">${arr(p.items).filter(isEl).map((o) => { const x = o.props || {}; return `<button type="button" class="${set.has(String(x.value)) ? 'on' : ''}" data-v="${esc(x.value)}" ${x.disabled ? 'disabled' : ''}>${label(x)}</button>` }).join('')}</div>`
    }
    // ---- charts: drawn as SVG, series in 小天's six chart colours (--c0…--c5, motion.css) ----
    function series(p) { return arr(p.series).filter(isEl).map((s) => ({ name: str(s.props?.category), values: arr(s.props?.values).map((x) => +x || 0) })) }
    const legend = (ss) => ss.length > 1 ? `<div class="ou-leg">${ss.map((s, i) => `<span><i class="s${i % 6}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''
    const axisT = (p) => p.yLabel || p.xLabel ? `<div class="ou-ax">${esc(p.yLabel || '')}${p.yLabel && p.xLabel ? ' · ' : ''}${esc(p.xLabel || '')}</div>` : ''
    function bars(p) {
      const labels = arr(p.labels).map(str), ss = series(p); if (!labels.length || !ss.length) return ''
      const stacked = p.variant === 'stacked'
      const tot = labels.map((_, i) => stacked ? ss.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0) : Math.max(...ss.map((s) => s.values[i] || 0)))
      const top = niceMax(Math.max(...tot)), W = 560, H = 200, L = 40, B = 24, T = 8, cw = (W - L) / labels.length
      const y = (v) => T + (H - T - B) * (1 - v / top)
      let g = ''
      for (let k = 0; k <= 4; k++) { const v = top * k / 4; g += `<line class="gl" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="yt" x="${L - 6}" y="${y(v) + 4}">${nice(v)}</text>` }
      labels.forEach((lb, i) => {
        const x0 = L + cw * i, inner = cw * 0.64, bw = stacked ? inner : inner / ss.length
        let acc = 0
        ss.forEach((s, j) => {
          const v = Math.max(0, s.values[i] || 0), x = stacked ? x0 + (cw - inner) / 2 : x0 + (cw - inner) / 2 + bw * j
          const y1 = y(acc + v), y2 = y(acc); if (stacked) acc += v
          g += `<rect class="s${j % 6}" x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(0, y2 - y1).toFixed(1)}" rx="3"><title>${esc(lb)} ${esc(s.name)}：${v}</title></rect>`
        })
        g += `<text class="xt" x="${(x0 + cw / 2).toFixed(1)}" y="${H - 6}">${esc(lb.length > 8 ? lb.slice(0, 7) + '…' : lb)}</text>`
      })
      return `<div class="ou-chart">${axisT(p)}<svg viewBox="0 0 ${W} ${H}">${g}</svg>${legend(ss)}</div>`
    }
    function hbars(p) {
      const labels = arr(p.labels).map(str), ss = series(p); if (!labels.length || !ss.length) return ''
      const tot = labels.map((_, i) => ss.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0)), top = Math.max(...tot, 1)
      return `<div class="ou-chart">${axisT(p)}<div class="bars ou-hb">${labels.map((lb, i) => `<div class="bar"><span class="l">${esc(lb)}</span><span class="tr">${ss.map((s, j) => `<i class="s${j % 6}" style="width:${Math.max(.5, (s.values[i] || 0) / top * 100)}%" title="${esc(s.name)}：${s.values[i] || 0}"></i>`).join('')}</span><span class="v">${nice(tot[i])}</span></div>`).join('')}</div>${legend(ss)}</div>`
    }
    function line(p) {
      const labels = arr(p.labels).map(str), ss = series(p); if (!labels.length || !ss.length) return ''
      const all = ss.flatMap((s) => s.values), top = niceMax(Math.max(...all, 0)), bot = Math.min(0, ...all)
      const W = 560, H = 200, L = 40, B = 24, T = 10, R = 12, dx = labels.length > 1 ? (W - L - R) / (labels.length - 1) : 0
      const x = (i) => L + dx * i + (labels.length > 1 ? 0 : (W - L) / 2), y = (v) => T + (H - T - B) * (1 - (v - bot) / (top - bot || 1))
      let g = ''
      for (let k = 0; k <= 4; k++) { const v = bot + (top - bot) * k / 4; g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="yt" x="${L - 6}" y="${y(v) + 4}">${nice(v)}</text>` }
      const every = Math.ceil(labels.length / 8)
      labels.forEach((lb, i) => { if (i % every === 0) g += `<text class="xt" x="${x(i).toFixed(1)}" y="${H - 6}">${esc(lb.length > 8 ? lb.slice(0, 7) + '…' : lb)}</text>` })
      ss.forEach((s, j) => {
        const pts = s.values.map((v, i) => [x(i), y(v)])
        let d = ''
        if (p.variant === 'step') pts.forEach(([a, b], i) => { d += i ? `H${a.toFixed(1)}V${b.toFixed(1)}` : `M${a.toFixed(1)} ${b.toFixed(1)}` })
        else if (p.variant === 'linear') d = pts.map(([a, b], i) => (i ? 'L' : 'M') + a.toFixed(1) + ' ' + b.toFixed(1)).join('')
        else pts.forEach(([a, b], i) => { if (!i) { d = `M${a.toFixed(1)} ${b.toFixed(1)}`; return } const [pa, pb] = pts[i - 1], m = (a - pa) / 2; d += `C${(pa + m).toFixed(1)} ${pb.toFixed(1)} ${(a - m).toFixed(1)} ${b.toFixed(1)} ${a.toFixed(1)} ${b.toFixed(1)}` })
        g += `<path class="ln s${j % 6}" d="${d}"/>` + pts.map(([a, b], i) => `<circle class="pt s${j % 6}" cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3"><title>${esc(labels[i] || '')} ${esc(s.name)}：${s.values[i]}</title></circle>`).join('')
      })
      return `<div class="ou-chart">${axisT(p)}<svg viewBox="0 0 ${W} ${H}">${g}</svg>${legend(ss)}</div>`
    }
    function pie(p) {
      const labels = arr(p.labels).map(str), vals = arr(p.values).map((v) => Math.max(0, +v || 0)), sum = vals.reduce((a, b) => a + b, 0)
      if (!labels.length || !sum) return ''
      let a0 = -Math.PI / 2, g = ''
      const R = 70, r = p.variant === 'donut' ? 44 : 0, C = 80
      const pt = (a, rr) => `${(C + Math.cos(a) * rr).toFixed(2)} ${(C + Math.sin(a) * rr).toFixed(2)}`
      vals.forEach((v, i) => {
        const a1 = a0 + v / sum * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0
        const d = v >= sum ? `M${C - R} ${C}A${R} ${R} 0 1 1 ${C + R} ${C}A${R} ${R} 0 1 1 ${C - R} ${C}Z` : r
          ? `M${pt(a0, R)}A${R} ${R} 0 ${big} 1 ${pt(a1, R)}L${pt(a1, r)}A${r} ${r} 0 ${big} 0 ${pt(a0, r)}Z`
          : `M${C} ${C}L${pt(a0, R)}A${R} ${R} 0 ${big} 1 ${pt(a1, R)}Z`
        g += `<path class="s${i % 6} sl" d="${d}"><title>${esc(labels[i])}：${v}</title></path>`
        a0 = a1
      })
      return `<div class="ou-chart ou-pie"><svg viewBox="0 0 160 160" width="150" height="150">${g}${r ? `<circle class="hole" cx="${C}" cy="${C}" r="${r - 1}"/>` : ''}</svg><div class="ou-leg col">${labels.map((lb, i) => `<span><i class="s${i % 6}"></i>${esc(lb)}<b>${Math.round(vals[i] / sum * 100)}%</b></span>`).join('')}</div></div>`
    }
    return { node, acts, fields: () => fields, S, used }
  }

  // The card for one message's interface block. live: still streaming.
  function render(mid, code, live) {
    if (!O) return `<div class="ou ou-bad">这一版没有装好生成式界面的组件</div>`
    const c = parse(mid, code, !live)
    if (!c?.root) {
      if (live) return `<div class="ou ou-wait" data-mid="${mid}"><i></i><i></i><i></i><span>正在画界面</span></div>`
      return `<div class="ou ou-bad" data-mid="${mid}">这段界面没能画出来${c?.meta?.errors?.length ? `（${esc(String(c.meta.errors[0]?.message || c.meta.errors[0]).slice(0, 80))}）` : ''}<details><summary>看原文</summary><pre>${esc(code)}</pre></details></div>`
    }
    const P = Pass(mid, live)
    const h = P.node(c.root, 'r')
    ACTS.set(mid, P.acts)
    const S = P.S
    return `<div class="ou${live ? ' live' : ''}${S.used ? ' used' : ''}" data-mid="${mid}">${h}${S.used ? `<div class="used">已发送：${esc(S.used)}</div>` : ''}</div>`
  }

  // ---------- events ----------
  const card = (el) => el.closest('.ou[data-mid]')
  const setV = (mid, k, v) => { st(mid).v[k] = v; persist() }
  function readField(el) {
    const k = el.dataset.ouF
    if (el.type === 'checkbox') { const all = el.closest('.ou-checks').querySelectorAll(`[data-ou-f="${CSS.escape(k)}"]`); const o = {}; all.forEach((x) => { o[x.dataset.ouK] = x.checked }); return o }
    if (el.type === 'radio') return el.value
    if (el.type === 'range') { el.nextElementSibling.textContent = el.value + ' ' + (el.dataset.unit || ''); return [+el.value] }
    if (el.dataset.ouI) { const both = card(el).querySelectorAll(`[data-ou-f="${CSS.escape(k)}"]`); return [...both].map((x) => x.value) }
    if (el.type === 'number') return el.value === '' ? '' : +el.value
    return el.value
  }
  addEventListener('input', (e) => { const el = e.target; if (el.dataset?.ouF && card(el)) { setV(card(el).dataset.mid, el.dataset.ouF, readField(el)); el.closest('.ou-fc')?.classList.remove('bad') } })
  addEventListener('change', (e) => { const el = e.target; if (el.dataset?.ouF && card(el)) setV(card(el).dataset.mid, el.dataset.ouF, readField(el)) })
  addEventListener('toggle', (e) => { const el = e.target; if (el.dataset?.ouUi && card(el)) { st(card(el).dataset.mid).ui[el.dataset.ouUi] = el.open; persist() } }, true)
  addEventListener('click', async (e) => {
    const el = e.target.closest('[data-ou-a],[data-ou-tab],[data-ou-pick] button,[data-ou-sw]'); if (!el) return
    const c = card(el); if (!c) return
    const mid = c.dataset.mid
    if (el.dataset.ouTab != null) {
      const t = el.closest('.ou-tabs'), v = el.dataset.ouTab
      t.querySelectorAll(':scope>.strip>button').forEach((b) => b.classList.toggle('on', b === el))
      t.querySelectorAll(':scope>.pane').forEach((p) => { p.hidden = p.dataset.ouPane !== v })
      st(mid).ui[t.dataset.ouUi] = v; persist(); return
    }
    if (el.closest('fieldset[disabled]')) return
    if (el.dataset.ouSw != null) {
      el.classList.toggle('on')
      const all = el.closest('.ou-checks').querySelectorAll(`[data-ou-f="${CSS.escape(el.dataset.ouF)}"]`), o = {}
      all.forEach((x) => { o[x.dataset.ouK] = x.classList.contains('on') }); setV(mid, el.dataset.ouF, o); return
    }
    const pk = el.parentElement?.dataset?.ouPick
    if (pk != null && !el.dataset.ouA) {
      const box = el.parentElement, multi = !!box.dataset.multi
      if (multi) el.classList.toggle('on'); else box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el))
      setV(mid, pk, multi ? [...box.querySelectorAll('button.on')].map((b) => b.dataset.v) : el.dataset.v)
      box.closest('.ou-fc')?.classList.remove('bad'); return
    }
    const a = ACTS.get(mid)?.[+el.dataset.ouA]; if (!a || el.disabled) return
    for (const s of a.steps || []) if (s.type === 'open_url' && /^https?:\/\//.test(s.url || '')) window.APP ? APP.open(s.url) : window.open(s.url)
    const talk = (a.steps || []).filter((s) => s.type === 'continue_conversation')
    if (!talk.length) return
    // the form this button belongs to: check it, then send its values
    const fEl = el.closest('form[data-ou-form]')
    const vals = el.closest('.ou-fu') ? { ok: true, n: 0, shown: '' } : collect(c, fEl?.dataset.ouForm ?? null)
    if (!vals.ok) return
    st(mid).used = a.label || talk[0].message || '好'; persist()
    c.classList.add('used'); c.querySelectorAll('button[data-ou-a],fieldset').forEach((b) => { if (!b.closest('.ou-fu') || b === el) b.disabled = true }); el.classList.add('picked')
    const msg = talk.map((s) => s.message).filter(Boolean).join('；') || a.label
    const shown = vals.shown ? `${msg}（${vals.shown}）` : msg
    const ctx = talk.map((s) => s.context).filter((x) => x !== undefined)
    const hidden = [msg, vals.n || ctx.length ? '\n[界面回传]' : '', vals.n ? `${fEl ? '表单 ' + fEl.dataset.ouForm : '用户在界面上选的'}：${JSON.stringify(vals.data)}` : '', ctx.length ? `context：${JSON.stringify(ctx.length === 1 ? ctx[0] : ctx)}` : ''].filter(Boolean).join('\n')
    // a tool or desktop widget (mid w:<id>:<version>) answers 小天 out of the chat
    await (GU.route?.(mid) || GU.send)(hidden, shown)
  })
  // the form's values, labelled the way the user saw them; marks fields that break their rules
  function collect(c, name) {
    const mid = c.dataset.mid, S = st(mid)
    const code = cache.get(mid)
    // every field the user could set on this card: this form's, and pickers outside any form (a plan picked above it)
    const fs = []
    ;(function walk(n, inForm, label) {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, inForm, label)); if (!isEl(n)) return
      const p = n.props || {}
      if (n.typeName === 'Form') { if (p.name === name) arr(p.fields).forEach((x) => walk(x, p.name, '')); return }
      if (n.typeName === 'FormControl') return walk(p.input, inForm, str(p.label))
      if (INPUTS.has(n.typeName) && p.name) { fs.push({ label: label || '选择', node: n, form: inForm }); return }
      for (const v of Object.values(p)) walk(v, inForm, '')
    })(code.root, null, '')
    const data = {}, shown = []; let ok = true
    for (const f of fs) {
      const p = f.node.props || {}, k = (f.form || '_') + '.' + p.name, t = f.node.typeName
      let v = k in S.v ? S.v[k] : t === 'Slider' ? (p.defaultValue || [p.min])[0] : t === 'Chips' || t === 'OptionCards' ? (p.defaultValue ?? ((p.type || (t === 'Chips' ? 'multiple' : 'single')) === 'multiple' ? [] : '')) : t === 'RadioGroup' ? (p.defaultValue ?? '') : t === 'CheckBoxGroup' || t === 'SwitchGroup' ? Object.fromEntries(arr(p.items).map((o) => [o.props?.name, !!o.props?.defaultChecked])) : ''
      if (Array.isArray(v) && t === 'Slider') v = v[0]
      const opts = arr(p.items).filter(isEl).map((o) => o.props || {})
      const lab = (x) => { const o = opts.find((y) => String(y.value) === String(x)); return o ? (o.label || o.title || x) : x }
      let say = ''
      if (t === 'Select' || t === 'RadioGroup' || t === 'Chips' || t === 'OptionCards') say = arr(v).filter((x) => x !== '').map(lab).join('、')
      else if (t === 'CheckBoxGroup' || t === 'SwitchGroup') say = opts.filter((o) => v[o.name]).map((o) => o.label || o.name).join('、') || '都不选'
      else if (t === 'Slider') say = v + (p.label ? ' ' + p.label : '')
      else if (t === 'DatePicker') say = arr(v).filter(Boolean).join(' 至 ')
      else say = String(v ?? '')
      const r = p.rules || {}, empty = v == null || v === '' || (Array.isArray(v) && !v.filter((x) => x !== '').length)
      const bad = r.required && empty ? '这一项要填' : typeof v === 'number' && r.min != null && v < r.min ? `不能小于 ${r.min}` : typeof v === 'number' && r.max != null && v > r.max ? `不能大于 ${r.max}` : r.maxLength && String(v).length > r.maxLength ? `最多 ${r.maxLength} 个字` : ''
      const fc = c.querySelector(`[data-ou-fc="${CSS.escape(k)}"]`)
      if (fc) { fc.classList.toggle('bad', !!bad); fc.querySelector('.err').textContent = bad }
      if (bad) ok = false
      data[p.name] = say && say !== String(v) ? { value: v, label: say } : v
      if (say) shown.push(`${f.label}：${say}`)
    }
    return { ok, data, n: fs.length, shown: shown.join('，') }
  }

  // keep focus and caret across a re-render of the chat
  function keepFocus(fn) {
    const a = document.activeElement, k = a?.dataset?.ouF && card(a) ? [card(a).dataset.mid, a.dataset.ouF, a.dataset.ouI, a.selectionStart, a.selectionEnd] : null
    fn()
    if (!k) return
    const el = document.querySelector(`.ou[data-mid="${CSS.escape(k[0])}"] [data-ou-f="${CSS.escape(k[1])}"]${k[2] ? `[data-ou-i="${k[2]}"]` : ''}`)
    if (el) { el.focus({ preventScroll: true }); try { if (k[3] != null) el.setSelectionRange(k[3], k[4]) } catch {} }
  }

  // the kind of card a reply carries: the name after its fence (```openui-lang 城市天气), else its title
  const kindOf = (text) => {
    const m = /```[ \t]*(?:openui-lang|openui)([^\n]*)\n/.exec(String(text || ''))
    const k = (m ? m[1] : '').replace(/[`"'“”‘’《》「」]/g, '').replace(/^\s*(用途|类型|kind|name)\s*[:：]\s*/i, '').trim().slice(0, 16)
    if (k) return k
    const t = /CardHeader\(\s*"((?:[^"\\]|\\.)*)"/.exec(String(text || ''))
    return t ? t[1].replace(/[`"'“”‘’《》「」]/g, '').trim().slice(0, 16) : '卡片'
  }

  return { split, plain, render, keepFocus, kindOf, send: async () => {}, route: null, ready: !!O }
})()
