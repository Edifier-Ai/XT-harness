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
let procPref = store.get('proc', 'open')    // the right panel stays open beside the chat unless you close it
let procSel = null                          // { agent, turn } pinned in the process bar; null follows the latest
let procTab = 'detail'                      // the right panel: detail (routines) | files | computer (steps)
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
const toolLabel = (n) => { if (TOOL[n]) return TOOL[n]; const m = /^mcp__([\w-]+?)__(.+)$/.exec(String(n || '')); if (m) { const a = (S.apps?.apps || []).find((x) => (x.catalogId || '') === m[1] || ('app_' + x.id.slice(-6)) === m[1]); return `用${a?.name || m[1]}：${m[2].replace(/_/g, ' ')}` } return String(n || '').replace(/_/g, ' ') }
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
const SHAPES = ['circle', 'blob', 'flower', 'egg', 'shield', 'square', 'lump']
const OLDSHAPE = { hex: 'flower', tri: 'shield', rect: 'square', cloud: 'lump' }
const hashNum = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) }
const shapeOf = (a) => { const s = OLDSHAPE[a.shape] || a.shape; return SHAPES.includes(s) ? s : a.main ? 'circle' : SHAPES[1 + hashNum(a.id) % (SHAPES.length - 1)] }
const COLORS = ['#3f7fe6', '#f2902e', '#53b8a5', '#4fc06d', '#e5508f', '#ee6a2b', '#8b6cf0', '#f2f2f2']
const colorOf = (a) => a.main && (!a.color || a.color === '#e2502e') ? '#f2f2f2' : (a.color || COLORS[hashNum(a.id) % 7])
// idle · think (busy, nothing done yet) · work (using tools) · wait (needs you) · done (just finished)
function stateOf(aid) {
  if (S.approvals.some((x) => x.agent === aid)) return 'wait'
  if (!busy(aid)) return doneAt[aid] && Date.now() - doneAt[aid] < 5000 ? 'done' : 'idle'
  const t = turnsOf(aid).filter((x) => x.running).pop()
  return t && toolsOf(t).length ? 'work' : 'think'
}
// Each bot is one soft shape with two dark dash eyes, like the Grok Bot roster.
const BODY = {
  circle: '<circle cx="50" cy="50" r="46"/>',
  blob: '<path d="M22 22c14-10 44-12 60-4 14 7 16 22 13 36-3 16-16 26-36 28-22 2-46-4-52-22-5-15 3-29 15-38z"/>',
  flower: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const t = i * Math.PI / 4; return `<circle cx="${(50 + Math.cos(t) * 30).toFixed(1)}" cy="${(50 + Math.sin(t) * 30).toFixed(1)}" r="17"/>` }).join('') + '<circle cx="50" cy="50" r="32"/>',
  egg: '<ellipse cx="50" cy="52" rx="40" ry="44" transform="rotate(-14 50 52)"/>',
  shield: '<path d="M30 10c16-6 44 2 56 18 10 14 8 34-2 48-11 15-30 20-46 14C20 84 8 66 8 46 8 28 16 15 30 10z" transform="rotate(-10 50 50)"/>',
  square: '<rect x="12" y="14" width="76" height="72" rx="22" transform="rotate(-14 50 50)"/>',
  lump: '<path d="M28 16c8-9 24-10 33-3 11-6 27 2 29 15 10 7 10 24 0 31 1 13-12 23-25 20-9 9-26 8-33-3-13 0-22-13-18-25-9-9-6-25 6-30 1-2 4-4 8-5z"/>',
}
const EYES = { circle: [62, 30, 76, 26], blob: [38, 40, 56, 37], flower: [40, 44, 58, 41], egg: [42, 36, 60, 32], shield: [38, 38, 56, 34], square: [40, 42, 58, 38], lump: [38, 38, 56, 35] }
// still: no state motion or badge (an avatar repeated in a list of steps)
function avatar(a, size = 36, still = false, badge = true) {
  const st = still ? 'idle' : stateOf(a.id), sh = shapeOf(a)
  const [x1, y1, x2, y2] = EYES[sh]
  const eye = (x, y) => `<rect x="${x - 4.2}" y="${y - 8.5}" width="8.4" height="17" rx="4.2" transform="rotate(-16 ${x} ${y})" fill="#141414"/>`
  const b = !badge || still ? '' : st === 'wait' ? '<i class="abadge w">?</i>' : st === 'done' ? `<i class="abadge d">${CHECK}</i>` : a.main && size <= 48 ? '<i class="abadge p" title="主 Bot"><svg width="8" height="8" viewBox="0 0 10 10"><path d="M5 .8l1.2 2.7 2.9.3-2.2 1.9.7 2.9L5 7.1 2.4 8.6l.7-2.9L.9 3.8l2.9-.3z" fill="#fff"/></svg></i>' : ''
  return `<span class="av s-${st}" style="width:${size}px;height:${size}px" data-sh="${sh}"><svg viewBox="0 0 100 100" width="${size}" height="${size}"><g class="bd" fill="${colorOf(a)}">${BODY[sh]}</g><g class="pu"><g class="eyes">${eye(x1, y1)}${eye(x2, y2)}</g></g></svg>${b}</span>`
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

// ---------- rail: the roster, grouped by each bot's tag ----------
const MINE = ['me', 'brief', 'memory', 'reflect', 'ledger', 'later']
let query = ''
function nowDoing(aid) {
  const t = turnsOf(aid).filter((x) => x.running).pop(); if (!t) return ''
  const now = [...toolsOf(t)].reverse().find((x) => x.state === 'running') || toolsOf(t).pop()
  return now ? `正在${toolLabel(now.name)}${toolDetail(now.args) ? ' · ' + toolDetail(now.args) : ''}` : '正在想'
}
const openCount = () => {
  const open = S.brief && S.brief.date === todayStr() ? (S.brief.items || []).filter((i) => i.kind === 'decide' && i.status === 'open').length : 0
  const r0 = S.reflections[0]; const nr = r0 ? [...r0.proposals, ...r0.lessons].filter((p) => p.status === 'open').length : 0
  return { open, nr }
}
function renderRail() {
  const q = query.trim().toLowerCase()
  const list = agents().filter((a) => !q || (a.name + (a.role || '') + (a.tag || '')).toLowerCase().includes(q))
  const groups = []
  for (const a of list) { const g = (a.tag || '').trim() || '未分组'; let x = groups.find((y) => y.g === g); if (!x) groups.push(x = { g, l: [] }); x.l.push(a) }
  groups.sort((x, y) => (x.g === '未分组') - (y.g === '未分组'))
  const row = (a) => {
    const items = transcript(a.id).filter((i) => !i.internal && (i.role === 'user' || i.role === 'assistant' || i.kind === 'mail') && (i.text || i.mail))
    const last = items[items.length - 1]
    const st = stateOf(a.id)
    const preview = st === 'wait' ? '需要你确认一件事' : busy(a.id) ? nowDoing(a.id) : last ? (last.role === 'user' ? '你：' + last.text : last.kind === 'mail' ? '收到邮件：' + (last.mail?.subject || '') : last.text) : (a.role || '')
    const unread = a.id === cur && view === 'chat' ? 0 : items.filter((i) => i.role !== 'user' && (!seen[a.id] || i.at > seen[a.id])).length
    return `<button class="ag ${a.id === cur && view === 'chat' ? 'on' : ''} ${st === 'wait' ? 'need' : ''}" data-act="agent-open" data-id="${a.id}" title="${esc(busy(a.id) ? nowDoing(a.id) : a.role || '')}">${avatar(a, 42)}
      <span class="tx"><b><span class="nm">${esc(a.name)}</span>${busy(a.id) ? '<span class="tdots"><i></i><i></i><i></i></span>' : ''}</b><span class="pv">${esc(String(preview).replace(/[*`#]/g, '').replace(/\s+/g, ' ').slice(0, 48))}</span></span>
      ${unread ? '<span class="udot"></span>' : ''}</button>`
  }
  $('#agentList').innerHTML = groups.map((x) => `<div class="grp">${esc(x.g)}</div>${x.l.map(row).join('')}`).join('') || '<div class="hint" style="padding:10px 14px">没有找到</div>'
  const { open, nr } = openCount()
  setCount($('#nMe'), open + nr)
  $('#meAv').textContent = userInitial()
  $('#meBtn').classList.toggle('on', MINE.includes(view) || !$('#umenu').hidden)
  $('#appIc').innerHTML = connectedIcons().slice(0, 3).map((k) => appIcon(k, 18, k)).join('')
  $('#bUpd').hidden = !updSt?.pending
}

// ---------- chat ----------
function renderHead() {
  const a = agentOf(cur)
  $('#cAvatar').innerHTML = avatar(a, 28, false, false)
  $('#cName').textContent = a.name
  $('#pmBadge').classList.toggle('on', !!S.privateMode)
  $('#bPriv').classList.toggle('on', !!S.privateMode)
  $('#ring').classList.toggle('priv', !!S.privateMode)
  $('#inp').placeholder = `给 ${a.name} 发消息`
  const send = $('#send'); send.classList.toggle('stop', busy(cur)); send.classList.toggle('hot', !busy(cur) && !!$('#inp').value.trim())
  send.title = busy(cur) ? '停下' : $('#inp').value.trim() ? '发送' : '语音对话'
}

// one line in the transcript for everything the bot did in a turn; the steps open on its computer
function procChip(t) {
  const tools = toolsOf(t)
  const sel = procSel && procSel.turn === t.id && panelOn() && procTab === 'computer'
  const ic = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 20.5h7M12 17v3.5"/></svg>'
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

// a time stamp between messages: at a new day, or after a long pause
const stamp = (iso) => { const x = new Date(iso); return `${x.getMonth() + 1}月${x.getDate()}日周${WEEK[x.getDay()]} ${hhmm(iso)}` }
const reacts = store.get('reacts', {})
const MACTS = `<div class="macts"><button data-act="m-react" title="点个赞"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0"/><path d="M9.5 9.5v.5M14.5 9.5v.5" stroke-width="2.2"/></svg></button><button data-act="m-quote" title="引用回复"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/></svg></button><button data-act="m-copy" title="复制"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg></button></div>`
const L = 'ABCDEFGH'
// a question with lettered answers, like the bot asking in a chat (also used for approvals)
const qcard = (title, body, opts, k) => `<div class="qcard" data-k="${k}"><div class="qt">${title}</div>${body || ''}<div class="qopts">${opts.map((o, i) => `<button class="qopt ${o.cls || ''}" ${o.attrs || ''}><span class="ql">${L[i]}</span><span>${esc(o.label)}</span></button>`).join('')}</div></div>`

// a new bot introduces itself the way Grok Bot does, then offers a first task
function welcome(a) {
  const me = S.settings?.callMe || '你'
  const mbub = (k, h) => `<div class="mrow" data-k="${k}"><div class="body"><div class="bub">${h}</div></div></div>`
  let h = `<div class="day" data-k="w0"><span>${stamp(new Date().toISOString())}</span></div>`
  h += mbub('w1', `<p>嗨，${esc(me)}！我是 ${esc(a.name)}，${esc(a.main ? '你的私人助理' : a.role || '你的私人助理')}。${a.main ? '我可以帮你处理工作和日常生活中的事情，替你分担琐事。' : esc(a.intro || '').slice(0, 120)}</p>`)
  h += mbub('w2', `<p>先简单介绍一下我自己：</p><ul><li>你不在的时候，我也会在这台电脑上继续干活。</li><li>我能用你的日程、待办、文件和我自己的邮箱，做完的每件事都记在操作记录里，能撤回。</li><li>我会记住你说过的偏好，每条都带出处，你随时能改。</li></ul>`)
  h += `<div class="mrow" data-k="w3"><div class="body">${qcard('要不要我先找几件能帮你做的事？我只会看看你的日程、待办和下载文件夹，不会发送、删除或改动任何东西。', '', [
    { label: '推荐第一个任务', attrs: `data-act="chip" data-say="看看我的日程、待办和下载文件夹，只看不改，推荐三件你现在就能帮我做的事。" data-label="推荐第一个任务"` },
    { label: '看看我今天的安排', attrs: `data-act="chip" data-say="我今天有哪些日程和待办？" data-label="看看我今天的安排"` },
    { label: '整理下载文件夹', attrs: `data-act="chip" data-say="帮我整理一下下载文件夹，按类型归档" data-label="整理下载文件夹"` },
  ], 'w3q')}</div></div>`
  return h
}

function renderMsgs(keepScroll) {
  const feed = $('#feed'); const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80
  const a = agentOf(cur)
  const turns = turnsOf(cur).filter((t) => !t.internal)
  let h = '', lastAt = 0, day = ''
  if (!turns.length) h = welcome(a)
  for (const t of turns) {
    const at = Date.parse(t.at)
    if (dayOf(t.at) !== day || at - lastAt > 3600e3) h += `<div class="day" data-k="d${t.id}"><span>${stamp(t.at)}</span></div>`
    day = dayOf(t.at); lastAt = at
    if (t.head?.role === 'user') h += `<div class="mrow me" id="m_${t.head.id}" data-k="${t.head.id}"><div class="body"><div class="bub" data-mid="${t.head.id}">${esc(t.head.text)}</div></div></div>`
    let body = ''
    if (t.kind === 'mail' && t.head.mail) {
      const m = t.head.mail
      body += `<div class="mailcard" data-k="mail${t.id}"><div class="h"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>收到 ${esc(m.fromName || m.from)} 的邮件 · ${hhmm(t.at)}</div><div class="s">${esc(m.subject)}</div><div class="b">${esc(m.body)}</div></div>`
    }
    const chip = procChip(t); if (chip) body += chip
    for (const it of t.items) {
      if (it.role === 'assistant' && it.text) body += `<div class="bw"><div class="bub ${it.live ? 'live' : ''}" id="m_${it.id}" data-k="${it.id}" data-mid="${it.id}">${md(it.text)}</div>${it.live ? '' : MACTS}${reacts[it.id] ? '<span class="rx">👍</span>' : ''}</div>`
      else if (it.role === 'ui') body += `<div class="uiw" data-k="${it.id}">${renderUI(it)}</div>`
      else if (it.role === 'error') body += `<div class="bub err" data-k="${it.id}">${esc(it.text)}</div>`
    }
    if (t.running && !t.items.some((i) => i.role === 'assistant' && i.text) && !toolsOf(t).length) body += '<div class="bub typing"><i></i><i></i><i></i></div>'
    if (body) h += `<div class="mrow" data-k="a${t.id}"><div class="body">${body}</div></div>`
  }
  for (const x of S.approvals.filter((y) => y.agent === cur)) h += `<div class="mrow" data-k="ask${x.id}"><div class="body">${askCard(x)}</div></div>`
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
  const yes = `data-act="ask" data-id="${x.id}" data-allow="1"`, no = `data-act="ask" data-id="${x.id}"`
  if (x.tool === 'mail_send') {
    const m = (S.outbox || []).find((y) => y.id === x.args?.id)
    if (m) return qcard('我写好了这封邮件，你同意了我再发出去。', `<div class="mailask"><div class="mf"><span>发件人</span>${esc(m.from || '')}</div><div class="mf"><span>收件人</span>${esc(m.to)}</div><div class="mf"><span>主题</span><b>${esc(m.subject)}</b></div><div class="mb">${esc(m.body)}</div>${x.args?.reason ? `<div class="r">${esc(x.args.reason)}</div>` : ''}</div>`,
      [{ label: '发送邮件', attrs: yes, cls: 'pri' }, { label: '先不发', attrs: no }], 'ask' + x.id)
  }
  const pv = Object.entries(x.args || {}).filter(([k]) => k !== 'reason').map(([k, v]) => `<span class="k">${esc(k)}</span>  ${esc(typeof v === 'string' ? v : JSON.stringify(v))}`).join('\n')
  return qcard(`我要${esc(toolLabel(x.tool))}，需要你点头。`, `${x.reason || x.args?.reason ? `<div class="r">${esc(x.reason || x.args?.reason)}</div>` : ''}${pv ? `<div class="pv">${pv}</div>` : ''}`,
    [{ label: '允许一次', attrs: yes, cls: 'pri' }, { label: '不行', attrs: no }], 'ask' + x.id)
}
function renderChips() {}

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

// ---------- right panel: the bot — 详情 (its routines), 资料库 (what it made), 电脑 (what it is doing) ----------
const panelOn = () => view === 'chat' && procPref !== 'closed'
function openProc(sel, tab) { if (sel !== undefined) procSel = sel; if (tab) procTab = tab; procPref = 'open'; store.set('proc', procPref); $('#app').classList.add('procon'); renderProc(); if (view === 'chat') renderMsgs(true) }
function closeProc() { $('#app').classList.remove('procon'); procPref = 'closed'; store.set('proc', procPref); procSel = null; if (view === 'chat') renderMsgs(true) }
function procTarget() {
  if (procSel) { const t = turnsOf(procSel.agent).find((x) => x.id === procSel.turn); if (t) return t }
  return [...turnsOf(cur)].reverse().find((t) => !t.internal && (toolsOf(t).length || t.running)) || null
}
let tagEdit = false
function renderProc() {
  $('#app').classList.toggle('procon', panelOn())
  if (!panelOn()) return
  const a = agentOf(cur), B = $('#procBody')
  const tabs = [['detail', '详情'], ['files', '资料库'], ['computer', '电脑']]
  let h = `<div class="pf"><button class="pav" data-act="agent-profile" title="Bot 设置">${avatar(a, 76, false, false)}</button><button class="pnm" data-act="agent-profile">${esc(a.name)}</button>
    ${tagEdit ? `<input class="ptag-in" id="tagIn" value="${esc(a.tag || '')}" placeholder="比如：生活、工作" maxlength="12">` : `<button class="ptag" data-act="tag-edit">${a.tag ? esc(a.tag) : '添加标签'}</button>`}
    <div class="ptabs" id="ptabs">${tabs.map(([k, l]) => `<button data-act="ptab" data-t="${k}" class="${procTab === k ? 'on' : ''}">${l}${k === 'computer' && busy(a.id) ? '<i class="live"></i>' : ''}</button>`).join('')}</div></div>`
  h += `<div class="pcont">${procTab === 'files' ? renderFiles(a) : procTab === 'computer' ? renderComputer() : renderDetail(a)}</div>`
  B.innerHTML = h
  const sig = cur + ':' + procTab + ':' + (procTab === 'computer' ? procTarget()?.id || '' : '')
  const switched = B.dataset.sig !== sig
  B.dataset.sig = sig
  const C = B.querySelector('.pcont')
  reveal(C, '.step[data-k], .chg, .rcard, .lib .li', (el) => 'p:' + (el.dataset.k || hashText(el.textContent)), { quiet: switched, step: 45 })
  if (switched) replay(C, 'swap')
  if (tagEdit) { const i = $('#tagIn'); i.focus(); i.select() }
}

// 详情: routines — what the bot does on its own, on a schedule or when something happens
function renderDetail(a) {
  const st = S.settings || {}
  const card = (t, w, key, on, extra = '') => `<div class="rcard" data-k="r${key}"><div class="m"><div class="t">${t}</div><div class="w">${w}</div>${extra}</div>${key ? `<button class="tg ${on ? 'on' : ''}" data-act="rt-toggle" data-key="${key}" title="${on ? '关掉' : '打开'}"></button>` : ''}</div>`
  let h = '<div class="psec">例行任务</div>'
  if (a.main) {
    h += card('每日简报', `每天 ${esc(st.briefTime || '08:00')} 左右`, 'briefOn', st.briefOn !== false, '<div class="ra"><button class="lk" data-act="brief-run">现在整理</button><button class="lk" data-go="brief">看简报</button></div>')
    h += card('夜里反思', `每天 ${esc(st.nightFrom ?? 23)}:00 后，你不在时`, 'reflectAtNight', st.reflectAtNight !== false, '<div class="ra"><button class="lk" data-act="reflect-run">现在反思</button><button class="lk" data-go="reflect">看反思</button></div>')
    h += card('留意新文件', `一直在 · ${esc((st.watch || []).map((x) => x.replace(/^~[\\/]/, '')).join('、') || '下载、桌面')}`, 'watchOn', st.watchOn !== false)
    const jobs = S.later.filter((j) => j.status === 'queued' || j.status === 'running')
    for (const j of jobs) h += card(esc(j.title), `${j.status === 'running' ? '正在做' : '排队中'} · ${j.when === 'night' ? '夜里做' : '你离开时做'}`, '', true, j.status === 'queued' ? `<div class="ra"><button class="lk" data-act="later-rm" data-id="${j.id}">不做了</button></div>` : '')
  } else h += `<div class="pempty">还没有例行任务。跟${esc(a.name)}说“每天早上帮我……”就会加上。</div>`
  h += `<div class="psec">关于</div><div class="rcard col"><div class="kv2"><span>头衔</span><b>${esc(a.role || '—')}</b><span>性格</span><b>${esc(a.style || '靠谱同事')}</b><span>邮箱</span><b>${esc(a.email || '')}</b></div>${a.intro ? `<div class="w" style="margin-top:8px">${esc(a.intro)}</div>` : ''}<div class="ra"><button class="lk" data-act="agent-profile">编辑人设</button><button class="lk" data-act="agent-mail">看邮箱</button></div></div>`
  return h
}

// 资料库: files the bot made or touched, newest first, picked out of its transcript and generated cards
function libraryOf(aid) {
  const out = new Map()
  const add = (p, at, title) => { p = String(p || '').trim(); if (!p || out.has(p) || /^https?:/.test(p)) return; out.set(p, { p, at, title }) }
  for (const it of [...transcript(aid)].reverse()) {
    if (it.role === 'tool' && it.state !== 'error' && /^(write|edit|file_move|present)$/.test(it.name)) add(it.args?.to || it.args?.path || it.args?.file_path, it.at)
    if (it.role === 'ui') for (const b of it.ui?.blocks || []) { if (b.type === 'files') for (const f of b.items || []) add(typeof f === 'string' ? f : f.path, it.at, f.note); if (b.type === 'image' && b.src) add(b.src, it.at, b.caption) }
  }
  return [...out.values()]
}
function fileIcon(p) {
  if (isImg(p)) return `<span class="fi img"><img src="${esc(fileUrl(p))}" alt="" onerror="this.remove()"></span>`
  const e = String(p).split('.').pop().toLowerCase()
  if (/^(mp3|wav|m4a|ogg|flac)$/.test(e)) return '<span class="fi"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 9v6M12 6v12M17 9v6"/></svg></span>'
  return `<span class="fi doc ${extOf(p)}">${esc(e.slice(0, 4).toUpperCase())}</span>`
}
function renderFiles(a) {
  const l = libraryOf(a.id)
  if (!l.length) return `<div class="pempty" style="margin-top:22px">${esc(a.name)}做出来的文件会放在这里：写的文档、整理好的表格、截图。</div>`
  const today = l.filter((x) => dayOf(x.at) === todayStr()), older = l.filter((x) => dayOf(x.at) !== todayStr())
  const grp = (n, xs) => xs.length ? `<div class="psec">${n}</div><div class="lib">${xs.map((x) => `<button class="li" data-act="file-open" data-p="${esc(x.p)}" title="${esc(x.p)}">${fileIcon(x.p)}<span>${esc(x.title || x.p.split(/[\\/]/).pop())}</span></button>`).join('')}</div>` : ''
  return grp('今天', today) + grp('更早', older)
}

// 电脑: the bot's own screen and the steps of one task
function renderComputer() {
  const t = procTarget()
  const ca = agentOf(t ? t.agent : cur)
  const hr = new Date().getHours(), wall = hr < 6 || hr >= 20 ? 'night' : hr < 11 ? 'morning' : hr < 17 ? 'noon' : 'evening'
  const screen = `<div class="scr wall-${wall} ${busy(ca.id) ? 'on' : ''}"><div class="sbar"><i></i><i></i><i></i><span>${esc(ca.name)} 的电脑</span><em>${busy(ca.id) ? '使用中' : '空闲'}</em></div><div class="sbody">${busy(ca.id) ? `<span class="spin"></span>${esc(nowDoing(ca.id))}` : `在 ${esc(S.device || '这台电脑')} 上，用你的文件、日程和邮箱做事`}</div></div>`
  if (!t) return screen + '<div class="pempty">这里会显示 Bot 做事的每一步：用了什么工具、改了什么，能直接撤回。</div>'
  const a = agentOf(t.agent)
  const tools = toolsOf(t)
  const secs = t.endAt ? Math.max(1, Math.round((Date.parse(t.endAt) - Date.parse(t.at)) / 1000)) : null
  let h = screen + `<div class="pt">${esc(String(turnTitle(t)).slice(0, 120))}</div>
    <div class="pm2">${hhmm(t.at)} · ${t.running ? '<span class="spin" style="width:11px;height:11px"></span> 正在做' : `${tools.length} 步${secs ? ` · 用时 ${secs < 90 ? secs + ' 秒' : Math.round(secs / 60) + ' 分钟'}` : ''}`}</div><div class="steps">`
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
  return h
}

// ---------- pages ----------
let entering = true
function setView(v, arg) {
  if (v === 'settings' || v === 'plugins') return openModal(v === 'settings' ? 'settings' : 'apps', arg)
  if (v !== view || (arg ?? null) !== viewArg) entering = true
  view = v; viewArg = arg ?? null
  $('#vChat').hidden = v !== 'chat'; $('#vPage').hidden = v === 'chat'
  // the right panel belongs to the chat; pages take the whole width
  procSel = null; tagEdit = false
  renderAll(false)
}
const phead = (title, sub = '', right = '') => `<div class="phead">${MINE.includes(view) && view !== 'me' ? '<button class="crumb" data-go="me"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>我的</button>' : ''}<h2>${title}</h2><span class="s">${sub}</span><div class="r">${right}</div></div>`

function renderPage() {
  if (view === 'chat') return
  const P = $('#pg')
  const keep = $('#vPage').scrollTop
  const fn = { me: pageMe, brief: pageBrief, memory: pageMemory, reflect: pageReflect, ledger: pageLedger, later: pageLater, agent: pageAgent }[view]
  if (fn) P.innerHTML = fn()
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

// 智能体: identity, persona and its own mailbox
const TEMPLATES = [
  { name: '出差助理', role: '出差助理', style: '靠谱同事', emailName: 'trip', color: '#4f8cff', intro: '负责出差的一切：订机票酒店、排行程、整理报销单。熟悉用户的出行偏好，订之前先查记忆。' },
  { name: '资料研究员', role: '资料研究员', style: '犀利有梗', emailName: 'research', color: '#9b6bff', intro: '负责查资料、读报告、写综述。只说有出处的话，结论先行，附上链接。' },
  { name: '财务小秘', role: '财务助理', style: '温暖贴心', emailName: 'finance', color: '#2fb380', intro: '负责发票、报销和账单。金额一分不差，涉及付款的事先问用户。' },
]
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
    ${`<div class="setrow"><label>颜色</label><div class="ctl colors" id="agColor" data-val="${esc(colorOf({ ...v, id: v.id || 'new' }))}">${COLORS.map((c) => `<button type="button" class="${c === colorOf({ ...v, id: v.id || 'new' }) ? 'on' : ''}" data-v="${c}" style="background:${c}"></button>`).join('')}</div></div>`}
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
  if (st.running) evalTimer = setTimeout(() => { if (modal?.tab === 'eval') renderEval($('#evalBox')) }, 4000)
}

// ---------- 更新 (Electron only): the client checks the GitHub repository and fetches only changed files ----------
async function renderUpdate(el, st) {
  if (!el) return
  if (!APP || !APP.updateStatus) { el.innerHTML = '<div class="srow"><div class="m"><b>在天禧客户端里可以检查更新</b></div></div>'; return }
  st = st || await APP.updateStatus(); updSt = st
  const when = st.checkedAt ? new Date(st.checkedAt).toLocaleString('zh-CN', { hour12: false }) : '还没检查过'
  const line = st.checking ? '正在检查…'
    : st.pending ? `天禧 ${esc(st.pending.version)} 已就绪。重启以应用。`
    : st.error ? `没查成：${esc(st.error)}`
    : st.latest ? `已经是最新版 · 上次检查 ${esc(when)}` : `上次检查 ${esc(when)}`
  el.innerHTML = `<div class="srow"><div class="m"><b>自动更新</b><span>在你离开时自动更新客户端，只下载改动的文件；新版本启动失败会自动退回</span></div><div class="c"><i class="tg on fixed" title="概念版一直开着"></i></div></div>
    <div class="srow"><div class="m"><b>版本 ${esc(st.version)}</b><span class="${st.pending ? 'blue' : st.error ? 'red' : ''}">${line}</span>${st.fellBack ? `<span class="red">新版本 ${esc(st.fellBack)} 没能启动，已经自动退回。</span>` : ''}${st.pending?.notes ? `<span>更新内容：${esc(st.pending.notes)}</span>` : ''}</div>
      <div class="c">${st.pending ? '<button class="pbtn blue" data-act="upd-restart">更新并重启</button>' : `<button class="pbtn" data-act="upd-check" ${st.checking ? 'disabled' : ''}>检查更新</button>`}</div></div>`
  const src = $('#updSrc')
  if (src && !src.dataset.done) {
    src.dataset.done = '1'
    src.innerHTML = `<div class="srow"><div class="m"><b>GitHub 仓库</b></div><div class="c"><input class="sin" id="updRepo" value="${esc(st.source?.repo || '')}" placeholder="Edifier-Ai/XT-harness" style="width:260px"></div></div>
      <div class="srow"><div class="m"><b>访问令牌</b><span>公开仓库不用填</span></div><div class="c"><input class="sin" id="updTok" type="password" placeholder="${st.source?.hasToken ? '已保存，不改就留空' : '不用填'}" style="width:260px"></div></div>`
  }
  renderRail()
}
function updateToast(st) {
  updSt = st || updSt; renderRail(); renderMenu()
  if (!st || !st.pending || $('#updToast')) return
  const el = document.createElement('div'); el.className = 'toast'; el.id = 'updToast'
  el.innerHTML = `<span>天禧新版本 ${esc(st.pending.version)} 已经下好${st.pending.notes ? '：' + esc(st.pending.notes) : ''}</span><button class="btn sm">现在重启</button><button class="btn sm">稍后</button>`
  const [go, later] = el.querySelectorAll('button')
  go.onclick = () => APP.restart(); later.onclick = () => dismiss(el)
  $('#toasts').appendChild(el)
}
if (APP && APP.onUpdate) {
  APP.onUpdate((st) => { updateToast(st); if (modal?.tab === 'update') renderUpdate($('#updBox'), st) })
  APP.updateStatus().then(updateToast).catch(() => {})
}

// ---------- the menu under your avatar: your own space (我的), settings and updates ----------
let updSt = null
const MI = {
  me: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  brief: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  memory: '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="7" r="1.6"/><circle cx="19" cy="6" r="1.6"/><circle cx="18" cy="18" r="1.6"/><circle cx="6" cy="18" r="1.6"/><path d="M6.3 8l3.8 2.6M17.6 7l-3.7 3.4M16.7 16.9l-3-3M7.3 16.8l2.8-3"/>',
  reflect: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  ledger: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  model: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.4l2.1 1.2M17.7 15.4l2.1 1.2M4.2 16.6l2.1-1.2M17.7 8.6l2.1-1.2"/><circle cx="12" cy="12" r="7.2"/>',
  priv: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><path d="M4 20L20 4"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  comp: '<rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M8.5 20.5h7M12 17v3.5"/>',
  usage: '<path d="M6 20V11M12 20V5M18 20v-6"/>',
  eval: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H15"/>',
  update: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  ext: '<path d="M8 16L16 8M9 8h7v7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
}
const ico = (k, w = 18, sw = 1.8) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${MI[k]}</svg>`
function renderMenu() {
  const m = $('#umenu'); if (m.hidden) return
  const { open, nr } = openCount()
  const model = S.model?.model || S.model?.id || ''
  const it = (act, k, label, right = '', extra = '') => `<button data-act="${act}" ${extra}>${ico(k)}<span>${label}</span>${right ? `<em>${right}</em>` : ''}</button>`
  m.innerHTML = `${updSt?.pending ? `<div class="ubanner"><span>发现新版本 ${esc(updSt.pending.version)}</span><button data-act="upd-restart">安装</button></div>` : ''}
    ${it('set-open', 'model', '模型', `${esc(String(model).split('/').pop().slice(0, 18))} ${ico('chev', 14)}`, 'data-t="model"')}
    ${it('menu-go', 'me', '我的', open + nr ? `<b>${open + nr}</b>` : ico('chev', 14), 'data-v="me"')}
    ${it('menu-go', 'brief', '每日简报', open ? `${open} 件等你定` : '', 'data-v="brief"')}
    ${it('menu-go', 'memory', '我的记忆', `${S.memories.length} 条`, 'data-v="memory"')}
    ${it('menu-go', 'reflect', '反思', nr ? `${nr} 条建议` : '', 'data-v="reflect"')}
    ${it('menu-go', 'ledger', '操作记录', '', 'data-v="ledger"')}
    ${it('set-open', 'settings', '设置', '', 'data-t="general"')}
    <hr>
    <button data-act="priv">${ico('priv')}<span>临时模式</span><i class="tg ${S.privateMode ? 'on' : ''}"></i></button>`
}
function toggleMenu(on) { const m = $('#umenu'); m.hidden = on === undefined ? !m.hidden : !on; if (!m.hidden) { renderMenu(); replay(m, 'in') } renderRail() }

// ---------- modals: 连接应用 and 设置, over the app like Grok Bot's ----------
let modal = null   // { kind: 'apps' | 'settings', tab, q, cat }
function openModal(kind, tab) { modal = { kind, tab: tab || (kind === 'settings' ? 'general' : '全部'), q: '' }; toggleMenu(false); $('#modal').hidden = false; renderModal(true) }
function closeModal() { modal = null; $('#modal').hidden = true; $('#mbox').innerHTML = ''; clearTimeout(evalTimer) }
function renderModal(enter) {
  if (!modal) return
  const box = $('#mbox')
  box.className = 'mbox ' + modal.kind
  if (modal.kind === 'apps') box.innerHTML = appsModal()
  else { box.innerHTML = settingsModal(); fillSettings() }
  if (enter) replay(box, 'pop')
}

// 连接应用: the real plugin manager. 内置 groups switch on and off; outside apps connect as MCP servers.
const LOOK = {
  calendar: ['历', '#3f7fe6'], todo: ['✓', '#2fb380'], mail: ['✉', '#e8483f'], files: ['文', '#e0a020'], cards: ['卡', '#f2f2f2', '#111'], web: ['网', '#2b2b2b'], shell: ['>_', '#2b2b2b'],
  memory: ['忆', '#8b6cf0'], ledger: ['↩', '#53b8a5'], brief: ['报', '#ee6a2b'],
  amap: ['高', '#2a8cf7'], baidumap: ['百', '#3a6df0'], feishu: ['飞', '#3370ff'], github: ['G', '#f2f2f2', '#111'], notion: ['N', '#f2f2f2', '#111'], browser: ['⌖', '#0e8a6a'],
}
const CORE = [
  { id: 'memory', n: '记忆', d: '记住你的偏好、人物和项目，每条带出处' },
  { id: 'ledger', n: '操作记录', d: '每件事都记下原因，一句“算了”就撤回' },
  { id: 'brief', n: '每日简报和后台', d: '每天整理要你定的事，你不在时做排着的事' },
]
const BUILTIN_D = { calendar: '本机日历，加日程时自动查冲突', todo: '本机待办清单', mail: '每个 Bot 有自己的邮箱，对外发送先问你', files: '列文件夹、移动和重命名，每次都能撤回', cards: '要你挑、调、确认时直接给出可点的卡片', web: '搜索、读网页', shell: '在这台电脑上跑命令' }
const BUILTIN_C = { calendar: '效率', todo: '效率', mail: '通信', files: '文件', cards: '效率', web: '联网', shell: '代码' }
let CAT = null   // { catalog, builtin } from the host
const loadCatalog = async () => { if (!CAT) { CAT = await api('apps/catalog'); renderRail(); if (modal?.kind === 'apps') renderModal() } }
const appIcon = (k, s = 44, name = '') => { const [g, bg, fg] = LOOK[k] || [String(name).slice(0, 1) || '·', '#3a3a3a']; return `<span class="appi" style="width:${s}px;height:${s}px;background:${bg};color:${fg || '#fff'};font-size:${Math.round(s * .42)}px;border-radius:${Math.round(s * .26)}px">${esc(g)}</span>` }
const myApps = () => S.apps?.apps || []
function connectedIcons() {
  const off = new Set(S.apps?.disabled || [])
  const b = (CAT?.builtin || []).filter((g) => !g.tools.every((t) => off.has(t))).map((g) => g.id)
  return [...myApps().filter((a) => a.status === 'ok').map((a) => a.catalogId || a.name), ...b]
}
function appStatus(a) {
  if (a.status === 'off') return '<span>已停用</span>'
  if (a.status === 'connecting') return '<span class="st2"><i class="spin"></i>正在连接…</span>'
  if (a.status === 'error') return `<span class="st2 bad">没连上：${esc(a.error)}</span>`
  return `<span class="st2 ok">已连接 · ${a.tools.length} 个工具</span>`
}
function appsModal() {
  if (!CAT) { loadCatalog(); return `<button class="mx" data-act="modal-close">${ico('x', 20)}</button><div class="ahead"><h2>连接应用</h2></div><div class="pempty" style="margin:40px 0">正在读取…</div>` }
  if (modal.edit) return appForm()
  const q = (modal.q || '').trim().toLowerCase(), cat = modal.tab
  const off = new Set(S.apps?.disabled || [])
  const hit = (n, d, c) => (cat === '全部' || cat === c || (cat === '已连接')) && (!q || (n + d).toLowerCase().includes(q))
  const mine = myApps()
  const added = new Set(mine.map((a) => a.catalogId).filter(Boolean))
  const rows = { connected: [], builtin: [], avail: [] }
  for (const a of mine) {
    const c = CAT.catalog.find((x) => x.id === a.catalogId)
    if (!hit(a.name, c?.d || '', c?.c || '自定义')) continue
    rows.connected.push(`<div class="arow big">${appIcon(a.catalogId || '', 44, a.name)}<div class="m"><b>${esc(a.name)}</b>${appStatus(a)}${a.tools.length ? `<span class="tl3" title="${esc(a.tools.join('  '))}">${esc(a.tools.slice(0, 6).join(' · '))}${a.tools.length > 6 ? ' …' : ''}</span>` : ''}</div>
      <div class="ab"><button class="pbtn" data-act="app-edit" data-id="${a.id}">设置</button><i class="tg ${a.enabled ? 'on' : ''}" data-act="app-toggle" data-id="${a.id}" title="${a.enabled ? '停用' : '启用'}"></i></div></div>`)
  }
  for (const g of CAT.builtin) {
    if (!hit(g.n, BUILTIN_D[g.id] || '', BUILTIN_C[g.id])) continue
    const on = !g.tools.every((t) => off.has(t))
    rows.builtin.push(`<div class="arow">${appIcon(g.id)}<div class="m"><b>${esc(g.n)}<em class="bi">内置</em></b><span>${esc(BUILTIN_D[g.id] || '')}</span></div><i class="tg ${on ? 'on' : ''}" data-act="app-builtin" data-id="${g.id}" title="${on ? '停用' : '启用'}"></i></div>`)
  }
  for (const c of CORE) if (hit(c.n, c.d, '记忆')) rows.builtin.push(`<div class="arow">${appIcon(c.id)}<div class="m"><b>${esc(c.n)}<em class="bi">内置</em></b><span>${esc(c.d)}</span></div><span class="always">一直开着</span></div>`)
  if (cat !== '已连接') for (const c of CAT.catalog) if (!added.has(c.id) && hit(c.n, c.d, c.c)) rows.avail.push(`<div class="arow">${appIcon(c.id)}<div class="m"><b>${esc(c.n)}</b><span>${esc(c.d)}${c.node && S.apps?.node === false ? ' · 需要 Node.js' : ''}</span></div><button class="pbtn" data-act="app-new" data-c="${c.id}">添加</button></div>`)
  const sec = (title, l, one) => l.length ? `<div class="asec"><div class="ah"><b>${title}</b></div><div class="${one ? 'alist' : 'agrid'}">${l.join('')}</div></div>` : ''
  const body = sec('我连接的应用', rows.connected, true) + sec('可以添加', rows.avail) + sec('天禧自带', rows.builtin)
    + (cat === '全部' && !q ? `<div class="asec"><div class="custom"><div class="m"><b>添加自定义应用</b><span>任何 MCP 服务器都能接：填启动命令（比如 npx -y 某个包）或者一个网址。魔搭、Smithery 等 MCP 广场上的服务都可以这样加。</span></div><button class="pbtn" data-act="app-new" data-c="">自定义</button></div></div>` : '')
  const ic = connectedIcons()
  return `<button class="mx" data-act="modal-close">${ico('x', 20)}</button>
    <div class="ahead"><h2>连接应用</h2><button class="conn" data-act="app-cat" data-c="已连接"><span class="stack">${ic.slice(0, 4).map((k) => appIcon(k, 22, k)).join('')}</span>已连接 ${ic.length} 个 ${ico('chev', 16)}</button></div>
    <div class="arow2"><label class="asearch"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input id="appQ" placeholder="在应用和技能中搜索" value="${esc(modal.q || '')}"></label><button class="tplb" data-act="bot-tpl">${avatar(agentOf(S.mainId), 22, true, false)}Bot 模板 ${ico('ext', 15)}</button></div>
    <div class="acats">${['全部', '已连接', '效率', '通信', '文件', '代码', '联网'].map((c) => `<button class="${cat === c ? 'on' : ''}" data-act="app-cat" data-c="${c}">${c}</button>`).join('')}</div>
    <div class="abody">${body || '<div class="pempty" style="margin:30px 0">没有找到</div>'}</div>
    <div class="afoot">连接的应用所有 Bot 共用。会改动外面数据的操作（发消息、建文档、提交）先问你。</div>`
}
// one app's settings: the keys it needs, or a custom server's command / address
function appForm() {
  const e = modal.edit, a = e.id ? myApps().find((x) => x.id === e.id) : null
  const c = CAT.catalog.find((x) => x.id === (a?.catalogId || e.catalogId))
  const f = (k, l, ph, v = '', secret = false, help = '') => `<div class="fr"><label>${esc(l)}</label><input class="sin" data-f="${k}" type="${secret ? 'password' : 'text'}" placeholder="${esc(ph)}" value="${esc(v)}">${help ? `<small>${esc(help)}</small>` : ''}</div>`
  let h = `<button class="mx" data-act="modal-close">${ico('x', 20)}</button><div class="ahead"><button class="crumb" data-act="app-back">${ico('chev', 14)}连接应用</button></div>
    <div class="fhead">${appIcon(c?.id || '', 52, a?.name || '自')}<div><h2>${esc(c?.n || a?.name || '自定义应用')}</h2><span>${esc(c?.d || '接一个 MCP 服务器')}</span></div></div><div class="abody"><div class="form2">`
  if (c) {
    for (const x of c.fields) h += f(x.k, x.l, a?.hasValues?.includes(x.k) ? '已保存，不改就留空' : '', '', x.secret, x.help || '')
    if (!c.fields.length) h += '<div class="pempty">不用填任何东西，点“连接”就行。</div>'
    if (c.node) h += `<div class="pempty">${S.apps?.node === false ? '⚠ 这台电脑还没有 Node.js。这个应用要用它启动：先从 nodejs.org 装 LTS 版，再重启天禧。' : '第一次连接会用 npx 下载它，要等一会儿。'}</div>`
  } else {
    h += f('name', '名字', '比如：公司知识库', a?.name || '')
    h += f('commandLine', '启动命令', '比如：npx -y @modelcontextprotocol/server-everything', a?.command ? [a.command, ...(a.args || [])].join(' ') : '', false, '本机启动的 MCP 服务器填这里；远程的填下面的网址')
    h += f('url', '或者网址', 'https://…/mcp', a?.url || '', false, '支持 Streamable HTTP 的 MCP 地址')
    h += f('header', '请求头 Authorization', 'Bearer xxx（可选）', '', true)
    h += `<div class="fr"><label>环境变量</label><textarea class="sin ta" data-f="envText" placeholder="每行一个，比如 API_KEY=xxx">${esc(Object.entries(a?.env || {}).map(([k, v]) => k + '=' + v).join('\n'))}</textarea></div>`
  }
  if (a) h += `<div class="fr"><label>状态</label><div id="appSt">${appStatus(a)}</div></div>`
  h += `</div></div><div class="facts"><button class="pbtn blue" data-act="app-save">${a ? '保存并重连' : '连接'}</button>${a ? `<button class="pbtn red" data-act="app-remove" data-id="${a.id}">删除</button>` : ''}<span class="hint" id="appMsg"></span></div>`
  return h
}

// 设置: 通用 · 电脑 · 模型 · 评测 · 更新
const SETTABS = [['general', '通用', 'settings'], ['computer', '电脑', 'comp'], ['model', '模型', 'usage'], ['eval', '评测', 'eval'], ['update', '更新', 'update']]
function settingsModal() {
  const s = S.settings || {}, t = modal.tab
  const nav = `<div class="snav">${SETTABS.map(([k, l, i]) => `<button class="${t === k ? 'on' : ''}" data-act="set-tab" data-t="${k}">${ico(i, 19)}<span>${l}</span></button>`).join('')}</div>`
  const row = (label, desc, ctl) => `<div class="srow"><div class="m"><b>${label}</b>${desc ? `<span>${desc}</span>` : ''}</div><div class="c">${ctl}</div></div>`
  const tg = (key, on) => `<button class="tg ${on ? 'on' : ''}" data-act="set-toggle" data-key="${key}"></button>`
  const sel = (key, val, opts) => `<label class="sel"><select data-set="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${ico('chev', 13)}</label>`
  const txt = (key, val, ph, w = 160) => `<input class="sin" data-set="${key}" value="${esc(val ?? '')}" placeholder="${esc(ph || '')}" style="width:${w}px">`
  let h = ''
  if (t === 'general') {
    const me = s.callMe || S.user || '你'
    h = `<h2>通用</h2><div class="slab">账户</div><div class="scard"><div class="acct"><span class="uav big">${esc(userInitial())}</span><div class="m"><b>${esc(me)}</b><span>${esc(S.user || '')}@${esc(S.device || 'local')}<button class="cp" data-act="copy" data-v="${esc(S.home || '')}" title="复制数据位置">${ico('copy', 15)}</button></span></div><div class="c"><button class="pbtn" data-act="set-tab" data-t="computer">数据位置</button></div></div></div>
      <div class="slab">外观</div><div class="scard">${row('主题', '', sel('theme', store.get('theme', 'dark'), [['dark', '深色'], ['light', '浅色'], ['system', '跟随系统']]))}${row('强调色', '', sel('accent', 'bot', [['bot', 'Bot 颜色']]))}${row('语言', '', sel('lang', 'zh', [['zh', '简体中文']]))}</div>
      <div class="slab">你</div><div class="scard">${row('怎么称呼你', 'Bot 打招呼和写邮件时用', txt('callMe', s.callMe, '比如：summer'))}</div>
      <div class="slab">Bot</div><div class="scard">${row('时区', '', sel('tz', 'auto', [['auto', `自动检测（${Intl.DateTimeFormat().resolvedOptions().timeZone}）`]]))}${row('每日简报时间', '主 Bot 到点整理当天的简报', txt('briefTime', s.briefTime || '08:00', '08:00', 90))}${row('离开多久算不在', '之后开始做排着的事（分钟）', txt('idleMinutes', s.idleMinutes ?? 10, '10', 70))}${row('夜里时段', '夜里反思和夜里做的事在这段时间', `${txt('nightFrom', s.nightFrom ?? 23, '23', 54)}<span class="to">点到</span>${txt('nightTo', s.nightTo ?? 6, '6', 54)}<span class="to">点</span>`)}${row('留意的文件夹', '出现新文件时记下来，写进简报', txt('watch', (s.watch || []).join('；'), '~/Downloads；~/Desktop', 260))}</div>`
  } else if (t === 'computer') {
    h = `<h2>电脑</h2><div class="slab">你的电脑 <b class="dev">${esc(S.device || '')}</b></div><div class="scard">${row('在这台电脑上执行', '允许 Bot 在你的电脑上打开文件并运行任务。对外发邮件仍会先问你，做过的事都能在操作记录里撤回。', sel('exec', 'always', [['always', '始终允许']]))}${row('临时模式', '开着时所有 Bot 都不记住你说的话', `<button class="tg ${S.privateMode ? 'on' : ''}" data-act="priv"></button>`)}</div>
      <div class="slab">Bot 的电脑</div><div class="scard">${row('数据位置', `记忆、对话、操作记录都在本机：${esc(S.home || '')}`, `<button class="pbtn" data-act="copy" data-v="${esc(S.home || '')}">复制</button>`)}${row(`清空和 ${esc(agentOf(cur).name)} 的对话`, '只清对话记录，记忆和操作记录不受影响。', `<button class="pbtn red" data-act="clear">清空</button>`)}</div>`
  } else if (t === 'model') h = `<h2>模型</h2><div class="slab">大模型</div><div class="scard pad" id="modelForm"></div><div class="snote">天禧用第三方大模型 API，Key 只加密保存在这台电脑上。</div>`
  else if (t === 'eval') h = `<h2>评测</h2><div class="scard pad" id="evalBox"></div>`
  else h = `<h2>更新</h2><div class="slab">天禧更新</div><div class="scard" id="updBox"></div><div class="slab">更新来源</div><div class="scard pad" id="updSrc"></div>`
  return `${nav}<div class="sbody">${h}</div><button class="mx" data-act="modal-close">${ico('x', 20)}</button>`
}
function fillSettings() {
  const t = modal.tab
  if (t === 'model') renderModelForm($('#modelForm'), false)
  if (t === 'eval') renderEval($('#evalBox'))
  if (t === 'update') renderUpdate($('#updBox'))
}
async function saveSetting(key, raw) {
  let v = raw
  if (['idleMinutes', 'nightFrom', 'nightTo'].includes(key)) { v = +raw; if (!Number.isFinite(v)) return }
  if (key === 'watch') v = String(raw).split(/[;；,，\n]/).map((x) => x.trim()).filter(Boolean)
  if (key === 'briefTime' && !/^\d{1,2}:\d{2}$/.test(raw)) { toastText('时间写成 08:00 这样'); return }
  if (!['callMe', 'briefTime', 'idleMinutes', 'nightFrom', 'nightTo', 'watch', 'briefOn', 'reflectAtNight', 'watchOn'].includes(key)) return
  await api('settings', { [key]: v }); soon()
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
  if (firstLoad && !REDUCED) { $('#app').classList.add('boot'); setTimeout(() => $('#app').classList.remove('boot'), 1500) }
  firstLoad = false
  renderAll(true)
}
const soon = () => { clearTimeout(refreshT); refreshT = setTimeout(refresh, 150) }
function renderAll(keep) {
  renderRail()
  const vis = view === 'chat' ? $('#vChat') : $('#vPage')
  if (vis.dataset.shown !== view) { vis.dataset.shown = view; (view === 'chat' ? $('#vPage') : $('#vChat')).dataset.shown = ''; replay(vis, 'fade') }
  if (view === 'chat') { renderHead(); renderMsgs(keep); renderChips() } else renderPage()
  renderProc(); renderMenu()
  if (modal?.tab === 'computer') renderModal()
  if (modal?.kind === 'apps') {
    if (!modal.edit) { const y = $('#mbox .abody')?.scrollTop; renderModal(); const b = $('#mbox .abody'); if (b && y) b.scrollTop = y }
    else { const a = myApps().find((x) => x.id === modal.edit.id), st = $('#appSt'); if (a && st) st.innerHTML = appStatus(a) }
  }
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
    else if (m.type === 'voice') voiceChanged(m.state)
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
const plusMenu = $('#plusMenu')
$('#bPlus').onclick = (e) => { e.stopPropagation(); plusMenu.hidden = !plusMenu.hidden; if (!plusMenu.hidden) replay(plusMenu, 'in') }
document.addEventListener('click', (e) => {
  if (!plusMenu.hidden && !e.target.closest('#plusMenu')) plusMenu.hidden = true
  if (!$('#umenu').hidden && !e.target.closest('#umenu, #meBtn, #bUpd')) toggleMenu(false)
})
const searchOn = (on) => { $('#searchBox').hidden = !on; $('#bSearch').classList.toggle('on', on); if (on) { $('#q').focus(); $('#q').select() } else { $('#q').value = ''; query = ''; renderRail() } }
$('#bSearch').onclick = () => searchOn($('#searchBox').hidden)
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal() })
document.addEventListener('input', (e) => {
  if (e.target.id === 'appQ') { const pos = e.target.selectionStart; modal.q = e.target.value; renderModal(); const i = $('#appQ'); i.focus(); i.setSelectionRange(pos, pos) }
})
document.addEventListener('change', (e) => { const k = e.target.dataset?.set; if (k) saveSetting(k, e.target.value) })
async function saveTag() { const i = $('#tagIn'); if (!i) return; const a = agentOf(cur); tagEdit = false; const v = i.value.trim().slice(0, 12); if (v !== (a.tag || '')) { await api('agents/save', { agent: { id: a.id, tag: v } }); await refresh() } else renderProc() }
document.addEventListener('keydown', (e) => { if (e.target.id === 'tagIn') { if (e.key === 'Enter') saveTag(); if (e.key === 'Escape') { e.stopPropagation(); tagEdit = false; renderProc() } } }, true)
document.addEventListener('focusout', (e) => { if (e.target.id === 'tagIn') setTimeout(saveTag, 0) })
function shareChat() {
  const a = agentOf(cur), lines = [`# 和 ${a.name} 的对话`, '']
  for (const t of turnsOf(cur).filter((x) => !x.internal)) {
    if (t.head?.role === 'user') lines.push(`**${S.settings?.callMe || '我'}** · ${stamp(t.at)}`, '', t.head.text, '')
    const said = t.items.filter((i) => i.role === 'assistant' && i.text).map((i) => i.text).join('\n\n')
    if (said) lines.push(`**${a.name}**`, '', said, '')
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }))
  const x = document.createElement('a'); x.href = url; x.download = `${a.name}-对话-${todayStr()}.md`; x.click(); setTimeout(() => URL.revokeObjectURL(url), 2000)
}
const copyText = async (t) => { try { await navigator.clipboard.writeText(t); toastText('已复制') } catch { toastText('没能复制') } }
$('#q').addEventListener('input', (e) => { query = e.target.value; renderRail() })
$('#bPriv').onclick = () => { plusMenu.hidden = true; api('private', { on: !S.privateMode }) }
$('#pmBadge').onclick = () => api('private', { on: false })
$('#bUndo').onclick = async () => { plusMenu.hidden = true; const r = await api('undo-last', {}); toastText(r.entry ? '已撤回：' + r.entry.title : '没有可以撤回的事') }
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (modal) return closeModal(); if (!$('#umenu').hidden) return toggleMenu(false); if (!$('#searchBox').hidden) return searchOn(false); if (view !== 'chat') setView(MINE.includes(view) && view !== 'me' ? 'me' : 'chat') }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchOn(true) }
})

document.addEventListener('click', async (e) => {
  const go = e.target.closest('[data-go]')
  if (go) { const g = go.dataset.go; toggleMenu(false); setView(view === g && !go.closest('.pg, .proc') ? 'chat' : g); return }
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
  else if (act === 'menu') toggleMenu()
  else if (act === 'upd-menu') toggleMenu(true)
  else if (act === 'menu-go') { toggleMenu(false); setView(el.dataset.v) }
  else if (act === 'set-open') openModal('settings', el.dataset.t)
  else if (act === 'apps') openModal('apps')
  else if (act === 'modal-close') closeModal()
  else if (act === 'set-tab') { modal.tab = el.dataset.t; renderModal() }
  else if (act === 'app-cat') { modal.tab = el.dataset.c; modal.q = ''; renderModal(); $('#mbox .abody')?.scrollTo(0, 0) }
  else if (act === 'app-new') { modal.edit = { catalogId: el.dataset.c || '' }; renderModal() }
  else if (act === 'app-edit') { modal.edit = { id: el.dataset.id }; renderModal() }
  else if (act === 'app-back') { modal.edit = null; renderModal() }
  else if (act === 'app-toggle') { const on = !el.classList.contains('on'); el.classList.toggle('on', on); await api('apps/toggle', { id: el.dataset.id, on }); soon() }
  else if (act === 'app-builtin') { const on = !el.classList.contains('on'); el.classList.toggle('on', on); await api('apps/builtin', { id: el.dataset.id, on }); soon() }
  else if (act === 'app-remove') { if (confirm('删除这个应用？所有 Bot 都不能再用它。')) { await api('apps/remove', { id: el.dataset.id }); modal.edit = null; await refresh(); renderModal() } }
  else if (act === 'app-save') {
    const e = modal.edit, v = {}; document.querySelectorAll('#mbox [data-f]').forEach((x) => { v[x.dataset.f] = x.value })
    const old = e.id ? myApps().find((x) => x.id === e.id) : null, cid = old?.catalogId || e.catalogId
    const app = cid ? { id: e.id, catalogId: cid, values: v, enabled: true } : { id: e.id, name: v.name, commandLine: v.commandLine, url: v.url, header: v.header, envText: v.envText, enabled: true }
    el.disabled = true; $('#appMsg').textContent = '正在连接…'
    const r = await api('apps/save', { app }); if (r.error) { el.disabled = false; $('#appMsg').textContent = r.error; return }
    modal.edit = { id: r.app.id }; await refresh(); renderModal()
  }
  else if (act === 'bot-tpl') { closeModal(); draftAgent = null; setView('agent', 'new') }
  else if (act === 'set-toggle' || act === 'rt-toggle') { const k = el.dataset.key, on = !el.classList.contains('on'); el.classList.toggle('on', on); await api('settings', { [k]: on }); soon() }
  else if (act === 'panel-toggle') panelOn() ? closeProc() : openProc(null, 'detail')
  else if (act === 'tag-edit') { tagEdit = true; renderProc() }
  else if (act === 'file-open') window.open(fileUrl(el.dataset.p), '_blank')
  else if (act === 'share') shareChat()
  else if (act === 'copy') copyText(el.dataset.v || '')
  else if (act === 'm-copy' || act === 'm-quote' || act === 'm-react') {
    const b = el.closest('.bw')?.querySelector('[data-mid]'); if (!b) return
    if (act === 'm-copy') copyText(b.innerText)
    else if (act === 'm-quote') { inp.value = '> ' + b.innerText.replace(/\s+/g, ' ').slice(0, 80) + '\n' + inp.value; grow(); inp.focus() }
    else { const k = b.dataset.mid; reacts[k] ? delete reacts[k] : reacts[k] = 1; store.set('reacts', reacts); renderMsgs(true) }
  }
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
  else if (act === 'proc-close') closeProc()
  else if (act === 'ptab') { procTab = el.dataset.t; if (procTab === 'computer') procSel = null; renderProc() }
  else if (act === 'proc-open') { if (view !== 'chat') { cur = el.dataset.agent; setView('chat') } openProc({ agent: el.dataset.agent, turn: el.dataset.turn }, 'computer') }
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
  connect(); loadCatalog()
  setInterval(() => { if (view === 'brief') renderPage() }, 60000)
})()
