// The take-over timing of the phone page (tianxi/web/mobile.js), with the 小天 App played by a stand-in bridge in desktop
// Chrome: binding then full screen, a late "visible" event from coming back after binding (it used to hand the computer
// back while UU 远程 was in front), the App really leaving and coming back, an older App without onXiaotianPause, and
// UU 远程 never opening. Runs against dev/phone-e2e/host.mjs.
// Usage: node dev/phone-e2e/takeover.mjs <chrome path>   (or set CHROME)
import { chromium } from 'playwright-core'
const ctl = async (p) => (await fetch('http://127.0.0.1:3092/' + p)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []
const check = (ok, what, x) => { out.push(ok); console.log(ok ? 'PASS' : 'FAIL', what, x === undefined ? '' : JSON.stringify(x)) }
await ctl('reset')
const { code } = await ctl('state')
const r = await fetch(`http://127.0.0.1:3091/pair?c=${code}`, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) XiaotianApp/0.19.1 (Race%20Phone)' } })
const loc = r.headers.get('location')
const exe = process.argv[2] || process.env.CHROME
const b = await chromium.launch(exe ? { executablePath: exe } : {})
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) XiaotianApp/0.19.1 (Race%20Phone)' })
await ctx.addInitScript(() => {
  window.__urls = []
  let hidden = false
  Object.defineProperty(document, 'hidden', { get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') })
  window.__vis = (h) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')) }
  window.XiaotianNative = { version: () => '0.19.1', uuInstalled: () => true, openUrl: (u) => { window.__urls.push(u); return true }, paired: () => true, hosts: () => '[]', bars: () => {}, home: () => {}, scan: () => {}, switchHost: () => {}, forget: () => {}, forgetHost: () => {}, connect: () => {} }
})
const pg = await ctx.newPage()
pg.on('pageerror', (e) => console.log('pageerror', e.message))
await pg.goto('http://127.0.0.1:3091' + loc)
await pg.waitForSelector('#mtabs')
await pg.click('#mtabs [data-mtab=pc]')
await pg.waitForSelector('.mpc-b [data-how=full]')
await pg.evaluate(() => localStorage.removeItem('tx.uuDevice'))
// 1. first time: binding comes first
await pg.click('.mpc-b [data-how=full]')
const urls1 = await pg.evaluate(() => window.__urls.slice())
check(/authorize/.test(urls1.at(-1)), 'not bound yet: UU 远程 is asked to pick the computer', urls1.at(-1))
const nonce = new URL(urls1.at(-1).replace('uuremote:', 'http:')).searchParams.get('nonce')
// the App goes away for UU 远程's picker, then comes back with the answer: link first, then resume
await pg.evaluate(() => { window.__vis(true); window.onXiaotianPause && window.onXiaotianPause() })
await pg.evaluate((n) => { window.onXiaotianLink('xiaotian://uu/authorize?anonymous_device_id=pc-1&nonce=' + n); window.onXiaotianResume() }, nonce)
await sleep(450)
const urls2 = await pg.evaluate(() => window.__urls.slice())
check(/control\?anonymous_device_id=pc-1&window_type=0/.test(urls2.at(-1)), 'then full screen on the picked computer', urls2.at(-1))
await sleep(400)
check((await ctl('takeover'))?.how === 'full', 'the Bots pause')
// 2. the "visible" event from coming back after picking arrives late, after full screen was asked for
await pg.evaluate(() => window.__vis(false))
await sleep(900)
check((await ctl('takeover'))?.how === 'full', 'a late visible event does not hand the computer back')
// 3. UU 远程 comes to the front, the person works, then comes back
await pg.evaluate(() => { window.onXiaotianPause(); window.__vis(true) })
await sleep(300)
check((await ctl('takeover'))?.how === 'full', 'while UU 远程 is in front, the Bots stay paused')
await pg.evaluate(() => { window.onXiaotianResume(); window.__vis(false) })
await sleep(900)
check((await ctl('takeover')) === null, 'coming back hands the computer back')
const toasts = await pg.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | '))
check((toasts.match(/交还给/g) || []).length === 1, 'one 交还 note', toasts)
// 4. an older App without onXiaotianPause: only visibility events
await pg.click('.mpc-b [data-how=full]')
await sleep(300)
await pg.evaluate(() => window.__vis(true))
await sleep(300)
check((await ctl('takeover'))?.how === 'full', 'older App: taken over')
await pg.evaluate(() => window.__vis(false))
await sleep(900)
check((await ctl('takeover')) === null, 'older App: coming back hands it back')
// 5. UU 远程 never comes to the front
await pg.click('.mpc-b [data-how=full]')
await sleep(500)
check((await ctl('takeover'))?.how === 'full', 'asked again: taken over')
await sleep(8200)
check((await ctl('takeover')) === null, 'UU 远程 never opened: the Bots go on by themselves', await pg.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | ')))
const ev = (await ctl('events')).filter((e) => e.type === 'takeover').map((e) => e.on)
check(ev.join() === 'true,false,true,false,true,false', 'the computer saw three take-overs and three hand-backs', ev)
await b.close()
console.log(out.filter(Boolean).length + '/' + out.length)
process.exit(out.every(Boolean) ? 0 : 1)
