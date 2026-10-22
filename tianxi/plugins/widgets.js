// 钉到桌面 · 我的工具: a card 小天 made in the chat lives on after the chat.
// Pinned, it becomes a desktop widget (the shell opens one small window per widget, web/widget.html) that 小天 keeps
// up to date out of sight, and takes away again when it is no longer of use: its time has passed, 小天 finds the
// matter settled, or it went unused for days. A kind of card the user got twice is collected into 我的工具 by itself,
// to be opened again without asking. Both go into 操作记录 and can be undone.
import { load, update, id, now, localISO, flags, bus, EVAL, transcriptKey } from './store.js'
import { record, defineUndo } from './ledger.js'

const KEY = 'widgets', KINDS = 'cardKinds', DECLINED = 'toolDeclined'
const IDLE_DAYS = 3                    // a pinned widget nobody touched for this long goes away
const MIN_EVERY = 15, MAX_EVERY = 1440 // minutes between updates
const COLLECT_AT = 2                   // the same kind of card this many times: it becomes a tool
const FRESH_WORKER_AFTER = 30          // updates before the worker starts a new, short session

// ---------- the card in a reply ----------
const FENCE = /```[ \t]*(?:openui-lang|openui)([^\n]*)\n([\s\S]*?)\n[ \t]*```/
const clean = (s) => String(s || '').replace(/[`"'“”‘’《》「」]/g, '').replace(/^\s*(用途|类型|kind|name)\s*[:：]\s*/i, '').trim().slice(0, 16)
/** The openui-lang card of a reply: { code, title, kind, at } (at: where the block starts), or null. The kind is the
 *  name the agent wrote after the fence (```openui-lang 城市天气), else the card's title. */
export function cardOf(text) {
  const s = String(text || '')
  let info = '', code = '', at = 0
  const m = FENCE.exec(s)
  if (m) { info = m[1]; code = m[2]; at = m.index }
  else {
    // code written without its fence, alone or after some text
    const bare = /^root\s*=\s*Card\(/m.exec(s)
    if (bare) { code = s.slice(bare.index); at = bare.index }
  }
  code = code.trim()
  if (!/(^|\n)\s*root\s*=/.test(code)) return null
  let title = ''
  const t = /CardHeader\(\s*"((?:[^"\\]|\\.)*)"/.exec(code)
  if (t) { try { title = JSON.parse('"' + t[1] + '"') } catch { title = t[1] } }
  const kind = clean(info) || clean(title) || '卡片'
  return { code, title: title || kind, kind, at }
}

// ---------- the store ----------
export const list = () => load(KEY, [])
const get = (wid) => list().find((w) => w.id === wid)
function patch(wid, fn) {
  let out = null
  update(KEY, [], (l) => { const w = l.find((x) => x.id === wid); if (w) { const p = typeof fn === 'function' ? fn(w) : fn; if (p) Object.assign(w, p); out = w } })
  if (out) bus.push({ type: 'widget', widget: out })
  return out
}
function add(w) {
  const x = { id: id('w'), at: now(), ver: 1, pinned: false, tool: false, status: 'ok', note: '', every: null, expires: null, retired: null, opens: 0, ...w }
  update(KEY, [], (l) => { l.push(x); if (l.length > 200) l.splice(0, l.length - 200) })
  bus.push({ type: 'widgets' })
  return x
}
function drop(wid) {
  update(KEY, [], (l) => l.filter((w) => w.id !== wid))
  bus.push({ type: 'widgets' })
}

// what the user had asked when 小天 answered with this card: the user's last words before it
function askOf(aid, mid) {
  const l = load(transcriptKey(aid), [])
  const i = l.findIndex((t) => t.id === mid)
  for (let k = (i < 0 ? l.length : i) - 1; k >= 0; k--) if (l[k].role === 'user' && l[k].text) return String(l[k].text).slice(0, 300)
  return ''
}
const fromChat = (aid, mid) => {
  const it = load(transcriptKey(aid), []).find((t) => t.id === mid)
  const c = it && cardOf(it.text)
  if (!c) throw new Error('这条回复里没有卡片')
  return { kind: c.kind, title: c.title, code: c.code, ask: askOf(aid, mid), agent: aid, mid }
}

// ---------- 我的工具 ----------
/** Every card in a reply is counted by kind; the second of a kind puts it into 我的工具 (unless the user took it out before). */
function onCard({ aid, mid, text }) {
  const c = cardOf(text); if (!c) return
  let n = 0
  update(KINDS, {}, (m) => {
    const x = m[c.kind] ||= { n: 0, mids: [] }
    if (!x.mids.includes(mid)) { x.n++; x.mids = [...x.mids, mid].slice(-6); x.at = now() }
    n = x.n
  })
  const card = { kind: c.kind, title: c.title, code: c.code, ask: askOf(aid, mid), agent: aid, mid }
  const tool = list().find((w) => w.tool && w.kind === c.kind)
  // a tool keeps the newest card of its kind, unless it is on the desktop showing what was pinned
  if (tool) { if (!tool.pinned) patch(tool.id, (w) => ({ ...card, ver: w.ver + 1, refreshedAt: now(), status: 'ok', note: '' })); return }
  if (n < COLLECT_AT || load(DECLINED, []).includes(c.kind)) return
  const pinned = list().find((w) => w.pinned && w.kind === c.kind)
  const w = pinned ? patch(pinned.id, { tool: true, toolAt: now(), auto: true }) : add({ ...card, tool: true, toolAt: now(), auto: true, refreshedAt: now() })
  record({ tool: 'tool_collect', title: `把「${c.kind}」收进了我的工具`, why: `这类卡片你已经用了 ${n} 次，下次直接打开，不用再问`, undo: { kind: 'widget-untool', data: { id: w.id }, label: '移出我的工具' } })
  bus.push({ type: 'tool-added', widget: w })
}
function setTool({ id: wid, agent, mid, on }) {
  let w = wid ? get(wid) : list().find((x) => x.mid === mid)
  if (on === false) {
    if (!w) return null
    update(DECLINED, [], (l) => l.includes(w.kind) ? l : [...l, w.kind])
    if (w.pinned) return patch(w.id, { tool: false, auto: false })
    drop(w.id); return null
  }
  if (!w && agent && mid) {
    const card = fromChat(agent, mid)
    w = list().find((x) => x.tool && x.kind === card.kind)
    if (w) return patch(w.id, (x) => ({ ...card, ver: x.ver + 1, refreshedAt: now() }))
    w = add({ ...card, refreshedAt: now() })
  }
  if (!w) throw new Error('找不到这张卡片')
  update(DECLINED, [], (l) => l.filter((k) => k !== w.kind))
  return patch(w.id, { tool: true, toolAt: now(), auto: false })
}
/** A tool opened: it shows what it had at once, and is brought up to date when that is old. */
function open(wid) {
  const w = patch(wid, (x) => ({ opens: (x.opens || 0) + 1, lastUsed: now() }))
  if (!w) throw new Error('这个工具已经不在了')
  const age = Date.now() - Date.parse(w.refreshedAt || w.at)
  if (w.status !== 'updating' && age > (w.every || 30) * 60e3) want(w.id)
  return w
}

// ---------- 钉到桌面 ----------
function pin({ id: wid, agent, mid }) {
  let w = wid ? get(wid) : list().find((x) => x.mid === mid)
  if (!w && agent && mid) {
    const card = fromChat(agent, mid)
    const same = list().find((x) => x.kind === card.kind && (x.tool || x.pinned))
    w = same ? patch(same.id, (x) => ({ ...card, ver: x.ver + 1 })) : add(card)
  }
  if (!w) throw new Error('找不到这张卡片')
  w = patch(w.id, { pinned: true, pinnedAt: now(), lastUsed: now(), retired: null, status: 'ok', note: '' })
  // the first update says how often it changes and when it stops mattering
  want(w.id, true)
  return w
}
function unpin(wid) {
  const w = get(wid); if (!w) return null
  if (!w.tool) { drop(wid); return null }
  return patch(wid, { pinned: false })
}
function retire(w, why) {
  patch(w.id, { pinned: false, retired: { at: now(), why } })
  record({ tool: 'widget_retire', title: `把桌面上的「${w.title}」收起来了`, why, undo: { kind: 'widget-restore', data: { id: w.id }, label: '放回桌面' } })
}
function restore(wid) {
  const w = patch(wid, { pinned: true, pinnedAt: now(), lastUsed: now(), retired: null, expires: null, keptAt: now() })
  if (w) want(w.id, true)
  return w
}
defineUndo('widget-restore', async ({ id: wid }) => { if (!restore(wid)) throw new Error('这个小组件已经删掉了'); return '已经放回桌面' })
defineUndo('widget-untool', async ({ id: wid }) => { setTool({ id: wid, on: false }); return '已移出我的工具' })

// ---------- keeping them up to date ----------
const when = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const fence = (w) => '```openui-lang ' + w.kind + '\n' + w.code + '\n```'

// the user said keep it: for a day 小天 does not take it away again
const kept = (w) => w.keptAt && Date.now() - Date.parse(w.keptAt) < 864e5
function updatePrompt(w) {
  return [
    `【桌面小组件·更新】你之前给用户做过一张卡片「${w.title}」（用途：${w.kind}），用户把它${w.pinned ? '钉在了电脑桌面上' : '收进了“我的工具”'}，它要一直是最新的。`,
    w.ask ? `当初用户说的是：${w.ask}` : '',
    `现在是 ${localISO().replace('T', ' ')}。它现在是这样：`,
    fence(w),
    '用工具查到现在的真实情况，重新生成这张卡片：用途和结构不变，只更新内容；放一行小字说明内容是几点的。只查看，不要改动、发送或删除任何东西。查不到新情况就保留原来的内容。',
    '只按下面的格式回复，不要别的话：',
    '刷新：每 N 分钟（N 在 15 到 1440 之间，看内容变得多快；内容不会再变就写“不用刷新”）',
    '到期：YYYY-MM-DD HH:mm（过了这个时间这张卡片就没用了，比如会开完、航班起飞、活动结束；一直有用就写“不会到期”）',
    `然后是一个 openui-lang 代码块，代码块第一行写 \`\`\`openui-lang ${w.kind}`,
    kept(w) ? '用户刚把它留在了桌面上，这次不要让它退场。' : '如果这张卡片已经没用了（事情办完了、时间已经过了），只回一行：退场：原因（一句话，写给用户看）',
  ].filter(Boolean).join('\n')
}
function actPrompt(w, hidden, shown, where) {
  return [
    `【桌面小组件·用户操作】用户在${where}的「${w.title}」（用途：${w.kind}）上点了：${shown || hidden}`,
    hidden && hidden !== shown ? hidden : '',
    w.ask ? `当初用户说的是：${w.ask}` : '',
    '它现在是这样：',
    fence(w),
    '照着直接去做（对外发送、花钱、删除这类动作系统会请用户确认）。做完回复：第一行用一句话说结果（写给用户看）；然后是更新后的卡片，一个 openui-lang 代码块，用途不变；没有变化就把原来的卡片原样给出。',
  ].filter(Boolean).join('\n')
}
/** An update or action reply: { retire } or { code, title, every, expires, said }. */
export function readReply(text) {
  const s = String(text || '')
  const c = cardOf(s)
  const out = /^\s*退场[:：]\s*(.+)$/m.exec(s)
  if (out && !c) return { retire: out[1].trim().slice(0, 80) }
  const ev = /刷新[:：]\s*(?:每\s*)?(\d+(?:\.\d+)?)\s*(分钟|小时|min|h)?/i.exec(s)
  let every = ev ? Math.round(+ev[1] * (/小时|h/i.test(ev[2] || '') ? 60 : 1)) : /刷新[:：]\s*(不用|不需要|无需)/.test(s) ? 0 : null
  if (every) every = Math.min(MAX_EVERY, Math.max(MIN_EVERY, every))
  const ex = /到期[:：]\s*(\d{4}-\d{1,2}-\d{1,2})[ T]+(\d{1,2}:\d{2})/.exec(s)
  let expires
  if (ex) { const [y, mo, d] = ex[1].split('-'), [hh, mm] = ex[2].split(':'); const t = new Date(+y, +mo - 1, +d, +hh, +mm); if (!isNaN(t)) expires = t.toISOString() }
  else if (/到期[:：]\s*(不会|没有|无)/.test(s)) expires = null
  const said = (c ? s.slice(0, c.at) : s).split('\n').filter((l) => !/^\s*(刷新|到期)[:：]/.test(l)).join('\n').trim()
  return { code: c?.code || '', title: c?.title || '', every, expires, said }
}

const queue = []
let working = false, done = 0
function want(wid, first = false) {
  if (!queue.includes(wid)) first ? queue.unshift(wid) : queue.push(wid)
  setTimeout(pump, 0)
}
async function pump() {
  if (working || !bus.say) return
  const wid = queue.shift(); if (!wid) return
  working = true
  try { await updateOne(wid) } catch (e) { console.error('[tianxi] widget', e) } finally {
    working = false
    if (++done >= FRESH_WORKER_AFTER && !queue.length && bus.resetWorker?.()) done = 0
    if (queue.length) setTimeout(pump, 300)
  }
}
async function updateOne(wid) {
  const w = get(wid)
  if (!w || (!w.pinned && !w.tool) || w.status === 'acting') return
  patch(wid, { status: 'updating' })
  let reply = ''
  try {
    reply = await Promise.race([bus.say(updatePrompt(w), { worker: true, kind: 'widget' }), new Promise((_, no) => setTimeout(() => no(new Error('等了 5 分钟没有结果')), 5 * 60e3))])
  } catch (e) {
    patch(wid, { status: 'error', note: '这次没更新成：' + String(e.message || e).slice(0, 80), nextAt: new Date(Date.now() + 30 * 60e3).toISOString() })
    return
  }
  const r = readReply(reply)
  const cur = get(wid); if (!cur) return
  if (r.retire) {
    if (cur.pinned && !kept(cur)) { patch(wid, { status: 'ok' }); retire(cur, r.retire) }
    else patch(wid, { status: 'ok', note: r.retire, nextAt: new Date(Date.now() + (cur.every || 60) * 60e3).toISOString() })
    return
  }
  if (!r.code) {
    patch(wid, { status: 'error', note: '这次没更新成，过一会儿再试', nextAt: new Date(Date.now() + 30 * 60e3).toISOString() })
    return
  }
  const every = r.every ?? cur.every ?? 60
  patch(wid, (x) => ({
    code: r.code, title: r.title || x.title, ver: x.ver + 1, status: 'ok', note: '', refreshedAt: now(),
    every, ...(r.expires !== undefined ? { expires: r.expires } : {}),
    nextAt: every ? new Date(Date.now() + every * 60e3).toISOString() : null,
  }))
}

/** A button or form on a widget or an opened tool: 小天 does it (asking first where it must) and redraws the card. */
async function act(wid, { hidden, shown, where = '电脑桌面上' }) {
  const w = get(wid); if (!w) throw new Error('这个小组件已经不在了')
  if (w.status === 'acting') throw new Error('上一个操作还在做')
  patch(wid, { status: 'acting', note: `正在按“${String(shown || '').slice(0, 30)}”去做`, lastUsed: now() })
  try {
    const reply = await bus.say(actPrompt(w, String(hidden || ''), String(shown || ''), where), { kind: 'widget' })
    const r = readReply(reply)
    const said = (r.said || '').split('\n')[0].slice(0, 120)
    patch(wid, (x) => r.code
      ? { code: r.code, title: r.title || x.title, ver: x.ver + 1, status: 'ok', note: said, noteAt: now(), refreshedAt: now() }
      : { status: 'ok', note: said || '做好了', noteAt: now(), ver: x.ver + 1 })
  } catch (e) {
    patch(wid, { status: 'error', note: '没做成：' + String(e.message || e).slice(0, 80) })
  }
}

// ---------- routes ----------
bus.widgets = list
bus.onCard = onCard
const R = bus.routes
R['GET /api/widgets'] = () => ({ widgets: list() })
R['POST /api/widgets/pin'] = async (b) => ({ ok: true, widget: pin(b) })
R['POST /api/widgets/unpin'] = async (b) => ({ ok: true, widget: unpin(b.id) })
R['POST /api/widgets/tool'] = async (b) => ({ ok: true, widget: setTool(b) })
R['POST /api/widgets/open'] = async (b) => ({ ok: true, widget: open(b.id) })
R['POST /api/widgets/refresh'] = async (b) => { if (!get(b.id)) throw new Error('这个小组件已经不在了'); want(b.id, true); return { ok: true } }
R['POST /api/widgets/act'] = async (b) => { act(b.id, b).catch(() => {}); return { ok: true } }
R['POST /api/widgets/touch'] = async (b) => { patch(b.id, { lastUsed: now() }); return { ok: true } }
R['POST /api/widgets/restore'] = async (b) => ({ ok: true, widget: restore(b.id) })
R['POST /api/widgets/remove'] = async (b) => { drop(b.id); return { ok: true } }

export const name = 'tianxi-widgets'

export function apply(ctx) {
  if (EVAL) return
  // an update cut short by a restart is not still running
  update(KEY, [], (l) => { for (const w of l) if (w.status === 'updating' || w.status === 'acting') w.status = 'ok' })
  // a pinned widget past its time, or left untouched for days, goes away; one that is due is brought up to date,
  // but only while someone is at the computer to see it
  const tick = () => {
    const t = Date.now(), here = flags.idleSec < 600
    for (const w of list()) {
      if (!w.pinned) continue
      if (w.expires && t > Date.parse(w.expires)) retire(w, `过了 ${when(w.expires)}，用不上了`)
      else if (t - Date.parse(w.lastUsed || w.pinnedAt || w.at) > IDLE_DAYS * 864e5) retire(w, `${IDLE_DAYS} 天没用过了`)
      else if (here && w.nextAt && t >= Date.parse(w.nextAt) && w.status !== 'updating' && w.status !== 'acting') want(w.id)
    }
  }
  ctx.effect(() => { const i = setInterval(tick, 60_000); const t0 = setTimeout(tick, 15_000); return () => { clearInterval(i); clearTimeout(t0) } })
}
