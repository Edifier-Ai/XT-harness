// 一群 Bot 之间的事: Bot 动态 (what they did on their own, posted like moments), 圆桌 (one question, several Bots,
// a 分歧卡 you decide) and 试用期 (a new Bot hands in plans until it is made regular). The data comes from
// plugins/feed.js, table.js and trial.js; this draws it and wires its buttons. Uses app.js's helpers.
'use strict'

// ---------- shared bits ----------
const BI = {
  feed: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/><circle cx="19" cy="17.5" r="1.6" fill="currentColor" stroke="none"/>',
  table: '<circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="3.9" r="1.7"/><circle cx="19.2" cy="15.6" r="1.7"/><circle cx="4.8" cy="15.6" r="1.7"/>',
  like: '<path d="M7.5 10.5v9h-3v-9z"/><path d="M7.5 10.5l3.6-6.3a1.6 1.6 0 0 1 2.9 1.2l-.9 3.6h5.1a1.9 1.9 0 0 1 1.9 2.2l-1.2 6.6a1.9 1.9 0 0 1-1.9 1.7H7.5"/>',
  cmt: '<path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5v-3.5h0a1.5 1.5 0 0 1-1.5-1.5z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
}
const bico = (k, w = 16, sw = 1.8) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${BI[k]}</svg>`
const ago = (iso) => {
  const d = new Date(iso), t = dayOf(iso)
  if (t === todayStr()) return '今天 ' + hhmm(iso)
  if (t === dayOf(new Date(Date.now() - 86400e3).toISOString())) return '昨天 ' + hhmm(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm(iso)}`
}
const ledgerOf = (eid) => (S.ledger || []).find((e) => e.id === eid)
const realAgents = () => agents().filter((a) => !String(a.id).startsWith('_'))
const busyB = new Set()   // buttons waiting on the runtime, so a second click does nothing
async function bapi(key, p, body) { if (busyB.has(key)) return {}; busyB.add(key); try { return await api(p, body) } finally { busyB.delete(key) } }

// ---------- the rail: 动态 and 圆桌 sit above the Bots, like a messenger's 朋友圈 ----------
const feedSeen = () => store.get('feedSeen', '')
const feedNew = () => (S.feed || []).filter((p) => p.at > feedSeen())
const openTables = () => (S.tables || []).filter((t) => t.status === 'open')
function railTop() {
  if (query) return ''
  const posts = S.feed || [], last = posts[posts.length - 1], fresh = feedNew()
  const lastT = (S.tables || [])[(S.tables || []).length - 1], open = openTables()
  const who = [...new Set(fresh.map((p) => p.agent))].slice(0, 3).map((aid) => agentOf(aid))
  const feedPv = last ? `${agentOf(last.agent).name}：${last.text || postWhat(last)}` : '你不在时 Bot 做的事会发在这里'
  const tablePv = open.length ? `等你拍板：${open[open.length - 1].q}` : lastT ? (lastT.status === 'talking' || lastT.status === 'summing' ? `正在讨论：${lastT.q}` : lastT.q) : '一个问题，几个 Bot 一起想'
  return `<div class="rtop2">
    <button class="ag disc ${view === 'feed' ? 'on' : ''}" data-act="go" data-v="feed"><span class="dic">${bico('feed', 20)}</span><span class="tx"><b><span class="nm">动态</span>${who.length ? `<span class="whos">${who.map((a) => avatar(a, 16, true, false)).join('')}</span>` : ''}</b><span class="pv">${esc(feedPv.replace(/\s+/g, ' ').slice(0, 48))}</span></span>${fresh.length && view !== 'feed' ? `<span class="ucount">${fresh.length}</span>` : ''}</button>
    <button class="ag disc ${view === 'table' ? 'on' : ''} ${open.length ? 'need' : ''}" data-act="go" data-v="table"><span class="dic">${bico('table', 20)}</span><span class="tx"><b><span class="nm">圆桌</span></b><span class="pv">${esc(tablePv.slice(0, 48))}</span></span>${open.length && view !== 'table' ? '<span class="udot amber"></span>' : ''}</button>
  </div>`
}

// ---------- Bot 动态 ----------
const KIND = { job: '后台任务', mail: '收到邮件', act: '简报里的事', brief: '每日简报', reflect: '反思' }
function postWhat(p) {
  if (p.kind === 'brief') return '整理好了今天的简报'
  if (p.kind === 'reflect') return '把最近的事想了一遍'
  return ''
}
let cmtOpen = null
function pageFeed() {
  const posts = [...(S.feed || [])].reverse()
  // reading the page reads what is new
  const top = posts[0]?.at || ''
  if (top && top > feedSeen()) setTimeout(() => { store.set('feedSeen', top); renderRail() }, 600)
  let h = phead('动态', '你不在时，Bot 们自己做的事都发在这里')
  h += `<div class="fhint"><span>${bico('like', 14)} 点赞 = 以后这样做</span><span>${bico('cmt', 14)} 评论 = 纠正它</span></div>`
  if (!posts.length) return h + `<div class="bempty">还没有动态。Bot 们在后台做完事、处理完别的 Bot 交来的活，都会发在这里。</div>`
  h += '<div class="fposts">'
  for (const p of posts.slice(0, 60)) h += postHtml(p)
  return h + '</div>'
}
function postHtml(p) {
  const a = agentOf(p.agent)
  const acts = (p.acts || []).map(ledgerOf).filter(Boolean)
  const steps = (p.steps || []).filter((s) => !acts.some((e) => e.tool === s.name))
  const what = p.kind === 'mail' && p.mail ? `处理了 ${esc(p.mail.from)} 交来的「${esc(p.mail.subject)}」` : KIND[p.kind] || ''
  let h = `<article class="fpost" data-k="${p.id}">${avatar(a, 40, true, false)}<div class="fm">`
  h += `<div class="fh"><b>${esc(a.name)}</b><span>${what}</span></div>`
  const said = p.text || postWhat(p)
  if (said) h += `<div class="ftx">${md(said)}</div>`
  if (p.card && GU.ready) h += `<div class="uiw fcard">${GU.render('post:' + p.id, p.card, false)}</div>`
  if (p.kind === 'brief') h += `<button class="lk fgo" data-act="go" data-v="brief">看今天的简报 ›</button>`
  if (p.kind === 'reflect') h += `<button class="lk fgo" data-act="go" data-v="reflect">看这次反思 ›</button>`
  if (acts.length) {
    h += '<div class="fdid">'
    for (const e of acts) {
      const und = e.status === 'undone'
      h += `<div class="r ${und ? 'und' : ''}"><span class="ok">${und ? bico('back', 13) : bico('check', 13, 2.2)}</span><span class="t">${esc(e.title)}</span>${und ? '<span class="st">已撤回</span>' : e.undo ? `<button class="btn sm" data-act="b-undo" data-id="${e.id}">${esc(e.undo.label || '撤回')}</button>` : ''}</div>`
    }
    h += '</div>'
  }
  // what it only looked at, in passing
  if (steps.length) h += `<div class="fsteps">${steps.map((s) => esc(toolLabel(s.name)) + (s.n > 1 ? ` ×${s.n}` : '')).join(' · ')}</div>`
  const liked = p.like && !p.like.pending
  h += `<div class="fft"><span>${ago(p.at)}${p.away ? ' · 你不在时' : ''}</span><span class="sp"></span>
    <button class="${p.like ? 'on' : ''}" data-act="b-like" data-id="${p.id}" ${p.like?.pending ? 'disabled' : ''}>${bico('like', 15)}<span>${p.like?.pending ? '正在记…' : liked ? '以后这样做' : '以后这样做'}</span></button>
    <button class="${cmtOpen === p.id ? 'on' : ''}" data-act="b-cmt" data-id="${p.id}">${bico('cmt', 15)}<span>纠正</span></button></div>`
  const cs = p.comments || []
  if (liked || cs.length) {
    h += '<div class="frx">'
    if (liked) h += `<div class="lkd">${bico('like', 13)}<span>你说以后这样做${p.like.text ? ` · 记成了做事经验：「${esc(p.like.text)}」` : ''}</span></div>`
    for (const c of cs) {
      const by = c.by === 'user' ? (S.settings?.callMe || '你') : agentOf(c.by).name
      h += `<div class="cm ${c.by === 'user' ? 'me' : ''}"><b>${esc(by)}</b>${c.live ? '<span class="tdots"><i></i><i></i><i></i></span>' : `<span>${esc(c.text)}</span>`}</div>`
    }
    h += '</div>'
  }
  if (cmtOpen === p.id) h += `<div class="fin"><textarea class="inp" id="cmt_${p.id}" rows="1" placeholder="哪里不对？${esc(a.name)}会按你说的改"></textarea><button class="btn pri sm" data-act="b-cmt-send" data-id="${p.id}">发给${esc(a.name)}</button></div>`
  return h + '</div></article>'
}

// ---------- 圆桌 ----------
let tbQ = '', tbSeats = null, tbOpen = new Set()
const TST = { talking: '讨论中', summing: '在整理分歧', open: '等你拍板', decided: '已拍板', error: '没讨论完' }
function seats() {
  const all = realAgents()
  if (!tbSeats) tbSeats = new Set(all.slice(0, 4).map((a) => a.id))
  for (const x of [...tbSeats]) if (!all.some((a) => a.id === x)) tbSeats.delete(x)
  return all
}
function pageTable() {
  const all = seats()
  let h = phead('圆桌', '一个问题，几个 Bot 各说各的，分歧你来定')
  if (all.length < 2) {
    h += `<div class="panel tbnew solo"><div class="t">圆桌至少要两个 Bot</div><div class="d">现在只有${esc(agentOf(S.mainId).name)}。新建一个有自己分工和性格的 Bot，它们就能一起讨论了。</div><button class="btn pri" data-act="agent-new">新建 Bot</button></div>`
  } else {
    h += `<div class="panel tbnew"><textarea class="inp" id="tbQ" rows="2" placeholder="想让大家讨论什么？比如：下周去深圳出差，坐飞机还是高铁？">${esc(tbQ)}</textarea>
      <div class="tbrow"><span class="l">请谁来</span><div class="seats">${all.map((a) => `<button class="seat ${tbSeats.has(a.id) ? 'on' : ''}" data-act="b-seat" data-id="${a.id}">${avatar(a, 22, true, false)}<span>${esc(a.name)}</span>${a.trial ? '<i class="ttag">试用</i>' : ''}</button>`).join('')}</div>
      <button class="btn pri" data-act="b-tb-start" ${tbSeats.size < 2 ? 'disabled' : ''}>开圆桌</button></div>
      <div class="hint">每个 Bot 先各说一遍，再回应别人；最后${esc(agentOf(S.mainId).name)}把分歧整理成一张卡，你来拍板，结论记进所有 Bot 共用的记忆。讨论时它们只查不改。</div></div>`
  }
  const list = [...(S.tables || [])].reverse()
  if (!list.length) return h
  h += '<div class="tbls">'
  list.forEach((t, i) => { h += tableHtml(t, i === 0 || t.status !== 'decided' || tbOpen.has(t.id)) })
  return h + '</div>'
}
function sayRow(x, small) {
  const a = agentOf(x.agent)
  return `<div class="tsay ${small ? 'sm' : ''}" data-k="${x.agent}:${small ? 1 : 0}">${avatar(a, small ? 24 : 30, !x.live, false)}<div class="m"><b>${esc(a.name)}</b><div class="b">${x.live ? '<span class="tdots"><i></i><i></i><i></i></span>' : esc(x.text)}</div></div></div>`
}
function tableHtml(t, open) {
  const av = t.agents.map((aid) => avatar(agentOf(aid), 20, true, false)).join('')
  const head = `<div class="th" ${t.status === 'decided' ? `data-act="b-tb-toggle" data-id="${t.id}"` : ''}><div class="tq">${esc(t.q)}</div><span class="tst ${t.status}">${TST[t.status] || t.status}</span></div>
    <div class="tmeta"><span class="avs">${av}</span><span>${ago(t.at)}${t.by && t.by !== 'user' ? ` · ${esc(agentOf(t.by).name)}替你开的` : ''}</span></div>`
  if (!open) return `<section class="tbl closed" data-k="${t.id}">${head}${t.decision ? `<div class="tdec">${bico('check', 14, 2.2)}<span>你拍板：${esc(t.decision.label)}</span></div>` : ''}</section>`
  let h = `<section class="tbl" data-k="${t.id}">${head}`
  const r0 = t.rounds[0] || [], r1 = t.rounds[1] || []
  const waiting = t.agents.filter((aid) => !r0.some((x) => x.agent === aid))
  h += '<div class="trnd">' + r0.map((x) => sayRow(x, false)).join('') + (t.status === 'talking' ? waiting.map((aid) => sayRow({ agent: aid, live: true }, false)).join('') : '') + '</div>'
  if (r1.length) h += '<div class="tlab"><span>回应</span></div><div class="trnd">' + r1.map((x) => sayRow(x, true)).join('') + '</div>'
  if (t.status === 'summing') h += `<div class="twait"><span class="spin"></span>${esc(agentOf(S.mainId).name)}在整理分歧…</div>`
  if (t.status === 'error') h += `<div class="twait bad">${esc(t.error || '没讨论完')}</div>`
  if (t.card) h += splitCard(t)
  return h + '</section>'
}
function splitCard(t) {
  const c = t.card, d = t.decision
  let h = '<div class="tcard"><div class="tck">分歧卡</div>'
  if (c.agree.length) h += `<div class="tsec"><div class="tk">都同意</div>${c.agree.map((x) => `<div class="tag1">${bico('check', 13, 2.2)}<span>${esc(x)}</span></div>`).join('')}</div>`
  for (const s of c.splits) {
    h += `<div class="tsec"><div class="tk">分歧</div><div class="tpt">${esc(s.point)}</div>${s.sides.map((y) => `<div class="tside">${avatar(agentOf(y.agent), 20, true, false)}<b>${esc(agentOf(y.agent).name)}</b><span>${esc(y.stance)}</span></div>`).join('')}</div>`
  }
  if (d) {
    const e = d.ledger && ledgerOf(d.ledger), und = e?.status === 'undone'
    h += `<div class="tdec big ${und ? 'und' : ''}">${bico(und ? 'back' : 'check', 15, 2.2)}<div><b>你拍板：${esc(d.label)}</b><span>${und ? '这条结论已经不记了' : d.memId ? `记进了记忆：「${esc(d.memory)}」，所有 Bot 以后都按这个来` : '隐私模式下没有记进记忆'}</span></div>${e && !und ? `<button class="btn sm" data-act="b-undo" data-id="${e.id}">不记这条</button>` : ''}</div>`
  } else if (t.status === 'open') {
    h += `<div class="tsec"><div class="tk">你来拍板</div><div class="qopts">${c.options.map((o, k) => `<button class="qopt topt" data-act="b-tb-pick" data-id="${t.id}" data-k="${k}"><span class="ql">${'ABC'[k]}</span><span class="ol">${esc(o.label)}</span><span class="avs">${o.agents.map((aid) => avatar(agentOf(aid), 18, true, false)).join('')}</span></button>`).join('')}</div>
      <div class="town"><input class="inp" id="tbOwn_${t.id}" placeholder="都不对？写下你的决定"><button class="btn sm" data-act="b-tb-own" data-id="${t.id}">就这么定</button></div></div>`
  }
  return h + '</div>'
}

// ---------- 试用期: the plan a Bot hands in, its application, being made regular ----------
const planOf = (callId) => (S.proposals || []).find((p) => p.callId === callId)
let planNo = null
function planCard(it) {
  const p = planOf(it.callId); if (!p) return ''
  const a = agentOf(p.agent)
  const st = p.status === 'open' ? '' : p.status === 'rejected' ? `<div class="pst no">你没同意${p.note ? `：${esc(p.note)}` : ''}</div>`
    : `<div class="pst ok">${bico('check', 14, 2.2)}<span>你同意了 · ${p.status === 'done' ? '已经照做' : '正在照做'}</span></div>`
  let h = `<div class="qcard plan" data-k="plan${p.id}"><div class="pk"><span class="ttag">方案</span><span>${esc(a.name)}还在试用期，你点头它才动手</span></div><div class="qt">${esc(p.title)}</div>`
  if (p.steps.length) h += `<ol class="psteps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
  if (p.why) h += `<div class="r">${esc(p.why)}</div>`
  if (p.status === 'open') {
    if (planNo === p.id) h += `<div class="fin"><textarea class="inp" id="planNo_${p.id}" rows="1" placeholder="哪里不对？"></textarea><button class="btn sm" data-act="b-plan-no-send" data-id="${p.id}">告诉它</button></div>`
    else h += `<div class="qopts"><button class="qopt pri" data-act="b-plan-ok" data-id="${p.id}"><span class="ql">A</span><span>照这个做</span></button><button class="qopt" data-act="b-plan-no" data-id="${p.id}"><span class="ql">B</span><span>不对，我说一下</span></button></div>`
  }
  return h + st + '</div>'
}
function trialNote(head) {
  const x = head.trial || {}, a = agentOf(head.agent)
  if (x.type === 'promoted') return `<div class="sysline" data-k="tn${head.id}"><span>${esc(a.name)}转正了 · 试用期里你同意了它 ${x.ok} 个方案</span></div>`
  if (x.type === 'later') return `<div class="sysline" data-k="tn${head.id}"><span>${esc(a.name)}再试用一阵，同意满 ${x.need} 个方案再申请</span></div>`
  if (x.type !== 'apply') return ''
  const still = a.trial && a.trial.applied
  let h = `<div class="qcard plan apply" data-k="tn${head.id}"><div class="pk"><span class="ttag">申请转正</span><span>${ago(x.at)}</span></div>
    <div class="qt">试用期里我交了 ${x.total} 个方案，你同意了 ${x.ok} 个</div>`
  if (x.titles?.length) {
    const n = new Map(); for (const s of x.titles) n.set(s, (n.get(s) || 0) + 1)
    h += `<ol class="psteps">${[...n].map(([s, k]) => `<li>${esc(s)}${k > 1 ? ` <small>× ${k}</small>` : ''}</li>`).join('')}</ol>`
  }
  h += `<div class="r">转正以后我可以直接动手，不用每次先交方案。做的每件事照样记进操作记录、能撤回；对外发送、花钱、删除照样先问你。</div>`
  if (still) h += `<div class="qopts"><button class="qopt pri" data-act="b-promote" data-id="${a.id}"><span class="ql">A</span><span>一键转正</span></button><button class="qopt" data-act="b-later" data-id="${a.id}"><span class="ql">B</span><span>再试试</span></button></div>`
  else if (!a.trial) h += `<div class="pst ok">${bico('check', 14, 2.2)}<span>已经转正</span></div>`
  return h + '</div>'
}
function tableChip(it) {
  const t = (S.tables || []).find((x) => x.at >= (it.at || '').slice(0, 19) && x.q && it.args?.question && x.q === String(it.args.question).trim().slice(0, 500))
  if (!t) return ''
  return `<button class="hand tbchip" data-act="go" data-v="table" data-k="tb${it.id}"><span class="hh"><span class="dic sm">${bico('table', 14)}</span><b>开了圆桌</b><span class="hsub">${esc(t.q)}</span><span class="hst">${t.agents.map((aid) => avatar(agentOf(aid), 18, true, false)).join('')}${TST[t.status] || ''} ›</span></span></button>`
}
window.BOTCARD = { plan_propose: planCard, roundtable_start: tableChip }
window.trialNote = trialNote

// in a Bot's settings: where its 试用期 stands
function trialPanel(a) {
  if (!a || a.main) return ''
  const mine = (S.proposals || []).filter((p) => p.agent === a.id)
  if (a.trial) {
    const t = a.trial
    return `<div class="sec">试用期</div><div class="panel trialp"><div class="tbar"><i style="width:${Math.min(100, (t.ok || 0) / (t.need || 3) * 100)}%"></i></div>
      <div class="t">同意了 ${t.ok || 0} / ${t.need || 3} 个方案${t.no ? ` · 没同意 ${t.no} 个` : ''}</div>
      <div class="hint">试用期里它只能查，不能改；要动手时先交方案，你点“照这个做”它才做。同意满 ${t.need || 3} 个，它会申请转正。</div>
      <div class="a"><button class="btn pri sm" data-act="b-promote" data-id="${a.id}">一键转正</button></div></div>`
  }
  return `<div class="sec">试用期</div><div class="panel trialp"><div class="t">${a.promotedAt ? `${dayLabel(a.promotedAt)}转正 · 试用期里交了 ${mine.length} 个方案` : '正式成员'}</div><div class="hint">它可以直接动手做事，每件事都记进操作记录、能撤回。</div>
    <div class="a"><button class="btn sm" data-act="b-trial-start" data-id="${a.id}">让它重新试用</button></div></div>`
}
window.trialPanel = trialPanel

// ---------- buttons ----------
document.addEventListener('input', (e) => {
  if (e.target.id === 'tbQ') tbQ = e.target.value
  if (e.target.matches('.fin textarea')) { e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px' }
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
  const t = e.target
  if (t.matches('.fin textarea')) { e.preventDefault(); t.closest('.fin').querySelector('button')?.click() }
  if (t.id?.startsWith('tbOwn_')) { e.preventDefault(); t.closest('.town').querySelector('button')?.click() }
})
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act^="b-"]'); if (!el) return
  const act = el.dataset.act, x = el.dataset.id
  if (act === 'b-like') { const r = await bapi('like' + x, 'feed/like', { id: x }); if (r.error) toastText(r.error); else if (r.post?.like && !r.post.like.ledger) toastText('隐私模式：这条经验没记进记忆') }
  else if (act === 'b-cmt') { cmtOpen = cmtOpen === x ? null : x; renderPage(); setTimeout(() => $('#cmt_' + x)?.focus(), 30) }
  else if (act === 'b-cmt-send') {
    const v = $('#cmt_' + x)?.value.trim(); if (!v) return
    cmtOpen = null
    const r = await bapi('cmt' + x, 'feed/comment', { id: x, text: v }); if (r.error) toastText(r.error)
  }
  else if (act === 'b-undo') { el.disabled = true; const r = await api('undo', { id: x }); if (r.error) toastText(r.error); soon() }
  else if (act === 'b-seat') { seats(); tbSeats.has(x) ? tbSeats.delete(x) : tbSeats.add(x); renderPage() }
  else if (act === 'b-tb-start') {
    const q = ($('#tbQ')?.value || tbQ).trim(); if (!q) { $('#tbQ')?.focus(); return }
    el.disabled = true
    const r = await bapi('tb', 'table/start', { q, agents: [...tbSeats] })
    if (r.error) { toastText(r.error); el.disabled = false; return }
    tbQ = ''; (S.tables ||= []).push(r.table); renderPage()
  }
  else if (act === 'b-tb-pick' || act === 'b-tb-own') {
    const body = act === 'b-tb-pick' ? { id: x, k: +el.dataset.k } : { id: x, text: $('#tbOwn_' + x)?.value || '' }
    if (act === 'b-tb-own' && !body.text.trim()) { $('#tbOwn_' + x)?.focus(); return }
    el.disabled = true
    const r = await bapi('tbd' + x, 'table/decide', body)
    if (r.error) { toastText(r.error); el.disabled = false } else { if (!r.table.decision.memId) toastText('拍板了。隐私模式下不记进记忆'); soon() }
  }
  else if (act === 'b-tb-toggle') { tbOpen.has(x) ? tbOpen.delete(x) : tbOpen.add(x); renderPage() }
  else if (act === 'b-plan-ok') { el.disabled = true; const r = await bapi('plan' + x, 'trial/decide', { id: x, ok: true }); if (r.error) toastText(r.error); soon() }
  else if (act === 'b-plan-no') { planNo = x; renderMsgs(true); setTimeout(() => $('#planNo_' + x)?.focus(), 30) }
  else if (act === 'b-plan-no-send') { const v = $('#planNo_' + x)?.value.trim() || ''; planNo = null; const r = await bapi('plan' + x, 'trial/decide', { id: x, ok: false, note: v }); if (r.error) toastText(r.error); soon() }
  else if (act === 'b-promote') { el.disabled = true; const r = await bapi('pro' + x, 'trial/promote', { id: x }); if (r.error) toastText(r.error); soon() }
  else if (act === 'b-later') { el.disabled = true; await bapi('pro' + x, 'trial/later', { id: x }); soon() }
  else if (act === 'b-trial-start') { el.disabled = true; const r = await bapi('pro' + x, 'trial/start', { id: x }); if (r.error) toastText(r.error); soon() }
})

// ---------- live updates from the runtime ----------
window.onBots = (m) => {
  if (m.type === 'table' && m.table) {
    const l = (S.tables ||= []), i = l.findIndex((t) => t.id === m.table.id)
    if (i >= 0) l[i] = m.table; else l.push(m.table)
  } else if (m.type === 'post' && m.post) {
    const l = (S.feed ||= []), i = l.findIndex((p) => p.id === m.post.id)
    if (i >= 0) l[i] = m.post; else l.push(m.post)
  } else if (m.type === 'nudge') {
    if (m.what === 'table' && view !== 'table') { const t = (S.tables || []).find((x) => x.id === m.id); toastText(`圆桌讨论完了，等你拍板${t ? '：' + t.q.slice(0, 20) : ''}`, ['去看', () => setView('table')]) }
    return
  } else { soon(); return }
  renderRail()
  if (view === 'feed' || view === 'table') renderPage()
  else if (view === 'chat') renderMsgs(true)
}
