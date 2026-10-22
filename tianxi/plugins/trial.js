// 试用期 Bot: a new Bot does not act at first. It only looks things up and hands in plans (plan_propose); you say
// "照这个做" and only then does it do that one thing. When enough of its plans were right, it asks to be made
// regular, and one click (一键转正) lets it act on its own like the others. Every step goes into 操作记录.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load, update, save, id, now, bus, agentList, agentById, MAIN } from './store.js'
import { record, defineUndo, keepLooking } from './ledger.js'

const J = { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }
const NEED = 3

export const proposals = () => load('proposals', [])
const patchProposal = (pid, p) => { let out; update('proposals', [], (l) => { const x = l.find((y) => y.id === pid); if (x) { Object.assign(x, p); out = x } }); return out }
function patchAgent(aid, fn) {
  const l = agentList().map((a) => ({ ...a }))
  const a = l.find((x) => x.id === aid); if (!a) throw new Error('没有这个 Bot')
  fn(a); save('agents', l)
  return a
}
const onTrial = (aid) => !!agentById(aid)?.trial && agentById(aid).id === aid

// a plan you said yes to is carried out in that one turn
const grants = new Map()   // aid -> proposal id

defineUndo('trial-restore', async ({ aid, trial }) => { patchAgent(aid, (a) => { a.trial = trial; delete a.promotedAt }); return '已让它回到试用期' })
defineUndo('trial-end', async ({ aid }) => { patchAgent(aid, (a) => { delete a.trial }); return '已结束它的试用期' })

/** Put a line about its 试用期 into the Bot's chat (an application, being made regular). */
function note(aid, trial) { bus.addItem?.(aid, { role: 'system', kind: 'trial', text: '试用期', trial, endAt: now() }) }

/** Enough plans were right: the Bot asks to be made regular. The numbers and the plans listed are its real record. */
function askToBeRegular(aid) {
  const a = agentById(aid); if (!a?.trial || a.trial.applied) return
  const mine = proposals().filter((p) => p.agent === aid)
  const ok = mine.filter((p) => p.status === 'approved' || p.status === 'done')
  patchAgent(aid, (x) => { x.trial.applied = now() })
  note(aid, { type: 'apply', ok: ok.length, total: mine.filter((p) => p.status !== 'open').length, titles: ok.slice(-5).map((p) => p.title), at: now() })
  bus.push({ type: 'trial', agent: aid })
}

export const name = 'tianxi-trial'
export const inject = ['tools']

export function apply(ctx) {
  ctx.effect(() => keepLooking((aid) => onTrial(aid) && grants.get(aid) === undefined
    ? '你还在试用期，不能直接动手。把你打算怎么做用 plan_propose 交给用户，等用户说“照这个做”再做。' : ''))

  ctx.tools.register(defineTool({
    name: 'plan_propose', output: J,
    description: '试用期的 Bot 用：把你打算替用户做的事写成一个方案交给用户，用户同意后你才去做。title 一句话说做什么；steps 是具体的几步（每步写清楚动哪个文件、哪条日程、发给谁）；why 说为什么这样做。交了就停下等用户，不要自己去做。',
    parameters: { title: { type: 'string', required: true }, steps: { type: 'array', required: true, items: { type: 'string' } }, why: { type: 'string' } },
    async execute(a, exec) {
      const aid = bus.aidOf(exec?.agent) || MAIN
      if (!onTrial(aid)) return { ok: false, reason: '你已经转正了，不用交方案，直接去做。' }
      const p = { id: id('plan'), agent: aid, callId: exec?.callId, title: String(a.title || '').slice(0, 120), steps: (a.steps || []).map((x) => String(x).slice(0, 200)).slice(0, 8), why: String(a.why || '').slice(0, 300), at: now(), status: 'open' }
      update('proposals', [], (l) => { l.push(p); if (l.length > 300) l.splice(0, l.length - 300) })
      bus.push({ type: 'trial', agent: aid })
      return { ok: true, id: p.id, note: '方案已经交给用户了。现在停下，用一句话告诉用户你交了什么方案，等用户点头再做。' }
    },
  }))

  // the plan's turn is over: what it was allowed to do it has done
  ctx.effect(() => {
    const f = ({ aid, error }) => {
      const pid = grants.get(aid); if (pid === undefined) return
      grants.delete(aid)
      patchProposal(pid, { status: error ? 'approved' : 'done', doneAt: now() })
      const a = agentById(aid)
      if (a?.trial && !a.trial.applied && (a.trial.ok || 0) >= (a.trial.need || NEED)) askToBeRegular(aid)
      bus.push({ type: 'trial', agent: aid })
    }
    bus.turnEnd.add(f); return () => bus.turnEnd.delete(f)
  })

  bus.state.set('proposals', () => proposals().slice(-120))

  Object.assign(bus.routes, {
    // 照这个做 / 不对
    'POST /api/trial/decide': async (b) => {
      const p = proposals().find((x) => x.id === b.id); if (!p) throw new Error('找不到这个方案')
      if (p.status !== 'open') return { ok: true, proposal: p }
      const a = agentById(p.agent)
      if (b.ok) {
        patchProposal(p.id, { status: 'approved', decidedAt: now() })
        if (a.trial) patchAgent(a.id, (x) => { x.trial.ok = (x.trial.ok || 0) + 1 })
        grants.set(a.id, p.id)
        bus.say(`【试用期·方案通过】用户同意了你的方案「${p.title}」：\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n现在照着做，只做方案里的事。做完用一两句话告诉用户结果。`, { agent: a.id, display: `照这个做：${p.title}` })
          .catch((e) => console.error('[tianxi] trial', e))
      } else {
        const said = String(b.note || '').trim().slice(0, 500)
        patchProposal(p.id, { status: 'rejected', decidedAt: now(), note: said })
        if (a.trial) patchAgent(a.id, (x) => { x.trial.no = (x.trial.no || 0) + 1 })
        bus.say(`【试用期·方案没通过】你的方案「${p.title}」用户没同意。${said ? `用户说：「${said}」。` : '用户没说原因，先问一句哪里不对。'}按用户说的改，需要的话用 plan_propose 再交一次，并在回复里说你以后会怎么做。`, { agent: a.id, display: said ? `不对：${said}` : '不对' })
          .catch((e) => console.error('[tianxi] trial', e))
      }
      bus.push({ type: 'trial', agent: a.id })
      return { ok: true }
    },
    // 一键转正
    'POST /api/trial/promote': async (b) => {
      const a = agentById(b.id); if (!a || a.id !== b.id || !a.trial) throw new Error('它不在试用期')
      const was = a.trial
      patchAgent(a.id, (x) => { delete x.trial; x.promotedAt = now() })
      record({ tool: 'trial_promote', agent: '', title: `让「${a.name}」转正了`, why: `试用期里你同意了它 ${was.ok || 0} 个方案`, undo: { kind: 'trial-restore', data: { aid: a.id, trial: was }, label: '回到试用期' } })
      note(a.id, { type: 'promoted', ok: was.ok || 0, at: now() })
      bus.push({ type: 'trial', agent: a.id })
      return { ok: true }
    },
    // 再试试: a few more plans before it asks again
    'POST /api/trial/later': async (b) => {
      const a = agentById(b.id); if (!a || a.id !== b.id || !a.trial) throw new Error('它不在试用期')
      patchAgent(a.id, (x) => { x.trial.need = Math.max(x.trial.need || NEED, x.trial.ok || 0) + 2; delete x.trial.applied })
      note(a.id, { type: 'later', need: agentById(a.id).trial.need, at: now() })
      bus.push({ type: 'trial', agent: a.id })
      return { ok: true }
    },
    // 让它重新试用 (from its settings)
    'POST /api/trial/start': async (b) => {
      const a = agentById(b.id); if (!a || a.id !== b.id || a.main) throw new Error('主 Bot 不用试用')
      if (a.trial) return { ok: true }
      patchAgent(a.id, (x) => { x.trial = { since: now(), need: NEED, ok: 0, no: 0 } })
      record({ tool: 'trial_start', agent: '', title: `让「${a.name}」回到试用期`, why: '你在它的设置里打开了试用期', undo: { kind: 'trial-end', data: { aid: a.id }, label: '结束试用' } })
      bus.push({ type: 'trial', agent: a.id })
      return { ok: true }
    },
  })
}
