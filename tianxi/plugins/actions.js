// 小天 action tools: calendar, to-dos, mail outbox, files, generative UI and the daily brief.
// Every tool that changes something writes a ledger entry with its own undo.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load, update, save, id, now, localISO, today, bus, agentById, agentByEmail, agentList } from './store.js'
import { record, defineUndo, markRisky } from './ledger.js'

const J = { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }
const WHY = { type: 'string', description: '一句话说明为什么这样做（会写进操作记录给用户看）' }
const fmt = (s) => String(s || '').replace('T', ' ')

// ---------- undo kinds ----------
defineUndo('cal-remove', async ({ id: eid }) => { update('calendar', [], (l) => l.filter((e) => e.id !== eid)); return '已从日历里删掉这条日程' })
defineUndo('cal-restore', async ({ event }) => { update('calendar', [], (l) => { const i = l.findIndex((e) => e.id === event.id); if (i >= 0) l[i] = event; else l.push(event) }); return `已恢复日程“${event.title}”（${fmt(event.start)}）` })
defineUndo('todo-remove', async ({ id: tid }) => { update('todos', [], (l) => l.filter((t) => t.id !== tid)); return '已删除这条待办' })
defineUndo('todo-reopen', async ({ id: tid }) => { update('todos', [], (l) => { const t = l.find((x) => x.id === tid); if (t) t.done = false }); return '已把待办改回未完成' })
defineUndo('mail-discard', async ({ id: mid }) => { update('outbox', [], (l) => l.filter((m) => m.id !== mid)); return '已删除这封草稿' })
defineUndo('mail-recall', async ({ id: mid }) => { update('outbox', [], (l) => { const m = l.find((x) => x.id === mid); if (m) { m.status = 'recalled'; m.recalledAt = now() } }); update('inbox', [], (l) => l.filter((x) => x.outId !== mid)); return '已召回这封邮件' })
defineUndo('file-move-back', async ({ from, to }) => { fs.mkdirSync(path.dirname(from), { recursive: true }); fs.renameSync(to, from); return `已把文件移回 ${from}` })
defineUndo('dir-remove', async ({ dir }) => { try { fs.rmdirSync(dir) } catch { return '文件夹里已经有东西，没有删除：' + dir } return '已删除新建的文件夹 ' + dir })

markRisky('mail_send', (a) => {
  const m = load('outbox', []).find((x) => x.id === a.id)
  if (m && agentByEmail(m.to)) return ''   // mail between your own agents stays inside 小天
  return `要对外发送邮件${m ? '给 ' + m.to : ''}。对外发送需要你确认。`
})

export const name = 'tianxi-actions'
export const inject = ['tools']

export function apply(ctx) {
  const reg = (t) => ctx.tools.register(defineTool({ output: J, ...t }))

  // ---------- calendar ----------
  reg({
    name: 'calendar_list', description: '查看小天日历里的日程。时间用本地时间 YYYY-MM-DDTHH:mm。不填 from/to 时返回今天起 7 天。',
    parameters: { from: { type: 'string' }, to: { type: 'string' } },
    async execute(a) {
      const from = a.from || today() + 'T00:00'
      const to = a.to || localISO(new Date(Date.now() + 7 * 864e5))
      return load('calendar', []).filter((e) => e.end >= from && e.start <= to).sort((x, y) => x.start.localeCompare(y.start))
    },
  })
  reg({
    name: 'calendar_add', description: '在小天日历里添加日程。会检查冲突并在结果里告诉你。',
    parameters: { title: { type: 'string', required: true }, start: { type: 'string', required: true }, end: { type: 'string', required: true }, location: { type: 'string' }, people: { type: 'array', items: { type: 'string' } }, reason: WHY },
    async execute(a) {
      const ev = { id: id('ev'), title: a.title, start: a.start, end: a.end, location: a.location || '', people: a.people || [], createdBy: '小天', createdAt: now() }
      const conflicts = load('calendar', []).filter((e) => e.start < ev.end && e.end > ev.start)
      update('calendar', [], (l) => { l.push(ev) })
      record({ tool: 'calendar_add', title: `添加日程“${ev.title}”（${fmt(ev.start)}–${ev.end.slice(11)}）`, why: a.reason, undo: { kind: 'cal-remove', data: { id: ev.id }, label: '删掉' } })
      return { ok: true, event: ev, conflicts }
    },
  })
  reg({
    name: 'calendar_update', description: '修改日程的时间、标题或地点。',
    parameters: { id: { type: 'string', required: true }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, location: { type: 'string' }, reason: WHY },
    async execute(a) {
      const old = load('calendar', []).find((e) => e.id === a.id)
      if (!old) return { ok: false, reason: '没有这条日程' }
      const next = { ...old, ...Object.fromEntries(['title', 'start', 'end', 'location'].filter((k) => a[k]).map((k) => [k, a[k]])) }
      update('calendar', [], (l) => { l[l.findIndex((e) => e.id === a.id)] = next })
      record({ tool: 'calendar_update', title: `把“${old.title}”从 ${fmt(old.start)} 改到 ${fmt(next.start)}`, why: a.reason, undo: { kind: 'cal-restore', data: { event: old }, label: '改回去' } })
      return { ok: true, event: next }
    },
  })
  reg({
    name: 'calendar_delete', description: '删除一条日程。',
    parameters: { id: { type: 'string', required: true }, reason: WHY },
    async execute(a) {
      const old = load('calendar', []).find((e) => e.id === a.id)
      if (!old) return { ok: false }
      update('calendar', [], (l) => l.filter((e) => e.id !== a.id))
      record({ tool: 'calendar_delete', title: `删除日程“${old.title}”（${fmt(old.start)}）`, why: a.reason, undo: { kind: 'cal-restore', data: { event: old }, label: '恢复' } })
      return { ok: true }
    },
  })

  // ---------- to-dos ----------
  reg({ name: 'todo_list', description: '查看待办（默认只看未完成）。', parameters: { all: { type: 'boolean' } }, async execute(a) { return load('todos', []).filter((t) => a.all || !t.done) } })
  reg({
    name: 'todo_add', description: '添加一条待办。', parameters: { title: { type: 'string', required: true }, due: { type: 'string' }, reason: WHY },
    async execute(a) {
      const t = { id: id('todo'), title: a.title, due: a.due || '', done: false, createdAt: now() }
      update('todos', [], (l) => { l.push(t) })
      record({ tool: 'todo_add', title: '添加待办：' + t.title, why: a.reason, undo: { kind: 'todo-remove', data: { id: t.id }, label: '删掉' } })
      return { ok: true, todo: t }
    },
  })
  reg({
    name: 'todo_done', description: '把待办标为完成。', parameters: { id: { type: 'string', required: true }, reason: WHY },
    async execute(a) {
      let t; update('todos', [], (l) => { t = l.find((x) => x.id === a.id); if (t) t.done = true })
      if (!t) return { ok: false }
      record({ tool: 'todo_done', title: '完成待办：' + t.title, why: a.reason, undo: { kind: 'todo-reopen', data: { id: t.id }, label: '改回未完成' } })
      return { ok: true }
    },
  })

  // ---------- mail: every agent has its own address; mail between agents is delivered locally ----------
  const me = (exec) => agentById(bus.agentOf(exec?.callId))
  reg({
    name: 'mail_draft', description: '用你自己的邮箱起草一封邮件放进发件箱（还没有发出）。可以写给用户的联系人，也可以写给别的智能体（地址见人设里的“智能体通讯录”）。语气参照记忆里用户和对方的习惯。',
    parameters: { to: { type: 'string', required: true }, subject: { type: 'string', required: true }, body: { type: 'string', required: true }, reason: WHY },
    async execute(a, exec) {
      const from = me(exec)
      const m = { id: id('mail'), agent: from.id, from: from.email, fromName: from.name, to: a.to, subject: a.subject, body: a.body, status: 'draft', createdAt: now() }
      update('outbox', [], (l) => { l.push(m) })
      record({ tool: 'mail_draft', title: `${from.name}起草邮件给 ${a.to}：${a.subject}`, why: a.reason, undo: { kind: 'mail-discard', data: { id: m.id }, label: '删除草稿' } })
      return { ok: true, draft: m }
    },
  })
  reg({
    name: 'mail_send', description: '发送发件箱里的一封草稿。发给别的智能体会直接送到它的收件箱；对外发送前系统会请用户确认。',
    parameters: { id: { type: 'string', required: true }, reason: WHY },
    async execute(a, exec) {
      const draft = load('outbox', []).find((x) => x.id === a.id)
      if (!draft) return { ok: false, reason: '没有这封草稿' }
      const target = agentByEmail(draft.to)
      const hops = bus.hopsOf(draft.agent) + 1
      let m; update('outbox', [], (l) => { m = l.find((x) => x.id === a.id); m.status = target ? 'delivered' : 'sent'; m.sentAt = now() })
      if (target) {
        const inmail = { id: id('in'), agent: target.id, from: m.from, fromName: m.fromName, to: target.email, subject: m.subject, body: m.body, at: now(), hops, read: false, outId: m.id }
        update('inbox', [], (l) => { l.push(inmail); if (l.length > 1000) l.splice(0, l.length - 1000) })
        record({ tool: 'mail_send', title: `${m.fromName || '小天'}给${target.name}发邮件：${m.subject}`, why: a.reason, undo: { kind: 'mail-recall', data: { id: m.id }, label: '撤回' } })
        bus.deliver?.(target.id, inmail)
        return { ok: true, delivered: target.name, note: `已送到${target.name}的收件箱，它会自己处理。` }
      }
      record({ tool: 'mail_send', title: `发送邮件给 ${m.to}：${m.subject}`, why: a.reason, risk: 'high', undo: { kind: 'mail-recall', data: { id: m.id }, label: '召回' } })
      return { ok: true, note: '已放入本地发件箱的“已发送”。当前版本没有连接真实邮箱。' }
    },
  })
  reg({
    name: 'mail_inbox', description: '查看你自己邮箱的收件箱（最近 20 封，新的在前）。',
    parameters: { unreadOnly: { type: 'boolean' } },
    async execute(a, exec) {
      const who = me(exec)
      const l = load('inbox', []).filter((x) => x.agent === who.id && (!a.unreadOnly || !x.read)).slice(-20).reverse()
      update('inbox', [], (all) => { for (const x of all) if (x.agent === who.id) x.read = true })
      return { address: who.email, mails: l.map(({ id: i, from, fromName, subject, body, at }) => ({ id: i, from, fromName, subject, body, at })) }
    },
  })

  // ---------- files ----------
  reg({
    name: 'folder_list', description: '列出一个文件夹里的文件（名称、大小、修改时间）。路径可用 ~ 表示用户主目录，如 ~/Downloads。',
    parameters: { path: { type: 'string', required: true }, limit: { type: 'integer' } },
    async execute(a) {
      const dir = a.path.replace(/^~/, os.homedir())
      const items = fs.readdirSync(dir, { withFileTypes: true }).slice(0, a.limit || 200).map((d) => {
        let st = {}; try { st = fs.statSync(path.join(dir, d.name)) } catch {}
        return { name: d.name, dir: d.isDirectory(), size: st.size, modified: st.mtime ? localISO(st.mtime) : '' }
      })
      return { dir, count: items.length, items }
    },
  })
  reg({
    name: 'file_move', description: '移动或重命名一个文件（整理文件夹时用）。目标文件夹不存在会自动建立。可撤回。',
    parameters: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, reason: WHY },
    async execute(a) {
      const from = a.from.replace(/^~/, os.homedir()); let to = a.to.replace(/^~/, os.homedir())
      if (fs.existsSync(to) && fs.statSync(to).isDirectory()) to = path.join(to, path.basename(from))
      if (fs.existsSync(to)) return { ok: false, reason: '目标位置已有同名文件' }
      const parent = path.dirname(to); const made = !fs.existsSync(parent)
      fs.mkdirSync(parent, { recursive: true }); fs.renameSync(from, to)
      if (made) record({ tool: 'file_move', title: '新建文件夹 ' + parent, undo: { kind: 'dir-remove', data: { dir: parent }, label: '删除空文件夹' } })
      record({ tool: 'file_move', title: `把 ${path.basename(from)} 移到 ${parent}`, why: a.reason, undo: { kind: 'file-move-back', data: { from, to }, label: '移回去' } })
      return { ok: true, to }
    },
  })

  // ---------- generative UI ----------
  reg({
    name: 'show_ui',
    description: [
      '在小天 Bot 界面里直接生成一个可以操作的界面，而不是只回复文字。能用控件回答的，优先用它。',
      'blocks 是一个数组，每个元素是一种块：',
      '{type:"text", text}；{type:"kv", items:[{k,v}]}；{type:"list", items:[{title, sub?, tag?}]}；',
      '{type:"table", columns:[...], rows:[[...]]}；{type:"timeline", items:[{time, title, sub?, tag?}]}；',
      '{type:"metric", items:[{label, value, note?}]}；',
      '{type:"choices", prompt?, options:[{label, say, primary?}]} 用户点按钮时，小天会收到 say 里的话；',
      '{type:"form", fields:[{key, label, kind:"select"|"range"|"text"|"toggle", options?, min?, max?, step?, value?, unit?}], submit:{label, say}} 用户提交时，小天会收到 say 加上各字段的取值（JSON）。',
      '图文块：{type:"image", src, caption?}；{type:"files", items:[{path, note?}]}；{type:"bar", unit?, items:[{label, value}]}；{type:"progress", items:[{label, value:0到1}]}；{type:"schedule", items:[{start, end, title, conflict?}]}。',
      '控件改变后要重新调用 show_ui 给出更新后的界面。',
    ].join('\n'),
    parameters: { title: { type: 'string' }, subtitle: { type: 'string' }, blocks: { type: 'array', required: true, items: { type: 'json' } } },
    async execute(a) { return { shown: true, blocks: a.blocks.length } },
  })

  // ---------- 每日简报: its own page, laid out as generated cards ----------
  reg({
    name: 'brief_publish',
    description: [
      '发布今天的“每日简报”。简报是单独的一页，不在对话里，要图文并茂、一眼看懂：先给结果，再给要用户定的事。',
      'sections 是卡片数组，每张 {kind, title, detail?, size?, blocks?, actions?}：',
      'kind："decide" 需要用户拍板（必须带 actions:[{label, say, primary?}]，用户点按钮时你会收到 say）；"done" 已经替用户做完；"doing" 还在做；"info" 值得知道的信息。',
      'size："l" 今天最重要的一两张大卡，"m" 普通，"s" 小卡。最重要的放前面。',
      'blocks 用和 show_ui 一样的块，另外简报里推荐用这些图文块：',
      '{type:"schedule", items:[{start:"HH:mm", end:"HH:mm", title, tag?, conflict?:true}]} 画成今天的时间轴；',
      '{type:"files", items:[{path, note?}]} 新文件，图片会显示缩略图；{type:"image", src:本地图片路径或网址, caption?}；',
      '{type:"bar", unit?, items:[{label, value}]} 简单柱状对比；{type:"progress", items:[{label, value:0到1}]}；{type:"quote", text, from?}。',
      'hero 可选 {title, text, image?}：放在最上面的一句话主题，比如“今天下午两个会撞了”。',
    ].join('\n'),
    parameters: { greeting: { type: 'string' }, summary: { type: 'string', required: true }, hero: { type: 'json' }, sections: { type: 'array', items: { type: 'json' } }, items: { type: 'array', items: { type: 'json' } } },
    async execute(a) {
      const list = a.sections || a.items || []
      const items = list.map((x) => ({ id: id('it'), status: 'open', size: 'm', ...x }))
      save('brief', { date: today(), at: now(), greeting: a.greeting || '', summary: a.summary, hero: a.hero || null, items })
      return { ok: true, sections: items.length }
    },
  })
  reg({
    name: 'brief_resolve', description: '把首页上的一张“需要你定”卡片标为已处理，并写明结果。',
    parameters: { id: { type: 'string', required: true }, result: { type: 'string', required: true } },
    async execute(a) {
      update('brief', {}, (b) => { const it = (b.items || []).find((x) => x.id === a.id); if (it) { it.status = 'resolved'; it.result = a.result } })
      return { ok: true }
    },
  })

  // ---------- 交给小天稍后做 ----------
  reg({
    name: 'later_add', description: '把一件事放进小天的后台队列，在用户离开电脑或夜里再做，做完写进第二天的简报。',
    parameters: { title: { type: 'string', required: true }, instructions: { type: 'string', required: true }, when: { type: 'string', enum: ['idle', 'night'] } },
    async execute(a) {
      const t = { id: id('job'), title: a.title, instructions: a.instructions, when: a.when || 'idle', status: 'queued', createdAt: now() }
      update('later', [], (l) => { l.push(t) })
      record({ tool: 'later_add', title: '记下稍后要做：' + t.title, undo: { kind: 'later-remove', data: { id: t.id }, label: '不做了' } })
      return { ok: true, job: t }
    },
  })
  defineUndo('later-remove', async ({ id: jid }) => { update('later', [], (l) => l.filter((x) => x.id !== jid)); return '已从后台队列里删掉' })
}
