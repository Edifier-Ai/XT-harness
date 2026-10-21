// 个人记忆: long-term memories about the user, each with where it came from. Readable, editable, deletable.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load, update, save, id, now, localISO, today, flags, bus, agentList, transcriptKey } from './store.js'
import { record, defineUndo, entries } from './ledger.js'

const KINDS = ['偏好', '事实', '人物', '习惯', '项目']
// 经验 = what 小天 learned about its own way of working, written by 反思 and accepted by the user.
export const ALL_KINDS = [...KINDS, '经验']

export function memories() { return load('memories', []) }

export function addMemory({ text, kind = '事实', source, quote }) {
  const m = { id: id('mem'), text, kind, source: source || '对话', quote: quote || '', createdAt: now(), updatedAt: now(), uses: 0 }
  update('memories', [], (l) => { l.push(m) })
  return m
}
export function editMemory(mid, text) { let m; update('memories', [], (l) => { m = l.find((x) => x.id === mid); if (m) { m.text = text; m.updatedAt = now(); m.editedByUser = true } }); return m }
export function forgetMemory(mid) { let m; update('memories', [], (l) => { const i = l.findIndex((x) => x.id === mid); if (i >= 0) m = l.splice(i, 1)[0] }); return m }

function search(q) {
  const terms = String(q || '').toLowerCase().split(/[\s,，。、]+/).filter(Boolean)
  const scored = memories().map((m) => {
    const t = (m.text + ' ' + m.kind + ' ' + m.quote).toLowerCase()
    let s = 0; for (const w of terms) if (t.includes(w)) s += 2; else for (const ch of w) if (t.includes(ch)) s += 0.1
    return [s, m]
  }).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0])
  return scored.slice(0, 12).map(([, m]) => m)
}

defineUndo('memory-forget', async ({ id: mid }) => { forgetMemory(mid); return '已忘掉这条记忆' })
defineUndo('memory-restore', async ({ memory }) => { update('memories', [], (l) => { l.push(memory) }); return '已恢复这条记忆' })
defineUndo('memory-text', async ({ id: mid, text }) => { editMemory(mid, text); return '已恢复记忆原来的说法' })

export const name = 'tianxi-memory'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  // What 小天 already knows is placed in front of the model on every step.
  ctx.systemPrompt.section({
    name: 'tianxi:memory', order: 900, interpolate: false,
    text: () => {
      const l = memories()
      if (flags.privateMode) return '【临时模式】用户开启了临时模式：这段对话不要保存任何记忆，也不要引用临时模式下说过的内容。'
      if (!l.length) return '【小天记忆】你还没有关于用户的长期记忆。用户透露稳定的偏好、事实、人物关系或习惯时，用 memory_save 记下来。'
      const facts = l.filter((m) => m.kind !== '经验'), lessons = l.filter((m) => m.kind === '经验')
      const r = load('reflections', [])[0]
      return '【小天记忆】下面是你记住的关于用户的事（每条带 id，可用 memory_search 查更多）。回答时自然地用上，不要逐条复述：\n'
        + facts.slice(-60).map((m) => `- [${m.id}] (${m.kind}) ${m.text}`).join('\n')
        + (r?.profile ? `\n\n【你对用户的整体理解（来自最近一次反思）】${r.profile}` : '')
        + (lessons.length ? '\n\n【做事经验（来自反思，用户认可过）】\n' + lessons.slice(-20).map((m) => `- ${m.text}`).join('\n') : '')
    },
  })

  ctx.tools.register(defineTool({
    name: 'memory_save',
    description: '记住一条关于用户的长期信息（偏好、事实、人物、习惯、项目）。只记稳定、以后用得上的信息；一条只写一件事，用第三人称简洁陈述，例如“出差不坐红眼航班”。quote 填用户的原话，作为出处。',
    parameters: {
      text: { type: 'string', required: true, description: '要记住的内容' },
      kind: { type: 'string', enum: KINDS, description: '类别' },
      quote: { type: 'string', description: '用户原话，作为出处' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) {
      if (flags.privateMode) return { saved: false, reason: '临时模式下不保存记忆' }
      const dup = memories().find((m) => m.text === args.text)
      if (dup) return { saved: false, reason: '已经记过', id: dup.id }
      const m = addMemory({ text: args.text, kind: args.kind, quote: args.quote, source: '对话' })
      record({ tool: 'memory_save', title: '记住了：' + m.text, why: args.quote ? `你说过“${args.quote}”` : '', undo: { kind: 'memory-forget', data: { id: m.id }, label: '忘掉' } })
      return { saved: true, id: m.id }
    },
  }))

  // ---------- 反思: the agent looks back over conversations, memories and the user's corrections ----------
  ctx.tools.register(defineTool({
    name: 'reflection_publish',
    description: [
      '只在“反思”任务里调用：把这次反思的结果交给用户看。不会直接改记忆，每条建议都要用户点头。',
      'profile：一段 80 字以内的话，说你现在怎么理解这个用户（第二人称“你”）。',
      'insights：[{text, memIds:[相关记忆 id], evidence:[用户原话]}] 从多条记忆和对话里看出的规律。',
      'proposals：[{op:"add"|"merge"|"update"|"forget", ids?:[记忆 id], text?, kind?, why}] 记忆整理建议：add 新记一条；merge 把 ids 合成一条 text；update 把 ids[0] 改成 text；forget 删掉过时或矛盾的 ids。',
      'lessons：[{text, why}] 你自己做事要改进的地方，尤其是用户撤回过、纠正过、出过错的事。',
    ].join('\n'),
    parameters: { profile: { type: 'string', required: true }, insights: { type: 'array', items: { type: 'json' } }, proposals: { type: 'array', items: { type: 'json' } }, lessons: { type: 'array', items: { type: 'json' } } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(a) {
      const ids = new Set(memories().map((m) => m.id))
      const ok = (l) => (Array.isArray(l) ? l : []).filter((x) => x && typeof x === 'object')
      const r = {
        id: id('ref'), at: now(), reason: pendingReason || '手动', stats: pendingStats || {},
        profile: String(a.profile || ''),
        insights: ok(a.insights).map((x) => ({ text: String(x.text || ''), memIds: (x.memIds || []).filter((m) => ids.has(m)), evidence: (x.evidence || []).map(String).slice(0, 3) })),
        proposals: ok(a.proposals).filter((x) => ['add', 'merge', 'update', 'forget'].includes(x.op)).map((x) => { const mids = (x.ids || []).filter((m) => ids.has(m)); return { id: id('p'), op: x.op, ids: mids, olds: mids.map((m) => memories().find((y) => y.id === m)?.text || ''), text: x.text ? String(x.text) : '', kind: ALL_KINDS.includes(x.kind) ? x.kind : '事实', why: String(x.why || ''), status: 'open' } })
          .filter((x) => x.op === 'add' ? x.text : x.ids.length),
        lessons: ok(a.lessons).map((x) => ({ id: id('p'), text: String(x.text || ''), why: String(x.why || ''), status: 'open' })).filter((x) => x.text),
      }
      update('reflections', [], (l) => { l.unshift(r); if (l.length > 30) l.length = 30 })
      return { ok: true, proposals: r.proposals.length, lessons: r.lessons.length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: '在小天的长期记忆里查找和问题相关的条目。',
    parameters: { query: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) {
      const hits = search(args.query)
      update('memories', [], (l) => { for (const h of hits) { const m = l.find((x) => x.id === h.id); if (m) m.uses = (m.uses || 0) + 1 } })
      return hits.map(({ id: i, text, kind, quote, source }) => ({ id: i, text, kind, quote, source }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_update',
    description: '修正一条已有记忆（用户说之前记错了，或偏好变了）。',
    parameters: { id: { type: 'string', required: true }, text: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) {
      const old = memories().find((m) => m.id === args.id)
      if (!old) return { ok: false, reason: '没有这条记忆' }
      editMemory(args.id, args.text)
      record({ tool: 'memory_update', title: `把记忆“${old.text}”改成“${args.text}”`, undo: { kind: 'memory-text', data: { id: args.id, text: old.text }, label: '改回去' } })
      return { ok: true }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: '删除一条记忆（用户要求忘掉）。',
    parameters: { id: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args) {
      const m = forgetMemory(args.id)
      if (!m) return { ok: false }
      record({ tool: 'memory_forget', title: '忘掉了：' + m.text, undo: { kind: 'memory-restore', data: { memory: m }, label: '恢复' } })
      return { ok: true }
    },
  }))
}

// ---------- 反思 ----------
let pendingReason = '', pendingStats = null

export function reflections() { return load('reflections', []) }

export function reflectPrompt() {
  const last = reflections()[0]
  const since = last ? Date.parse(last.at) : Date.now() - 7 * 86400e3
  const said = []
  for (const a of agentList()) for (const t of load(transcriptKey(a.id), [])) {
    if (t.role === 'user' && Date.parse(t.at) > since) said.push(`- ${t.at.slice(0, 16).replace('T', ' ')} 对${a.name}说：${String(t.text).slice(0, 200)}`)
  }
  const undone = entries().filter((e) => e.status === 'undone' && Date.parse(e.undoneAt || e.at) > since).map((e) => `- ${e.title}（用户撤回了）`)
  const mems = memories().map((m) => `- [${m.id}] (${m.kind}) ${m.text}${m.quote ? ` ——原话“${m.quote.slice(0, 60)}”` : ''}${m.editedByUser ? '（用户亲手改过）' : ''} · 记于 ${m.createdAt.slice(0, 10)} · 用过 ${m.uses || 0} 次`)
  pendingStats = { said: said.length, memories: mems.length, undone: undone.length }
  return [
    `【小天反思】现在是 ${localISO().replace('T', ' ')}。像人睡前回想一天那样，安静地想一想${last ? '上次反思以来' : '最近一周'}和用户的相处。不要动手做任何事，不要改记忆，只调用一次 reflection_publish 交出结果。`,
    '要想的事：',
    '1. 你现在怎么理解这个用户：在意什么、怎么做决定、最近在忙什么。',
    '2. 多条记忆和对话放在一起看，有什么规律或联系（每条写清楚是哪几条记忆、用户哪句原话）。',
    '3. 记忆要不要整理：重复的合并，矛盾或过时的改掉或忘掉，对话里有但还没记下的稳定信息补上。用户亲手改过的记忆不要动。',
    '4. 你自己哪里做得不好：用户撤回过的事、纠正过你的地方，下次该怎么做。',
    '只写有依据的，没有就留空，不要硬凑。',
    '', '现有记忆：', ...(mems.length ? mems : ['- 无']),
    '', '这段时间用户说过的话：', ...(said.length ? said.slice(-80) : ['- 无']),
    '', '用户撤回过的事：', ...(undone.length ? undone.slice(-20) : ['- 无']),
  ].join('\n')
}

export async function runReflect(reason = '手动') {
  if (!bus.say) throw new Error('小天还没准备好')
  pendingReason = reason
  await bus.say(reflectPrompt(), { kind: 'reflect' })
  update('state', {}, (s) => { s.lastReflectDate = today() })
  pendingReason = ''
}

/** The user accepts or ignores one suggestion from a reflection. Accepted changes go through the ledger, so they can be undone. */
export function applyProposal(rid, pid, accept) {
  const r = reflections().find((x) => x.id === rid)
  const p = r && [...r.proposals, ...r.lessons].find((x) => x.id === pid)
  if (!p) throw new Error('找不到这条建议')
  if (p.status !== 'open') return p
  if (accept) {
    const byId = (i) => memories().find((m) => m.id === i)
    if (!p.op) {
      const m = addMemory({ text: p.text, kind: '经验', source: '反思', quote: p.why })
      record({ tool: 'reflection', title: '记下做事经验：' + m.text, why: p.why, undo: { kind: 'memory-forget', data: { id: m.id }, label: '不要这条' } })
    } else if (p.op === 'add') {
      const m = addMemory({ text: p.text, kind: p.kind, source: '反思', quote: p.why })
      record({ tool: 'reflection', title: '反思后记住：' + m.text, why: p.why, undo: { kind: 'memory-forget', data: { id: m.id }, label: '忘掉' } })
    } else if (p.op === 'update') {
      const old = byId(p.ids[0]); if (!old) throw new Error('这条记忆已经不在了')
      editMemory(old.id, p.text)
      record({ tool: 'reflection', title: `反思后把“${old.text}”改成“${p.text}”`, why: p.why, undo: { kind: 'memory-text', data: { id: old.id, text: old.text }, label: '改回去' } })
    } else if (p.op === 'forget') {
      for (const i of p.ids) { const m = forgetMemory(i); if (m) record({ tool: 'reflection', title: '反思后忘掉：' + m.text, why: p.why, undo: { kind: 'memory-restore', data: { memory: m }, label: '恢复' } }) }
    } else if (p.op === 'merge') {
      const olds = p.ids.map(byId).filter(Boolean)
      const kind = olds[0]?.kind || p.kind
      const m = addMemory({ text: p.text, kind, source: '反思合并', quote: olds.map((o) => o.quote).filter(Boolean).join(' / ') })
      for (const o of olds) forgetMemory(o.id)
      record({ tool: 'reflection', title: `反思后把 ${olds.length} 条记忆合成一条：${m.text}`, why: p.why, undo: { kind: 'memory-unmerge', data: { id: m.id, olds }, label: '拆回去' } })
    }
  }
  let out
  update('reflections', [], (l) => { const x = l.find((y) => y.id === rid); out = [...x.proposals, ...x.lessons].find((y) => y.id === pid); out.status = accept ? 'accepted' : 'ignored' })
  return out
}
defineUndo('memory-unmerge', async ({ id: mid, olds }) => { forgetMemory(mid); update('memories', [], (l) => { l.push(...olds) }); return '已把合并的记忆拆回原来的几条' })
