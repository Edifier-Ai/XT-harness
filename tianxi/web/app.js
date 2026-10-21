// 天禧 client: an IM for your personal agents. Talks to the tianxi-host plugin over /api (JSON) and /api/events (SSE).
'use strict'
const $ = (s, r = document) => r.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const TOKEN = new URLSearchParams(location.search).get('t') || ''
const APP = window.tianxiApp || null   // Electron bridge (absent in a plain browser)
const store = { get(k, d) { try { const v = localStorage.getItem('tx.' + k); return v === null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem('tx.' + k, JSON.stringify(v)) } catch {} } }

const api = async (path, body) => {
  const r = await fetch('/api/' + path, body === undefined ? { headers: { 'x-tianxi-token': TOKEN } }
    : { method: 'POST', headers: { 'content-type': 'application/json', 'x-tianxi-token': TOKEN }, body: JSON.stringify(body) })
  return r.json()
}

let S = { agents: [], transcripts: {}, agentStatus: {}, ledger: [], memories: [], reflections: [], later: [], observations: [], approvals: [], inbox: [], outbox: [], brief: null, mainId: 'tianxi', styles: [] }
let cur = store.get('agent', 'tianxi')     // the agent being chatted with
let view = 'chat'                          // chat | brief | memory | reflect | ledger | later | settings | agent
let viewArg = null
let procPref = store.get('proc', 'auto')    // auto: the process bar opens when an agent starts working; closed: stays shut
let procSel = null                          // { agent, turn } pinned in the process bar; null follows the latest
let procTab = 'computer'                    // the right panel: computer (steps) | routines
let memSel = null, memTab = 'map', mailTab = 'inbox'
const usedUI = new Set()
const seenLedger = new Set()
const seen = store.get('seen', {})          // agentId -> ISO time last read
let firstLoad = true

// ---------- labels ----------
const TOOL = {
  calendar_list: '查看日程', calendar_add: '添加日程', calendar_update: '修改日程', calendar_delete: '删除日程',
  todo_list: '查看待办', todo_add: '添加待办', todo_done: '完成待办',
  mail_draft: '起草邮件', mail_send: '发邮件', mail_inbox: '看收件箱', folder_list: '查看文件夹', file_move: '移动文件',
  brief_publish: '发布每日简报', brief_resolve: '处理简报卡片', later_add: '放进后台队列', reflection_publish: '写下反思',
  memory_save: '记下来', memory_search: '翻记忆', memory_update: '改记忆', memory_forget: '忘掉一条记忆',
  ledger_recent: '翻操作记录', undo_actions: '撤回',
  read: '读取文件', write: '写文件', edit: '修改文件', bash: '运行命令', shell: '运行命令', ls: '查看文件夹', glob: '查找文件', grep: '搜索文件内容',
  web_search: '搜索网页', web_fetch: '打开网页', fetch: '打开网页', read_image: '看图片', pwsh: '运行命令', powershell: '运行命令',
  subagent: '派一个助手去做', subagent_fork: '派一个助手去做', send_message: '和助手沟通', list_agents: '查看助手', todo_write: '拆解步骤',
  schedule_create: '设定时任务', schedule_list: '查看定时任务', schedule_update: '改定时任务', schedule_delete: '删定时任务', working_directory: '切换文件夹',
  create_goal: '定目标', update_goal: '更新目标', get_goal: '看目标', job_list: '查看后台进程', job_output: '查看进程输出', job_kill: '停掉进程', skill: '用技能', workflow: '跑工作流', present: '展示文件',
}
const toolLabel = (n) => TOOL[n] || String(n || '').replace(/_/g, ' ')
const toolDetail = (a = {}) => {
  const v = a.title || a.subject || a.text || a.query || a.url || a.command || a.path || a.file_path || (a.from && String(a.from).split(/[\\/]/).pop()) || a.to || ''
  return typeof v === 'string' ? v.slice(0, 80) : ''
}
const pad = (n) => String(n).padStart(2, '0')
const hhmm = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()) }
const dayOf = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
const todayStr = () => dayOf(new Date().toISOString())
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const dayLabel = (iso) => { const d = dayOf(iso); if (d === todayStr()) return '今天'; const y = new Date(Date.now() - 86400e3); if (d === dayOf(y.toISOString())) return '昨天'; const x = new Date(iso); return `${x.getMonth() + 1}月${x.getDate()}日 星期${WEEK[x.getDay()]}` }
const when = (iso) => dayOf(iso) === todayStr() ? hhmm(iso) : dayLabel(iso)
const CHECK = '<svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 5.2l2 2 4-4.4" stroke="#fff" stroke-width="1.7" fill="none"/></svg>'
const fileUrl = (p) => '/api/file?path=' + encodeURIComponent(p) + '&t=' + encodeURIComponent(TOKEN)
const isImg = (p) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(p || ''))

// minimal markdown: paragraphs, lists, **bold**, `code`
function md(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
  const out = []; let list = null
  for (const raw of String(src || '').split('\n')) {
    const line = raw.replace(/^#{1,6}\s+/, '')
    const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.、)]\s+(.*)/)
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol'
      if (!list || list.tag !== tag) { if (list) out.push(`</${list.tag}>`); list = { tag }; out.push(`<${tag}>`) }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>'); continue
    }
    if (list) { out.push(`</${list.tag}>`); list = null }
    if (line.trim()) out.push('<p>' + inline(line) + '</p>')
  }
  if (list) out.push(`</${list.tag}>`)
  return out.join('')
}

// ---------- agents ----------
const agents = () => S.agents.length ? S.agents : [{ id: 'tianxi', name: '天禧', role: '你的个人智能体', main: true, email: 'tianxi@agent.local' }]
const agentOf = (aid) => agents().find((a) => a.id === aid) || agents()[0]
const busy = (aid) => (S.agentStatus[aid] || 'idle') !== 'idle'
const doneAt = {}                            // agentId -> when it last finished, for the little "done" hop
const SHAPES = ['circle', 'blob', 'hex', 'tri', 'rect', 'cloud']
const hashNum = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) }
const shapeOf = (a) => SHAPES.includes(a.shape) ? a.shape : a.main ? 'circle' : SHAPES[1 + hashNum(a.id) % (SHAPES.length - 1)]
// idle · think (busy, nothing done yet) · work (using tools) · wait (needs you) · done (just finished)
function stateOf(aid) {
  if (S.approvals.some((x) => x.agent === aid)) return 'wait'
  if (!busy(aid)) return doneAt[aid] && Date.now() - doneAt[aid] < 5000 ? 'done' : 'idle'
  const t = turnsOf(aid).filter((x) => x.running).pop()
  return t && toolsOf(t).length ? 'work' : 'think'
}
const BODY = {
  circle: '<circle cx="50" cy="52" r="40"/>',
  blob: '<path d="M50 11c27 0 41 16 40 41-1 27-17 39-41 38-25-1-39-15-38-41 1-25 14-38 39-38z"/>',
  hex: '<path d="M44 9.5a12 12 0 0 1 12 0l27 15.6a12 12 0 0 1 6 10.4v31a12 12 0 0 1-6 10.4L56 92.5a12 12 0 0 1-12 0L17 76.9a12 12 0 0 1-6-10.4v-31a12 12 0 0 1 6-10.4z"/>',
  tri: '<path d="M41.5 17a10 10 0 0 1 17 0l33 56a10 10 0 0 1-8.5 15H17a10 10 0 0 1-8.5-15z"/>',
  rect: '<rect x="12" y="15" width="76" height="74" rx="20"/>',
  cloud: '<path d="M27 88a19 19 0 0 1-4-37 24 24 0 0 1 45-12 20 20 0 0 1 9 39 13 13 0 0 1-4 10z"/>',
}
// still: no state motion or badge (avatars repeated down a transcript)
function avatar(a, size = 36, still = false) {
  const st = still ? 'idle' : stateOf(a.id), sh = shapeOf(a)
  const ey = sh === 'tri' ? 62 : sh === 'cloud' ? 62 : 52
  const fill = a.main ? 'url(#txorb)' : (a.color || '#5b6cff')
  const badge = st === 'wait' ? '<i class="abadge w">?</i>' : st === 'done' ? `<i class="abadge d">${CHECK}</i>` : ''
  return `<span class="av s-${st}" style="width:${size}px;height:${size}px" data-sh="${sh}"><svg viewBox="0 0 100 100" width="${size}" height="${size}"><g class="bd" fill="${fill}">${BODY[sh]}</g><g class="eyes"><ellipse cx="37" cy="${ey}" rx="8.5" ry="10.5" fill="#fff"/><ellipse cx="63" cy="${ey}" rx="8.5" ry="10.5" fill="#fff"/><g class="pu"><circle cx="38.5" cy="${ey + 2}" r="4.6" fill="#141418"/><circle cx="64.5" cy="${ey + 2}" r="4.6" fill="#141418"/></g></g></svg>${badge}</span>`
}
const userInitial = () => (S.settings?.callMe || '你').trim().slice(0, 1).toUpperCase()
const transcript = (aid) => S.transcripts[aid] || []

// turns: a user message (or a system wake-up) and everything the agent did after it
function turnsOf(aid) {
  const turns = []; let t = null
  for (const it of transcript(aid)) {
    if (it.role === 'user' || it.role === 'system') { t = { id: it.id, agent: aid, head: it, items: [], at: it.at, endAt: it.endAt, internal: !!it.internal, kind: it.kind || 'user' }; turns.push(t); continue }
    if (!t) { t = { id: 'pre_' + it.id, agent: aid, head: null, items: [], at: it.at, endAt: it.at, internal: !!it.internal, kind: 'user' }; turns.push(t) }
    t.items.push(it)
  }
  const last = turns[turns.length - 1]
  for (const x of turns) x.running = x === last && busy(aid) && !x.endAt
  return turns
}
const toolsOf = (t) => t.items.filter((i) => i.role === 'tool')
const turnTitle = (t) => t.head ? (t.head.role === 'user' ? t.head.text : (t.kind === 'mail' && t.head.mail ? '处理邮件：' + t.head.mail.subject : agentOf(t.agent).name + t.head.text)) : '对话'

// ---------- motion: what is new slides in; a plain refresh replays nothing ----------
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
const known = new Set()
const hashText = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) }
// Mark every element matching sel under root as seen; the ones not seen before get cls (staggered by --d).
// quiet: just remember them (first paint of a view that animates as a whole).
function reveal(root, sel, keyOf, { cls = 'in', quiet = false, step = 45, max = 10 } = {}) {
  const moved = []
  for (const el of root.querySelectorAll(sel)) {
    const k = keyOf(el); if (!k) continue
    const fresh = !known.has(k); known.add(k)
    if (!fresh || quiet || REDUCED || moved.some((m) => m.contains(el))) continue
    el.style.setProperty('--d', Math.min(moved.length, max) * step + 'ms'); el.classList.add(cls); moved.push(el)
  }
  return moved.length
}
// One-shot classes come off when they finish, so hover and later transitions work on the element again.
const ONESHOT = ['rise', 'in', 'upd', 'pop', 'draw', 'swap', 'fade', 'bump']
document.addEventListener('animationend', (e) => { if (e.target === e.currentTarget) return; const el = e.target; if (el.classList) for (const c of ONESHOT) if (el.classList.contains(c) && !el.closest?.('.toast.out')) el.classList.remove(c) }, true)
// Restart a one-shot animation class on an element.
function replay(el, cls) { if (!el || REDUCED) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls) }
function setCount(el, n) {
  const was = el.hidden ? 0 : +el.textContent || 0
  el.hidden = !n; el.textContent = n
  if (n && n !== was) replay(el, 'bump')
}

// ---------- rail: the roster ----------
const MINE = ['me', 'brief', 'memory', 'reflect', 'ledger', 'later']
let query = ''
function nowDoing(aid) {
  const t = turnsOf(aid).filter((x) => x.running).pop(); if (!t) return ''
  const now = [...toolsOf(t)].reverse().find((x) => x.state === 'running') || toolsOf(t).pop()
  return now ? `正在${toolLabel(now.name)}${toolDetail(now.args) ? ' · ' + toolDetail(now.args) : ''}` : '正在想'
}
function renderRail() {
  const q = query.trim().toLowerCase()
  const list = agents().filter((a) => !q || (a.name + (a.role || '')).toLowerCase().includes(q))
  $('#agentList').innerHTML = list.map((a) => {
    const items = transcript(a.id).filter((i) => !i.internal && (i.role === 'user' || i.role === 'assistant' || i.kind === 'mail') && (i.text || i.mail))
    const last = items[items.length - 1]
    const st = stateOf(a.id)
    const preview = st === 'wait' ? '需要你确认一件事' : busy(a.id) ? nowDoing(a.id) : last ? (last.role === 'user' ? '你：' + last.text : last.kind === 'mail' ? '收到邮件：' + (last.mail?.subject || '') : last.text) : (a.role || '')
    const unread = a.id === cur && view === 'chat' ? 0 : items.filter((i) => i.role !== 'user' && (!seen[a.id] || i.at > seen[a.id])).length
    const right = busy(a.id) ? '<span class="tdots"><i></i><i></i><i></i></span>' : last ? `<small>${when(last.at)}</small>` : ''
    return `<button class="ag ${a.id === cur && view === 'chat' ? 'on' : ''} ${st === 'wait' ? 'need' : ''}" data-act="agent-open" data-id="${a.id}" title="${esc(busy(a.id) ? nowDoing(a.id) : a.role || '')}">${avatar(a, 36)}
      <span class="tx"><b><span class="nm">${esc(a.name)}</span>${a.main ? '<span class="star" title="主 Bot">★</span>' : ''}${right}</b><span class="pv">${esc(String(preview).replace(/\s+/g, ' ').slice(0, 48))}</span></span>
      ${unread ? '<span class="udot"></span>' : ''}</button>`
  }).join('') || '<div class="hint" style="padding:10px 12px">没有找到</div>'
  const open = S.brief && S.brief.date === todayStr() ? (S.brief.items || []).filter((i) => i.kind === 'decide' && i.status === 'open').length : 0
  const r0 = S.reflections[0]; const nr = r0 ? [...r0.proposals, ...r0.lessons].filter((p) => p.status === 'open').length : 0
  setCount($('#nMe'), open + nr)
  $('#meAv').textContent = userInitial()
  $('#meName').textContent = S.settings?.callMe || '我的'
  $('#meSub').textContent = open ? `简报里有 ${open} 件等你定` : nr ? `反思有 ${nr} 条建议` : `${S.memories.length} 条记忆 · 简报和操作记录`
  $('#meBtn').classList.toggle('on', MINE.includes(view))
  document.querySelectorAll('.rlinks [data-go], .mine .ib[data-go]').forEach((b) => b.classList.toggle('on', view === b.dataset.go))
}

// ---------- chat ----------
function renderHead() {
  const a = agentOf(cur)
  $('#cAvatar').innerHTML = avatar(a, 34)
  $('#cName').textContent = a.name
  const st = stateOf(cur)
  $('#cSub').textContent = st === 'wait' ? '等你确认' : busy(cur) ? nowDoing(cur) : (a.role || '')
  $('#pmBadge').classList.toggle('on', !!S.privateMode)
  $('#bPriv').classList.toggle('on', !!S.privateMode)
  $('#ring').classList.toggle('priv', !!S.privateMode)
  $('#inp').placeholder = `给 ${a.name} 发消息`
  const send = $('#send'); send.classList.toggle('stop', busy(cur)); send.classList.toggle('hot', !busy(cur) && !!$('#inp').value.trim())
  const comp = $('#bProc'); comp.classList.toggle('on', $('#app').classList.contains('procon')); comp.classList.toggle('live', busy(cur))
  comp.title = busy(cur) ? `${a.name}的电脑正在用：${nowDoing(cur)}` : `${a.name}的电脑`
}

// one line in the transcript for everything the bot did in a turn; the steps open on its computer
function procChip(t) {
  const tools = toolsOf(t)
  const sel = procSel && procSel.turn === t.id && $('#app').classList.contains('procon')
  const ic = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 20.5h7M12 17v3.5"/></svg>'
  if (t.running) {
    if (!tools.length) return ''   // still thinking: the typing dots say it
    const now = [...tools].reverse().find((x) => x.state === 'running') || tools[tools.length - 1]
    return `<button class="pchip live" data-act="proc-open" data-agent="${t.agent}" data-turn="${t.id}"><span class="spin"></span><span class="t">${now ? `正在${esc(toolLabel(now.name))}${toolDetail(now.args) ? ' · ' + esc(toolDetail(now.args)) : ''}` : '正在想'}</span><span class="ar">第 ${Math.max(1, tools.length)} 步 ›</span></button>`
  }
  if (!tools.length) return ''
  const errs = tools.filter((x) => x.state === 'error').length
  const labels = [...new Set(tools.map((x) => toolLabel(x.name)))].slice(0, 3).join('、')
  return `<button class="pchip ${sel ? 'sel' : ''}" data-act="proc-open" data-agent="${t.agent}" data-turn="${t.id}">${errs && errs === tools.length ? '<span class="xdot">!</span>' : ic}<span class="t">活动记录 · ${tools.length} 步：${esc(labels)}</span><span class="ar">›</span></button>`
}

function renderMsgs(keepScroll) {
  const feed = $('#feed'); const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80
  const a = agentOf(cur)
  const turns = turnsOf(cur).filter((t) => !t.internal)
  let h = '', day = ''
  if (!turns.length) {
    h = `<div class="hello">${avatar(a, 88)}<div class="nm">${esc(a.name)}</div><div class="rl2">${esc(a.role || '')}</div>${a.intro ? `<div class="in">${esc(a.intro)}</div>` : ''}<div class="mail">${esc(a.email || '')}</div></div>`
  }
  for (const t of turns) {
    const d = dayOf(t.at); if (d !== day) { day = d; h += `<div class="day"><span>${dayLabel(t.at)}</span></div>` }
    if (t.head?.role === 'user') h += `<div class="mrow me" id="m_${t.head.id}" data-k="${t.head.id}"><div class="body"><div class="bub">${esc(t.head.text)}</div><span class="tm2">${hhmm(t.at)}</span></div></div>`
    let body = ''
    if (t.kind === 'mail' && t.head.mail) {
      const m = t.head.mail
      body += `<div class="mailcard" data-k="mail${t.id}"><div class="h"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>收到 ${esc(m.fromName || m.from)} 的邮件 · ${hhmm(t.at)}</div><div class="s">${esc(m.subject)}</div><div class="b">${esc(m.body)}</div></div>`
    }
    const chip = procChip(t); if (chip) body += chip
    for (const it of t.items) {
      if (it.role === 'assistant' && it.text) body += `<div class="bub ${it.live ? 'live' : ''}" id="m_${it.id}" data-k="${it.id}">${md(it.text)}</div>`
      else if (it.role === 'ui') body += `<div class="uiw" data-k="${it.id}">${renderUI(it)}</div>`
      else if (it.role === 'error') body += `<div class="bub err" data-k="${it.id}">${esc(it.text)}</div>`
    }
    if (t.running && !t.items.some((i) => i.role === 'assistant' && i.text) && !toolsOf(t).length) body += '<div class="bub typing"><i></i><i></i><i></i></div>'
    if (body) h += `<div class="mrow" data-k="a${t.id}"><div class="side">${avatar(a, 34, true)}</div><div class="body">${body}</div></div>`
  }
  for (const x of S.approvals.filter((y) => y.agent === cur)) h += `<div class="mrow" data-k="ask${x.id}"><div class="side">${avatar(a, 34, true)}</div><div class="body">${askCard(x)}</div></div>`
  const M = $('#msgs')
  M.innerHTML = h
  // Switching to another agent fades the whole conversation in; afterwards only new messages move.
  const switched = M.dataset.agent !== cur
  M.dataset.agent = cur
  reveal(M, '[data-k]', (el) => cur + ':' + el.dataset.k, { quiet: switched, step: 60 })
  if (switched) replay(M, 'swap')
  if (!keepScroll || atBottom) feed.scrollTop = feed.scrollHeight
  if (view === 'chat') { seen[cur] = new Date().toISOString(); store.set('seen', seen) }
}

function askCard(x) {
  if (x.tool === 'mail_send') {
    const m = (S.outbox || []).find((y) => y.id === x.args?.id)
    if (m) return `<div class="askcard mailask"><div class="h"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>邮件草稿 · 要你点头才发出</div>
      <div class="mf"><span>发件人</span>${esc(m.from || '')}</div><div class="mf"><span>收件人</span>${esc(m.to)}</div><div class="mf"><span>主题</span><b>${esc(m.subject)}</b></div><div class="mb">${esc(m.body)}</div>
      ${x.args?.reason ? `<div class="r">${esc(x.args.reason)}</div>` : ''}<div class="acts"><button class="btn pri" data-act="ask" data-id="${x.id}" data-allow="1">发送邮件</button><button class="btn" data-act="ask" data-id="${x.id}">放弃</button></div></div>`
  }
  const pv = Object.entries(x.args || {}).filter(([k]) => k !== 'reason').map(([k, v]) => `<span class="k">${esc(k)}</span>  ${esc(typeof v === 'string' ? v : JSON.stringify(v))}`).join('\n')
  return `<div class="askcard"><div class="h"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>要${esc(toolLabel(x.tool))}，需要你点头</div><div class="r">${esc(x.reason || x.args?.reason || '')}</div>${pv ? `<div class="pv">${pv}</div>` : ''}
    <div class="acts"><button class="btn pri" data-act="ask" data-id="${x.id}" data-allow="1">允许一次</button><button class="btn" data-act="ask" data-id="${x.id}">不行</button></div></div>`
}

function renderChips() {
  const a = agentOf(cur)
  const sig = a.id
  if ($('#chips').dataset.agent === sig) return
  $('#chips').dataset.agent = sig
  const chips = a.main
    ? [['看看我今天的安排', '我今天有哪些日程和待办？'], ['整理下载文件夹', '帮我整理一下下载文件夹，按类型归档'], ['记住一件事', null], ['帮我排个行程', null], ['看看收件箱', '看看你的收件箱有没有新邮件']]
    : [['你能帮我做什么？', '简单说说你能帮我做什么。'], ['看看收件箱', '看看你的收件箱有没有新邮件'], [`和${agentOf(S.mainId).name}配合一下`, null]]
  $('#chips').innerHTML = chips.map(([l, s], i) => `<button class="chip ${REDUCED ? '' : 'in'}" style="--d:${120 + i * 40}ms" data-act="chip" data-say="${esc(s || '')}" data-label="${esc(l)}">${esc(l)}</button>`).join('')
}

// ---------- generative UI ----------
function renderUI(t) {
  const u = t.ui || {}
  let h = `<div class="gcard" data-ui="${t.id}">${u.title ? `<h4>${esc(u.title)}</h4>` : ''}${u.subtitle ? `<div class="sub">${esc(u.subtitle)}</div>` : ''}`
  ;(u.blocks || []).forEach((b, bi) => { h += `<div class="blk">${block(b, t.id, bi)}</div>` })
  if (usedUI.has(t.id)) h += '<div class="used">已经交给它了</div>'
  return h + '</div>'
}
function extOf(p) { const e = String(p || '').split('.').pop().toLowerCase(); return /^(docx?|txt|md|rtf)$/.test(e) ? 'doc' : /^(xlsx?|csv)$/.test(e) ? 'xls' : /^pptx?$/.test(e) ? 'ppt' : e === 'pdf' ? 'pdf' : /^(zip|rar|7z)$/.test(e) ? 'zip' : '' }
function block(b, tid, bi) {
  if (!b || typeof b !== 'object') return ''
  const items = Array.isArray(b.items) ? b.items : []
  switch (b.type) {
    case 'text': return `<div class="txt">${esc(b.text)}</div>`
    case 'kv': return `<div class="kv">${items.map((i) => `<div class="k">${esc(i.k ?? i.key ?? i.label)}</div><div class="v">${esc(i.v ?? i.value)}</div>`).join('')}</div>`
    case 'list': return `<div class="gl">${items.map((i) => typeof i === 'string' ? `<div class="it"><div class="m">${esc(i)}</div></div>` : `<div class="it"><div class="m">${esc(i.title)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>${i.tag ? `<span class="tag">${esc(i.tag)}</span>` : ''}</div>`).join('')}</div>`
    case 'table': return `<table class="gt"><tr>${(b.columns || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${(b.rows || []).map((r) => `<tr>${(r || []).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`
    case 'timeline': return `<div class="tl">${items.map((i) => `<div class="it"><span class="tm">${esc(i.time)}</span><div class="m">${esc(i.title)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>${i.tag ? `<span class="tag">${esc(i.tag)}</span>` : ''}</div>`).join('')}</div>`
    case 'metric': return `<div class="metrics">${items.map((i) => `<div class="metric"><div class="l">${esc(i.label)}</div><div class="v">${esc(i.value)}</div>${i.note ? `<div class="n">${esc(i.note)}</div>` : ''}</div>`).join('')}</div>`
    case 'image': { const src = /^https?:/.test(b.src || '') ? b.src : fileUrl(b.src || ''); return `<div class="gimg"><img src="${esc(src)}" alt="" onerror="this.parentElement.style.display='none'">${b.caption ? `<div class="c">${esc(b.caption)}</div>` : ''}</div>` }
    case 'files': return `<div class="files">${items.map((i) => { const p = typeof i === 'string' ? i : i.path; const n = String(p || '').split(/[\\/]/).pop(); const e = extOf(p); return `<div class="file" title="${esc(p)}"><div class="th ${e}">${isImg(p) ? `<img src="${esc(fileUrl(p))}" alt="">` : esc((n.split('.').pop() || '').toUpperCase().slice(0, 4))}</div><div class="n">${esc(n)}</div>${i.note ? `<div class="no">${esc(i.note)}</div>` : ''}</div>` }).join('')}</div>`
    case 'bar': { const max = Math.max(...items.map((i) => +i.value || 0), 1); const top = Math.max(...items.map((i) => +i.value || 0)); return `<div class="bars">${items.map((i) => `<div class="bar ${+i.value === top ? 'top' : ''}"><span class="l">${esc(i.label)}</span><span class="tr"><i style="width:${Math.max(2, (+i.value || 0) / max * 100)}%"></i></span><span class="v">${esc(i.value)}${esc(b.unit || '')}</span></div>`).join('')}</div>` }
    case 'progress': return `<div class="prog">${items.map((i) => `<div class="it">${esc(i.label)}<div class="tr"><i style="width:${Math.round(Math.min(1, Math.max(0, +i.value || 0)) * 100)}%"></i></div></div>`).join('')}</div>`
    case 'quote': return `<div class="quote">${esc(b.text)}${b.from ? `<small>${esc(b.from)}</small>` : ''}</div>`
    case 'schedule': return schedule(items)
    case 'choices': return `<div class="choices">${b.prompt ? `<div class="p">${esc(b.prompt)}</div>` : ''}<div class="acts">${(b.options || []).map((o, k) => `<button class="btn ${o.primary ? 'pri' : ''}" data-act="ui-choice" data-t="${tid}" data-b="${bi}" data-k="${k}">${esc(o.label)}</button>`).join('')}</div></div>`
    case 'form': {
      let h = `<div class="form" data-form="${tid}:${bi}">`
      for (const f of b.fields || []) {
        const key = esc(f.key)
        h += `<div class="fld"><label>${esc(f.label || f.key)}</label><div class="ctl">`
        if (f.kind === 'select') {
          const opts = f.options || []
          h += opts.length <= 4 ? `<div class="seg2" data-key="${key}" data-val="${esc(f.value ?? opts[0] ?? '')}">${opts.map((o) => `<button type="button" class="${String(o) === String(f.value ?? opts[0]) ? 'on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`
            : `<select data-key="${key}">${opts.map((o) => `<option ${String(o) === String(f.value) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        } else if (f.kind === 'range') {
          const v = f.value ?? f.min ?? 0
          h += `<input type="range" data-key="${key}" min="${+f.min || 0}" max="${+f.max || 100}" step="${+f.step || 1}" value="${+v}" data-unit="${esc(f.unit || '')}"><span class="val">${esc(v)} ${esc(f.unit || '')}</span>`
        } else if (f.kind === 'toggle') h += `<button type="button" class="sw ${f.value ? 'on' : ''}" data-key="${key}" data-kind="toggle"></button>`
        else h += `<input type="text" class="inp" style="flex:1" data-key="${key}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}">`
        h += '</div></div>'
      }
      if (b.submit) h += `<div><button class="btn pri" data-act="ui-submit" data-t="${tid}" data-b="${bi}">${esc(b.submit.label || '好了')}</button></div>`
      return h + '</div>'
    }
    default: return b.text ? `<div class="txt">${esc(b.text)}</div>` : ''
  }
}
// a day's events as bars on a time axis; conflicts show red
function schedule(items) {
  const mins = (s) => { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null }
  const ev = items.map((i) => ({ ...i, s: mins(i.start), e: mins(i.end) ?? (mins(i.start) + 60) })).filter((i) => i.s !== null).sort((x, y) => x.s - y.s)
  if (!ev.length) return ''
  const from = Math.floor(Math.min(...ev.map((i) => i.s), 9 * 60) / 60) * 60, to = Math.ceil(Math.max(...ev.map((i) => i.e), 18 * 60) / 60) * 60
  const x = (m) => ((m - from) / (to - from) * 100).toFixed(2) + '%'
  let ax = '', grid = ''
  const step = to - from > 8 * 60 ? 120 : 60
  for (let m = from; m <= to; m += 60) { if ((m - from) % step === 0) ax += `<span style="left:${x(m)}">${m / 60}</span>`; grid += `<i style="left:${x(m)}"></i>` }
  const n = new Date(), nm = n.getHours() * 60 + n.getMinutes()
  const now = nm > from && nm < to ? `<em style="left:${x(nm)}"></em>` : ''
  return `<div class="sched"><div class="row"><span></span><div class="trk ax">${ax}</div></div>${ev.map((i) => `<div class="row ${i.conflict ? 'cf' : ''}"><span class="lb"><small>${esc(i.start)}${i.end ? '–' + esc(i.end) : ''}</small>${esc(i.title)}</span><div class="trk">${grid}${now}<b style="left:${x(i.s)};width:calc(${x(i.e)} - ${x(i.s)})"></b></div></div>`).join('')}</div>`
}
function formValues(formEl) {
  const v = {}
  formEl.querySelectorAll('[data-key]').forEach((x) => {
    const k = x.dataset.key
    if (x.classList.contains('seg2')) v[k] = x.dataset.val
    else if (x.dataset.kind === 'toggle') v[k] = x.classList.contains('on')
    else if (x.type === 'range') v[k] = +x.value
    else v[k] = x.value
  })
  return v
}

// ---------- task process bar ----------
function openProc(sel) { if (sel !== undefined) procSel = sel; $('#app').classList.add('procon'); procPref = 'auto'; store.set('proc', procPref); renderProc(); renderHead(); if (view === 'chat') renderMsgs(true) }
function closeProc() { $('#app').classList.remove('procon'); procPref = 'closed'; store.set('proc', procPref); procSel = null; renderHead(); if (view === 'chat') renderMsgs(true) }
function procTarget() {
  if (procSel) { const t = turnsOf(procSel.agent).find((x) => x.id === procSel.turn); if (t) return t }
  return [...turnsOf(cur)].reverse().find((t) => !t.internal && (toolsOf(t).length || t.running)) || null
}
function renderProc() {
  if (!$('#app').classList.contains('procon')) return
  document.querySelectorAll('#ptabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === procTab))
  const B = $('#procBody')
  if (procTab === 'routines') { const sig = 'routines:' + cur; B.innerHTML = renderRoutines(); if (B.dataset.turn !== sig) { B.dataset.turn = sig; replay(B, 'swap') } return }
  const t = procTarget()
  const ca = agentOf(t ? t.agent : cur)
  const hr = new Date().getHours(), wall = hr < 6 || hr >= 20 ? 'night' : hr < 11 ? 'morning' : hr < 17 ? 'noon' : 'evening'
  const screen = `<div class="scr wall-${wall} ${busy(ca.id) ? 'on' : ''}"><div class="sbar"><i></i><i></i><i></i><span>${esc(ca.name)} 的电脑</span><em>${busy(ca.id) ? '使用中' : '空闲'}</em></div><div class="sbody">${busy(ca.id) ? `<span class="spin"></span>${esc(nowDoing(ca.id))}` : '在这台电脑上，用你的文件、日程和邮箱做事'}</div></div>`
  if (!t) { B.innerHTML = screen + '<div class="hint">这里会显示 Bot 做事的每一步：用了什么工具、改了什么，能直接撤回。</div>'; return }
  const a = agentOf(t.agent)
  const tools = toolsOf(t)
  const secs = t.endAt ? Math.max(1, Math.round((Date.parse(t.endAt) - Date.parse(t.at)) / 1000)) : null
  let h = screen + `<div class="pt">${esc(String(turnTitle(t)).slice(0, 120))}</div>
    <div class="pm2">${avatar(a, 18, true)}${esc(a.name)} · ${hhmm(t.at)} · ${t.running ? '<span class="spin" style="width:11px;height:11px"></span> 正在做' : `${tools.length} 步${secs ? ` · 用时 ${secs < 90 ? secs + ' 秒' : Math.round(secs / 60) + ' 分钟'}` : ''}`}</div><div class="steps">`
  for (const it of t.items) {
    if (it.role === 'tool') {
      const ic = it.state === 'running' ? '<span class="spin"></span>' : it.state === 'error' ? '<span class="xdot">!</span>' : `<span class="okdot">${CHECK}</span>`
      const d = toolDetail(it.args)
      h += `<div class="step" data-k="${it.id}"><span class="ic">${ic}</span><div class="m"><div class="l">${esc(toolLabel(it.name))}</div>${d ? `<div class="d">${esc(d)}</div>` : ''}${it.args?.reason ? `<div class="d">为什么：${esc(it.args.reason)}</div>` : ''}${it.error ? `<div class="e">${esc(it.error)}</div>` : ''}</div></div>`
    } else if (it.role === 'assistant' && it.text) h += `<div class="step say"><span class="ic"></span><div class="m"><div class="l">${esc(it.text.replace(/\s+/g, ' ').slice(0, 160))}</div></div></div>`
    else if (it.role === 'ui') h += `<div class="step"><span class="ic"><span class="okdot">${CHECK}</span></span><div class="m"><div class="l">生成了卡片</div><div class="d">${esc(it.ui?.title || '')}</div></div></div>`
    else if (it.role === 'error') h += `<div class="step"><span class="ic"><span class="xdot">!</span></span><div class="m"><div class="e">${esc(it.text)}</div></div></div>`
  }
  h += '</div>'
  const all = turnsOf(t.agent), i = all.findIndex((x) => x.id === t.id)
  const end = t.endAt || all[i + 1]?.at || new Date(Date.now() + 1000).toISOString()
  const changes = S.ledger.filter((e) => e.at >= t.at && e.at <= end)
  if (changes.length) {
    const can = changes.filter((e) => e.status === 'done' && e.undo)
    h += `<div class="psec">这次改了这些</div>${changes.map((e) => `<div class="chg ${e.status === 'undone' ? 'undone' : ''}"><span class="t">${esc(e.title)}</span>${e.status === 'undone' ? '<span class="hint" style="margin:0">已撤回</span>' : e.undo ? `<button class="btn sm" data-act="undo" data-id="${e.id}">${esc(e.undo.label || '撤回')}</button>` : ''}</div>`).join('')}`
    if (can.length > 1) h += `<div style="margin-top:8px"><button class="btn sm warn" data-act="undo-many" data-ids="${can.map((e) => e.id).join(',')}">全部撤回</button></div>`
  }
  const others = [...all].reverse().filter((x) => toolsOf(x).length && x.id !== t.id).slice(0, 12)
  if (others.length) h += `<div class="psec">${esc(a.name)}做过的其他事</div><div class="turns">${others.map((x) => `<button data-act="proc-open" data-agent="${x.agent}" data-turn="${x.id}"><span>${esc(String(turnTitle(x)).slice(0, 50))}</span><small>${when(x.at)}</small></button>`).join('')}</div>`
  B.innerHTML = h
  const switched = B.dataset.turn !== t.id
  B.dataset.turn = t.id
  reveal(B, '.step[data-k], .chg', (el) => 'p:' + (el.dataset.k || hashText(el.textContent)), { quiet: switched, step: 50 })
  if (switched) replay(B, 'swap')
}

// 日常任务: what the bots do on their own, on a schedule or when something happens
function renderRoutines() {
  const st = S.settings || {}, main = agentOf(S.mainId), a = agentOf(cur)
  const briefOn = true, refOn = st.reflectAtNight !== false
  const row = (icon, title, when, on, acts = '') => `<div class="rt ${on ? '' : 'off'}"><span class="ri">${icon}</span><div class="m"><div class="t">${title}</div><div class="w">${when}</div>${acts ? `<div class="a">${acts}</div>` : ''}</div><span class="rs">${on ? '开' : '已暂停'}</span></div>`
  const I = {
    sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>',
    moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    q: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  }
  let h = `<div class="rhd">${avatar(main, 22)}<span>${esc(main.name)}负责的日常任务</span></div>`
  h += row(I.sun, '每日简报', `每天 ${esc(st.briefTime || '08:00')} · 整理今天要你定的、替你做完的事`, briefOn, '<button class="btn sm" data-act="brief-run">现在跑</button><button class="lk" data-go="brief">看简报</button>')
  h += row(I.moon, '夜里反思', `每天 ${esc(st.nightFrom ?? 23)}:00 后你不在时 · 回想对话，整理记忆`, refOn, '<button class="btn sm" data-act="reflect-run">现在跑</button><button class="lk" data-go="reflect">看反思</button>')
  h += row(I.eye, '留意新文件', `一直在 · ${esc((st.watch || []).map((x) => x.replace(/^~[\\/]/, '')).join('、') || '下载、桌面')}`, true)
  const jobs = S.later.filter((j) => j.status === 'queued' || j.status === 'running')
  if (jobs.length) {
    h += '<div class="psec">排着的事</div>'
    for (const j of jobs) h += row(I.q, esc(j.title), `${j.status === 'running' ? '正在做' : '排队中'} · ${j.when === 'night' ? '夜里做' : '你离开时做'}`, true, j.status === 'queued' ? `<button class="lk" data-act="later-rm" data-id="${j.id}">不做了</button>` : '')
  }
  h += `<div class="hint" style="margin-top:14px">想加一个？直接跟${esc(a.name)}说，比如“每周五下午帮我整理这周的报销单”。设置里能改时间。</div>`
  return h
}

// ---------- pages ----------
let entering = true
function setView(v, arg) {
  if (v !== view || (arg ?? null) !== viewArg) entering = true
  view = v; viewArg = arg ?? null
  $('#vChat').hidden = v !== 'chat'; $('#vPage').hidden = v === 'chat'
  // the process bar belongs to the chat; on a page it only opens when asked for there
  $('#app').classList.remove('procon'); procSel = null
  renderAll(false)
}
const phead = (title, sub = '', right = '') => `<div class="phead">${MINE.includes(view) && view !== 'me' ? '<button class="crumb" data-go="me"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>我的</button>' : ''}<h2>${title}</h2><span class="s">${sub}</span><div class="r">${right}</div></div>`

function renderPage() {
  if (view === 'chat') return
  const P = $('#pg')
  const keep = $('#vPage').scrollTop
  const fn = { me: pageMe, plugins: pagePlugins, brief: pageBrief, memory: pageMemory, reflect: pageReflect, ledger: pageLedger, later: pageLater, settings: pageSettings, agent: pageAgent }[view]
  if (fn) P.innerHTML = fn()
  if (view === 'settings') { renderModelForm($('#modelForm'), false); renderEval($('#evalBox')); renderUpdate($('#updBox')) }
  const CARDS = '#pg > *:not(.two):not(.bgrid):not(.stats):not(.mapwrap), #pg .bgrid > *, #pg .stats > *, #pg .two > div > *, #pg .mapwrap > *, #pg .panel > .ent'
  const keyOf = (el) => view + ':' + (el.dataset.k || el.className.split(' ')[0] + ':' + hashText(el.textContent.slice(0, 600)))
  if (entering) {
    entering = false
    $('#vPage').scrollTop = 0
    if (!REDUCED) reveal(P, CARDS, keyOf, { cls: 'rise', step: 35, max: 14 })
    else reveal(P, CARDS, keyOf, { quiet: true })
    if (view === 'memory' && !REDUCED) P.querySelectorAll('.map .mnode').forEach((n, i) => { n.style.setProperty('--d', 200 + Math.min(i, 30) * 22 + 'ms'); n.classList.add('pop') })
    if (view === 'memory' && !REDUCED) P.querySelectorAll('.map .medge').forEach((n) => n.classList.add('draw'))
  } else {
    reveal(P, CARDS, keyOf, { cls: 'upd', step: 30 })
    $('#vPage').scrollTop = keep
  }
}

// 我的: what is yours across every bot — the brief, memory, reflection, records and queued work
function pageMe() {
  const b = S.brief, fresh = b && b.date === todayStr()
  const open = fresh ? (b.items || []).filter((i) => i.kind === 'decide' && i.status === 'open').length : 0
  const r = S.reflections[0], nr = r ? [...r.proposals, ...r.lessons].filter((p) => p.status === 'open').length : 0
  const led = [...S.ledger].reverse(), canUndo = led.filter((e) => e.status === 'done' && e.undo).length
  const q = S.later.filter((j) => j.status === 'queued' || j.status === 'running').length
  const ms = S.memories
  const card = (go, k, title, body, foot, extra = '') => `<button class="mcard ${extra}" data-go="${go}" data-k="${go}"><div class="k">${k}</div><div class="t">${title}</div><div class="d">${body}</div>${foot ? `<div class="f">${foot}</div>` : ''}</button>`
  const dots = KORDER.map((k) => { const n = ms.filter((m) => (m.kind || '事实') === k).length; return n ? `<span style="--c:${KCOL[k]}"><i></i>${k} ${n}</span>` : '' }).join('')
  let h = phead('我的', '所有 Bot 共用')
  h += `<div class="mehead"><span class="uav big">${esc(userInitial())}</span><div><div class="nm">${esc(S.settings?.callMe || '你')}</div><div class="s">${r?.profile ? esc(r.profile.slice(0, 90)) + (r.profile.length > 90 ? '…' : '') : '这里放着你的记忆、每日简报和 Bot 替你做过的每件事。'}</div></div></div>`
  h += '<div class="megrid">'
  h += card('brief', '每日简报', fresh ? esc(b.greeting || '今天的简报') : '今天还没整理', fresh ? esc(String(b.summary || '').slice(0, 80)) : `每天 ${esc(S.settings?.briefTime || '08:00')} 自动整理`, open ? `<b class="warn">${open} 件等你定</b>` : fresh ? `${hhmm(b.at)} 整理` : '', 'wide')
  h += card('memory', '我的记忆', `${ms.length} 条`, dots ? `<span class="kd">${dots}</span>` : '聊天时说“记住……”就会记下', '带出处，能改能删')
  h += card('reflect', '反思', r ? dayLabel(r.at) + ' 的反思' : '还没反思过', r ? `${r.insights.length} 个发现 · ${r.proposals.length + r.lessons.length} 条建议` : '每晚你不在时回想一次', nr ? `<b class="warn">${nr} 条等你采纳</b>` : '')
  h += card('ledger', '操作记录', `${led.length} 件事`, led[0] ? esc(led[0].title) : '还没替你做过事', canUndo ? `${canUndo} 件能撤回` : '')
  h += card('later', '后台任务', q ? `${q} 件排着` : '队列是空的', '交给 Bot “晚点做”的事，你离开或夜里做', '')
  h += '</div>'
  h += `<div class="sec">隐私</div><div class="panel"><div class="setrow"><label>临时模式</label><div class="ctl"><button class="sw ${S.privateMode ? 'on' : ''}" data-act="priv"></button><span class="hint" style="margin:0">开着时所有 Bot 都不记住你说的话</span></div></div></div>`
  return h
}

// 插件: the tools every bot shares, by where they come from
const PLUGINS = [
  { n: '记忆', k: 'memory', d: '记住你的偏好、人物和项目，每条带出处；夜里反思整理', t: ['memory_save', 'memory_search', 'memory_update', 'memory_forget', 'reflection_publish'] },
  { n: '日程和待办', k: 'actions', d: '本机日历和待办，添加时查冲突', t: ['calendar_list', 'calendar_add', 'calendar_update', 'calendar_delete', 'todo_list', 'todo_add', 'todo_done'] },
  { n: '邮箱', k: 'actions', d: '每个 Bot 有自己的邮箱，Bot 之间发邮件派活；对外发送先问你', t: ['mail_draft', 'mail_send', 'mail_inbox'] },
  { n: '文件', k: 'actions', d: '列文件夹、移动和重命名，每次都能撤回', t: ['folder_list', 'file_move', 'read', 'write', 'edit'] },
  { n: '生成式卡片', k: 'actions', d: '要你挑、调、确认时直接给出可点的卡片', t: ['show_ui'] },
  { n: '简报和后台', k: 'ambient', d: '每日简报、留意新文件、你不在时做排着的事', t: ['brief_publish', 'brief_resolve', 'later_add'] },
  { n: '操作记录', k: 'ledger', d: '每件事都记下原因，一句“算了”就撤回', t: ['ledger_recent', 'undo_actions'] },
  { n: '联网和命令行', k: 'DSH', d: 'DeepSeek Harness 自带：搜索、读网页、在这台电脑上跑命令', t: ['web_search', 'web_fetch', 'shell'] },
]
function pagePlugins() {
  let h = phead('插件', '所有 Bot 共用')
  h += '<div class="intro">工具和插件是整个账号共用的；记忆、人设和日常任务属于每个 Bot 自己。</div><div class="plgrid">'
  for (const p of PLUGINS) h += `<div class="plug" data-k="pl${p.n}"><div class="h"><b>${esc(p.n)}</b><span class="tag">${esc(p.k)}</span><span class="on">已启用</span></div><div class="d">${esc(p.d)}</div><div class="tl2">${p.t.map((x) => `<code>${esc(x)}</code>`).join('')}</div></div>`
  return h + '</div>'
}

// 每日简报: its own page, generated cards laid out by importance
function pageBrief() {
  const b = S.brief, d = new Date()
  const hour = d.getHours()
  const hi = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const main = agentOf(S.mainId)
  const fresh = b && b.date === todayStr()
  const working = turnsOf(S.mainId).some((t) => t.kind === 'brief' && t.running)
  let h = phead('每日简报', '', `<button class="btn" data-act="brief-run" ${working ? 'disabled' : ''}>${working ? '正在整理…' : fresh ? '重新整理' : '现在整理'}</button>`)
  h += `<div class="bhead"><div class="date">${d.getMonth() + 1}月${d.getDate()}日 · 星期${WEEK[d.getDay()]}</div><div class="hi">${esc(fresh && b.greeting ? b.greeting : hi)}</div>`
  if (!fresh) return h + `</div><div class="bempty">${working ? `${esc(main.name)}正在整理今天的简报…` : `今天的简报还没准备。每天 ${esc(S.settings?.briefTime || '08:00')} ${esc(main.name)}会自己整理，也可以现在就让它整理。`}</div>`
  const bt = [...turnsOf(S.mainId)].reverse().find((t) => t.kind === 'brief')
  h += `<div class="sum">${esc(b.summary)}</div><div class="meta"><span>${esc(main.name)} ${hhmm(b.at)} 整理</span>${bt ? `<button class="lk" data-act="proc-open" data-agent="${S.mainId}" data-turn="${bt.id}">看看它怎么整理的</button>` : ''}</div></div>`
  if (b.hero && (b.hero.title || b.hero.text)) {
    const img = b.hero.image ? (/^https?:/.test(b.hero.image) ? b.hero.image : fileUrl(b.hero.image)) : ''
    h += `<div class="hero"><div class="glow"></div><div class="tx"><div class="k">今天最要紧</div><div class="t">${esc(b.hero.title || '')}</div>${b.hero.text ? `<div class="d">${esc(b.hero.text)}</div>` : ''}</div>${img ? `<img src="${esc(img)}" alt="" onerror="this.remove()">` : ''}</div>`
  }
  const K = { decide: '需要你定', done: '已经替你做完', doing: '还在做', info: '值得知道' }
  const order = { decide: 0, doing: 2, done: 3, info: 1 }
  const items = [...(b.items || [])].sort((x, y) => (x.size === 'l' ? -1 : 0) - (y.size === 'l' ? -1 : 0) || (order[x.kind] ?? 1) - (order[y.kind] ?? 1))
  h += '<div class="bgrid">'
  for (const it of items) {
    const kind = K[it.kind] ? it.kind : 'info'
    let c = `<div class="bcard ${kind} ${it.size === 'l' ? 'l' : it.size === 's' ? 's' : ''} ${it.status === 'working' ? 'working' : ''}" data-k="${it.id}:${it.status || ''}"><div class="k"><i></i>${K[kind]}</div><div class="t">${esc(it.title)}</div>${it.detail ? `<div class="d">${esc(it.detail)}</div>` : ''}`
    for (const bl of it.blocks || []) c += `<div class="blk">${block(bl, 'brief', 0)}</div>`
    if (it.status === 'resolved') c += `<div class="res">✓ ${esc(it.result || it.choice || '已处理')}</div>`
    else if (it.status === 'working') c += `<div class="wk"><span class="spin"></span>正在按“${esc(it.choice || '')}”去做</div>`
    else if ((it.actions || []).length) c += `<div class="acts">${it.actions.map((a, k) => `<button class="btn ${a.primary ? 'pri' : ''}" data-act="brief-do" data-id="${it.id}" data-k="${k}">${esc(a.label)}</button>`).join('')}</div>`
    if (it.status === 'open' && it.result) c += `<div class="hint">${esc(it.result)}</div>`
    h += c + '</div>'
  }
  return h + '</div>'
}

// 我的记忆: a star map of what the agents know about you, grouped by kind
const KCOL = { 偏好: '#e6a66f', 事实: '#8fb0ff', 人物: '#7fd6a8', 习惯: '#e3c46a', 项目: '#c39bff', 经验: '#f08a9a' }
const KORDER = ['偏好', '习惯', '人物', '项目', '事实', '经验']
function pageMemory() {
  const ms = S.memories, r = S.reflections[0]
  let h = phead('我的记忆', `${ms.length} 条 · 所有 Bot 共用`, `<div class="tabs" style="margin:0"><button class="${memTab === 'map' ? 'on' : ''}" data-act="mem-tab" data-t="map">星图</button><button class="${memTab === 'list' ? 'on' : ''}" data-act="mem-tab" data-t="list">列表</button></div>`)
  h += `<div class="portrait">${avatar(agentOf(S.mainId), 40)}<div style="flex:1"><div class="k">${esc(agentOf(S.mainId).name)}眼中的你</div><div class="t">${r?.profile ? esc(r.profile) : '还没有反思过。反思之后，这里会写下它对你的整体理解。'}</div>${r ? `<div class="hint">来自 ${dayLabel(r.at)} ${hhmm(r.at)} 的反思 · <button class="lk" data-act="go" data-v="reflect">看反思</button></div>` : `<div class="hint"><button class="lk" data-act="reflect-run">现在反思一次</button></div>`}</div></div>`
  if (S.privateMode) h += '<div class="hint" style="color:#ffd7a1;margin-top:10px">临时模式开着：现在说的话不会被记住。</div>'
  if (memTab === 'list') {
    h += `<div class="sec">手动告诉它一件事</div><div class="addrow"><input class="inp" id="memNew" placeholder="比如：我对芒果过敏"><button class="btn" data-act="mem-add">记住</button></div>`
    for (const k of KORDER) {
      const l = ms.filter((m) => (m.kind || '事实') === k).reverse(); if (!l.length) continue
      h += `<div class="sec">${k} · ${l.length}</div><div class="panel mlist">${l.map((m) => `<div class="mem" data-id="${m.id}"><span class="kchip" style="background:${KCOL[k]}22;color:${KCOL[k]}">${k}</span><div class="m"><div class="t">${esc(m.text)}</div><div class="src">${esc(m.source || '对话')}${m.quote ? ` · “${esc(m.quote.slice(0, 60))}”` : ''} · ${dayOf(m.createdAt)}${m.editedByUser ? ' · 你改过' : ''}${m.uses ? ` · 用过 ${m.uses} 次` : ''}</div></div><button class="lk" data-act="mem-pick" data-id="${m.id}">详情</button></div>`).join('')}</div>`
    }
    if (!ms.length) h += '<div class="intro" style="margin-top:20px">还没有记忆。聊天时说“记住……”，或者在上面直接写。</div>'
    return h
  }
  h += `<div class="mapwrap"><div class="map ${memSel ? 'focus' : ''}" id="map">${memoryMap()}<div class="lg">点大小 = 用过的次数 · 虚线 = 反思里发现的联系</div></div><div class="detail">${memoryDetail()}</div></div>`
  return h
}
function memoryMap() {
  const W = 900, H = 660, cx = W / 2, cy = H / 2
  const ms = S.memories
  const kinds = KORDER.filter((k) => ms.some((m) => (m.kind || '事实') === k))
  const ins = S.reflections[0]?.insights || []
  const linked = new Set(); const hl = new Set()
  if (memSel) { hl.add(memSel); for (const i of ins) if (i.memIds.includes(memSel)) i.memIds.forEach((x) => hl.add(x)) }
  const pos = {}
  let g = '', edges = '', nodes = ''
  kinds.forEach((k, ki) => {
    const ang = -Math.PI / 2 + ki * (2 * Math.PI / kinds.length)
    const kx = cx + Math.cos(ang) * 255, ky = cy + Math.sin(ang) * 195
    const l = ms.filter((m) => (m.kind || '事实') === k)
    g += `<line x1="${cx}" y1="${cy}" x2="${kx}" y2="${ky}" stroke="${KCOL[k]}" stroke-opacity=".18" stroke-width="1"/>`
    l.forEach((m, i) => {
      const a = i * 2.39996 + ki + .6, rr = 60 + 22 * Math.sqrt(i)
      const x = kx + Math.cos(a) * rr, y = ky + Math.sin(a) * rr * .85
      pos[m.id] = [x, y]
      edges += `<line class="medge ${hl.has(m.id) ? 'hl' : ''}" x1="${kx}" y1="${ky}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${KCOL[k]}" stroke-opacity=".22"/>`
    })
    g += `<g><circle cx="${kx}" cy="${ky}" r="24" fill="${KCOL[k]}" fill-opacity=".12" stroke="${KCOL[k]}" stroke-opacity=".5"/><text x="${kx}" y="${ky + 4}" text-anchor="middle" font-size="15" fill="${KCOL[k]}">${k}</text><text x="${kx}" y="${ky + 40}" text-anchor="middle" font-size="13" fill="#6e6e74">${l.length} 条</text></g>`
  })
  for (const i of ins) for (let a = 0; a < i.memIds.length; a++) for (let b = a + 1; b < i.memIds.length; b++) {
    const p = pos[i.memIds[a]], q = pos[i.memIds[b]]; if (!p || !q) continue
    const on = hl.has(i.memIds[a]) && hl.has(i.memIds[b])
    linked.add(i.memIds[a]); linked.add(i.memIds[b])
    edges += `<path class="medge ${on ? 'hl' : ''}" d="M${p[0].toFixed(1)},${p[1].toFixed(1)} Q${cx},${cy} ${q[0].toFixed(1)},${q[1].toFixed(1)}" fill="none" stroke="#fff" stroke-opacity="${on ? .7 : .28}" stroke-dasharray="3 4"/>`
  }
  const labels = ms.length <= 40
  for (const m of ms) {
    const p = pos[m.id]; if (!p) continue
    const k = m.kind || '事实', r = 4.5 + Math.min(m.uses || 0, 8) * .9
    const fresh = Date.now() - Date.parse(m.createdAt) < 3 * 86400e3
    const t = m.text.length > 9 ? m.text.slice(0, 9) + '…' : m.text
    nodes += `<g class="mnode ${memSel === m.id ? 'sel' : ''} ${hl.has(m.id) ? 'hl' : ''}" data-act="mem-pick" data-id="${m.id}"><title>${esc(m.text)}</title>${fresh ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r + 5}" fill="${KCOL[k]}" fill-opacity=".15"/>` : ''}<circle class="c" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}" fill="${KCOL[k]}" fill-opacity="${linked.has(m.id) ? 1 : .8}"/>${labels ? `<text x="${(p[0] + r + 4).toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" font-size="14" fill="#c4c4ca">${esc(t)}</text>` : ''}</g>`
  }
  const me = `<defs><radialGradient id="og" cx="35%" cy="30%"><stop offset="0" stop-color="#ffb46b"/><stop offset=".3" stop-color="#e2502e"/><stop offset=".62" stop-color="#5a2fd0"/><stop offset=".85" stop-color="#141432"/></radialGradient></defs>
    <circle cx="${cx}" cy="${cy}" r="46" fill="#fff" fill-opacity=".03"/><circle cx="${cx}" cy="${cy}" r="26" fill="url(#og)"/><text x="${cx}" y="${cy + 46}" text-anchor="middle" font-size="15" fill="#e6e6ea">${esc(S.settings?.callMe || '你')}</text>`
  if (!ms.length) return `<svg viewBox="0 0 ${W} ${H}">${me}<text x="${cx}" y="${cy + 80}" text-anchor="middle" font-size="13" fill="#6e6e74">还没有记忆。聊得越多，这里越亮。</text></svg>`
  return `<svg viewBox="0 0 ${W} ${H}">${g}${edges}${me}${nodes}</svg>`
}
function memoryDetail() {
  const m = S.memories.find((x) => x.id === memSel)
  if (!m) {
    const ms = S.memories
    const recent = [...ms].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
    return `<div class="k" style="font-size:12px;color:var(--tx3)">一共 ${ms.length} 条</div>
      <div class="bars" style="margin-top:10px">${KORDER.map((k) => { const n = ms.filter((x) => (x.kind || '事实') === k).length; return `<div class="bar"><span class="l">${k}</span><span class="tr"><i style="width:${ms.length ? Math.max(2, n / ms.length * 100) : 0}%;background:${KCOL[k]}"></i></span><span class="v">${n}</span></div>` }).join('')}</div>
      <div class="sec">最近记住的</div>${recent.map((x) => `<div class="rel"><div class="it" style="cursor:pointer" data-act="mem-pick" data-id="${x.id}">${esc(x.text)}</div></div>`).join('') || '<div class="hint">还没有</div>'}
      <div class="sec">手动告诉它一件事</div><div class="addrow"><input class="inp" id="memNew" placeholder="比如：我对芒果过敏"><button class="btn" data-act="mem-add">记住</button></div>`
  }
  const k = m.kind || '事实'
  const rel = (S.reflections[0]?.insights || []).filter((i) => i.memIds.includes(m.id))
  return `<span class="kchip" style="background:${KCOL[k]}22;color:${KCOL[k]}">${k}</span>
    <div class="t" id="memText" style="margin-top:10px">${esc(m.text)}</div>
    ${m.quote ? `<div class="q">“${esc(m.quote)}”</div>` : ''}
    <div class="kv"><div class="k">来源</div><div class="v">${esc(m.source || '对话')}</div><div class="k">记于</div><div class="v">${dayLabel(m.createdAt)} ${hhmm(m.createdAt)}</div><div class="k">用过</div><div class="v">${m.uses || 0} 次</div>${m.editedByUser ? '<div class="k">修改</div><div class="v">你亲手改过</div>' : ''}</div>
    ${rel.length ? `<div class="rel"><div class="sec" style="margin-top:6px">反思里的联系</div>${rel.map((i) => `<div class="it">${esc(i.text)}</div>`).join('')}</div>` : ''}
    <div class="a"><button class="btn sm" data-act="mem-edit" data-id="${m.id}">改一下</button><button class="btn sm warn" data-act="mem-forget" data-id="${m.id}">忘掉</button><button class="btn sm" data-act="mem-pick" data-id="" style="margin-left:auto">返回</button></div>`
}

// 反思: what the agent noticed looking back, and what it suggests changing — nothing changes until you agree
const OPS = { add: ['新记一条', 'add'], merge: ['合并', 'merge'], update: ['改一下', 'update'], forget: ['忘掉', 'forget'] }
function pageReflect() {
  const rs = S.reflections, r = rs[0]
  const working = turnsOf(S.mainId).some((t) => t.kind === 'reflect' && t.running)
  const main = agentOf(S.mainId)
  let h = phead('反思', '', `<button class="btn" data-act="reflect-run" ${working ? 'disabled' : ''}>${working ? '正在反思…' : '现在反思'}</button>`)
  h += `<div class="intro">像人睡前回想一天：${esc(main.name)}每天夜里把这段时间的对话、记忆和你撤回过的事想一遍，写下对你的新理解、发现的规律，以及记忆要怎么整理、自己哪里要改。每条建议都要你点头才会生效，采纳后也能在操作记录里撤回。</div>`
  if (!r) return h + `<div class="bempty">${working ? '正在反思，稍等一下…' : '还没有反思过。可以等今晚，也可以现在就让它想一次。'}</div>`
  const st = r.stats || {}
  const bt = [...turnsOf(S.mainId)].reverse().find((t) => t.kind === 'reflect')
  h += `<div class="refhead"><div class="moon"></div><div style="flex:1"><div class="t">${dayLabel(r.at)} ${hhmm(r.at)} · ${r.reason === '夜间' ? '夜里自己想的' : '你让它想的'}${bt ? ` · <button class="lk" data-act="proc-open" data-agent="${S.mainId}" data-turn="${bt.id}">过程</button>` : ''}</div><div class="p">${esc(r.profile)}</div></div></div>`
  h += `<div class="stats"><div class="stat"><b>${st.said ?? '-'}</b><span>句你说过的话</span></div><div class="stat"><b>${st.memories ?? '-'}</b><span>条记忆</span></div><div class="stat"><b>${st.undone ?? 0}</b><span>次你撤回过</span></div><div class="stat"><b>${r.proposals.length + r.lessons.length}</b><span>条建议</span></div></div>`
  if (r.insights.length) {
    h += '<div class="sec">发现</div>'
    for (const i of r.insights) h += `<div class="ins"><div class="t">${esc(i.text)}</div>${i.evidence.length ? `<div class="ev">${i.evidence.map((e) => `<span>“${esc(e)}”</span>`).join('')}</div>` : ''}${i.memIds.length ? `<div class="mm">${i.memIds.map((x) => { const m = S.memories.find((y) => y.id === x); return m ? `<button data-act="mem-goto" data-id="${x}">${esc(m.text.slice(0, 18))}</button>` : '' }).join('')}</div>` : ''}</div>`
  }
  const prop = (p, rid, lesson) => {
    const [label, cls] = lesson ? ['做事经验', 'lesson'] : OPS[p.op] || [p.op, '']
    const bef = !lesson && p.op !== 'add' ? (p.olds || []).filter(Boolean).map((o) => `<div class="bef">${esc(o)}</div>`).join('') : ''
    const aft = lesson || p.op !== 'forget' ? `<div class="aft">${esc(p.text)}</div>` : ''
    const right = p.status === 'open' ? `<div class="a"><button class="btn sm pri" data-act="prop" data-r="${rid}" data-p="${p.id}" data-ok="1">采纳</button><button class="btn sm" data-act="prop" data-r="${rid}" data-p="${p.id}">不用</button></div>`
      : `<span class="st ${p.status === 'ignored' ? 'ig' : ''}">${p.status === 'accepted' ? '✓ 已采纳' : '没采纳'}</span>`
    return `<div class="prop ${p.status !== 'open' ? 'done' : ''}"><span class="op ${cls}">${label}</span><div class="m">${bef}${aft}${p.why ? `<div class="why">${esc(p.why)}</div>` : ''}</div>${right}</div>`
  }
  if (r.proposals.length) h += '<div class="sec">记忆整理建议</div>' + r.proposals.map((p) => prop(p, r.id, false)).join('')
  if (r.lessons.length) h += `<div class="sec">${esc(main.name)}自己要改进的</div>` + r.lessons.map((p) => prop(p, r.id, true)).join('')
  if (rs.length > 1) h += '<div class="sec">以前的反思</div><div class="panel">' + rs.slice(1).map((x) => `<div class="ent"><div class="tm">${dayOf(x.at).slice(5)}</div><div class="m"><div class="t">${esc(x.profile)}</div><div class="w">${x.insights.length} 个发现 · ${x.proposals.length + x.lessons.length} 条建议，采纳 ${[...x.proposals, ...x.lessons].filter((p) => p.status === 'accepted').length} 条</div></div></div>`).join('') + '</div>'
  return h
}

function pageLedger() {
  const list = [...S.ledger].reverse()
  let h = phead('操作记录', `${list.length} 件事`, `<button class="btn" data-act="undo-last" ${list.some((e) => e.status === 'done' && e.undo) ? '' : 'disabled'}>算了，撤回上一步</button>`)
  h += '<div class="intro">Bot 替你做的每一件事都记在这里：做了什么、为什么做。能撤回的都能一键撤回。</div><div class="panel">'
  let day = ''
  for (const e of list) {
    const d = dayOf(e.at); if (d !== day) { day = d; h += `<div class="sec" style="margin-top:${day === dayOf(list[0].at) ? 0 : 18}px">${dayLabel(e.at)}</div>` }
    const und = e.status === 'undone'
    h += `<div class="ent ${und ? 'undone' : ''}"><div class="tm">${hhmm(e.at)}</div><div class="m"><div class="t">${esc(e.title)}${e.risk === 'high' ? '<span class="tagx risk">经你确认</span>' : ''}${e.private ? '<span class="tagx priv">临时模式</span>' : ''}</div>${e.why ? `<div class="w">为什么：${esc(e.why)}</div>` : ''}
      <div class="a">${und ? `<span class="note">↩ ${esc(e.undoNote || '已撤回')}</span>` : e.undo ? `<button class="btn sm" data-act="undo" data-id="${e.id}">${esc(e.undo.label || '撤回')}</button>` : '<span class="w">这件事不用撤回</span>'}</div></div></div>`
  }
  if (!list.length) h += '<div class="intro" style="margin:0">还没替你做过事。</div>'
  return h + '</div>'
}

function pageLater() {
  const st = { queued: '排队中', running: '正在做', done: '做完了', error: '没做成' }
  let h = phead('后台任务') + '<div class="intro">交给 Bot“晚点做”的事会排在这里。你离开电脑或到了夜里，它会自己做，结果写进第二天的简报。</div>'
  const jobs = [...S.later].reverse()
  const jt = turnsOf(S.mainId).filter((t) => t.kind === 'job')
  h += '<div class="sec">队列</div><div class="panel">' + (jobs.length ? jobs.map((j) => { const t = j.startedAt ? jt.find((x) => x.at >= j.startedAt) : null; return `<div class="ent"><div class="tm">${hhmm(j.createdAt)}</div><div class="m"><div class="t">${esc(j.title)}</div><div class="w">${st[j.status] || j.status} · ${j.when === 'night' ? '夜里做' : '你离开时做'}${t ? ` · <button class="lk" data-act="proc-open" data-agent="${S.mainId}" data-turn="${t.id}">过程</button>` : ''}</div>${j.result ? `<div class="w" style="color:#cfcfd4;margin-top:6px;white-space:pre-wrap">${esc(j.result.slice(0, 400))}</div>` : ''}
    ${j.status === 'queued' ? `<div class="a"><button class="btn sm" data-act="later-rm" data-id="${j.id}">不做了</button></div>` : ''}</div></div>` }).join('') : '<div class="intro" style="margin:0">队列是空的。</div>') + '</div>'
  const obs = [...S.observations].reverse().slice(0, 30)
  h += '<div class="sec">注意到的新文件</div><div class="panel">' + (obs.length ? obs.map((o) => `<div class="ent"><div class="tm">${hhmm(o.at)}</div><div class="m"><div class="t">${esc(o.text || o.name || o.path)}</div>${o.seen ? '<div class="w">已写进简报</div>' : ''}</div></div>`).join('') : `<div class="intro" style="margin:0">正在留意 ${esc((S.settings?.watch || []).join('、'))} 里的新文件。</div>`) + '</div>'
  return h
}

function pageSettings() {
  const s = S.settings || {}
  return phead('设置') + `<div class="two"><div>
    <div class="sec" style="margin-top:0">大模型</div><div class="panel" id="modelForm"></div>
    <div class="sec">关于你</div><div class="panel"><div class="setrow"><label>怎么称呼你</label><div class="ctl"><input class="inp" id="setCall" value="${esc(s.callMe || '')}" placeholder="比如：summer"></div></div></div>
    <div class="sec">怎么做事</div><div class="panel">
      <div class="setrow"><label>每日简报</label><div class="ctl"><input class="inp" id="setBrief" value="${esc(s.briefTime || '08:00')}" style="max-width:100px"><span class="hint">到点自动整理</span></div></div>
      <div class="setrow"><label>离开多久算不在</label><div class="ctl"><input class="inp" id="setIdle" value="${esc(s.idleMinutes ?? 10)}" style="max-width:80px"><span class="hint">分钟，之后开始做后台任务</span></div></div>
      <div class="setrow"><label>夜里时段</label><div class="ctl"><input class="inp" id="setNf" value="${esc(s.nightFrom ?? 23)}" style="max-width:60px">点到<input class="inp" id="setNt" value="${esc(s.nightTo ?? 6)}" style="max-width:60px">点</div></div>
      <div class="setrow"><label>夜里反思</label><div class="ctl"><button class="sw ${s.reflectAtNight !== false ? 'on' : ''}" id="setRef" data-kind="toggle"></button><span class="hint">每晚回想一次，第二天给你看建议</span></div></div>
      <div class="setrow"><label>留意的文件夹</label><div class="ctl"><input class="inp" id="setWatch" value="${esc((s.watch || []).join('；'))}"></div></div>
      <div style="margin-top:10px"><button class="btn pri" data-act="save-settings">保存</button></div></div>
  </div><div>
    <div class="sec" style="margin-top:0">更新</div><div class="panel" id="updBox"></div>
    <div class="sec">评测</div><div class="panel" id="evalBox"></div>
    <div class="sec">隐私</div><div class="panel">
      <div class="setrow"><label>临时模式</label><div class="ctl"><button class="sw ${S.privateMode ? 'on' : ''}" data-act="priv"></button><span class="hint">开着时不保存记忆</span></div></div>
      <div class="setrow"><label>对话记录</label><div class="ctl"><button class="btn sm warn" data-act="clear">清空和${esc(agentOf(cur).name)}的对话</button></div></div>
      <div class="hint">数据都在这台电脑上：${esc(S.home || '')}</div></div>
  </div></div>`
}

// 智能体: identity, persona and its own mailbox
const TEMPLATES = [
  { name: '出差助理', role: '出差助理', style: '靠谱同事', emailName: 'trip', color: '#4f8cff', intro: '负责出差的一切：订机票酒店、排行程、整理报销单。熟悉用户的出行偏好，订之前先查记忆。' },
  { name: '资料研究员', role: '资料研究员', style: '犀利有梗', emailName: 'research', color: '#9b6bff', intro: '负责查资料、读报告、写综述。只说有出处的话，结论先行，附上链接。' },
  { name: '财务小秘', role: '财务助理', style: '温暖贴心', emailName: 'finance', color: '#2fb380', intro: '负责发票、报销和账单。金额一分不差，涉及付款的事先问用户。' },
]
const COLORS = ['#4f8cff', '#9b6bff', '#2fb380', '#e0a020', '#ef6b5b', '#2bb3c0']
let draftAgent = null
function pageAgent() {
  const isNew = viewArg === 'new'
  const a = isNew ? (draftAgent ||= { name: '', role: '', style: '靠谱同事', intro: '', emailName: '', color: COLORS[agents().length % COLORS.length] }) : agentOf(viewArg)
  if (!isNew) draftAgent = null
  const v = isNew ? a : { ...a, emailName: (a.email || '').split('@')[0] }
  let h = phead(isNew ? '新建 Bot' : 'Bot 设置', isNew ? '' : esc(a.name), isNew ? '' : `<button class="btn" data-act="agent-open" data-id="${a.id}">去聊天</button>`)
  if (!isNew) h += `<div class="prof">${avatar(a, 72)}<div><div class="nm">${esc(a.name)}</div><div class="rl2">${esc(a.role || '')} · ${esc(a.style || '')}</div><div class="ml"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>${esc(a.email || '')}</div></div></div>`
  h += `<div class="two"><div><div class="sec" style="margin-top:0">身份和人设</div><div class="panel">`
  if (isNew) h += `<div class="tpl">${TEMPLATES.map((t, i) => `<button class="chip" data-act="agent-tpl" data-i="${i}">${esc(t.name)}</button>`).join('')}</div>`
  h += `<div class="setrow"><label>名字</label><div class="ctl"><input class="inp" id="agName" value="${esc(v.name)}" placeholder="比如：出差助理"></div></div>
    <div class="setrow"><label>头衔</label><div class="ctl"><input class="inp" id="agRole" value="${esc(v.role || '')}" placeholder="比如：负责出差的一切"></div></div>
    <div class="setrow"><label>性格</label><div class="ctl"><div class="seg2" id="agStyle" data-val="${esc(v.style || '靠谱同事')}">${(S.styles.length ? S.styles : ['靠谱同事', '温暖贴心', '犀利有梗']).map((s) => `<button type="button" class="${s === (v.style || '靠谱同事') ? 'on' : ''}" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div></div></div>
    <div class="setrow top"><label>描述</label><div class="ctl"><textarea class="inp" id="agIntro" placeholder="它负责什么、怎么做事、说话有什么讲究，越具体越好">${esc(v.intro || '')}</textarea></div></div>
    <div class="setrow"><label>邮箱</label><div class="ctl"><input class="inp" id="agMail" value="${esc(v.emailName || '')}" placeholder="英文名" style="max-width:160px"><span class="hint" style="margin:0">@agent.local</span></div></div>
    <div class="setrow"><label>样子</label><div class="ctl shapes" id="agShape" data-val="${esc(shapeOf({ ...v, id: v.id || 'new' }))}">${SHAPES.map((sh) => `<button type="button" class="${sh === shapeOf({ ...v, id: v.id || 'new' }) ? 'on' : ''}" data-v="${sh}">${avatar({ ...v, id: v.id || 'new', shape: sh }, 34)}</button>`).join('')}</div></div>
    ${a.main ? '' : `<div class="setrow"><label>颜色</label><div class="ctl colors" id="agColor" data-val="${esc(v.color || COLORS[0])}">${COLORS.map((c) => `<button type="button" class="${c === v.color ? 'on' : ''}" data-v="${c}" style="background:${c}"></button>`).join('')}</div></div>`}
    <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><button class="btn pri" data-act="agent-save" data-id="${isNew ? '' : a.id}">${isNew ? '创建' : '保存'}</button>${!isNew && !a.main ? `<button class="btn warn" data-act="agent-del" data-id="${a.id}" style="margin-left:auto">删除这个 Bot</button>` : ''}<span class="hint" id="agMsg" style="margin:0"></span></div>
    </div><div class="hint">改动从下一句话开始生效。所有 Bot 共用“我的记忆”和“操作记录”；每个 Bot 有自己的人设、对话、邮箱和日常任务，互相之间可以发邮件分工协作。</div></div>`
  if (isNew) return h + '</div>'
  const inbox = S.inbox.filter((m) => m.agent === a.id).reverse()
  const outbox = S.outbox.filter((m) => (m.agent || S.mainId) === a.id).reverse()
  const list = mailTab === 'inbox' ? inbox : outbox
  const stn = { draft: '草稿', sent: '已发出', delivered: '已送达', recalled: '已召回' }
  h += `<div><div class="sec" style="margin-top:0" id="mailbox">邮箱</div><div class="panel"><div class="tabs"><button class="${mailTab === 'inbox' ? 'on' : ''}" data-act="mail-tab" data-t="inbox">收件箱 ${inbox.length}</button><button class="${mailTab === 'out' ? 'on' : ''}" data-act="mail-tab" data-t="out">发件箱 ${outbox.length}</button></div>
    ${list.length ? list.slice(0, 40).map((m) => `<div class="mail"><div class="h">${mailTab === 'inbox' ? `<b>${esc(m.fromName || m.from)}</b><span>${esc(m.from)}</span>` : `<span>给</span><b>${esc(m.to)}</b>`}<span class="st">${mailTab === 'inbox' ? when(m.at) : `${stn[m.status] || m.status} · ${when(m.sentAt || m.createdAt)}`}</span></div><div class="s">${esc(m.subject)}</div><div class="b">${esc(m.body)}</div></div>`).join('') : `<div class="hint">${mailTab === 'inbox' ? '还没有收到邮件。别的 Bot 可以直接给它发邮件。' : '还没发过邮件。'}</div>`}
    </div><div class="hint">当前版本的邮箱在本机：Bot 之间的邮件会直接送达；发往外部地址的只放进发件箱，不会真的发出去。</div></div></div>`
  return h
}

// model config form (Electron only), used by settings and first run
async function renderModelForm(el, first) {
  if (!el) return
  if (!APP) { el.innerHTML = `<div class="hint" style="margin:0">现在用的是 ${esc(S.model?.provider || '')} / ${esc(S.model?.model || '')}。在天禧客户端里可以切换模型。</div>`; return }
  const cfg = await APP.getConfig()
  const presets = cfg.presets
  const c0 = presets.find((p) => p.id === cfg.provider) || presets[0]
  el.innerHTML = `
    <div class="setrow"><label>服务商</label><div class="ctl"><select class="inp" id="mfP">${presets.map((p) => `<option value="${p.id}" ${p.id === c0.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
    <div class="setrow"><label>模型</label><div class="ctl"><input class="inp" id="mfM" list="mfML" value="${esc(cfg.model || c0.models[0] || '')}"><datalist id="mfML"></datalist></div></div>
    <div class="setrow"><label>接口地址</label><div class="ctl"><input class="inp" id="mfU" value="${esc(cfg.baseURL || c0.baseURL)}"></div></div>
    <div class="setrow"><label>API Key</label><div class="ctl"><input class="inp" id="mfK" type="password" placeholder="${cfg.hasKey ? '已保存，不改就留空' : '粘贴你的 API Key'}"></div></div>
    <div class="hint" id="mfH">${esc(c0.hint || '')}</div>
    ${first ? '' : `<div class="setrow"><label>开机启动</label><div class="ctl"><button class="sw ${cfg.autoLaunch ? 'on' : ''}" id="mfA"></button><span class="hint">开机后在后台待命</span></div></div>`}
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center"><button class="btn pri" id="mfS" style="flex:none;white-space:nowrap">${first ? '开始用天禧' : '保存并重启'}</button><span class="hint" id="mfR" style="min-width:0;overflow-wrap:anywhere"></span></div>`
  const fillModels = (list) => { $('#mfML', el).innerHTML = list.map((m) => `<option value="${esc(m)}">`).join('') }
  // Local routers (Magpie, Ollama) list their models; ask them so the user can pick instead of guessing a name.
  const probe = async (p) => {
    fillModels(p.models)
    if (!p.key || !APP.listModels) return
    $('#mfK', el).placeholder = `不用填，默认就是 ${p.key}`
    const r = await APP.listModels({ provider: p.id, baseURL: $('#mfU', el).value.trim() })
    if (!r.ok) { $('#mfH', el).textContent = `${p.hint} （现在连不上 ${$('#mfU', el).value.trim()}：${r.error}，先确认它已经打开）`; return }
    fillModels(r.models)
    $('#mfH', el).textContent = `${p.hint} 它现在有 ${r.models.length} 个模型，点“模型”一栏可以直接选。`
    if (!r.models.includes($('#mfM', el).value.trim())) $('#mfM', el).value = r.models.find((m) => /:free$/.test(m)) || r.models[0] || ''
  }
  probe(c0)
  $('#mfP', el).onchange = () => { const p = presets.find((x) => x.id === $('#mfP', el).value); $('#mfU', el).value = p.baseURL; $('#mfM', el).value = p.models[0] || ''; $('#mfH', el).textContent = p.hint || ''; $('#mfK', el).placeholder = cfg.hasKey ? '已保存，不改就留空' : '粘贴你的 API Key'; probe(p) }
  const a = $('#mfA', el); if (a) a.onclick = () => a.classList.toggle('on')
  $('#mfS', el).onclick = async () => {
    const out = { provider: $('#mfP', el).value, model: $('#mfM', el).value.trim(), baseURL: $('#mfU', el).value.trim(), apiKey: $('#mfK', el).value.trim() || undefined, autoLaunch: a ? a.classList.contains('on') : undefined }
    if (!out.model || !out.baseURL) { $('#mfR', el).textContent = '模型和接口地址都要填'; return }
    if (!out.apiKey && !cfg.hasKey && !(presets.find((x) => x.id === out.provider) || {}).key) { $('#mfR', el).textContent = '还没填 API Key'; return }
    $('#mfR', el).textContent = '正在检查这个模型能不能用…'
    const r = await APP.saveConfig(out)
    $('#mfR', el).textContent = r.ok ? '好了，正在重启' : ('没连上：' + (r.error || '未知错误'))
  }
}

// ---------- 评测 (Electron only) ----------
let evalTimer = null
async function renderEval(el) {
  if (!el) return
  if (!APP || !APP.runEval) { el.innerHTML = '<div class="hint" style="margin:0">评测要在天禧客户端里运行。</div>'; return }
  const st = await APP.evalStatus()
  const c0 = st.history[0]
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '-'
  let h = `<div class="hint" style="margin:0 0 10px">用 30 个贴近日常的任务测完成率和成功率：整理文件、读文档表格、排日程、写邮件、记忆、联网、后台和撤回。用当前模型跑，每个任务在单独的沙盒文件夹里进行，不碰你的真实文件和数据。跑 3 轮大约要 1～3 小时，会消耗模型额度。</div>`
  if (st.running && c0) {
    h += `<div class="setrow"><label>正在评测</label><div class="ctl" style="flex-direction:column;align-items:flex-start;gap:4px"><span>${c0.done || 0} / ${c0.total || '?'} 次，已通过 ${c0.passed || 0}</span><span class="hint">${esc(c0.current || '准备中')}</span></div></div>
      <div style="margin-top:8px;display:flex;gap:10px"><button class="btn warn" data-act="eval-stop">停止</button><button class="btn" data-act="eval-open" data-dir="${esc(c0.dir)}">打开文件夹</button></div>`
  } else {
    h += `<div class="setrow"><label>每个任务跑</label><div class="ctl"><select class="inp" id="evalRuns" style="max-width:120px"><option value="1">1 轮（快）</option><option value="3" selected>3 轮（准）</option></select></div></div>
      <div style="margin-top:8px"><button class="btn pri" data-act="eval-run">开始评测</button> <span class="hint" id="evalMsg"></span></div>`
  }
  const done = st.history.filter((x) => x.total)
  if (done.length) {
    h += '<div class="sec">历次结果</div>' + done.map((x) => `<div class="ent"><div class="m"><div class="t">${esc(x.provider || '')} / ${esc(x.model || '')}</div>
      <div class="w">${esc((x.startedAt || '').replace('T', ' '))} · ${x.state === 'done' ? '完成' : x.state === 'running' && st.running ? '进行中' : '未跑完'} · ${x.done}/${x.total} 次 · 成功率 ${pct(x.passed, x.done)}</div>
      <div class="a"><button class="btn sm" data-act="eval-open" data-dir="${esc(x.dir)}">${x.state === 'done' ? '看报告' : '打开文件夹'}</button></div></div></div>`).join('')
  }
  el.innerHTML = h
  clearTimeout(evalTimer)
  if (st.running) evalTimer = setTimeout(() => { if (view === 'settings') renderEval($('#evalBox')) }, 4000)
}

// ---------- 更新 (Electron only): the client checks the GitHub repository and fetches only changed files ----------
async function renderUpdate(el, st) {
  if (!el) return
  if (!APP || !APP.updateStatus) { el.innerHTML = '<div class="hint" style="margin:0">在天禧客户端里可以检查更新。</div>'; return }
  st = st || await APP.updateStatus()
  const when = st.checkedAt ? new Date(st.checkedAt).toLocaleString('zh-CN', { hour12: false }) : '还没检查过'
  let line = st.checking ? '正在检查…'
    : st.pending ? `新版本 ${esc(st.pending.version)} 已经下好（只下载了改动的 ${st.downloaded} 个文件），重启后生效`
    : st.error ? `没查成：${esc(st.error)}`
    : st.latest ? '已经是最新版' : ''
  el.innerHTML = `
    <div class="setrow"><label>当前版本</label><div class="ctl"><b>${esc(st.version)}</b><span class="hint">上次检查：${esc(when)}</span></div></div>
    ${st.fellBack ? `<div class="hint" style="color:#ffb3b3">新版本 ${esc(st.fellBack)} 没能启动，已经自动退回。</div>` : ''}
    ${st.pending?.notes ? `<div class="hint">更新内容：${esc(st.pending.notes)}</div>` : ''}
    <div class="setrow"><label>更新来源</label><div class="ctl"><input class="inp" id="updRepo" value="${esc(st.source?.repo || '')}" placeholder="GitHub 仓库，比如 Edifier-Ai/XT-harness"></div></div>
    <div class="setrow"><label>访问令牌</label><div class="ctl"><input class="inp" id="updTok" type="password" placeholder="${st.source?.hasToken ? '已保存，不改就留空' : '公开仓库不用填'}"></div></div>
    <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      ${st.pending ? '<button class="btn pri" data-act="upd-restart" style="flex:none">现在重启</button>' : ''}
      <button class="btn ${st.pending ? '' : 'pri'}" data-act="upd-check" style="flex:none" ${st.checking ? 'disabled' : ''}>检查更新</button>
      <span class="hint" style="min-width:0;overflow-wrap:anywhere">${line}</span></div>
    <div class="hint">天禧启动时和每两小时会自动检查；你不在电脑前时会自己换上新版本。新版本启动失败会自动退回。</div>`
}
function updateToast(st) {
  if (!st || !st.pending || $('#updToast')) return
  const el = document.createElement('div'); el.className = 'toast'; el.id = 'updToast'
  el.innerHTML = `<span>天禧新版本 ${esc(st.pending.version)} 已经下好${st.pending.notes ? '：' + esc(st.pending.notes) : ''}</span><button class="btn sm">现在重启</button><button class="btn sm">稍后</button>`
  const [go, later] = el.querySelectorAll('button')
  go.onclick = () => APP.restart(); later.onclick = () => dismiss(el)
  $('#toasts').appendChild(el)
}
if (APP && APP.onUpdate) {
  APP.onUpdate((st) => { updateToast(st); if (view === 'settings') renderUpdate($('#updBox'), st) })
  APP.updateStatus().then(updateToast).catch(() => {})
}

// ---------- toasts: every action can be taken back right away ----------
function dismiss(el) { if (!el.isConnected) return; if (REDUCED) return el.remove(); el.classList.add('out'); setTimeout(() => el.remove(), 220) }
function toast(entry) {
  const el = document.createElement('div'); el.className = 'toast'
  el.innerHTML = `<span>${esc(entry.title)}</span>${entry.undo ? `<button class="btn sm">${esc(entry.undo.label || '撤回')}</button>` : ''}`
  const b = el.querySelector('button'); if (b) b.onclick = async () => { b.disabled = true; await api('undo', { id: entry.id }); dismiss(el) }
  $('#toasts').appendChild(el); setTimeout(() => dismiss(el), 7000)
}
function toastText(t, act) {
  const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = `<span>${esc(t)}</span>${act ? `<button class="btn sm">${esc(act[0])}</button>` : ''}`
  if (act) el.querySelector('button').onclick = () => { act[1](); dismiss(el) }
  $('#toasts').appendChild(el); setTimeout(() => dismiss(el), 5000)
}
function notify(title, body) {
  try { if (document.hidden && 'Notification' in window && Notification.permission !== 'denied') new Notification(title, { body, silent: false }).onclick = () => APP?.show() } catch {}
}

// ---------- state + events ----------
let refreshT = null
async function refresh() {
  const prevBrief = S.brief?.at, prevRef = S.reflections[0]?.id
  S = await api('state')
  if (!agents().some((a) => a.id === cur)) cur = S.mainId
  for (const e of S.ledger) {
    if (!seenLedger.has(e.id)) { seenLedger.add(e.id); if (!firstLoad && e.status === 'done') toast(e) }
  }
  if (!firstLoad && S.brief?.at && S.brief.at !== prevBrief) { notify('每日简报', S.brief.summary || '今天的简报准备好了'); if (view !== 'brief') toastText('今天的简报准备好了', ['去看', () => setView('brief')]) }
  if (!firstLoad && S.reflections[0] && S.reflections[0].id !== prevRef && view !== 'reflect') toastText(`${agentOf(S.mainId).name}反思完了`, ['去看', () => setView('reflect')])
  firstLoad = false
  renderAll(true)
}
const soon = () => { clearTimeout(refreshT); refreshT = setTimeout(refresh, 150) }
function renderAll(keep) {
  renderRail()
  const vis = view === 'chat' ? $('#vChat') : $('#vPage')
  if (vis.dataset.shown !== view) { vis.dataset.shown = view; (view === 'chat' ? $('#vPage') : $('#vChat')).dataset.shown = ''; replay(vis, 'fade') }
  if (view === 'chat') { renderHead(); renderMsgs(keep); renderChips() } else renderPage()
  renderProc()
}

function connect() {
  const es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN))
  es.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.type === 'hello') { refresh(); return }
    if (m.type === 'item') {
      const aid = m.item.agent || S.mainId
      const l = (S.transcripts[aid] ||= [])
      const i = l.findIndex((t) => t.id === m.item.id)
      if (i >= 0) l[i] = m.item; else l.push(m.item)
      if (m.item.role === 'tool' && !m.item.internal && aid === cur && view === 'chat' && procPref === 'auto' && !$('#app').classList.contains('procon')) { procSel = null; $('#app').classList.add('procon') }
      if (view === 'chat' && aid === cur) { renderMsgs(true); renderHead() } else if (view === 'brief' || view === 'reflect') renderPage()
      renderRail(); renderProc()
    } else if (m.type === 'delta') {
      const t = (S.transcripts[m.agent || S.mainId] || []).find((x) => x.id === m.id)
      if (t) { t.text = m.text; const el = document.getElementById('m_' + m.id); if (el) { el.innerHTML = md(m.text); const f = $('#feed'); if (f.scrollHeight - f.scrollTop - f.clientHeight < 140) f.scrollTop = f.scrollHeight } else if (view === 'chat' && (m.agent || S.mainId) === cur) renderMsgs(true) }
    } else if (m.type === 'status') {
      const aid = m.agent || S.mainId
      if (busy(aid) && m.status === 'idle') { doneAt[aid] = Date.now(); setTimeout(() => renderAll(true), 5200) }
      S.agentStatus[aid] = m.status; renderAll(true)
    }
    else if (m.type === 'approval') {
      S.approvals.push(m.approval); soon()
      const a = agentOf(m.approval.agent)
      notify(`${a.name}需要你确认`, m.approval.reason || toolLabel(m.approval.tool))
      if (APP && document.hidden) APP.show()
      if (view !== 'chat' || cur !== a.id) toastText(`${a.name}需要你确认一件事`, ['去看', () => { cur = a.id; store.set('agent', cur); setView('chat') }])
    }
    else if (m.type === 'approval-gone') { S.approvals = S.approvals.filter((a) => a.id !== m.id); renderAll(true) }
    else if (m.type === 'private') { S.privateMode = m.on; renderAll(true) }
    else if (m.type === 'mail') soon()
    else if (m.type === 'turn-end' || m.type === 'store') soon()
  }
  es.onerror = () => { $('#cSub').textContent = '正在重新连接…' }
}

// ---------- input ----------
const inp = $('#inp')
const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(180, inp.scrollHeight) + 'px'; renderHead() }
inp.addEventListener('input', grow)
inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() } })
async function say(text, display) { text = String(text || '').trim(); if (text) await api('say', { text, display, agent: cur }) }
async function send() {
  const v = inp.value.trim()
  if (!v) { if (busy(cur)) api('cancel', { agent: cur }); return }
  inp.value = ''; grow(); await say(v)
}
$('#send').onclick = () => { if (busy(cur) && !inp.value.trim()) api('cancel', { agent: cur }); else send() }
const plusMenu = $('#plusMenu')
$('#bPlus').onclick = (e) => { e.stopPropagation(); plusMenu.hidden = !plusMenu.hidden; if (!plusMenu.hidden) replay(plusMenu, 'in') }
document.addEventListener('click', (e) => { if (!plusMenu.hidden && !e.target.closest('#plusMenu')) plusMenu.hidden = true })
$('#q').addEventListener('input', (e) => { query = e.target.value; renderRail() })
$('#bPriv').onclick = () => { plusMenu.hidden = true; api('private', { on: !S.privateMode }) }
$('#pmBadge').onclick = () => api('private', { on: false })
$('#bUndo').onclick = async () => { plusMenu.hidden = true; const r = await api('undo-last', {}); toastText(r.entry ? '已撤回：' + r.entry.title : '没有可以撤回的事') }
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view !== 'chat') setView(MINE.includes(view) && view !== 'me' ? 'me' : 'chat')
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select() }
})

document.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-go]')
  if (go) { const g = go.dataset.go; setView(view === g && !go.closest('.pg') ? 'chat' : g); return }
  const el = e.target.closest('[data-act]')
  if (!el) {
    const seg = e.target.closest('.seg2 button'); if (seg) { const p = seg.parentElement; p.dataset.val = seg.dataset.v; p.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg)) }
    const shb = e.target.closest('.shapes button'); if (shb) { const p = shb.parentElement; p.dataset.val = shb.dataset.v; p.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === shb)) }
    const col = e.target.closest('.colors button'); if (col) { const p = col.parentElement; p.dataset.val = col.dataset.v; p.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === col)) }
    const sw = e.target.closest('.sw[data-kind=toggle]'); if (sw) sw.classList.toggle('on')
    return
  }
  const act = el.dataset.act
  if (act === 'agent-open') { cur = el.dataset.id; store.set('agent', cur); procSel = null; setView('chat'); inp.focus() }
  else if (act === 'agent-new') { draftAgent = null; setView('agent', 'new') }
  else if (act === 'agent-profile') setView('agent', cur)
  else if (act === 'agent-mail') { mailTab = 'inbox'; setView('agent', cur); setTimeout(() => $('#mailbox')?.scrollIntoView({ block: 'start' }), 30) }
  else if (act === 'agent-tpl') { draftAgent = { ...TEMPLATES[+el.dataset.i] }; renderPage() }
  else if (act === 'agent-save') {
    const out = { id: el.dataset.id || undefined, name: $('#agName').value.trim(), role: $('#agRole').value.trim(), style: $('#agStyle').dataset.val, intro: $('#agIntro').value.trim(), emailName: $('#agMail').value.trim() }
    const c = $('#agColor'); if (c) out.color = c.dataset.val
    const shp = $('#agShape'); if (shp) out.shape = shp.dataset.val
    if (!out.name) { $('#agMsg').textContent = '起个名字吧'; return }
    const r = await api('agents/save', { agent: out })
    if (r.error) { $('#agMsg').textContent = r.error; return }
    draftAgent = null
    await refresh()
    if (!el.dataset.id) { cur = r.agent.id; store.set('agent', cur); setView('chat') } else toastText('已保存，下一句话开始生效')
  }
  else if (act === 'agent-del') { if (confirm('删除这个 Bot？它的对话记录会保留在本机数据里。')) { await api('agents/remove', { id: el.dataset.id }); cur = S.mainId; store.set('agent', cur); await refresh(); setView('chat') } }
  else if (act === 'mail-tab') { mailTab = el.dataset.t; renderPage() }
  else if (act === 'proc-toggle') { $('#app').classList.contains('procon') ? closeProc() : openProc(null) }
  else if (act === 'proc-close') closeProc()
  else if (act === 'ptab') { procTab = el.dataset.t; renderProc() }
  else if (act === 'proc-open') { procTab = 'computer'; if (view !== 'chat') { cur = el.dataset.agent; setView('chat') } openProc({ agent: el.dataset.agent, turn: el.dataset.turn }) }
  else if (act === 'go') setView(el.dataset.v)
  else if (act === 'ask') { await api('approval', { id: el.dataset.id, allow: !!el.dataset.allow }) }
  else if (act === 'brief-run') { await api('brief/run', {}); setTimeout(soon, 400) }
  else if (act === 'brief-do') { el.disabled = true; await api('brief/act', { id: el.dataset.id, k: +el.dataset.k }); soon() }
  else if (act === 'reflect-run') { await api('reflect/run', {}); setTimeout(soon, 400) }
  else if (act === 'prop') { el.disabled = true; const r = await api('reflect/apply', { rid: el.dataset.r, pid: el.dataset.p, accept: !!el.dataset.ok }); if (r.error) toastText(r.error); soon() }
  else if (act === 'ui-choice') {
    const t = transcript(cur).find((x) => x.id === el.dataset.t); const o = t.ui.blocks[+el.dataset.b].options[+el.dataset.k]
    usedUI.add(t.id); await say(o.say || o.label, o.label)
  }
  else if (act === 'ui-submit') {
    const t = transcript(cur).find((x) => x.id === el.dataset.t); const b = t.ui.blocks[+el.dataset.b]
    const vals = formValues(el.closest('.form'))
    const shown = (b.fields || []).map((f) => `${f.label || f.key}：${vals[f.key] === true ? '开' : vals[f.key] === false ? '关' : vals[f.key]}${f.unit && f.kind === 'range' ? f.unit : ''}`).join('，')
    usedUI.add(t.id); await say(`${b.submit.say || b.submit.label} ${JSON.stringify(vals)}`, `${b.submit.label}：${shown}`)
  }
  else if (act === 'chip') {
    const s = el.dataset.say
    if (s) say(s, el.dataset.label); else { inp.value = el.dataset.label === '记住一件事' ? '记住：' : el.dataset.label === '帮我排个行程' ? '帮我排一下行程：' : `请给${agentOf(S.mainId).name}发邮件，`; grow(); inp.focus() }
  }
  else if (act === 'undo') { el.disabled = true; await api('undo', { id: el.dataset.id }) }
  else if (act === 'undo-many') { el.disabled = true; for (const i of el.dataset.ids.split(',').reverse()) { try { await api('undo', { id: i }) } catch {} } }
  else if (act === 'undo-last') { await api('undo-last', {}) }
  else if (act === 'mem-tab') { memTab = el.dataset.t; renderPage() }
  else if (act === 'mem-pick') { memSel = el.dataset.id || null; if (memTab === 'list' && memSel) memTab = 'map'; renderPage() }
  else if (act === 'mem-goto') { memSel = el.dataset.id; memTab = 'map'; setView('memory') }
  else if (act === 'mem-add') { const v = $('#memNew').value.trim(); if (v) { await api('memory/add', { text: v }); $('#memNew').value = '' } }
  else if (act === 'mem-forget') { await api('memory/forget', { id: el.dataset.id }); memSel = null }
  else if (act === 'mem-edit') {
    const t = $('#memText')
    if (t.isContentEditable) { await api('memory/edit', { id: el.dataset.id, text: t.textContent.trim() }); t.contentEditable = 'false'; el.textContent = '改一下' }
    else { t.contentEditable = 'true'; t.focus(); document.getSelection().selectAllChildren(t); el.textContent = '保存' }
  }
  else if (act === 'later-rm') { await api('later/remove', { id: el.dataset.id }); soon() }
  else if (act === 'priv') { await api('private', { on: !S.privateMode }) }
  else if (act === 'clear') { if (confirm(`清空和${agentOf(cur).name}的对话记录？记忆和操作记录不受影响。`)) { await api('transcript/clear', { agent: cur }); soon() } }
  else if (act === 'eval-run') { const r = await APP.runEval({ runs: +$('#evalRuns').value }); if (!r.ok) $('#evalMsg').textContent = r.error; setTimeout(() => renderEval($('#evalBox')), 800) }
  else if (act === 'upd-restart') APP.restart()
  else if (act === 'upd-check') {
    const repo = $('#updRepo').value.trim(), token = $('#updTok').value.trim()
    await APP.updateSource({ repo, token: token || undefined })
    el.disabled = true; el.textContent = '正在检查…'
    renderUpdate($('#updBox'), await APP.updateCheck())
  }
  else if (act === 'eval-stop') { await APP.evalStop(); renderEval($('#evalBox')) }
  else if (act === 'eval-open') { APP.evalOpen(el.dataset.dir) }
  else if (act === 'save-settings') {
    await api('settings', { callMe: $('#setCall').value.trim(), briefTime: $('#setBrief').value.trim(), idleMinutes: +$('#setIdle').value || 10, nightFrom: +$('#setNf').value, nightTo: +$('#setNt').value, reflectAtNight: $('#setRef').classList.contains('on'), watch: $('#setWatch').value.split(/[;；,，\n]/).map((x) => x.trim()).filter(Boolean) })
    toastText('设置已保存'); soon()
  }
})
document.addEventListener('input', (e) => { if (e.target.type === 'range') { const s = e.target.nextElementSibling; if (s) s.textContent = e.target.value + ' ' + (e.target.dataset.unit || '') } })

// ---------- boot ----------
;(async () => {
  if (APP) {
    $('#wctl').hidden = false
    document.querySelectorAll('[data-win]').forEach((b) => { b.onclick = () => APP.win(b.dataset.win) })
    const cfg = await APP.getConfig()
    if (!cfg.hasKey) { $('#setup').classList.add('on'); renderModelForm($('#setupForm'), true); return }
  }
  const start = new URLSearchParams(location.search).get('view')
  if (start) view = start
  $('#vChat').hidden = view !== 'chat'; $('#vPage').hidden = view === 'chat'
  connect()
  setInterval(() => { if (view === 'brief') renderPage() }, 60000)
})()
