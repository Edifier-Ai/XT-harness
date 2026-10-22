// Bot 动态: what the Bots did on their own (a queued job while you were away, a mail from another Bot, the brief,
// a decision you made on the brief page) is posted like a moment in a feed, with what it changed. A like means
// "以后这样做": it becomes a 做事经验 every Bot reads. A comment is a correction: the Bot answers under it and fixes it.
import { load, update, id, now, bus, flags, agentById, transcriptKey, quick, plainOf, WORKER } from './store.js'
import { record, defineUndo, entries, undoEntry } from './ledger.js'
import { addMemory, forgetMemory } from './memory.js'

const POSTED = new Set(['job', 'mail', 'act', 'brief', 'reflect'])
const FENCE = /```[ \t]*(?:openui-lang|openui)[^\n]*\n([\s\S]*?)\n[ \t]*```/
export const posts = () => load('feed', [])
function patch(pid, fn) {
  let out
  update('feed', [], (l) => { const p = l.find((x) => x.id === pid); if (p) { fn(p); out = p } })
  if (out) bus.push({ type: 'post', post: out })
  return out
}

defineUndo('feed-unlike', async ({ pid, memId }) => { if (memId) forgetMemory(memId); patch(pid, (p) => { p.like = null }); return '已取消点赞，也不记这条经验了' })

/** A turn the Bot did on its own becomes a post, if it did or said anything. */
function onTurnEnd({ aid, kind, turn, text, at }) {
  if (!POSTED.has(kind) || aid === WORKER) return
  const items = load(transcriptKey(aid), [])
  const head = items.find((t) => t.id === turn)
  const tools = items.filter((t) => t.turn === turn && t.role === 'tool')
  const since = head ? Date.parse(head.at) - 1000 : Date.now() - 600e3
  const acts = entries().filter((e) => e.agent === aid && Date.parse(e.at) >= since && e.status === 'done').map((e) => e.id)
  const words = plainOf(text)
  if (!acts.length && !words) return
  const steps = {}
  for (const t of tools) if (t.state !== 'error') steps[t.name] = (steps[t.name] || 0) + 1
  const card = FENCE.exec(String(text || ''))?.[1] || ''
  const p = {
    id: id('post'), agent: aid, kind, turn, at: at || now(), text: words.slice(0, 600), card: card.slice(0, 8000),
    mail: kind === 'mail' && head?.mail ? { from: head.mail.fromName || head.mail.from, subject: head.mail.subject } : null,
    steps: Object.entries(steps).map(([name, n]) => ({ name, n })), acts,
    // the user had been away (or it was night work): a post they did not see happen
    away: flags.idleSec >= 60 || kind === 'job' || kind === 'reflect' || kind === 'brief',
    like: null, comments: [],
  }
  update('feed', [], (l) => { l.push(p); if (l.length > 300) l.splice(0, l.length - 300) })
  bus.push({ type: 'post', post: p })
  bus.push({ type: 'nudge', what: 'post', id: p.id })
}

/** 点赞 = 以后这样做: the Bot's way of doing it, in one sentence, becomes a 做事经验. */
async function like(pid) {
  const p = posts().find((x) => x.id === pid); if (!p) throw new Error('找不到这条动态')
  if (p.like) {
    if (p.like.ledger) try { await undoEntry(p.like.ledger) } catch {}
    if (posts().find((x) => x.id === pid)?.like) patch(pid, (x) => { x.like = null })
    return posts().find((x) => x.id === pid)
  }
  const a = agentById(p.agent)
  const did = entries().filter((e) => p.acts.includes(e.id)).map((e) => `- ${e.title}${e.why ? `（${e.why}）` : ''}`)
  patch(pid, (x) => { x.like = { at: now(), pending: true } })
  let lesson = ''
  try {
    lesson = plainOf(await quick('你帮一个个人智能体总结做事经验。只输出一句话，不要别的。',
      [`${a.name}（${a.role || '助手'}）自己做了这件事，用户点了赞，意思是“以后遇到同样的情况就这样做”。`, `它说：${p.text || '（没说话）'}`, did.length ? `它做的事：\n${did.join('\n')}` : '',
        '把这当成以后的做法，写成一句做事经验：说清什么情况下、怎么做，以 Bot 的名字开头，30 字以内，只用上面有的内容。'].filter(Boolean).join('\n'), { max: 200 })).slice(0, 80)
  } catch (e) { console.error('[tianxi] like', e.message) }
  if (!lesson) lesson = `${a.name}：以后遇到同样的事，照“${(p.text || '这次').slice(0, 30)}”这样做`
  if (flags.privateMode) return patch(pid, (x) => { x.like = { at: now(), text: lesson, memId: '', ledger: '' } })
  const m = addMemory({ text: lesson, kind: '经验', source: '动态点赞', quote: (p.text || '').slice(0, 80) })
  const e = record({ tool: 'feed_like', agent: '', title: '记下做事经验：' + lesson, why: `你给${a.name}的动态点了赞`, undo: { kind: 'feed-unlike', data: { pid, memId: m.id }, label: '取消点赞' } })
  return patch(pid, (x) => { x.like = { at: now(), text: lesson, memId: m.id, ledger: e.id } })
}

/** 评论 = 纠正: the Bot reads it, fixes what it did and answers under the post. */
function comment(pid, text) {
  const p = posts().find((x) => x.id === pid); if (!p) throw new Error('找不到这条动态')
  const said = String(text || '').trim().slice(0, 500); if (!said) throw new Error('写点什么')
  const a = agentById(p.agent)
  const did = entries().filter((e) => p.acts.includes(e.id)).map((e) => `- [${e.id}] ${e.title}${e.status === 'undone' ? '（已撤回）' : ''}`)
  const cid = id('c')
  patch(pid, (x) => { x.comments.push({ id: cid, by: 'user', text: said, at: now() }, { id: cid + 'r', by: p.agent, text: '', live: true, at: now() }) })
  bus.say([
    `【动态里的纠正】你之前自己做了一件事，发在了 Bot 动态里：`,
    `你当时说：${p.text || '（没说话）'}`, did.length ? `你做的事（操作记录 id）：\n${did.join('\n')}` : '',
    `用户在下面评论：「${said}」`,
    '这是对你的纠正。按用户说的去改：做错的先用 undo_actions 撤回再重做，缺的补上；用户说的是以后的做法，就用 memory_save 记下来。',
    '最后用一两句话回复用户（这句话会作为你的回复显示在评论下面），说你改了什么。',
  ].filter(Boolean).join('\n'), { agent: a.id, kind: 'feedfix' })
    .then((reply) => patch(pid, (x) => { const c = x.comments.find((y) => y.id === cid + 'r'); if (c) { c.text = plainOf(reply).slice(0, 300) || '好的，改了。'; c.live = false; c.at = now() } }))
    .catch((e) => patch(pid, (x) => { const c = x.comments.find((y) => y.id === cid + 'r'); if (c) { c.text = '没改成：' + e.message; c.live = false } }))
  return posts().find((x) => x.id === pid)
}

export const name = 'tianxi-feed'

export function apply(ctx) {
  ctx.effect(() => { bus.turnEnd.add(onTurnEnd); return () => bus.turnEnd.delete(onTurnEnd) })
  bus.state.set('feed', () => posts().slice(-80))
  Object.assign(bus.routes, {
    'POST /api/feed/like': async (b) => ({ ok: true, post: await like(b.id) }),
    'POST /api/feed/comment': async (b) => ({ ok: true, post: comment(b.id, b.text) }),
    'POST /api/feed/remove': async (b) => { update('feed', [], (l) => l.filter((p) => p.id !== b.id)); bus.push({ type: 'post' }); return { ok: true } },
  })
}
