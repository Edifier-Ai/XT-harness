// 天禧评测: runs only when TIANXI_EVAL is set (the client starts a separate runtime for it, with its own data).
// For every task × run it resets 天禧's data, builds a sandbox from the fixtures, talks to a fresh 天禧 agent
// exactly like the client does, then grades the end state. Writes progress.json, results.json and 报告.md.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { load, resetAll, bus, EVAL, localISO } from './store.js'
import { agentSetup } from './host.js'
import { runBrief, runOneJob } from './ambient.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval')
const OUT = process.env.TIANXI_EVAL_OUT || path.join(os.tmpdir(), 'tianxi-eval-' + Date.now())
const RUNS = Math.max(1, +(process.env.TIANXI_EVAL_RUNS || 3))
const ONLY = (process.env.TIANXI_EVAL_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean)
const norm = (s) => String(s ?? '').replace(/[\s,，]/g, '')

export const name = 'tianxi-eval'
export const inject = ['agents', 'agentDefaultModel', 'systemPrompt']

export function apply(ctx) {
  if (!EVAL) return
  const { presetId, setup } = agentSetup(ctx)
  const live = new Map() // session id -> per-run trace

  // ---------- trace what the agent does ----------
  ctx.on('session/event', (session, event) => {
    const r = live.get(session.id); if (!r) return
    const d = event.data || {}
    if (event.type === 'tool/call') {
      let args = {}; try { args = JSON.parse(d.arguments || '{}') } catch {}
      r.tools.push({ name: d.name, args, callId: d.callId })
      if (d.name === 'show_ui') r.ui.push(args)
    } else if (event.type === 'tool/result') {
      const t = r.tools.find((x) => x.callId === (d.message?.toolCallId || d.message?.callId))
      if (t && (d.message?.isError || d.error)) { t.error = d.error?.reason || 'error'; r.toolErrors++ }
    } else if (event.type === 'assistant/message') {
      const text = (d.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
      if (text) { r.last = text; r.texts.push(text) }
    } else if (event.type === 'turn/end') {
      if (d.reason?.kind === 'error') r.errors.push(d.reason.error?.message || 'turn error')
      r.turnDone?.(d.reason?.kind || 'completed')
    }
  })
  // Approvals are granted automatically and counted (a real user would have been asked this many times).
  ctx.on('approval/request', (req, next) => {
    const r = live.get(req.agent?.id); if (!r) return next()
    r.approvals++; r.approvalTools.push(req.toolName)
    return 'allowed-once'
  })

  async function newAgent(r, sb) {
    const agentPreset = await presetId()
    const handle = await ctx.agents.create({
      sessionId: 'eval-' + randomUUID(),
      meta: { cwd: sb, ...(agentPreset ? { agentPreset } : {}) },
      agentOptions: { ...ctx.agentDefaultModel.currentSelection() },
      setup: async (agentCtx) => {
        await setup(agentCtx)
        agentCtx.systemPrompt.section({ name: 'tianxi:eval-env', order: 950, interpolate: false,
          text: `【当前环境】用户这次要处理的文件都在 ${sb} 里。“下载”“桌面”“照片”“发票”等文件夹指的都是这个目录下的同名文件夹，只在这个目录里操作。` })
      },
    })
    live.set(handle.agent.id, r)
    return handle
  }
  async function send(r, agent, text, timeoutSec) {
    const done = new Promise((resolve) => { r.turnDone = resolve })
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    let timer
    const res = await Promise.race([done, new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutSec * 1000) })])
    clearTimeout(timer)
    if (res === 'timeout') { r.timeout = true; try { agent.cancel({ kind: 'user' }) } catch {} await Promise.race([done, new Promise((x) => setTimeout(x, 10000))]) }
    return res
  }

  // ---------- grading helpers ----------
  const listFiles = (dir, base = dir) => {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')])
  }
  async function judge(rubric, material) {
    const url = (process.env.TIANXI_JUDGE_URL || '').replace(/\/+$/, '')
    if (!url) return { pass: false, notes: '没有配置评审模型' }
    try {
      const r = await fetch(url + '/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.TIANXI_API_KEY },
        body: JSON.stringify({ model: process.env.TIANXI_JUDGE_MODEL, temperature: 0, max_tokens: 300, messages: [
          { role: 'system', content: '你是严格的评审。根据评分标准判断材料是否通过，只输出一行 JSON：{"pass": true 或 false, "reason": "一句话理由"}' },
          { role: 'user', content: `评分标准：${rubric}\n\n材料：\n${String(material).slice(0, 8000)}` }] }),
        signal: AbortSignal.timeout(60000),
      })
      const j = await r.json(); const t = j.choices?.[0]?.message?.content || ''
      const m = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
      return { pass: !!m.pass, notes: '评审模型：' + (m.reason || '') }
    } catch (e) { return { pass: false, notes: '评审失败：' + e.message } }
  }

  // ---------- one task, one run ----------
  async function runTask(task, run, manifest) {
    const sb = path.join(OUT, 'sandbox', `${task.id}-${run}`)
    fs.rmSync(sb, { recursive: true, force: true }); fs.mkdirSync(sb, { recursive: true })
    for (const [src, dst] of Object.entries(task.fixtures || {})) fs.cpSync(path.join(ROOT, 'fixtures', src), path.join(sb, dst), { recursive: true })
    task.setup?.(sb)
    resetAll(task.seed ? task.seed() : {})
    const r = { tools: [], ui: [], texts: [], last: '', errors: [], toolErrors: 0, approvals: 0, approvalTools: [], timeout: false }
    const t0 = Date.now()
    let handle = null
    try {
      handle = await newAgent(r, sb)
      bus.say = async (text) => { r.last = ''; await send(r, handle.agent, text, task.timeout || 180); return r.last }
      bus.busy = () => false
      if (task.brief) await runBrief('评测')
      for (const text of task.say || []) { r.last = ''; await send(r, handle.agent, text, task.timeout || 180); if (r.timeout) break }
      if (task.runJob && !r.timeout) { await runOneJob(); await runBrief('评测') }
    } catch (e) { r.errors.push(e.message) }
    const ms = Date.now() - t0
    const c = {
      sb, M: manifest[task.id] || {}, reply: r.last || '', replies: r.texts.join('\n\n'), tools: r.tools, ui: r.ui, approvals: r.approvals,
      data: (n) => load(n, n === 'brief' ? null : []), files: (rel = '') => listFiles(path.join(sb, rel)),
      read: (rel) => fs.readFileSync(path.join(sb, rel), 'utf8'), exists: (rel) => fs.existsSync(path.join(sb, rel)),
      has: (text, alts) => alts.some((a) => norm(text).includes(norm(a))), judge,
    }
    const completed = !r.timeout && !r.errors.length && (!!r.last || task.brief || task.runJob)
    let g = { pass: false, notes: '' }
    try { g = await task.check(c) } catch (e) { g = { pass: false, notes: '判分出错：' + e.message } }
    try { await handle?.dispose() } catch {}
    if (handle) live.delete(handle.agent.id)
    return {
      task: task.id, cat: task.cat, title: task.title, run, completed, pass: completed && g.pass, notes: g.notes, review: !!task.review,
      timeout: r.timeout, errors: r.errors, toolCalls: r.tools.length, toolErrors: r.toolErrors, tools: r.tools.map((t) => t.name),
      approvals: r.approvals, approvalTools: r.approvalTools, seconds: Math.round(ms / 100) / 10, reply: (r.last || '').slice(0, 600),
    }
  }

  // ---------- the suite ----------
  async function runSuite() {
    fs.mkdirSync(OUT, { recursive: true })
    const tasks = (await import('../eval/tasks.js')).default.filter((t) => !ONLY.length || ONLY.includes(t.id))
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'manifest.json'), 'utf8'))
    const model = ctx.agentDefaultModel.currentSelection()
    const meta = { model: model.model, provider: process.env.TIANXI_EVAL_PROVIDER || model.provider, runs: RUNS, startedAt: localISO(), platform: process.platform }
    const results = []
    const progress = (extra) => fs.writeFileSync(path.join(OUT, 'progress.json'), JSON.stringify({ ...meta, total: tasks.length * RUNS, done: results.length, passed: results.filter((x) => x.pass).length, ...extra }))
    progress({ state: 'running' })
    for (let run = 1; run <= RUNS; run++) {
      for (const task of tasks) {
        progress({ state: 'running', current: `${task.id} ${task.title}（第 ${run} 轮）` })
        console.log(`[eval] ${task.id} run ${run} ...`)
        const res = await runTask(task, run, manifest)
        results.push(res)
        console.log(`[eval] ${task.id} run ${run}: ${res.pass ? 'PASS' : 'FAIL'} ${res.notes}`)
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...meta, results }, null, 1))
      }
    }
    fs.writeFileSync(path.join(OUT, '报告.md'), report(meta, tasks, results))
    progress({ state: 'done', finishedAt: localISO() })
    console.log('[eval] done', OUT)
    setTimeout(() => process.exit(0), 500)
  }

  ctx.effect(() => {
    const t = setTimeout(() => runSuite().catch((e) => {
      console.error('[eval] failed', e)
      try { fs.writeFileSync(path.join(OUT, 'progress.json'), JSON.stringify({ state: 'error', error: e.message })) } catch {}
      setTimeout(() => process.exit(1), 500)
    }), 1500)
    return () => clearTimeout(t)
  })
}

function report(meta, tasks, results) {
  const pct = (a, b) => b ? Math.round((a / b) * 1000) / 10 + '%' : '-'
  const n = results.length
  const avg = (k) => n ? Math.round(results.reduce((s, x) => s + x[k], 0) / n * 10) / 10 : 0
  const allPass = tasks.filter((t) => results.filter((x) => x.task === t.id).every((x) => x.pass)).length
  const lines = [
    `# 天禧评测报告`, '',
    `- 模型：${meta.provider} / ${meta.model}`, `- 时间：${meta.startedAt.replace('T', ' ')}，每个任务跑 ${meta.runs} 轮，共 ${n} 次`, '',
    `| 指标 | 结果 |`, `|---|---|`,
    `| 完成率 | ${pct(results.filter((x) => x.completed).length, n)} |`,
    `| 成功率（pass@1 平均） | ${pct(results.filter((x) => x.pass).length, n)} |`,
    `| 每轮都通过的任务 | ${allPass} / ${tasks.length} |`,
    `| 平均工具调用 | ${avg('toolCalls')} 次 |`, `| 平均耗时 | ${avg('seconds')} 秒 |`,
    `| 平均确认次数 | ${avg('approvals')} 次 |`, `| 超时 | ${results.filter((x) => x.timeout).length} 次 |`, '',
    `## 按类别`, '', `| 类别 | 成功率 |`, `|---|---|`,
    ...[...new Set(tasks.map((t) => t.cat))].map((cat) => { const rs = results.filter((x) => x.cat === cat); return `| ${cat} | ${pct(rs.filter((x) => x.pass).length, rs.length)} |` }),
    '', `## 每个任务`, '', `| # | 任务 | 通过 | 平均调用 | 平均秒数 | 最后一轮说明 |`, `|---|---|---|---|---|---|`,
    ...tasks.map((t) => {
      const rs = results.filter((x) => x.task === t.id); const last = rs[rs.length - 1] || {}
      const a = (k) => rs.length ? Math.round(rs.reduce((s, x) => s + x[k], 0) / rs.length * 10) / 10 : 0
      return `| ${t.id} | ${t.title}${t.review ? '（需人工复核）' : ''} | ${rs.filter((x) => x.pass).length}/${rs.length} | ${a('toolCalls')} | ${a('seconds')} | ${String(last.notes || '').replace(/\|/g, '/')}${last.timeout ? '；超时' : ''}${last.errors?.length ? '；出错：' + last.errors[0].slice(0, 60) : ''} |`
    }),
    '', '失败明细（回复原文、工具调用）在同目录的 results.json 里，沙盒文件在 sandbox 文件夹。',
  ]
  return lines.join('\n')
}
