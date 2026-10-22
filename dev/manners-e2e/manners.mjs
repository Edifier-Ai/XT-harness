// 会察言观色的小天 and 拖给小天, end to end in Chrome against dev/phone-e2e/host.mjs (the 小天 runtime with the scripted
// model; start it with TIANXI_NUDGE_GAP=2000 so the gap between two things said on its own is short).
// The runtime is told what is in front the way the desktop client tells it (POST /api/room); the desktop 小天
// (orb.html) runs with a stand-in for the client's bridge. Writes NN-name.png and results.json.
// Usage: node dev/manners-e2e/manners.mjs <out dir> <chrome path> <FAKE_DIR>
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(process.argv[2] || 'shots-manners')
const exe = process.argv[3] || process.env.CHROME
const DL = path.resolve(process.argv[4] || process.env.FAKE_DIR || 'dl')
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(DL, { recursive: true })
const BASE = 'http://127.0.0.1:3090', T = 'e2etoken'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (p, body) => (await fetch(`${BASE}/api/${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-tianxi-token': T }, body: body ? JSON.stringify(body) : undefined })).json()
const results = []
const check = (ok, what, x) => { results.push({ ok: !!ok, what, ...(x !== undefined ? { x } : {}) }); console.log(ok ? 'PASS' : 'FAIL', what, x === undefined ? '' : JSON.stringify(x).slice(0, 300)) }
async function until(fn, ms = 20000) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v } catch {} if (Date.now() - t > ms) return null; await sleep(200) } }
let n = 0
const shot = async (pg, name) => { await sleep(450); await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) }) }
const state = () => api('state')
const manner = async () => (await state()).manner
// what the desktop client would say: a pause is a few seconds without touching mouse or keys
const room = (m = {}) => api('room', { typing: false, full: false, meeting: '', app: 'Code', title: 'main.js', orb: true, idleSec: 10, ...m })

// the orb page: the window is 520×380 with the ball in the middle; a desktop-coloured backdrop for the pictures
const W = 520, H = 380, CX = W / 2, CY = H / 2
const ORB_BRIDGE = () => {
  window.__paths = {}; window.__shown = 0; window.__goto = null; window.__hit = false
  window.tianxiApp = {
    show: () => { window.__shown++ }, goto: (g) => { window.__goto = g }, orbHit: (on) => { window.__hit = on }, orbDrag: () => {}, orbMenu: () => {},
    onOrb: (cb) => { window.__orb = cb }, onLook: (cb) => { window.__look = cb }, peekHelp: () => { window.__help = true },
    pathOf: (f) => window.__paths[f.name] || '',
  }
  localStorage.setItem('tx.theme', '"dark"')
}
const APP_BRIDGE = () => {
  const own = { platform: 'win32', getConfig: async () => ({ configured: true }), updateStatus: async () => ({}), phoneState: async () => ({ on: false, devices: [] }) }
  window.tianxiApp = new Proxy(own, { get: (t, k) => k in t ? t[k] : () => Promise.resolve(null) })
  localStorage.setItem('tx.tourSeen', 'true')
}

async function main() {
  const b = await chromium.launch(exe ? { executablePath: exe } : {})
  const octx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  await octx.addInitScript(ORB_BRIDGE)
  const orb = await octx.newPage()
  const errs = []
  orb.on('pageerror', (e) => errs.push('orb: ' + e.message))
  await orb.goto(`${BASE}/orb.html?t=${T}`)
  await orb.addStyleTag({ content: 'html{background:linear-gradient(160deg,#41506b,#2a3346) !important}' })
  await sleep(800)
  // where the pointer is, as the main process reports it (ball centre = CX, CY); edges far from the screen's sides
  const at = (x, y, extra = {}) => orb.evaluate(([x, y, e]) => window.__orb({ x, y, top: 600, left: 700, right: 400, ...e }), [x, y, extra])
  const away = () => at(20, 20)
  const cls = () => orb.evaluate(() => document.body.className)
  const bub = () => orb.evaluate(() => { const b = document.getElementById('bub'); return b.classList.contains('on') ? b.innerText.replace(/\s+/g, ' ').trim() : '' })
  await away()
  // what the runtime has to tell you on its own at start (the day's brief, a 动态) is cleared first, as if read
  await sleep(6000)
  for (const x of (await manner()).held) await api('nudge/done', { id: x.id })

  // ---------- 察言观色: nothing is said while the client has not told 小天 what you are doing ----------
  check(/桌面客户端/.test((await manner()).why), 'without the desktop client nothing is said on its own', (await manner()).why)
  await room({ typing: true, idleSec: 0 })
  check((await manner()).why === '你在打字', 'typing keeps it quiet', (await manner()).why)

  // a step that needs your OK, while you type: held, not said
  await api('say', { text: '发邮件给王经理，提醒补签合同' })
  const ap = await until(async () => (await state()).approvals[0], 30000)
  check(ap, 'a step waits for your OK', ap && ap.tool)
  await room({ typing: true, idleSec: 0 })
  const h1 = await until(async () => (await manner()).held.find((x) => x.what === 'approval'))
  check(h1 && h1.urgent, 'it is held as something to tell you', h1)
  await sleep(2500)
  check((await manner()).held.some((x) => x.what === 'approval') && !(await manner()).said.length, 'still held after a while of typing')
  check(await until(async () => /f-hold/.test(await cls())), 'the desktop 小天 holds it in (憋着 face)', await cls())
  const badge = await orb.evaluate(() => document.getElementById('badge').textContent)
  check(badge === String((await manner()).held.length), 'its badge counts what it holds', badge)
  check(!(await bub()), 'and says nothing')
  await shot(orb, 'orb-hold')
  await at(CX, CY)
  check(await until(async () => /憋着 \d+ 件事没说/.test(await bub())), 'coming close: it says it is holding something in', await bub())
  await shot(orb, 'orb-hold-hover')
  await away()

  // full screen and meetings: still held, and the ball steps back
  await room({ full: true, app: 'POWERPNT', title: '方案评审.pptx', idleSec: 10 })
  check(/你在全屏/.test((await manner()).why), 'full screen keeps it quiet', (await manner()).why)
  check(await until(async () => /tucked/.test(await cls())), 'in full screen the ball fades back', await cls())
  await shot(orb, 'orb-tucked')
  await room({ meeting: '开会（Zoom）', app: 'Zoom', idleSec: 10 })
  check((await manner()).why === '你在开会（Zoom）', 'a meeting keeps it quiet', (await manner()).why)
  await sleep(1500)
  check(!(await manner()).said.length, 'nothing said in full screen or a meeting')

  // you pause: it says it now
  await room({ idleSec: 8 })
  check(await until(async () => (await manner()).said.find((x) => x.what === 'approval' && x.state === 'said'), 5000), 'when you pause it says it')
  check(await until(async () => /要你确认/.test(await bub())), 'the desktop 小天 says it in its bubble', await bub())
  check(/f-ask/.test(await cls()), 'with its asking face', await cls())
  check(/去看/.test(await bub()) && /等会儿/.test(await bub()), 'with 去看 and 等会儿')
  check(!/tucked/.test(await cls()), 'no longer faded')
  await shot(orb, 'orb-say')
  await orb.click('#bub button[data-a=later]')
  const later = await until(async () => (await manner()).held.find((x) => x.what === 'approval' && x.notBefore))
  check(later, '等会儿 puts it back for later', later && later.notBefore)
  await sleep(2000)
  check(!(await manner()).said.some((x) => x.what === 'approval' && x.state === 'said'), 'and it is not said again right away')
  // a click on the ball: it says what it holds now
  await orb.mouse.move(CX, CY); await at(CX, CY); await orb.mouse.down(); await orb.mouse.up()
  check(await until(async () => (await manner()).said.find((x) => x.asked)), 'clicking the ball asks it to say it now')
  check(await until(async () => /要你确认/.test(await bub()) && /去看/.test(await bub())), 'and it says it', await bub())
  await orb.click('#bub button[data-a=go]')
  const g = await orb.evaluate(() => window.__goto)
  check(g && g.view === 'chat', '去看 opens the chat it was about', g)
  check(await until(async () => (await manner()).said.find((x) => x.what === 'approval' && x.state === 'done')), 'and it counts as told')
  await api('approval', { id: ap.id, allow: true })
  await until(async () => !(await state()).approvals.length)
  check(!(await manner()).held.length, 'once answered nothing is held')
  await away()

  // ---------- the daily cap ----------
  await api('settings', { nudgeCap: 0 })
  await room({ typing: true, idleSec: 0 })
  await api('brief/run', {})
  const bn = await until(async () => (await manner()).held.find((x) => x.what === 'brief'), 40000)
  check(bn, 'a new brief is held to tell you', bn && bn.text)
  await room({ idleSec: 9 })
  await sleep(2500)
  check(!(await manner()).said.some((x) => x.what === 'brief'), 'with 不主动说 it is not said, even at a pause')
  await api('settings', { nudgeCap: 4 })
  check(await until(async () => (await manner()).said.find((x) => x.what === 'brief'), 6000), 'with a cap left it is said at the pause')
  check(await until(async () => /简报/.test(await bub())), 'the bubble says the brief is ready', await bub())
  const m1 = await manner()
  check(m1.used === 1 && m1.cap === 4, 'today it spoke once of four', { used: m1.used, cap: m1.cap })

  // ---------- seen where it was about: nothing left to say ----------
  const actx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
  await actx.addInitScript(APP_BRIDGE)
  const pg = await actx.newPage()
  pg.on('pageerror', (e) => errs.push('app: ' + e.message))
  await pg.goto(`${BASE}/?t=${T}`)
  await pg.waitForSelector('#inp'); await sleep(1000)
  await room({ typing: true, idleSec: 0 })
  await api('reflect/run', {})
  const rn = await until(async () => (await manner()).held.find((x) => x.what === 'reflect'), 40000)
  check(rn, 'a reflection is held to tell you', rn && rn.text)
  await pg.bringToFront()
  await pg.evaluate(() => goTo({ view: 'reflect' }))
  check(await until(async () => !(await manner()).held.some((x) => x.what === 'reflect'), 6000), 'opening the page it was about: it no longer needs saying')
  await pg.evaluate(() => goTo({ view: 'later' }))
  await pg.waitForSelector('.manner')
  const panel = await pg.evaluate(() => document.querySelector('.manner').innerText)
  check(/先不开口：你在打字/.test(panel), 'the 系统感知 page says why it keeps quiet now', panel.slice(0, 80))
  const used = (await manner()).used
  check(panel.includes(`今天主动说了 ${used} 次`), 'and how often it spoke today', panel.slice(0, 120))
  check(await pg.$('#nudgeCap'), 'the daily cap can be set there')
  await pg.evaluate(() => document.querySelector('.manner').scrollIntoView({ block: 'center' }))
  await shot(pg, 'app-manners')

  // ---------- 拖给小天 ----------
  await room({ idleSec: 9 })
  await api('agents/save', { agent: { name: '出差助理', role: '出差助理', style: '靠谱同事', emailName: 'trip', color: '#4f8cff' } })
  const bot = await until(async () => (await state()).agents.find((a) => a.name === '出差助理'))
  await orb.reload(); await orb.addStyleTag({ content: 'html{background:linear-gradient(160deg,#41506b,#2a3346) !important}' }); await sleep(900); await away()
  // a drag over the ball: it opens up, the other Bots come out around it
  const drag = (type, x, y, data) => orb.evaluate(([type, x, y, data]) => {
    const dt = new DataTransfer()
    for (const [k, v] of Object.entries(data.strings || {})) dt.setData(k, v)
    for (const f of data.files || []) { const file = new File([f.bytes ? Uint8Array.from(atob(f.bytes), (c) => c.charCodeAt(0)) : f.text], f.name, { type: f.type || '' }); if (f.path) window.__paths[f.name] = f.path; dt.items.add(file) }
    window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  }, [type, x, y, data])
  const text = { strings: { 'text/plain': '周五下午三点方案评审，地点 3 楼会议室' } }
  await at(CX, CY); await drag('dragenter', CX, CY, text); await drag('dragover', CX, CY, text)
  check(/f-catch/.test(await cls()), 'something dragged over it: it opens up', await cls())
  check(/松手交给小天/.test(await bub()), 'and says it will take it', await bub())
  const satN = await orb.evaluate(() => document.querySelectorAll('.sat.on').length)
  check(satN === 1, 'the other Bot comes out around it', satN)
  check(await orb.evaluate(() => window.__hit), 'the whole window takes the drop')
  // the drag goes on while the picture is taken
  const keep = setInterval(() => drag('dragover', CX, CY, text).catch(() => {}), 120)
  await shot(orb, 'orb-catch')
  clearInterval(keep)
  await drag('drop', CX, CY, text)
  check(await until(async () => /小天在看/.test(await bub()), 3000), 'dropped: it looks at it first', await bub())
  check(await until(async () => await orb.evaluate(() => document.querySelectorAll('.pet.on').length) >= 3, 20000), 'then things to do grow out of it')
  const labels = await orb.evaluate(() => [...document.querySelectorAll('.pet.on')].map((p) => p.textContent))
  check(labels.includes('加进日程') && labels.includes('打开对话'), 'drawn from what it saw, plus 打开对话', labels)
  check(/会议安排/.test(await bub()), 'it says what it saw', await bub())
  const look = (await state()).transcripts.tianxi.filter((t) => t.kind === 'drop')
  check(look.length && look.every((t) => t.internal), 'the look stays out of the chat')
  await shot(orb, 'orb-petals')
  await orb.click('.pet[data-i="0"]')
  const did = await until(async () => (await state()).transcripts.tianxi.find((t) => t.role === 'user' && t.text === '拖给小天：加进日程'))
  check(did, 'picking one asks 小天 in its chat', did && did.text)
  check(await until(async () => (await state()).calendar.find((e) => e.title === '方案评审'), 20000), 'and it is done: the meeting is on the calendar')
  check(!(await orb.evaluate(() => document.querySelectorAll('.pet.on').length)), 'the petals fold back')
  await until(async () => (await state()).agentStatus.tianxi === 'idle', 20000)

  // a file, dropped on the other Bot
  const csv = path.join(DL, '报价单.csv')
  fs.writeFileSync(csv, '供应商,单价,交期\n供应商A,128,7天\n供应商B,119,10天\n供应商C,135,5天\n')
  const file = { files: [{ name: '报价单.csv', text: fs.readFileSync(csv, 'utf8'), path: csv }] }
  await at(CX, CY); await drag('dragenter', CX, CY, file); await drag('dragover', CX, CY, file)
  // dragging goes on (dragover keeps coming) while the Bots come out
  for (let i = 0; i < 3; i++) { await sleep(150); await drag('dragover', CX, CY, file) }
  const satAt = await orb.evaluate(() => { const r = document.querySelector('.sat.on').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await drag('dragover', satAt.x, satAt.y, file)
  check(/交给出差助理/.test(await bub()), 'over a Bot: it will go to that Bot', await bub())
  await drag('drop', satAt.x, satAt.y, file)
  check(await until(async () => /出差助理在看/.test(await bub()), 3000), 'that Bot looks at it', await bub())
  check(await until(async () => /3 家供应商/.test(await bub()), 20000), 'it read the file before offering anything', await bub())
  const read = (await state()).transcripts[bot.id].find((t) => t.role === 'tool' && t.name === 'read')
  check(read && read.state === 'done' && read.internal, 'it only read it', read && { name: read.name, state: read.state })
  await orb.click('.pet[data-i="chat"]')
  const g2 = await until(() => orb.evaluate(() => window.__goto && window.__goto.arg !== 'tianxi' && window.__goto))
  check(g2 && g2.arg === bot.id && g2.draft.includes(csv), '打开对话 opens that Bot with the file in the chat box', g2)
  await pg.evaluate((g) => goTo(g), g2)
  check((await pg.evaluate(() => document.getElementById('inp').value)).includes('报价单.csv'), 'the chat box holds it, ready to finish the sentence')
  await shot(pg, 'app-draft')

  // a picture with no file behind it (from a web page): kept as bytes
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const pic = { files: [{ name: 'image.png', bytes: png, type: 'image/png' }] }
  await at(CX, CY); await drag('dragenter', CX, CY, pic); await drag('dragover', CX, CY, pic); await drag('drop', CX, CY, pic)
  check(await until(async () => /一张图片/.test(await bub()), 20000), 'a picture from a web page is looked at too', await bub())
  const kept = fs.readdirSync(path.join(path.dirname(DL), 'data', 'drops')).filter((f) => f.endsWith('image.png'))
  check(kept.length >= 1, 'its bytes were kept as a file', kept)
  await orb.click('.pet.x')
  check(!(await orb.evaluate(() => document.querySelectorAll('.pet.on').length)), '× lets it go')

  // ---------- dragged onto a window ----------
  await orb.mouse.move(CX, CY); await orb.mouse.down(); await orb.mouse.move(CX + 30, CY + 10, { steps: 4 })
  await at(CX + 30, CY + 10, { peek: { aim: .55, armed: false } })
  check(await orb.evaluate(() => document.getElementById('aim').classList.contains('on')), 'held still over a window: the ring fills')
  await shot(orb, 'orb-aim')
  await at(CX + 30, CY + 10, { peek: { aim: 1, armed: true, title: '会议纪要.txt - 记事本', app: 'notepad' } })
  check(/松手看看「会议纪要/.test(await bub()), 'framed: let go to look at it', await bub())
  check(/f-peek/.test(await cls()), 'squinting at it', await cls())
  await shot(orb, 'orb-peek')
  await orb.mouse.up()
  const shotFile = path.join(path.dirname(DL), 'data', 'look-test.png'); fs.writeFileSync(shotFile, Buffer.from(png, 'base64'))
  await orb.evaluate((f) => window.__look({ shot: f, window: { app: 'notepad', title: '会议纪要.txt - 记事本' } }), shotFile)
  check(await until(async () => /会议纪要.txt - 记事本」的窗口/.test(await bub()), 20000), 'let go: it looks at that window', await bub())
  await orb.click('.pet.x')
  await orb.evaluate(() => window.__look({ error: '要看别的窗口，得先在「系统设置 › 隐私与安全性 › 录屏与系统录音」里打开小天 Bot，再重开小天 Bot。', help: '去打开' }))
  check(/录屏/.test(await bub()) && /去打开/.test(await bub()), 'no permission to see windows: it says where to allow it', await bub())
  await shot(orb, 'orb-perm')
  await orb.click('#bub button[data-a=help]')
  check(await orb.evaluate(() => window.__help), '去打开 opens that setting')

  check(!errs.length, 'no page errors', errs)
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
  await b.close()
  const bad = results.filter((r) => !r.ok).length
  console.log(`${results.length - bad}/${results.length}`)
  process.exit(bad ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
