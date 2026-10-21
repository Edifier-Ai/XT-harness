// 天禧 host: owns the one long-lived 天禧 agent, serves the 天禧 client UI, streams events to it,
// answers approvals through the client and exposes the ledger / memory / brief APIs.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { load, update, save, id, now, localISO, today, flags, bus, onChange, settings, HOME, EVAL, MAIN, STYLES, agentList, agentById, transcriptKey } from './store.js'
import { entries, undoEntry, undoLast, pendingArgs } from './ledger.js'
import { memories, editMemory, forgetMemory, addMemory, reflections, runReflect, applyProposal } from './memory.js'
import { runBrief } from './ambient.js'
import { CATALOG, BUILTIN, saveApp, removeApp, toggleApp, toggleBuiltin } from './apps.js'

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web')
const PORT = +(process.env.TIANXI_PORT || 3090)
const TOKEN = process.env.TIANXI_TOKEN || ''
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

const STYLE = {
  靠谱同事: '说中文，口语、简短，像一个靠谱的同事。',
  温暖贴心: '说中文，语气温和、体贴，会留意用户的情绪和状态，但依然简短，不说空话。',
  犀利有梗: '说中文，直率、机灵，偶尔吐槽或玩个梗，像一个有趣的老朋友；不刻薄，不油腻，做事依旧靠谱。',
}

/** The system prompt of one agent: its identity (name, role, style, mailbox), then the shared way 天禧 agents work. */
export const PERSONA = (agentId = MAIN) => () => {
  const me = agentById(agentId), all = agentList(), main = agentById(MAIN), s = settings()
  const others = all.filter((x) => x.id !== me.id)
  return [
    me.main
      ? `你是“${me.name}”，${me.role || '用户的个人智能体'}，属于联想天禧。你住在用户的这台电脑里，一直在运行；手机、平板上的${me.name}和你是同一个。`
      : `你是“${me.name}”，用户的${me.role || '助手'}。你是联想天禧智能体家族的一员，主智能体叫“${main.name}”。你有自己的身份和分工，只做和你分工有关的事；别的事交给合适的智能体。`,
    me.intro ? `你的人设：${me.intro}` : '',
    s.callMe ? `称呼用户为“${s.callMe}”。` : '',
    `你有自己的邮箱 ${me.email}。用 mail_draft / mail_send 发出的邮件，发件人都是你；mail_inbox 看你的收件箱。`,
    others.length ? '智能体通讯录（需要别的智能体帮忙时，直接给它发邮件说清楚要什么，它会自己处理并回信）：\n' + others.map((x) => `- ${x.name}（${x.role || '助手'}）${x.email}`).join('\n') : '',
    '你的设计主张是：让用户不用学、不用记、不用盯，也不用担心。',
    '',
    '做事的方式：',
    '1. 先给结果。能直接做的就去做，做完用一两句话告诉用户结果；不要只给建议、不要反问可以自己查到的信息。你做的每个改变都会写进“操作记录”，用户随时能撤回，所以可以放心动手。用户说“算了”“撤回刚才那个”时，用 ledger_recent 找到那件事的所有记录，再用 undo_actions 一起撤回。',
    '2. 意图即界面。需要用户比较、挑选、调参数或确认时，调用 show_ui 生成可操作的界面（按钮、表单、时间线、表格、图片），不要用长段文字罗列选项。',
    '3. 用好记忆。先看【天禧记忆】再回答；用户透露稳定的偏好、事实、人物关系、习惯时，用 memory_save 记下并附上原话。用户说记错了就用 memory_update 改。所有天禧智能体共用这份关于用户的记忆。',
    '4. 整理、移动、重命名文件优先用 file_move（会记进操作记录、能撤回），不要用命令行批量移动。对外发送、花钱、删除这类动作，系统会请用户确认；其余可撤回的动作直接做。',
    '5. 每个会改变东西的工具都要填 reason，一句话、写给用户看。',
    '6. 用户不在、或者事情需要时间，用 later_add 放进后台队列，等用户离开或夜里再做。',
    '   执行要简单务实：不先写计划、不列步骤清单，直接用最少的工具调用把事做完；能一条命令解决就不要拆成几步。出错先自己查原因、换个办法再试，不把报错原样丢给用户。',
    '7. 用户的待办用 todo_add / todo_list / todo_done（天禧待办）；todo_write 只用来拆解你自己手上任务的步骤。需要用户选择时用 show_ui，不要用 ask_user_question。',
    `8. ${STYLE[me.style] || STYLE['靠谱同事']}这是即时聊天，不要用 Markdown 标题，不要客套。`,
    '',
    `现在是 ${localISO().replace('T', ' ')}（星期${WEEK[new Date().getDay()]}）。用户主目录是 ${os.homedir()}。`,
  ].filter((x) => x !== '').join('\n')
}

/** How every 天禧 agent is composed: the lean 'tianxi' preset (files, shell, web, compaction) plus that agent's persona. */
export function agentSetup(ctx, agentId = MAIN) {
  const presetId = async () => { const p = ctx.get('agentPresets'); if (!p) return undefined; try { return (await p.resolve('tianxi')).id } catch { return (await p.resolve()).id } }
  const setup = async (agentCtx) => {
    const presets = ctx.get('agentPresets')
    if (presets) await presets.mount(agentCtx, await presetId())
    agentCtx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, interpolate: false, text: PERSONA(agentId) })
  }
  return { presetId, setup }
}

export const name = 'tianxi-host'
export const inject = ['agents', 'agentDefaultModel', 'systemPrompt']


const SYS_TEXT = { brief: '在准备每日简报', job: '在后台做事', reflect: '在反思', mail: '收到一封邮件', act: '在处理简报里的事' }
const INTERNAL = new Set(['brief', 'job', 'reflect', 'act'])   // turns kept out of the chat; their process is still viewable
const MAX_HOPS = 3                                      // agent-to-agent mail stops waking agents after this many hops

export function apply(ctx) {
  if (EVAL) return // the eval runner drives its own agents
  // ---------- client event stream ----------
  const clients = new Set()
  const push = (o) => { const s = 'data: ' + JSON.stringify(o) + '\n\n'; for (const c of clients) { try { c.write(s) } catch {} } }
  bus.push = push
  ctx.effect(() => onChange((name) => push({ type: 'store', name })))

  // ---------- one transcript per agent ----------
  const transcript = (aid) => load(transcriptKey(aid), [])
  const addItem = (aid, item) => {
    const it = { id: id('t'), at: now(), agent: aid, ...item }
    update(transcriptKey(aid), [], (l) => { l.push(it); if (l.length > 600) l.splice(0, l.length - 600) })
    push({ type: 'item', item: it }); return it
  }
  const patchItem = (aid, tid, patch) => { let it; update(transcriptKey(aid), [], (l) => { it = l.find((x) => x.id === tid); if (it) Object.assign(it, patch) }); if (it) push({ type: 'item', item: it }) }

  // ---------- the agents: one long-lived DSH agent per 天禧 agent ----------
  const R = new Map()          // agentId -> runtime
  const callAgent = new Map()  // tool callId -> agentId, so tools know who is calling (mail "from")
  bus.agentOf = (cid) => callAgent.get(cid) || MAIN
  const rt = (aid) => {
    if (!R.has(aid)) R.set(aid, { aid, handle: null, starting: null, status: 'idle', hidden: new Map(), turn: null, currentMsg: null, streamItem: null, streamText: '', toolItems: new Map(), hops: -1 })
    return R.get(aid)
  }
  const byAgent = (agent) => { for (const r of R.values()) if (r.handle && agent && r.handle.agent.id === agent.id) return r; return null }
  const bySession = (sid) => { for (const r of R.values()) if (r.handle && r.handle.agent.id === sid) return r; return null }
  bus.hopsOf = (aid) => rt(aid || MAIN).hops

  async function ensure(aid) {
    const r = rt(aid)
    if (r.handle) return r.handle.agent
    if (r.starting) return r.starting
    r.starting = (async () => {
      const { presetId, setup } = agentSetup(ctx, aid)
      const meta = load('agentSessions', {})
      const agentOptions = { ...ctx.agentDefaultModel.currentSelection() }
      const legacy = aid === MAIN ? load('state', {}).sessionId : null
      const resumeId = meta[aid] || legacy
      if (resumeId) {
        try { r.handle = await ctx.agents.resume({ resumeSessionId: resumeId, agentOptions, setup }); return r.handle.agent } catch (e) { console.error(`[tianxi] resume ${aid} failed, starting fresh:`, e.message) }
      }
      const sessionId = 'tianxi-' + aid + '-' + randomUUID()
      const agentPreset = await presetId()
      r.handle = await ctx.agents.create({ sessionId, meta: { cwd: os.homedir(), ...(agentPreset ? { agentPreset } : {}) }, agentOptions, setup })
      update('agentSessions', {}, (m) => { m[aid] = sessionId })
      return r.handle.agent
    })().finally(() => { r.starting = null })
    return r.starting
  }
  ctx.effect(() => () => { for (const r of R.values()) r.handle?.dispose(); R.clear() })
  ctx.effect(() => { const t = setTimeout(() => ensure(MAIN).catch((e) => console.error('[tianxi] start', e)), 500); return () => clearTimeout(t) })

  bus.busy = () => [...R.values()].some((r) => r.status !== 'idle')

  /** Send text to an agent. Internal prompts (brief/job/reflect) stay out of the chat; resolves with the agent's last reply. */
  bus.say = async (text, opts = {}) => {
    const aid = opts.agent && agentList().some((a) => a.id === opts.agent) ? opts.agent : MAIN
    const r = rt(aid)
    const agent = await ensure(aid)
    const msg = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    const kind = opts.kind || 'user'
    const item = kind === 'user'
      ? addItem(aid, { role: 'user', text: opts.display || text, mid: msg.id })
      : addItem(aid, { role: 'system', kind, text: SYS_TEXT[kind] || '在做事', internal: INTERNAL.has(kind), mail: opts.mail, mid: msg.id })
    const done = new Promise((resolve) => r.hidden.set(msg.id, { kind, resolve, turn: item.id, internal: INTERNAL.has(kind), hops: opts.hops ?? -1, last: '' }))
    agent.followup(msg)
    return done
  }

  /** Mail from one agent to another wakes the receiver, which handles it in its own chat. */
  bus.deliver = (aid, mail) => {
    push({ type: 'mail', mail })
    if (mail.hops >= MAX_HOPS) return
    const text = `【新邮件】你的邮箱 ${mail.to} 收到一封邮件。\n发件人：${mail.fromName || ''} <${mail.from}>\n主题：${mail.subject}\n\n${mail.body}\n\n按你的分工处理它；做完需要回复的话，用 mail_draft + mail_send 回信给发件人。`
    bus.say(text, { agent: aid, kind: 'mail', mail: { id: mail.id, from: mail.from, fromName: mail.fromName, subject: mail.subject, body: mail.body }, hops: mail.hops }).catch((e) => console.error('[tianxi] mail', e))
  }

  // ---------- turn bookkeeping ----------
  const turnOf = (r) => r.hidden.get(r.currentMsg)
  ctx.on('agent/status', ({ agent, status: s }) => {
    const r = byAgent(agent); if (!r) return
    r.status = typeof s === 'string' ? s : (s?.kind || 'running')
    push({ type: 'status', agent: r.aid, status: r.status })
  })
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const r = byAgent(agent); if (!r) return
    if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') {
      r.streamText += frame.chunk.text
      const h = turnOf(r)
      if (!r.streamItem) r.streamItem = addItem(r.aid, { role: 'assistant', text: r.streamText, live: true, internal: h?.internal || false, turn: h?.turn }).id
      else push({ type: 'delta', agent: r.aid, id: r.streamItem, text: r.streamText })
    }
  })
  ctx.on('session/event', (session, event) => {
    const r = bySession(session.id); if (!r) return
    const d = event.data || {}
    const h = turnOf(r)
    switch (event.type) {
      case 'user/message': if (d.source?.kind === 'user' && r.hidden.has(d.id)) { r.currentMsg = d.id; r.hops = r.hidden.get(d.id).hops } break
      case 'assistant/message': {
        const text = (d.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')
        if (h && text) h.last = text
        if (r.streamItem) patchItem(r.aid, r.streamItem, { text, live: false })
        else if (text) addItem(r.aid, { role: 'assistant', text, internal: h?.internal || false, turn: h?.turn })
        r.streamItem = null; r.streamText = ''
        break
      }
      case 'tool/call': {
        let args = {}; try { args = JSON.parse(d.arguments || '{}') } catch {}
        callAgent.set(d.callId, r.aid); if (callAgent.size > 5000) callAgent.delete(callAgent.keys().next().value)
        const base = { callId: d.callId, internal: h?.internal || false, turn: h?.turn }
        if (d.name === 'show_ui') r.toolItems.set(d.callId, addItem(r.aid, { role: 'ui', ui: args, ...base }).id)
        else r.toolItems.set(d.callId, addItem(r.aid, { role: 'tool', name: d.name, args, state: 'running', ...base }).id)
        break
      }
      case 'tool/result': {
        const cid = d.message?.toolCallId || d.message?.callId
        const tid = r.toolItems.get(cid)
        if (tid) { patchItem(r.aid, tid, { state: d.message?.isError ? 'error' : 'done', error: d.error?.reason || undefined, endAt: now() }); r.toolItems.delete(cid) }
        break
      }
      case 'turn/end': {
        if (d.reason?.kind === 'error') addItem(r.aid, { role: 'error', text: d.reason.error?.message || '出错了', internal: h?.internal || false, turn: h?.turn })
        if (h) { patchItem(r.aid, h.turn, { endAt: now() }); h.resolve(h.last); r.hidden.delete(r.currentMsg) }
        r.currentMsg = null; r.streamItem = null; r.streamText = ''; r.hops = -1
        push({ type: 'turn-end', agent: r.aid })
        break
      }
    }
  })

  // ---------- approvals answered in the 天禧 client ----------
  const approvals = new Map()
  ctx.on('approval/request', (req, next) => {
    const r = byAgent(req.agent); if (!r) return next()
    const aid = id('ask')
    return new Promise((resolve) => {
      const call = transcript(r.aid).find((t) => t.callId === req.callId)
      const a = { id: aid, agent: r.aid, tool: req.toolName, reason: req.displayReason?.zh || req.reason || '', args: pendingArgs.get(req.callId) || call?.args || {}, at: now(), turn: call?.turn }
      approvals.set(aid, { ...a, resolve })
      push({ type: 'approval', approval: a })
      req.signal?.addEventListener('abort', () => { approvals.delete(aid); push({ type: 'approval-gone', id: aid }); resolve('cancelled') }, { once: true })
    })
  }, true)   // first in line: DSH's own web remote would otherwise hold the request waiting for a page nobody has open

  // ---------- HTTP ----------
  const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(v)) }
  const body = async (req) => { let b = ''; for await (const d of req) b += d; try { return JSON.parse(b || '{}') } catch { return {} } }
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.json': 'application/json' }
  const IMG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

  const state = () => {
    const list = agentList()
    return {
      status: [...R.values()].some((r) => r.status !== 'idle') ? 'running' : 'idle',
      agentStatus: Object.fromEntries(list.map((a) => [a.id, R.get(a.id)?.status || 'idle'])),
      agents: list, styles: STYLES, mainId: MAIN,
      privateMode: flags.privateMode, today: today(), now: localISO(),
      brief: load('brief', null), transcripts: Object.fromEntries(list.map((a) => [a.id, transcript(a.id).slice(-300)])),
      ledger: entries().slice(-300), memories: memories(), reflections: reflections().slice(0, 10),
      calendar: load('calendar', []), todos: load('todos', []), outbox: load('outbox', []).slice(-200), inbox: load('inbox', []).slice(-200),
      later: load('later', []), observations: load('observations', []).slice(-50),
      approvals: [...approvals.values()].map(({ resolve, ...a }) => a), settings: settings(), home: HOME, device: os.hostname(), user: os.userInfo().username,
      model: ctx.agentDefaultModel.currentSelection(),
      apps: bus.appsState?.() || { apps: [], disabled: [] },
      voice: bus.voice?.state() || { available: false, phase: 'missing' },
    }
  }

  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24)
  const routes = {
    'GET /api/ping': () => ({ ok: true }),
    'GET /api/state': () => state(),
    'POST /api/say': async (b) => { bus.say(String(b.text || '').slice(0, 20000), { display: b.display, agent: b.agent }); return { ok: true } },
    'POST /api/cancel': async (b) => { R.get(b.agent || MAIN)?.handle?.agent.cancel({ kind: 'user' }); return { ok: true } },
    'POST /api/undo': async (b) => ({ ok: true, entry: await undoEntry(b.id) }),
    'POST /api/undo-last': async () => ({ ok: true, entry: await undoLast() }),
    'POST /api/approval': async (b) => { const a = approvals.get(b.id); if (!a) return { ok: false }; approvals.delete(b.id); a.resolve(b.allow ? 'allowed-once' : 'rejected'); push({ type: 'approval-gone', id: b.id }); return { ok: true } },
    'POST /api/memory/edit': async (b) => ({ ok: true, memory: editMemory(b.id, String(b.text)) }),
    'POST /api/memory/forget': async (b) => ({ ok: true, memory: forgetMemory(b.id) }),
    'POST /api/memory/add': async (b) => ({ ok: true, memory: addMemory({ text: String(b.text), kind: b.kind || '事实', source: '你手动添加' }) }),
    'POST /api/reflect/run': async () => { runReflect('手动').catch((e) => console.error(e)); return { ok: true } },
    'POST /api/reflect/apply': async (b) => ({ ok: true, item: applyProposal(b.rid, b.pid, !!b.accept) }),
    'POST /api/private': async (b) => { flags.privateMode = !!b.on; push({ type: 'private', on: flags.privateMode }); return { ok: true, on: flags.privateMode } },
    'POST /api/presence': async (b) => { flags.idleSec = +b.idleSec || 0; flags.lastSeen = Date.now(); return { ok: true } },
    'POST /api/brief/run': async () => { runBrief('手动').catch((e) => console.error(e)); return { ok: true } },
    'POST /api/brief/act': async (b) => {
      // A decision made on the brief page is carried out out of the chat; its result goes back onto the card.
      const it = (load('brief', {}).items || []).find((i) => i.id === b.id); if (!it) throw new Error('找不到这张卡片')
      const a = (it.actions || [])[+b.k]; if (!a) throw new Error('没有这个按钮')
      const set = (patch) => update('brief', {}, (x) => { const y = (x.items || []).find((i) => i.id === it.id); if (y) Object.assign(y, patch) })
      set({ status: 'working', choice: a.label })
      bus.say(`【简报卡片·用户的决定】简报卡片“${it.title}”${it.detail ? `（${it.detail}）` : ''}，用户点了“${a.label}”：${a.say || a.label}\n直接去做。做完用一句话说结果，这句话会直接显示在卡片上。`, { kind: 'act' })
        .then((reply) => set({ status: 'resolved', result: String(reply || a.label).slice(0, 200) }))
        .catch((e) => set({ status: 'open', result: '没做成：' + e.message }))
      return { ok: true }
    },
    'POST /api/brief/item': async (b) => { update('brief', {}, (x) => { const it = (x.items || []).find((i) => i.id === b.id); if (it) { it.status = b.status || 'resolved'; it.result = b.result || '' } }); return { ok: true } },
    'POST /api/settings': async (b) => { update('settings', {}, (s) => Object.assign(s, b)); return { ok: true, settings: settings() } },
    'POST /api/later/remove': async (b) => { update('later', [], (l) => l.filter((j) => j.id !== b.id)); return { ok: true } },
    'POST /api/transcript/clear': async (b) => { save(transcriptKey(b.agent), []); return { ok: true } },
    'POST /api/agents/save': async (b) => {
      const a = b.agent || {}
      const list = agentList().map((x) => ({ ...x }))
      let cur = list.find((x) => x.id === a.id)
      if (!cur) {
        const aid = 'ag' + randomUUID().slice(0, 6)
        cur = { id: aid, createdAt: now() }; list.push(cur)
      }
      for (const k of ['name', 'role', 'style', 'intro', 'color', 'shape', 'tag']) if (a[k] !== undefined) cur[k] = String(a[k]).slice(0, 600)
      if (!cur.name) throw new Error('名字不能空着')
      if (!STYLES.includes(cur.style)) cur.style = STYLES[0]
      const want = slug(a.emailName) || slug(cur.email?.split('@')[0]) || cur.id
      const taken = new Set(list.filter((x) => x !== cur).map((x) => x.email))
      let email = want + '@agent.local', n = 2
      while (taken.has(email)) email = `${want}${n++}@agent.local`
      cur.email = email
      save('agents', list)
      // a changed persona applies from the next turn: the prompt section reads the store each time
      return { ok: true, agent: cur }
    },
    'GET /api/apps/catalog': () => ({ catalog: CATALOG.map(({ id, n, c, d, transport, fields, command }) => ({ id, n, c, d, transport, fields, node: command === 'npx' })), builtin: BUILTIN }),
    'POST /api/apps/save': async (b) => ({ ok: true, app: saveApp(b.app || {}) }),
    'POST /api/apps/remove': async (b) => { removeApp(b.id); return { ok: true } },
    'POST /api/apps/toggle': async (b) => { toggleApp(b.id, b.on); return { ok: true } },
    'GET /api/voice': () => bus.voice?.state() || { available: false, phase: 'missing' },
    'POST /api/voice/prepare': async () => { if (!bus.voice) throw new Error('这台电脑上没有语音识别组件'); bus.voice.prepare(); return { ok: true } },
    'POST /api/voice/cancel': async () => { await bus.voice?.cancel(); return { ok: true } },
    'POST /api/voice/transcribe': async (b) => {
      if (!bus.voice) throw new Error('这台电脑上没有语音识别组件')
      return { ok: true, ...await bus.voice.transcribe(Buffer.from(String(b.wav || ''), 'base64'), b.language || 'auto') }
    },
    'POST /api/apps/builtin': async (b) => { toggleBuiltin(b.id, b.on); return { ok: true } },
    'POST /api/agents/remove': async (b) => {
      if (b.id === MAIN) throw new Error('主智能体不能删')
      save('agents', agentList().filter((x) => x.id !== b.id))
      const r = R.get(b.id); if (r) { r.handle?.dispose(); R.delete(b.id) }
      return { ok: true }
    },
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const authed = !TOKEN || req.headers['x-tianxi-token'] === TOKEN || url.searchParams.get('t') === TOKEN
    if (url.pathname.startsWith('/api/')) {
      if (!authed) return json(res, 401, { error: 'unauthorized' })
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        res.write('data: ' + JSON.stringify({ type: 'hello' }) + '\n\n')
        clients.add(res); const ka = setInterval(() => res.write(': ka\n\n'), 20000)
        req.on('close', () => { clients.delete(res); clearInterval(ka) })
        return
      }
      if (url.pathname === '/api/file') {
        // Thumbnails for the brief and generated cards: local images under the user's home only.
        const f = path.resolve(String(url.searchParams.get('path') || '').replace(/^~/, os.homedir()))
        if (!f.startsWith(os.homedir()) || !IMG.has(path.extname(f).toLowerCase()) || !fs.existsSync(f)) { res.writeHead(404); return res.end() }
        res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'max-age=300' })
        return fs.createReadStream(f).pipe(res)
      }
      const fn = routes[req.method + ' ' + url.pathname]
      if (!fn) return json(res, 404, { error: 'not found' })
      try { json(res, 200, await fn(req.method === 'POST' ? await body(req) : {})) } catch (e) { json(res, 400, { error: e.message }) }
      return
    }
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
    if (!p) p = 'index.html'
    const f = path.join(WEB, p)
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' })
    fs.createReadStream(f).pipe(res)
  })
  ctx.effect(() => {
    server.listen(PORT, '127.0.0.1', () => console.log(`[tianxi] ready http://127.0.0.1:${PORT}`))
    return () => { server.close(); for (const c of clients) c.end() }
  })
}
