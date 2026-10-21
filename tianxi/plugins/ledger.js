// 操作记录: every action 小天 takes is written here with why it did it and how to undo it.
import fs from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { load, update, id, now, flags } from './store.js'

const undoers = new Map()          // undo kind -> async (data) => note shown to the user
const RISKY = new Map()            // tool name -> reason shown when asking

/** Register how to reverse one kind of action. */
export function defineUndo(kind, fn) { undoers.set(kind, fn) }

/** Mark a tool as needing the user's explicit approval before it runs. */
export function markRisky(toolName, reason) { RISKY.set(toolName, reason) }
const RISKY_MATCH = new Set()      // (toolName, args) -> reason or ''
/** Mark a family of tools (e.g. an outside app's write tools) as needing approval; returns the disposer. */
export function markRiskyMatch(fn) { RISKY_MATCH.add(fn); return () => RISKY_MATCH.delete(fn) }

/** Append one action. `undo` is { kind, data, label } or null when it cannot be reversed. */
export function record({ tool, title, why, undo = null, risk = 'low', detail }) {
  const entry = { id: id('act'), at: now(), tool, title, why: why || '', detail, risk, undo, status: 'done', private: flags.privateMode }
  update('ledger', [], (l) => { l.push(entry); if (l.length > 2000) l.splice(0, l.length - 2000) })
  return entry
}

export function entries() { return load('ledger', []) }

export async function undoEntry(entryId) {
  const e = entries().find((x) => x.id === entryId)
  if (!e) throw new Error('找不到这条记录')
  if (e.status === 'undone') return e
  if (!e.undo) throw new Error('这件事不能撤回：' + (e.title || e.tool))
  const fn = undoers.get(e.undo.kind)
  if (!fn) throw new Error('缺少撤回方法：' + e.undo.kind)
  const note = await fn(e.undo.data)
  let out
  update('ledger', [], (l) => { const x = l.find((y) => y.id === entryId); x.status = 'undone'; x.undoneAt = now(); x.undoNote = note || '已恢复到之前的状态'; out = x })
  return out
}

/** "算了": undo the most recent action that can still be undone. */
export async function undoLast() {
  const l = entries()
  for (let i = l.length - 1; i >= 0; i--) if (l[i].status === 'done' && l[i].undo) return undoEntry(l[i].id)
  throw new Error('今天没有可以撤回的事了')
}

// ---- built-in undo for files the harness's own write/edit tools change ----
defineUndo('file-restore', async ({ path, before }) => {
  if (before === null) { try { fs.rmSync(path) } catch {} return '已删除小天新建的文件 ' + path }
  fs.writeFileSync(path, before, 'utf8'); return '已把 ' + path + ' 恢复成修改前的内容'
})

/** Arguments of risky calls waiting for approval, by callId (read by the host to preview them). */
export const pendingArgs = new Map()

export const name = 'tianxi-ledger'
export const inject = ['tools']

export function apply(ctx) {
  // Let the user take things back by just saying so ("算了", "刚才那个撤回").
  const J = { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }
  ctx.tools.register(defineTool({
    name: 'ledger_recent', output: J,
    description: '查看操作记录里最近做过的事（新的在前），用于用户说“算了”“撤回刚才那个”时找到要撤回的记录。',
    parameters: { limit: { type: 'integer', description: '条数，默认 20' } },
    async execute(a) { return entries().slice(-(a.limit || 20)).reverse().map(({ id: eid, at, title, status, undo }) => ({ id: eid, at, title, status, canUndo: status === 'done' && !!undo })) },
  }))
  ctx.tools.register(defineTool({
    name: 'undo_actions', output: J,
    description: '撤回操作记录里的一条或多条记录，恢复到做之前的状态。用户说“算了”“刚才那个撤回”时，先用 ledger_recent 找到属于那件事的所有记录，再一次性撤回。',
    parameters: { ids: { type: 'array', required: true, items: { type: 'string' } } },
    async execute(a) {
      const out = []
      const order = entries().map((e) => e.id)
      // newest first, so a file moves back before the folder it was put in is removed
      for (const eid of [...a.ids].sort((x, y) => order.indexOf(y) - order.indexOf(x))) { try { const e = await undoEntry(eid); out.push({ id: eid, ok: true, note: e.undoNote }) } catch (err) { out.push({ id: eid, ok: false, error: err.message }) } }
      return out
    },
  }))

  const snapshots = new Map() // callId -> { path, before }
  // The 小天 client answers through generated UI, not DSH's question / plan-mode dialogs.
  const REDIRECT = { ask_user_question: '小天 Bot 客户端不支持这个工具。需要用户选择或填写时，请在回复里写一段 openui-lang 界面（按钮或表单）。', exit_plan_mode: '小天不使用计划模式，直接动手做，做完说结果。' }
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (REDIRECT[exec.name]) return { kind: 'deny', reason: REDIRECT[exec.name], displayReason: { en: REDIRECT[exec.name], zh: REDIRECT[exec.name] } }
    const args = exec.arguments || {}
    if ((exec.name === 'write' || exec.name === 'edit') && typeof (args.path || args.file_path) === 'string') {
      const p = args.path || args.file_path
      let before = null
      try { before = fs.readFileSync(p, 'utf8') } catch {}
      snapshots.set(exec.callId, { path: p, before })
    }
    const risky = RISKY.get(exec.name)
    let why = risky && risky(args)     // a reason function may return '' when this call needs no approval
    if (!why) for (const fn of RISKY_MATCH) { why = fn(exec.name, args); if (why) break }
    if (why) {
      const decision = await next()
      if (decision.kind !== 'allow') return decision
      pendingArgs.set(exec.callId, args); setTimeout(() => pendingArgs.delete(exec.callId), 30 * 60e3)
      return { kind: 'ask', reason: why, displayReason: { en: why, zh: why } }
    }
    return next()
  })
  ctx.on('tools/result', (exec, result) => {
    const snap = snapshots.get(exec.callId)
    if (!snap) return
    snapshots.delete(exec.callId)
    if (result.isError) return
    record({ tool: exec.name, title: (snap.before === null ? '新建了文件 ' : '修改了文件 ') + snap.path, why: '', undo: { kind: 'file-restore', data: snap, label: '恢复文件' } })
  })
}
