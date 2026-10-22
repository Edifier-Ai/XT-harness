// Bot 圆桌: one question, several Bots. Each says what it thinks in its own role and manner, then answers the others;
// 小天 sorts where they agree and where they split into a 分歧卡, and you decide. What you decide goes into memory,
// which every Bot shares, and into 操作记录 (so it can be taken back).
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load, update, id, now, bus, flags, agentList, agentById, quick, jsonOf, plainOf, MAIN } from './store.js'
import { record, keepLooking } from './ledger.js'
import { addMemory } from './memory.js'

const J = { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }
const MAX = 4
export const tables = () => load('tables', [])
function patch(tid, fn) {
  let out
  update('tables', [], (l) => { const t = l.find((x) => x.id === tid); if (t) { fn(t); out = t } })
  if (out) bus.push({ type: 'table', table: out })
  return out
}

const who = (aid) => { const a = agentById(aid); return `${a.name}（${a.main ? '主 Bot，' : ''}${a.role || '助手'}）` }

function seat(q, aids) {
  const l = agentList().filter((a) => !a.id.startsWith('_'))
  let ids = (aids || []).filter((x) => l.some((a) => a.id === x))
  if (ids.length < 2) ids = [...new Set([...ids, ...l.map((a) => a.id)])]
  return ids.slice(0, MAX)
}

export function startTable(question, aids, by = 'user') {
  const q = String(question || '').trim().slice(0, 500)
  if (!q) throw new Error('先说说要讨论什么')
  const agents = seat(q, aids)
  if (agents.length < 2) throw new Error('圆桌至少要两个 Bot。先新建一个 Bot，再来开圆桌。')
  const t = { id: id('tb'), q, by, agents, at: now(), status: 'talking', rounds: [[], []], card: null, decision: null }
  update('tables', [], (l) => { l.push(t); if (l.length > 60) l.splice(0, l.length - 60) })
  bus.push({ type: 'table', table: t })
  run(t.id).catch((e) => { console.error('[tianxi] table', e); patch(t.id, (x) => { x.status = 'error'; x.error = e.message }) })
  return t
}

async function speak(tid, round, aid, text) {
  patch(tid, (t) => { t.rounds[round] = t.rounds[round].filter((x) => x.agent !== aid).concat({ agent: aid, text: '', live: true }) })
  const reply = await bus.say(text, { agent: aid, kind: 'table' })
  const said = plainOf(reply).slice(0, 400) || '（没有说话）'
  patch(tid, (t) => { const x = t.rounds[round].find((y) => y.agent === aid); if (x) { x.text = said; x.live = false; x.at = now() } })
  return said
}

async function run(tid) {
  const t = tables().find((x) => x.id === tid)
  const names = t.agents.map(who).join('、')
  // 第一轮: everyone says where they stand, at the same time
  await Promise.all(t.agents.map((aid) => speak(tid, 0, aid, [
    `【圆桌·第一轮】用户把一个问题拿到圆桌上，请几个 Bot 各说各的看法。`,
    `问题：「${t.q}」`,
    `在座的有：${names}。你是${agentById(aid).name}。`,
    `按你的分工和性格，直接说你的立场和最要紧的一两个理由，100 字以内，像在会上发言。不要客套，不要画卡片。`,
    `要用到事实就先用工具查（这一轮只能查，不能改任何东西）；查不到、不知道就直说，不要编。`,
  ].join('\n'))))
  // 第二轮: each answers the others
  const first = tables().find((x) => x.id === tid).rounds[0]
  await Promise.all(t.agents.map((aid) => speak(tid, 1, aid, [
    `【圆桌·第二轮】别的 Bot 是这么说的：`,
    ...first.filter((x) => x.agent !== aid).map((x) => `- ${agentById(x.agent).name}：${x.text}`),
    `你同意谁、不同意谁？一两句话回应，必要时改一下你的立场，60 字以内。不要重复你上一轮的话。`,
  ].join('\n'))))
  // 小天 sorts it into a 分歧卡
  patch(tid, (x) => { x.status = 'summing' })
  const cur = tables().find((x) => x.id === tid)
  const talk = cur.rounds.map((r, i) => r.map((x) => `${i ? '（回应）' : ''}${agentById(x.agent).name}：${x.text}`).join('\n')).join('\n')
  const sys = '你是圆桌的主持人，只整理，不加自己的观点。只输出一个 JSON 对象，不要别的文字。'
  const ask = [
    `问题：「${cur.q}」`, '发言：', talk, '',
    '把讨论整理成一张分歧卡，格式：',
    '{"agree":["大家都同意的点，每条一句"],"splits":[{"point":"分歧在哪，一句话","sides":[{"agent":"Bot 的名字","stance":"它的立场，一句话"}]}],"options":[{"label":"给用户拍板的选项，10 字以内","agents":["支持它的 Bot 名字"],"memory":"用户选了它之后要记住的结论，第三人称、一句话，比如“出差优先坐高铁”"}]}',
    '要求：只用发言里有的内容，不要编；没有共识就让 agree 为空；options 给 2 到 3 个，覆盖主要的几种立场；名字照抄。',
  ].join('\n')
  let card = null
  for (let i = 0; i < 2 && !card; i++) {
    const j = jsonOf(await quick(sys, ask))
    if (j && Array.isArray(j.options) && j.options.length) card = j
  }
  if (!card) throw new Error('没整理出分歧卡，再开一次试试')
  const idOf = (name) => { const s = String(name || '').trim(); return cur.agents.find((aid) => agentById(aid).name === s) || cur.agents.find((aid) => s.includes(agentById(aid).name)) || '' }
  const clean = {
    agree: (card.agree || []).map(String).filter(Boolean).slice(0, 4),
    splits: (card.splits || []).filter((x) => x && x.point).slice(0, 4).map((x) => ({ point: String(x.point), sides: (x.sides || []).map((y) => ({ agent: idOf(y.agent), stance: String(y.stance || '') })).filter((y) => y.agent && y.stance) })),
    options: (card.options || []).filter((x) => x && x.label).slice(0, 3).map((x) => ({ label: String(x.label).slice(0, 24), agents: (x.agents || []).map(idOf).filter(Boolean), memory: String(x.memory || x.label).slice(0, 120) })),
  }
  patch(tid, (x) => { x.card = clean; x.status = 'open'; x.readyAt = now() })
  bus.push({ type: 'nudge', what: 'table', id: tid })
  bus.nudge({ what: 'table', ref: tid, text: `圆桌讨论完了，等你拍板：${cur.q.slice(0, 40)}`, go: { view: 'table' } })
}

/** You decide: an option of the card (k) or your own words (text). It goes into memory, shared by every Bot. */
function decide(tid, { k, text }) {
  const t = tables().find((x) => x.id === tid); if (!t) throw new Error('找不到这次圆桌')
  if (t.status !== 'open') throw new Error(t.status === 'decided' ? '这次已经拍过板了' : '还在讨论，等一下')
  const opt = k !== undefined && k !== null && k !== '' ? t.card.options[+k] : null
  const own = String(text || '').trim().slice(0, 200)
  if (!opt && !own) throw new Error('选一个，或者写下你的决定')
  const label = opt ? opt.label : own, mem = opt ? opt.memory : own
  let memId = '', entry = null
  if (!flags.privateMode) {
    const m = addMemory({ text: mem, kind: '偏好', source: '圆桌拍板', quote: t.q })
    memId = m.id
    entry = record({ tool: 'table_decide', agent: '', title: `圆桌拍板：${mem}`, why: `你在圆桌上对「${t.q.slice(0, 40)}」的决定`, undo: { kind: 'memory-forget', data: { id: m.id }, label: '不记这条' } })
  }
  bus.unnudge('table', tid)
  return patch(tid, (x) => { x.status = 'decided'; x.decision = { label, memory: mem, memId, ledger: entry?.id || '', own: !opt, at: now() } })
}

export const name = 'tianxi-table'
export const inject = ['tools']

export function apply(ctx) {
  ctx.effect(() => keepLooking((aid) => bus.kindNow(aid) === 'table' ? '你在圆桌上发言，这时只能查，不能改任何东西。' : ''))
  // a table still talking when 小天 restarted: its talk was lost
  update('tables', [], (l) => { for (const t of l) if (t.status === 'talking' || t.status === 'summing') { t.status = 'error'; t.error = '小天 Bot 重启了，这次没讨论完' } })

  ctx.tools.register(defineTool({
    name: 'roundtable_start', output: J,
    description: '开一个 Bot 圆桌：用户想听听几个 Bot 的不同意见（“让大家讨论一下”“开个圆桌”“你们几个怎么看”）时用。几个 Bot 会各自发言、互相回应，最后整理成分歧卡让用户拍板。agents 填参加的 Bot 名字（不填就是所有 Bot，最多 4 个）。开了以后用一句话告诉用户，讨论在“圆桌”里进行。',
    parameters: { question: { type: 'string', required: true }, agents: { type: 'array', items: { type: 'string' } } },
    async execute(a, exec) {
      const names = (a.agents || []).map(String)
      const aids = agentList().filter((x) => names.some((n) => n && (x.name === n || n.includes(x.name)))).map((x) => x.id)
      const by = bus.aidOf(exec?.agent) || MAIN
      try {
        const t = startTable(a.question, aids, by)
        return { ok: true, id: t.id, agents: t.agents.map((x) => agentById(x).name) }
      } catch (e) { return { ok: false, reason: e.message } }
    },
  }))

  bus.state.set('tables', () => tables().slice(-30))
  Object.assign(bus.routes, {
    'POST /api/table/start': async (b) => ({ ok: true, table: startTable(b.q, b.agents || []) }),
    'POST /api/table/decide': async (b) => ({ ok: true, table: decide(b.id, b) }),
    'POST /api/table/remove': async (b) => { bus.unnudge('table', b.id); update('tables', [], (l) => l.filter((t) => t.id !== b.id || t.status === 'talking' || t.status === 'summing')); bus.push({ type: 'table' }); return { ok: true } },
  })
}
