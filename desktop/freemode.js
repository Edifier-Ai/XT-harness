'use strict'
// 免费模式: models the user can use without buying an API key.
//  · 借用已安装的软件: Qoder, WorkBuddy, Codex and Claude, signed in on this computer, reached through Magpie
//    (github.com/yetone/magpie), the local gateway that finds those sign-ins and serves their models.
//  · 云端注册: 智谱 BigModel, whose Flash models are free with a key from a phone-number sign-up.
// Which providers count as which software, and which models are free, live in the bundle's
// web/free-models.json, so a change there ships with a differential update.
const fs = require('fs')
const os = require('os')
const path = require('path')

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function readList(bundleDir) {
  try { return JSON.parse(fs.readFileSync(path.join(bundleDir, 'web', 'free-models.json'), 'utf8')) } catch { return { software: [], cloud: [] } }
}

// Magpie listens on 127.0.0.1:3425 unless its settings.json names another port.
function magpieBase() {
  const dirs = [process.env.XDG_CONFIG_HOME && path.join(process.env.XDG_CONFIG_HOME, 'magpie'), path.join(os.homedir(), '.config', 'magpie')].filter(Boolean)
  for (const d of dirs) {
    try { const s = JSON.parse(fs.readFileSync(path.join(d, 'settings.json'), 'utf8')); if (+s.port) return `http://127.0.0.1:${+s.port}` } catch {}
  }
  return 'http://127.0.0.1:3425'
}
const MAGPIE_KEY = 'magpie-tianxi'   // names 天禧 in Magpie's usage page

const isFree = (re, m) => (re || []).some((p) => new RegExp(p, 'i').test(m.id) || new RegExp(p, 'i').test(m.display_name || ''))
const effortsOf = (m) => {
  const raw = (m.reasoning_levels && m.reasoning_levels.length ? m.reasoning_levels : (m.supported_reasoning_levels || []).map((x) => x.effort)) || []
  const lv = LEVELS.filter((l) => l !== 'off' && raw.includes(l))
  return lv.length ? ['off', ...lv] : []
}

// Find Magpie, list its models and sort them under the four apps.
async function scan(bundleDir) {
  const list = readList(bundleDir)
  const base = magpieBase()
  const out = { magpie: { ok: false, base }, software: [], others: [] }
  try {
    const r = await fetch(base + '/api/hello', { signal: AbortSignal.timeout(2500) })
    const j = await r.json()
    if (j.name !== 'magpie') throw new Error('这个端口上不是 Magpie')
    out.magpie = { ok: true, base, version: j.version || '' }
  } catch (e) {
    out.magpie.error = /fetch failed|ECONNREFUSED|aborted|timeout/i.test(String(e.cause?.code || e.message)) ? '这台电脑上没有运行 Magpie' : e.message
    out.software = list.software.map((s) => ({ id: s.id, name: s.name, how: s.how, models: [] }))
    return out
  }
  let models = []
  try {
    const r = await fetch(base + '/v1/models', { headers: { authorization: 'Bearer ' + MAGPIE_KEY }, signal: AbortSignal.timeout(8000) })
    models = ((await r.json()).data || [])
  } catch (e) { out.magpie.error = '读不到 Magpie 的模型列表：' + e.message }
  const taken = new Set()
  for (const s of list.software) {
    const mine = models.filter((m) => s.providers.some((p) => new RegExp(p, 'i').test(m.owned_by || '')))
    mine.forEach((m) => taken.add(m.id))
    out.software.push({
      id: s.id, name: s.name, how: s.how,
      models: mine.map((m) => ({ id: m.id, label: m.display_name || m.id.split('/').pop(), free: isFree(s.free, m), tag: s.tag || '', efforts: effortsOf(m) })),
    })
  }
  out.others = models.filter((m) => !taken.has(m.id) && !/^group\//.test(m.id)).map((m) => ({ id: m.id, label: m.display_name || m.id, free: isFree(list.freeAnywhere, m), tag: '', efforts: effortsOf(m) }))
  return out
}

// One small request with a tool attached: proves the model answers and takes tools.
// A failure keeps the HTTP status and the provider's own error code.
async function test({ baseURL, key, model, effort }) {
  const t0 = Date.now()
  const body = { model, max_tokens: 16, messages: [{ role: 'user', content: '你好，回复“好”' }],
    tools: [{ type: 'function', function: { name: 'ping', description: 'test', parameters: { type: 'object', properties: {} } } }] }
  if (effort && effort !== 'off') body.reasoning_effort = effort
  try {
    const r = await fetch(String(baseURL).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
    })
    const text = await r.text()
    if (r.ok) return { ok: true, ms: Date.now() - t0 }
    let j = {}; try { j = JSON.parse(text) } catch {}
    const e = j.error || j
    return { ok: false, status: r.status, code: String(e.code ?? e.type ?? e.status ?? ''), message: String(e.message || e.msg || text || r.statusText).slice(0, 240) }
  } catch (e) {
    const code = e.cause?.code || (e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK')
    return { ok: false, status: 0, code, message: code === 'ECONNREFUSED' ? '连不上，对方没有在运行' : code === 'TIMEOUT' ? '等了 45 秒没有回应' : (e.cause?.message || e.message) }
  }
}

// The cloud platforms 天禧 can sign the user up for (now 智谱 only).
const cloud = (bundleDir) => (readList(bundleDir).cloud || []).map((c) => process.env['TIANXI_CLOUD_' + c.id.toUpperCase()] ? { ...c, baseURL: process.env['TIANXI_CLOUD_' + c.id.toUpperCase()] } : c)   // the override is for tests

module.exports = { scan, test, cloud, magpieBase, MAGPIE_KEY, LEVELS }
