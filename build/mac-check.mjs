// Start-up check for a built Mac app, run by .github/workflows/mac.yml: node build/mac-check.mjs "<path to 小天 Bot.app>" <out dir>
// Starts the app the way a person would after installing it, waits for 小天's runtime and home page, and reads
// back what the window shows through Chromium's debugging port. Writes check.json, page.png and screen.png to <out dir>.
// Exits 1 when the runtime, the home page or the desktop 小天 does not come up.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [app, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const exe = path.join(app, 'Contents', 'MacOS', 'XiaotianBot')
const DBG = 9223
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = fs.openSync(path.join(out, 'app.log'), 'w')
const child = spawn(exe, [`--remote-debugging-port=${DBG}`], { stdio: ['ignore', log, log] })
let exited = null
child.on('exit', (code, sig) => { exited = { code, sig } })

const res = { app, ok: false, steps: {} }
const done = async (ok) => {
  res.ok = ok
  try { execFileSync('screencapture', ['-x', path.join(out, 'screen.png')]) } catch {}
  child.kill(); await sleep(1500); try { process.kill(child.pid, 'SIGKILL') } catch {}
  fs.writeFileSync(path.join(out, 'check.json'), JSON.stringify(res, null, 2))
  console.log(JSON.stringify(res, null, 2))
  process.exit(ok ? 0 : 1)
}
const until = async (what, ms, fn) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (exited) { res.steps[what] = { ok: false, error: `app exited ${JSON.stringify(exited)}` }; return null }
    try { const v = await fn(); if (v) { res.steps[what] = { ok: true, after: Math.round((Date.now() - t0) / 1000) + 's' }; return v } } catch {}
    await sleep(1000)
  }
  res.steps[what] = { ok: false, error: `not within ${ms / 1000}s` }
  return null
}
const pages = async () => (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).filter((p) => p.type === 'page')

// one Chrome DevTools Protocol call on a page
async function cdp(page, method, params = {}) {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  const reply = new Promise((r) => { ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m) } })
  ws.send(JSON.stringify({ id: 1, method, params }))
  const m = await reply; ws.close()
  if (m.error) throw new Error(m.error.message)
  return m.result
}
const evaluate = async (page, expr) => (await cdp(page, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value

// 1. the window opens (start-up page or first-run setup)
if (!await until('window', 60000, async () => (await pages()).length > 0)) await done(false)
// 2. 小天's runtime answers on its port
if (!await until('runtime', 180000, async () => { const r = await fetch('http://127.0.0.1:3090/api/ping').catch(() => null); return r && r.status > 0 })) await done(false)
// 3. the home page is loaded and drawn
const home = await until('home page', 60000, async () => (await pages()).find((p) => /^http:\/\/127\.0\.0\.1:3090\/(\?|$|index)/.test(p.url) && !p.url.includes('orb.html')))
if (!home) { res.pages = (await pages().catch(() => [])).map((p) => p.url); await done(false) }
await sleep(6000)
res.home = await evaluate(home, `(() => ({
  url: location.href, title: document.title,
  mac: document.documentElement.classList.contains('mac'),
  pageButtonsHidden: !!document.getElementById('wctl')?.hidden,
  bots: document.querySelectorAll('.rail .ag').length,
  input: !!document.getElementById('inp'),
  tour: !!document.querySelector('.tour'),
  font: getComputedStyle(document.body).fontFamily,
  text: document.body.innerText.slice(0, 300),
}))()`)
fs.writeFileSync(path.join(out, 'page.png'), Buffer.from((await cdp(home, 'Page.captureScreenshot', { format: 'png' })).data, 'base64'))
res.steps['home page drawn'] = { ok: !!(res.home.input && res.home.mac && res.home.pageButtonsHidden) }
// 4. the desktop 小天 (floating ball) is up
res.steps['desktop 小天'] = { ok: (await pages()).some((p) => p.url.includes('orb.html')) }
res.pages = (await pages()).map((p) => p.url)
await done(Object.values(res.steps).every((s) => s.ok))
