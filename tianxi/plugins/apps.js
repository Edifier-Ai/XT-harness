// 连接应用: real plugin management. Built-in tool groups can be switched off; outside apps come in as MCP servers
// (a catalog of known ones plus any custom server), loaded at runtime through DSH's own MCP client.
import { spawn } from 'node:child_process'
import * as mcp from '@deepseek-ai/dsh-mcp-client'
import { load, update, id, now, bus, settings } from './store.js'
import { markRiskyMatch } from './ledger.js'

export const name = 'tianxi-apps'
export const inject = ['tools']

const WIN = process.platform === 'win32'

// Known MCP servers. Fields are what the user fills in; {key} placeholders are replaced in url/args/env/headers.
export const CATALOG = [
  { id: 'amap', n: '高德地图', c: '效率', d: '查地点、路线规划、估算通勤和天气', transport: 'streamable-http', url: 'https://mcp.amap.com/mcp?key={key}', fields: [{ k: 'key', l: 'Web 服务 Key', help: '在 lbs.amap.com 控制台创建应用，选“Web 服务”拿到 Key', secret: true }] },
  { id: 'baidumap', n: '百度地图', c: '效率', d: '地点检索、路线规划、天气和路况', transport: 'stdio', command: 'npx', args: ['-y', '@baidumap/mcp-server-baidu-map'], env: { BAIDU_MAP_API_KEY: '{key}' }, fields: [{ k: 'key', l: 'API Key (AK)', help: '在 lbsyun.baidu.com 控制台创建服务端应用拿到 AK', secret: true }] },
  { id: 'feishu', n: '飞书', c: '通信', d: '读写飞书文档、多维表格、日历和群消息', transport: 'stdio', command: 'npx', args: ['-y', '@larksuiteoapi/lark-mcp', 'mcp', '-a', '{appId}', '-s', '{appSecret}'], fields: [{ k: 'appId', l: 'App ID', help: '在 open.feishu.cn 创建企业自建应用，开通需要的权限' }, { k: 'appSecret', l: 'App Secret', secret: true }] },
  { id: 'github', n: 'GitHub', c: '代码', d: '看 issue 和 PR、搜代码、提交评论', transport: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer {token}' }, fields: [{ k: 'token', l: '访问令牌', help: 'GitHub → Settings → Developer settings → Personal access tokens', secret: true }] },
  { id: 'notion', n: 'Notion', c: '效率', d: '搜索和编辑 Notion 页面与数据库', transport: 'stdio', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: '{token}' }, fields: [{ k: 'token', l: 'Integration Token', help: 'notion.so/my-integrations 创建集成，再把页面分享给它', secret: true }] },
  { id: 'browser', n: '浏览器', c: '联网', d: '打开网页、点击、填表、截图（用本机的 Edge）', transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--browser', WIN ? 'msedge' : 'chromium'], fields: [] },
]
const needsNode = (a) => a.transport === 'stdio' && /^(npx|npm|node)$/i.test(a.command || '')

// Built-in tool groups the user may switch off. Memory, records and the brief are the core and stay on.
export const BUILTIN = [
  { id: 'calendar', n: '日历', tools: ['calendar_list', 'calendar_add', 'calendar_update', 'calendar_delete'] },
  { id: 'todo', n: '待办', tools: ['todo_list', 'todo_add', 'todo_done'] },
  { id: 'mail', n: '邮箱', tools: ['mail_draft', 'mail_send', 'mail_inbox'] },
  { id: 'files', n: '文件', tools: ['folder_list', 'file_move'] },
  { id: 'cards', n: '生成式卡片', tools: ['show_ui'] },
  { id: 'web', n: '联网搜索', tools: ['web_search', 'web_fetch', 'fetch'] },
  { id: 'shell', n: '命令行', tools: ['bash', 'shell', 'pwsh', 'powershell'] },
]

const live = new Map()   // app id -> { fork, sig, status, error, at }
let nodeOk = null
/** Whether npx can run here; checked once in the background so the event loop never blocks. */
export function checkNode() {
  if (nodeOk !== null) return Promise.resolve(nodeOk)
  return new Promise((res) => {
    let p; const done = (ok) => { nodeOk = ok; res(ok) }
    try { p = spawn(WIN ? 'npx.cmd' : 'npx', ['--version'], { shell: WIN, windowsHide: true, stdio: 'ignore' }) } catch { return done(false) }
    const t = setTimeout(() => { try { p.kill() } catch {}; done(false) }, 20000)
    p.on('error', () => { clearTimeout(t); done(false) })
    p.on('exit', (code) => { clearTimeout(t); done(code === 0) })
  })
}
const fill = (v, vals) => typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_m, k) => vals[k] ?? '') : v
const serverName = (a) => (a.catalogId || 'app_' + a.id.slice(-6)).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32)

/** The DSH MCP client config of one app. */
function mcpConfig(a) {
  const base = a.catalogId ? CATALOG.find((c) => c.id === a.catalogId) : a
  const vals = a.values || {}
  const cfg = { serverName: serverName(a), transport: base.transport, failOnStartupError: true, toolCallTimeoutMs: 120000 }
  if (base.transport === 'stdio') {
    let command = base.command, args = (base.args || []).map((x) => fill(x, vals))
    // Windows cannot spawn npx.cmd without a shell; go through cmd.exe.
    if (WIN && /^(npx|npm)$/i.test(command)) { args = ['/c', command, ...args]; command = 'cmd.exe' }
    Object.assign(cfg, { command, args, env: Object.fromEntries(Object.entries(base.env || {}).map(([k, v]) => [k, fill(v, vals)])) })
  } else Object.assign(cfg, { url: fill(base.url, vals), headers: Object.fromEntries(Object.entries(base.headers || {}).map(([k, v]) => [k, fill(v, vals)])) })
  return cfg
}

export const apps = () => load('apps', [])
export function appsState(ctx) {
  const visible = [...(ctx?.tools?.view?.(undefined)?.visible?.keys?.() || [])]
  return {
    node: nodeOk,
    disabled: settings().disabledTools || [],
    apps: apps().map((a) => {
      const l = live.get(a.id), sn = serverName(a)
      const { values, ...rest } = a
      return { ...rest, hasValues: Object.keys(values || {}), status: !a.enabled ? 'off' : l?.status || 'connecting', error: l?.error || '', tools: visible.filter((n) => n.startsWith(`mcp__${sn}__`)).map((n) => n.slice(sn.length + 7)) }
    }),
  }
}

export function apply(ctx) {
  const changed = () => bus.push({ type: 'store', name: 'apps' })
  // Switched-off built-in tools: the call is refused with a reason the model can relay.
  ctx.effect(() => ctx.tools.guard((exec) => (settings().disabledTools || []).includes(exec.name) ? `用户在“连接应用”里停用了这个工具（${exec.name}）。告诉用户可以去连接应用里重新打开。` : undefined), 'tianxi-apps.guard')
  // Outside apps that change things ask first, like sending mail does.
  ctx.effect(() => markRiskyMatch((tool) => {
    const m = /^mcp__([\w-]+?)__(.+)$/.exec(tool); if (!m) return ''
    if (!/(create|update|delete|remove|send|post|push|merge|write|edit|move|reply|comment|publish|upload|close|add|set|insert|click|fill|type|submit|press|drag|select)/i.test(m[2])) return ''
    const a = apps().find((x) => serverName(x) === m[1]); return `要用${a?.name || m[1]}执行 ${m[2]}，会改动外面的数据`
  }))

  function stop(aid) { const l = live.get(aid); if (l) { live.delete(aid); try { l.fork.dispose() } catch {} } }
  function start(a) {
    const cfg = mcpConfig(a), sig = JSON.stringify(cfg)
    const l = live.get(a.id); if (l && l.sig === sig && l.status !== 'error') return
    stop(a.id)
    if (needsNode(a) && nodeOk === false) { live.set(a.id, { fork: { dispose() {} }, sig, status: 'error', error: '这个应用要用 Node.js 启动。先从 nodejs.org 装 Node.js（LTS 版），装好后重启天禧。' }); changed(); return }
    const entry = { sig, status: 'connecting', error: '', at: now() }
    // A wrapper plugin so a failed start shows up here instead of in the log only.
    entry.fork = ctx.plugin({
      name: 'tianxi-app-' + cfg.serverName, inject: ['tools'],
      apply: async (c) => {
        try { await mcp.apply(c, mcp.Config(cfg)); if (live.get(a.id) === entry) { entry.status = 'ok'; changed() } }
        catch (e) { if (live.get(a.id) === entry) { entry.status = 'error'; entry.error = String(e.cause?.message || e.message || e).slice(0, 300); changed(); setTimeout(() => { if (live.get(a.id) === entry) try { entry.fork.dispose() } catch {} }, 0) } }
      },
    })
    live.set(a.id, entry); changed()
  }
  function sync() {
    const list = apps()
    for (const aid of [...live.keys()]) if (!list.some((a) => a.id === aid && a.enabled)) stop(aid)
    for (const a of list) if (a.enabled) start(a)
    changed()
  }
  bus.appsSync = sync
  bus.appsState = () => appsState(ctx)
  setTimeout(() => checkNode().then(sync), 300)
  ctx.effect(() => () => { for (const aid of [...live.keys()]) stop(aid) })
}

/** Add or change one app; values left empty keep what was saved before (secrets are never sent back). */
export function saveApp(b) {
  let out
  update('apps', [], (l) => {
    let a = l.find((x) => x.id === b.id)
    if (!a) { a = { id: id('app'), createdAt: now(), enabled: true, values: {} }; l.push(a) }
    if (b.catalogId) { const c = CATALOG.find((x) => x.id === b.catalogId); if (!c) throw new Error('没有这个应用'); a.catalogId = c.id; a.name = c.n }
    else {
      a.name = String(b.name || '').trim().slice(0, 30) || '自定义应用'
      if (b.url) { a.transport = 'streamable-http'; a.url = String(b.url).trim(); a.headers = b.header ? { Authorization: String(b.header).trim() } : {} }
      else {
        const parts = String(b.commandLine || '').match(/"[^"]*"|\S+/g) || []
        if (!parts.length) throw new Error('填一个启动命令，或者一个网址')
        a.transport = 'stdio'; a.command = parts[0].replace(/^"|"$/g, ''); a.args = parts.slice(1).map((x) => x.replace(/^"|"$/g, ''))
        a.env = {}
        for (const line of String(b.envText || '').split(/\n/)) { const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/); if (m) a.env[m[1]] = m[2].trim() }
      }
    }
    for (const [k, v] of Object.entries(b.values || {})) if (String(v).trim()) a.values[k] = String(v).trim()
    if (b.enabled !== undefined) a.enabled = !!b.enabled
    out = { ...a, values: undefined }
  })
  bus.appsSync?.()
  return out
}
export function removeApp(aid) { update('apps', [], (l) => l.filter((x) => x.id !== aid)); bus.appsSync?.() }
export function toggleApp(aid, on) { update('apps', [], (l) => { const a = l.find((x) => x.id === aid); if (a) a.enabled = !!on }); bus.appsSync?.() }
export function toggleBuiltin(gid, on) {
  const g = BUILTIN.find((x) => x.id === gid); if (!g) throw new Error('没有这一组')
  update('settings', {}, (s) => { const d = new Set(s.disabledTools || []); for (const t of g.tools) on ? d.delete(t) : d.add(t); s.disabledTools = [...d] })
}
