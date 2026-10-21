// The computer side for the phone tests: the scripted model (dev/fake), the 小天 runtime on :3090 and the phone
// connection (desktop/phone.js) on 0.0.0.0:3091, with "允许手机连接" turned on. :3092 answers what the Electron
// shell would: GET /state (incl. the pairing code), /renew, /on?v=0|1, /events, /takeover (the runtime's takeover state).
// Needs build/runtime installed (see .github/workflows/android.yml). Usage: node dev/phone-e2e/host.mjs <work dir>
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WORK = path.resolve(process.argv[2] || 'e2e-host')
const TOKEN = 'e2etoken', PORT = 3090
fs.mkdirSync(path.join(WORK, 'home'), { recursive: true })
fs.mkdirSync(path.join(WORK, 'data'), { recursive: true })
const log = (...a) => console.log('[host]', ...a)

// the 小天 plugins import DSH packages: let them find the runtime's (the installers put them side by side)
if (!fs.existsSync(path.join(ROOT, 'node_modules')) && !fs.existsSync(path.join(ROOT, 'tianxi/node_modules'))) {
  fs.symlinkSync(path.join(ROOT, 'build/runtime/node_modules'), path.join(ROOT, 'tianxi/node_modules'), 'dir')
  log('linked tianxi/node_modules to build/runtime/node_modules')
}

// the runtime's plugin bundle, with the plugins loaded from this checkout and the fake model as the only model
const B = path.join(ROOT, 'tianxi')
const bundle = fs.readFileSync(path.join(B, 'cordis.patch.yml'), 'utf8').replace(/name: dsh-tianxi\/plugins\/([\w-]+\.js)/g, (_m, f) => 'name: ' + JSON.stringify(pathToFileURL(path.join(B, 'plugins', f)).href))
const PATCH = path.join(WORK, 'patch.yml')
fs.writeFileSync(PATCH, `${bundle}
- id: llm-pi-ai
  config:
    providers:
      tianxi:
        apiKeyEnv: TIANXI_API_KEY
        api: openai-completions
        baseURL: "http://127.0.0.1:4010/v1"
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
          - id: "fake-tianxi"
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: "tianxi"
    model: "fake-tianxi"
`)

const kids = []
const run = (name, cmd, args, opts) => {
  const out = fs.openSync(path.join(WORK, name + '.log'), 'a')
  const p = spawn(cmd, args, { stdio: ['ignore', out, out], ...opts })
  p.on('exit', (c) => log(name, 'exited', c))
  kids.push(p)
  return p
}
const stop = () => { for (const k of kids) try { k.kill() } catch {} process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)

run('fake-llm', process.execPath, ['fake-llm.mjs'], { cwd: path.join(ROOT, 'dev/fake'), env: { ...process.env } })
run('runtime', process.execPath, [path.join(ROOT, 'build/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--patch', PATCH, '--no-open', '--port', '0'], {
  cwd: WORK,
  env: { ...process.env, DSH_HOME: path.join(WORK, 'home'), TIANXI_HOME: path.join(WORK, 'data'), TIANXI_PORT: String(PORT), TIANXI_TOKEN: TOKEN, TIANXI_API_KEY: 'x',
    TIANXI_MODELS: JSON.stringify([{ provider: 'tianxi', model: 'fake-tianxi', label: '测试模型', group: '测试', efforts: [] }]), TIANXI_PICK: JSON.stringify({ provider: 'tianxi', model: 'fake-tianxi' }) },
})

const api = (p, body) => fetch(`http://127.0.0.1:${PORT}/api/${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-tianxi-token': TOKEN }, body: body ? JSON.stringify(body) : undefined })
for (let i = 0; ; i++) {
  try { if ((await api('state')).ok) break } catch {}
  if (i > 120) { log('runtime did not come up; see', path.join(WORK, 'runtime.log')); stop() }
  await new Promise((r) => setTimeout(r, 1000))
}
log('runtime up on', PORT)

const require = createRequire(import.meta.url)
const { createPhone } = require(path.join(ROOT, 'desktop/phone.js'))
const CFG = path.join(WORK, 'cfg.json')
let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')) } catch {}
const events = []
const phone = createPhone({
  getCfg: () => cfg, saveCfg: (c) => { cfg = c; fs.writeFileSync(CFG, JSON.stringify(c, null, 1)) }, runtime: () => ({ port: PORT, token: TOKEN }),
  log: (m) => log('phone:', m),
  onEvent: (ev) => { events.push({ ...ev, at: Date.now() }); log('event', JSON.stringify(ev)); if (ev.type === 'takeover') api('takeover', { on: ev.on, how: ev.how, phone: ev.phone }) },
})
await phone.start()
await phone.setOn(true)
const st = await phone.state()
log('phone connection', st.running ? 'on' : 'off', st.port, st.url || st.error)

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  let r
  try {
    if (u.pathname === '/state') r = await phone.state()
    else if (u.pathname === '/renew') r = await phone.renew()
    else if (u.pathname === '/on') r = await phone.setOn(u.searchParams.get('v') === '1')
    else if (u.pathname === '/events') r = events
    else if (u.pathname === '/takeover') r = (await (await api('state')).json()).takeover ?? null
    else { res.writeHead(404); return res.end() }
  } catch (e) { r = { error: e.message } }
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(r))
}).listen(3092, '127.0.0.1', () => log('control on 3092'))
