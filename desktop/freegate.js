'use strict'
// 免费模式, built from Magpie's own code (github.com/yetone/magpie) instead of running Magpie:
//  · Qoder and WorkBuddy sign-ins are Magpie's community plugins (magpie-community/plugins, MIT), kept unchanged
//    in the bundle's vendor/magpie/ and driven the way Magpie drives them: their sign-in methods, their model
//    lists with Magpie's `free` mark, and their fetch, which talks to the vendor.
//  · Which models count as free is Magpie's rule too: the plugin's mark, or "free" as a word of the id or name.
//  · 智谱 is a key from a phone-number sign-up, asked directly.
// A local gateway gives every signed-in plugin an OpenAI-compatible endpoint, /<site>/v1, for DSH.
const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { pathToFileURL } = require('url')

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
// Magpie's namedFree and isFree (internal/gui/assets/app.js)
const namedFree = (...names) => names.some((n) => /(^|[^a-z])free($|[^a-z])/i.test(n || ''))
const isFree = (m) => !!m.free || namedFree(m.id, m.name)

function createGate({ bundleDir, userDir, encrypt, decrypt, openExternal }) {
  const KEY = crypto.randomBytes(16).toString('hex')
  const AUTH_FILE = path.join(userDir, 'free-auth.json')
  let port = 0
  const list = () => { try { return JSON.parse(fs.readFileSync(path.join(bundleDir, 'web', 'free-models.json'), 'utf8')) } catch { return { software: [], cloud: [] } } }
  const sites = () => list().software.flatMap((s) => (s.sites || []).map((x) => ({ ...x, app: s.id, appName: s.name })))
  const siteOf = (id) => sites().find((x) => x.id === id)

  // ---- sign-ins, encrypted on this computer ----
  const readAuth = () => { try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) } catch { return {} } }
  const getAuth = (id) => { const v = readAuth()[id]; if (!v) return undefined; try { return JSON.parse(decrypt(v.v, v.enc)) } catch { return undefined } }
  const setAuth = (id, auth) => {
    const all = readAuth()
    if (auth) { const e = encrypt(JSON.stringify(auth)); all[id] = { v: e.v, enc: e.enc } } else delete all[id]
    fs.writeFileSync(AUTH_FILE, JSON.stringify(all))
    loaders.delete(id)
  }

  // ---- plugins, one instance per site, as Magpie's plugin host makes them ----
  const plugins = new Map(), loaders = new Map()
  async function plugin(id) {
    if (plugins.has(id)) return plugins.get(id)
    const s = siteOf(id); if (!s) throw new Error('不认识的来源 ' + id)
    const p = (async () => {
      const mod = await import(pathToFileURL(path.join(bundleDir, 'vendor', 'magpie', s.file)).href)
      // the plugin saves a renewed sign-in through OpenCode's client.auth.set
      const hooks = await mod[s.export]({ client: { auth: { set: async ({ path: p, body }) => { setAuth(p?.id || id, body); return { data: true } } } } })
      const conf = {}; await hooks.config?.(conf)
      return { hooks, info: { id, ...(conf.provider?.[id] || {}) } }
    })()
    plugins.set(id, p)
    p.catch(() => plugins.delete(id))
    return p
  }
  async function loader(id) {
    if (loaders.has(id)) return loaders.get(id)
    const { hooks, info } = await plugin(id)
    const l = await hooks.auth.loader(async () => getAuth(id), info)
    loaders.set(id, l)
    return l
  }
  const effortsOf = (m) => {
    const v = Object.keys(m.variants || {}).filter((l) => LEVELS.includes(l) && l !== 'off')
    return m.capabilities?.reasoning !== false && v.length ? ['off', ...LEVELS.filter((l) => v.includes(l))] : []
  }
  // The account's own models, with Magpie's free mark.
  async function models(id) {
    const { hooks, info } = await plugin(id)
    const auth = getAuth(id)
    const got = auth ? await hooks.provider.models(info, { auth }) : info.models
    return Object.entries(got || {}).map(([k, m]) => ({ id: m.id || k, label: m.name || k, free: isFree({ id: m.id || k, name: m.name, free: m.free }), efforts: effortsOf(m) }))
  }
  const accountOf = (a) => a ? (a.email || a.name || a.accountId || a.uid || '已登录') : ''

  // What each software has on this computer: signed in or not, and its models.
  async function scan() {
    const out = []
    for (const s of list().software) {
      const app = { id: s.id, name: s.name, how: s.how || '', off: s.off || '', sites: [] }
      for (const x of s.sites || []) {
        const st = { id: x.id, name: x.name, account: '', models: [], error: '' }
        try {
          const a = getAuth(x.id)
          if (a) { st.account = (a.source === 'desktop' ? '桌面版的登录 · ' : '') + accountOf(a); st.models = await models(x.id) }
          else {
            // WorkBuddy desktop already signed in on this computer: offered, never taken without a click
            const { hooks } = await plugin(x.id)
            const d = hooks.auth.methods.find((m) => /desktop/i.test(m.label))
            if (d) { const r = await (await d.authorize()).callback().catch(() => null); if (r?.type === 'success') st.desktop = accountOf(r) }
          }
        } catch (e) { st.error = e.message }
        app.sites.push(st)
      }
      out.push(app)
    }
    return out
  }

  // Sign in with the plugin's own method: a browser page (device flow / Tencent's page) or the desktop app's sign-in.
  const pending = new Map()
  async function signIn(id, how = 'browser') {
    const { hooks } = await plugin(id)
    const ms = hooks.auth.methods
    const m = how === 'desktop' ? ms.find((x) => /desktop/i.test(x.label)) : ms.find((x) => !x.prompts && !/desktop/i.test(x.label))
    if (!m) return { ok: false, code: 'NO_METHOD', message: '这个来源没有这种登录方式' }
    try {
      const a = await m.authorize()
      if (a.url) { pending.set(id, a.url); openExternal(a.url) }
      const r = await a.callback()
      pending.delete(id)
      if (r?.type !== 'success') return { ok: false, code: 'SIGNIN_FAILED', message: r?.error || '登录没有完成' }
      const { type, ...cred } = r
      setAuth(id, { type: 'oauth', ...cred })
      return { ok: true, account: accountOf(cred), models: await models(id) }
    } catch (e) { pending.delete(id); return { ok: false, code: 'SIGNIN_FAILED', message: e.message } }
  }
  const reopen = (id) => { const u = pending.get(id); if (u) openExternal(u); return !!u }
  const signOut = (id) => setAuth(id, null)

  // ---- the gateway DSH talks to ----
  async function chat(id, body, signal) {
    const l = await loader(id)
    if (!l?.fetch) return new Response(JSON.stringify({ error: { message: '还没登录', code: 'NOT_SIGNED_IN' } }), { status: 401, headers: { 'content-type': 'application/json' } })
    return l.fetch(String(l.baseURL || 'http://x').replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal, body,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (l.apiKey || 'x') },
    })
  }
  const server = http.createServer(async (req, res) => {
    const fail = (status, code, message) => { if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message, code } })) }
    if (req.headers.authorization !== 'Bearer ' + KEY) return fail(401, 'BAD_KEY', 'not for this gateway')
    const m = /^\/([\w.-]+)\/v1\/(chat\/completions|models)$/.exec(req.url.split('?')[0])
    if (!m || !siteOf(m[1])) return fail(404, 'NOT_FOUND', 'no such route')
    try {
      if (m[2] === 'models') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: (await models(m[1])).map((x) => ({ id: x.id, object: 'model', owned_by: m[1], free: x.free })) })) }
      const chunks = []; for await (const c of req) chunks.push(c)
      const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort() })
      const r = await chat(m[1], Buffer.concat(chunks).toString('utf8'), ac.signal)
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-cache' })
      if (r.body) for await (const c of r.body) res.write(c)
      res.end()
    } catch (e) { if (e.name !== 'AbortError') fail(502, 'GATEWAY', e.message); else res.end() }
  })
  const start = (pref) => port ? Promise.resolve(port) : new Promise((resolve) => {
    server.once('error', () => server.listen(0, '127.0.0.1', () => resolve(port = server.address().port)))
    server.listen(pref, '127.0.0.1', () => resolve(port = server.address().port))
  })
  const baseURL = (id) => `http://127.0.0.1:${port}/${id}/v1`

  return { start, scan, signIn, reopen, signOut, models, baseURL, KEY, siteOf, sites, getAuth, list }
}

// One small streamed request with a tool attached: proves the model answers and takes tools (WorkBuddy serves streams only).
// A failure keeps the HTTP status and the provider's own error code.
async function test({ baseURL, key, model, effort, stream }) {
  const t0 = Date.now()
  const body = { model, max_tokens: 32, stream: !!stream, messages: [{ role: 'user', content: '你好，回复“好”' }],
    tools: [{ type: 'function', function: { name: 'ping', description: 'test', parameters: { type: 'object', properties: { x: { type: 'string' } } } } }] }
  if (effort && effort !== 'off') body.reasoning_effort = effort
  const bad = (status, text) => {
    let j = {}; try { j = JSON.parse(text) } catch {}
    const e = j.error || j
    return { ok: false, status, code: String(e.code ?? e.type ?? e.status ?? ''), message: String(e.message || e.msg || text || '').slice(0, 240) }
  }
  try {
    const r = await fetch(String(baseURL).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    })
    const text = await r.text()
    if (!r.ok) return bad(r.status, text)
    if (stream) {
      // an error can come inside a 200 stream
      const err = text.split('\n').map((l) => l.replace(/^data:\s*/, '')).find((l) => /^\{.*"error"/.test(l))
      if (err) return bad(r.status, err)
      if (!/"choices"/.test(text)) return bad(r.status, text || '没有回复')
    }
    return { ok: true, ms: Date.now() - t0 }
  } catch (e) {
    const code = e.cause?.code || (e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK')
    return { ok: false, status: 0, code, message: code === 'ECONNREFUSED' ? '连不上，对方没有在运行' : code === 'TIMEOUT' ? '等了 60 秒没有回应' : (e.cause?.message || e.message) }
  }
}

// The cloud platforms 天禧 can sign the user up for (now 智谱 only).
const cloud = (bundleDir) => {
  let l = {}; try { l = JSON.parse(fs.readFileSync(path.join(bundleDir, 'web', 'free-models.json'), 'utf8')) } catch {}
  return (l.cloud || []).map((c) => process.env['TIANXI_CLOUD_' + c.id.toUpperCase()] ? { ...c, baseURL: process.env['TIANXI_CLOUD_' + c.id.toUpperCase()] } : c)   // the override is for tests
}

module.exports = { createGate, test, cloud, isFree, LEVELS }
