// 钉到桌面 · 我的工具, end to end in Chrome against dev/phone-e2e/host.mjs (the 小天 runtime with the scripted model).
// The desktop app's bridge (window.tianxiApp) is played by a stand-in that records what the page asks of it; the
// widget window is web/widget.html opened at the size the shell gives it. Writes NN-name.png and results.json.
// Usage: [THEME=light] node dev/widgets-e2e/widgets.mjs <out dir> <chrome path>
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(process.argv[2] || 'shots-widgets')
const exe = process.argv[3] || process.env.CHROME
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:3090', T = 'e2etoken'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (p, body) => (await fetch(`${BASE}/api/${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-tianxi-token': T }, body: body ? JSON.stringify(body) : undefined })).json()
const results = []
const check = (ok, what, x) => { results.push({ ok: !!ok, what, ...(x !== undefined ? { x } : {}) }); console.log(ok ? 'PASS' : 'FAIL', what, x === undefined ? '' : JSON.stringify(x).slice(0, 300)) }
async function until(fn, ms = 20000) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v } catch {} if (Date.now() - t > ms) return null; await sleep(250) } }
let n = 0
const shot = async (pg, name, opts) => { await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), ...opts }) }
const widgets = async () => (await api('widgets')).widgets

// the desktop bridge: records calls, answers like the shell does
const BRIDGE = (theme) => {
  window.__calls = []
  if (theme) localStorage.setItem('tx.theme', JSON.stringify(theme))
  const own = { platform: 'win32', getConfig: async () => ({ configured: true }), updateStatus: async () => ({}), phoneState: async () => ({ on: false, devices: [] }) }
  window.tianxiApp = new Proxy(own, { get: (t, k) => k in t ? t[k] : (...a) => { window.__calls.push([k, ...a]); return Promise.resolve(null) } })
  localStorage.setItem('tx.tourSeen', 'true')
}

async function main() {
  const b = await chromium.launch(exe ? { executablePath: exe } : {})
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(BRIDGE, process.env.THEME || '')
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', (e) => errs.push(e.message))
  await pg.goto(`${BASE}/?t=${T}`)
  await pg.waitForSelector('#inp')
  await sleep(800)

  // a card in the chat, with the two new actions under it
  await pg.fill('#inp', '上海天气怎么样'); await pg.keyboard.press('Enter')
  const card = await until(() => pg.$('.bw .uiw .ou .ou-stats'), 30000)
  check(card, 'the weather card shows in the chat')
  await sleep(600)
  const bar = await pg.$$eval('.oubar button', (bs) => bs.map((x) => x.innerText.trim()))
  check(bar.join() === '钉到桌面,收进我的工具', 'under the card: 钉到桌面 and 收进我的工具', bar)
  await pg.hover('.bw .uiw .ou'); await sleep(300)
  await shot(pg, 'chat-card')

  // 钉到桌面
  await pg.click('.oubar [data-act=w-pin]')
  const pinned = await until(async () => (await widgets()).find((w) => w.pinned))
  check(pinned && pinned.kind === '城市天气', 'pinned: a widget of kind 城市天气', pinned && { kind: pinned.kind, title: pinned.title, ask: pinned.ask })
  check(await pg.evaluate(() => window.__calls.some((c) => c[0] === 'widgetsSync')), 'the desktop app is told to open its window')
  const first = await until(async () => { const w = (await widgets()).find((x) => x.id === pinned.id); return w.ver >= 2 && w.status === 'ok' && w }, 30000)
  check(first && first.every === 30 && first.expires === null, 'the first update says how often it changes and that it does not expire', first && { ver: first.ver, every: first.every, expires: first.expires })
  check(await until(() => pg.$eval('.oubar [data-act=w-pin]', (x) => x.innerText.includes('在桌面上'))), 'the card now says 在桌面上')
  const main = (await api('state')).transcripts.tianxi
  check(!main.some((t) => /桌面小组件·更新/.test(t.text || '')), 'updates run out of the chat (the background worker)')

  // the widget window
  const wp = await ctx.newPage()
  await wp.setViewportSize({ width: 384, height: 520 })
  wp.on('pageerror', (e) => errs.push('widget: ' + e.message))
  await wp.goto(`${BASE}/widget.html?t=${T}&id=${pinned.id}`)
  await wp.waitForSelector('#wbody .ou-stats')
  await sleep(900)
  check((await wp.textContent('#wname')) === '城市天气', 'the widget shows its kind', await wp.textContent('#wname'))
  check(/更新/.test(await wp.textContent('#wsub')), 'and when it was updated', await wp.textContent('#wsub'))
  const fits = await wp.evaluate(() => window.__calls.filter((c) => c[0] === 'widgetFit').map((c) => c[1]))
  check(fits.length && fits.at(-1) > 150 && fits.at(-1) < 760, 'the window is sized to its card', fits.slice(-3))
  await shot(wp, 'widget', { clip: { x: 0, y: 0, width: 384, height: Math.min(520, fits.at(-1) || 400) } })

  // update now, from the widget
  const v0 = (await widgets()).find((w) => w.id === pinned.id).ver
  await wp.click('#wref')
  check(await until(async () => (await widgets()).find((w) => w.id === pinned.id).ver > v0, 30000), '现在更新 brings a new version')
  await sleep(600)

  // use it: pick 北京 on the widget, 小天 does it and redraws the card
  await wp.evaluate(() => { window.__subs = []; new MutationObserver(() => window.__subs.push(document.querySelector('#wsub').innerText)).observe(document.querySelector('#wsub'), { childList: true, subtree: true, characterData: true }) })
  await wp.selectOption('#wbody select', 'bj')
  await wp.click('#wbody .ou-btns button')
  check(await until(() => wp.evaluate(() => window.__subs.some((t) => /正在/.test(t))), 8000), 'while 小天 works on it, the widget says so', await wp.evaluate(() => window.__subs))
  check(await until(() => wp.evaluate(() => document.querySelector('#wbody').innerText.includes('北京天气')), 30000), 'the widget now shows 北京')
  check(await until(() => wp.evaluate(() => !document.querySelector('#wnote').hidden && document.querySelector('#wnote').innerText.includes('北京'))), 'with 小天 saying what it did', await wp.textContent('#wnote'))
  await sleep(500)
  const fit2 = await wp.evaluate(() => window.__calls.filter((c) => c[0] === 'widgetFit').map((c) => c[1]).at(-1))
  await shot(wp, 'widget-used', { clip: { x: 0, y: 0, width: 384, height: Math.min(520, fit2 || 400) } })
  await wp.click('#wmore')
  check(await wp.evaluate(() => window.__calls.some((c) => c[0] === 'widgetMenu')), 'the ⋯ button asks the app for its menu')

  // the same kind of card a second time: it goes into 我的工具 by itself
  await pg.fill('#inp', '深圳天气呢'); await pg.keyboard.press('Enter')
  const tool = await until(async () => (await widgets()).find((w) => w.tool), 30000)
  check(tool && tool.kind === '城市天气' && tool.auto, 'the second weather card: 城市天气 is collected into 我的工具', tool && { kind: tool.kind, auto: tool.auto })
  check(await until(() => pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('收进我的工具'))), 8000), 'a note says so, with 去看')
  await sleep(500)
  await shot(pg, 'collected')
  const led = (await api('state')).ledger
  check(led.some((e) => e.tool === 'tool_collect' && e.undo), 'it is in 操作记录 and can be undone')

  // 我的工具: open it, use it there
  await pg.click('#meBtn'); await sleep(300)
  await pg.click('#umenu [data-v=tools]')
  await pg.waitForSelector('.tcard .ou-stats')
  await sleep(900)
  check((await pg.$$('.tcard')).length === 1, '我的工具 lists the tool, its card open and usable')
  await shot(pg, 'tools-page')
  await pg.selectOption('.tcard select', 'sh')
  await pg.click('.tcard .ou-btns button')
  check(await until(() => pg.evaluate(() => document.querySelector('.tcard').innerText.includes('上海天气')), 30000), 'used in 我的工具: the card changes there too')
  check(await until(() => wp.evaluate(() => document.querySelector('#wbody').innerText.includes('上海天气')), 10000), 'and on the desktop, the same widget', { list: (await widgets()).map((w) => [w.id, w.kind, w.pinned, w.tool, w.ver, w.title]), wp: pinned.id, shown: await wp.evaluate(() => document.querySelector('#wbody').innerText.slice(0, 60)) })

  // the plus menu lists it
  await pg.click('#mtabs, .rail [data-act=agent-open]').catch(() => {})
  await pg.evaluate(() => setView('chat')); await sleep(400)
  await pg.click('#bPlus'); await sleep(300)
  check((await pg.$$eval('#plusTools button', (bs) => bs.map((x) => x.innerText))).some((t) => t.includes('城市天气')), 'the + menu offers 城市天气')
  await pg.click('#plusTools button'); await sleep(700)
  check(await pg.evaluate(() => !!document.querySelector('.tcard.hl')), 'and opens it in 我的工具')
  await pg.evaluate(() => setView('chat')); await sleep(300)

  // a card whose time is over: 小天 takes it off the desktop and says why
  await pg.fill('#inp', '评审会议倒计时'); await pg.keyboard.press('Enter')
  await until(() => pg.$$eval('.oubar [data-act=w-pin]', (bs) => bs.length >= 3), 30000)
  await pg.locator('.oubar [data-act=w-pin]').last().click()
  const cd = await until(async () => (await widgets()).find((w) => w.kind === '会议倒计时'))
  const cp = await ctx.newPage(); await cp.setViewportSize({ width: 384, height: 400 })
  await cp.goto(`${BASE}/widget.html?t=${T}&id=${cd.id}`)
  const gone = await until(async () => (await widgets()).find((w) => w.id === cd.id && w.retired), 30000)
  check(gone && /开完/.test(gone.retired.why), '小天 takes the countdown away: the meeting is over', gone?.retired)
  check(await until(() => pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('收起来了') && t.innerText.includes('放回桌面')))), 'the app says so too, with 放回桌面')
  check(await until(() => cp.evaluate(() => document.querySelector('#wg').classList.contains('leaving'))), 'its window folds up and says why', await cp.evaluate(() => document.querySelector('#bye').innerText))
  await sleep(500)
  await shot(cp, 'widget-retired', { clip: { x: 0, y: 0, width: 384, height: 160 } })
  const ent = (await api('state')).ledger.find((e) => e.tool === 'widget_retire')
  await api('undo', { id: ent.id })
  check((await widgets()).find((w) => w.id === cd.id).pinned, '放回桌面 (undo) puts it back')
  check(await until(() => cp.evaluate(() => !document.querySelector('#wg').classList.contains('leaving'))), 'and its window unfolds')
  await sleep(4000)
  const kept = (await widgets()).find((w) => w.id === cd.id)
  check(kept.pinned && kept.status === 'ok', 'kept by the user, 小天 does not take it away again at the next update', { pinned: kept.pinned, note: kept.note })

  // taking a pinned widget down
  await api('widgets/unpin', { id: cd.id })
  check(!(await widgets()).some((w) => w.id === cd.id), 'taken down, a widget that is not a tool is gone')
  check(await until(() => cp.evaluate(() => window.__calls.some((c) => c[0] === 'widgetClose')), 5000), 'and its window closes')

  // 移出我的工具: kept off for good
  await pg.evaluate(() => setView('tools')); await sleep(600)
  await shot(pg, 'tools-page-2')
  check(errs.length === 0, 'no page errors', errs)
  await b.close()
}

try { await main() } catch (e) { check(false, 'test run', String(e && e.stack || e)) }
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
const bad = results.filter((r) => !r.ok)
console.log(`${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length ? 1 : 0)
