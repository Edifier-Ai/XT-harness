// Drives the 小天 App (debug build) in an Android emulator against dev/phone-e2e/host.mjs, the way a person would:
// pair with a typed code (a wrong one first), chat and approve, walk the tabs, take the computer over through UU 远程
// (played by the fakeuu app) and hand it back, reopen the App, lose the computer and find it again, unpair.
// Taps and reads go through the WebView's DevTools socket; screenshots are the emulator's whole screen.
// Usage: node dev/phone-e2e/android.mjs <out dir> <fakeuu.apk>   (writes NN-name.png and results.json)
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(process.argv[2] || 'shots')
const FAKEUU = process.argv[3]
fs.mkdirSync(OUT, { recursive: true })
const APP = 'com.xiaotianbot.app', HOST = 'http://10.0.2.2:3091'
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', timeout: 120000 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ctl = async (p) => (await fetch('http://127.0.0.1:3092/' + p)).json()
const results = []
let n = 0
const shot = (name) => {
  const f = `${String(++n).padStart(2, '0')}-${name}.png`
  fs.writeFileSync(path.join(OUT, f), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }))
  return f
}
const check = (ok, what, extra) => { results.push({ ok: !!ok, what, ...(extra !== undefined ? { extra } : {}) }); console.log(ok ? 'PASS' : 'FAIL', what, extra !== undefined ? JSON.stringify(extra) : '') }
async function until(fn, ms = 15000, step = 300) {
  const t = Date.now()
  for (;;) {
    try { const v = await fn(); if (v) return v } catch {}
    if (Date.now() - t > ms) return null
    await sleep(step)
  }
}
const top = () => (adb('shell', 'dumpsys', 'activity', 'activities').match(/topResumedActivity[^\n]*|mResumedActivity[^\n]*/) || [''])[0]
const back = () => adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
const launch = () => adb('shell', 'am', 'start', '-W', '-n', `${APP}/.MainActivity`)

let browser, browserPid
// the App's WebView, through its DevTools socket (on in debug builds only); one connection per App process
async function page(want = () => true) {
  const pid = await until(() => adb('shell', 'pidof', APP).trim(), 20000)
  if (!browser || pid !== browserPid || !browser.isConnected()) {
    try { adb('forward', '--remove', 'tcp:9333') } catch {}
    adb('forward', 'tcp:9333', `localabstract:webview_devtools_remote_${pid}`)
    browser = await until(() => chromium.connectOverCDP('http://127.0.0.1:9333'), 30000, 1000)
    if (!browser) throw new Error('no DevTools socket for the WebView')
    browserPid = pid
  }
  const pg = await until(() => browser.contexts().flatMap((c) => c.pages()).find((p) => !p.isClosed() && !p.url().startsWith('about:') && want(p.url())), 20000)
  if (!pg) throw new Error('no page in the WebView matching ' + want)
  return pg
}
const toastText = (pg) => pg.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | '))

async function main() {
  // the scanner opens straight on the camera
  adb('shell', 'pm', 'grant', APP, 'android.permission.CAMERA')
  launch()
  let pg = await page()
  await pg.waitForSelector('#scan', { timeout: 20000 })
  await sleep(1200)
  shot('start')
  check(await pg.evaluate(() => window.XiaotianNative && window.XiaotianNative.version()), 'start page reaches the App (XiaotianNative)')

  await pg.click('#scan')
  await sleep(3000)
  shot('scanner')
  check(/ScanActivity/.test(top()), 'scan opens the QR scanner', top())
  back()
  await sleep(1500)
  check(/MainActivity/.test(top()), 'Back leaves the scanner')

  // a wrong code: the computer says so, and Back returns to the start page
  pg = await page()
  await pg.click('#manualBtn')
  await pg.fill('#addr', '10.0.2.2:3091')
  await pg.fill('#code', '000000')
  await sleep(400)
  shot('manual')
  await pg.click('#go')
  pg = await page((u) => u.includes('/pair'))
  check(await until(() => pg.evaluate(() => document.body.innerText.includes('过期'))), 'a wrong code shows the computer\'s message')
  shot('wrong-code')
  back()
  pg = await page((u) => u.startsWith('file:'))
  check(await until(() => pg.$('#scan')), 'Back from the message returns to the start page')

  // the right code
  const st = await ctl('state')
  await pg.click('#manualBtn')
  await pg.fill('#addr', '10.0.2.2:3091')
  await pg.fill('#code', st.code)
  await pg.click('#go')
  pg = await page((u) => u.startsWith(HOST) && !u.includes('/pair'))
  await pg.waitForSelector('#mtabs', { timeout: 30000 })
  await sleep(3000)
  shot('bots')
  check(pg.url().startsWith(HOST + '/'), 'paired: the computer\'s 小天 page is open', pg.url())
  const devs = (await ctl('state')).devices
  check(devs.length === 1, 'the computer lists this phone', devs.map((d) => d.name))
  check(JSON.parse(await pg.evaluate(() => window.XiaotianNative.hosts())).some((h) => h.current && h.origin === HOST), 'the App remembers the computer')

  // chat, and approve what 小天 wants to send
  await pg.click('.ag[data-id=tianxi]')
  await sleep(900)
  await pg.fill('#inp', '给王经理发邮件，提醒补签合同')
  await pg.click('#send')
  const ask = await until(() => pg.$('[data-act=ask][data-allow="1"]'), 40000)
  await sleep(1000)
  shot('chat-approval')
  check(ask, '小天 asks before sending the mail')
  if (ask) await ask.click()
  check(await until(() => pg.evaluate(() => document.body.innerText.includes('邮件处理完了')), 40000), 'approved on the phone, 小天 finishes')
  await sleep(800)
  shot('chat-done')
  back()
  await sleep(1200)
  check(await pg.evaluate(() => !document.documentElement.classList.contains('m-chat')), 'Back leaves the chat for the list')

  await pg.click('#mtabs [data-mtab=brief]')
  await sleep(1500)
  shot('brief')

  // 电脑, before UU 远程 is installed
  await pg.click('#mtabs [data-mtab=pc]')
  await sleep(1000)
  shot('pc-no-uu')
  check(await pg.evaluate(() => !window.XiaotianNative.uuInstalled()), 'no UU 远程 on the phone yet')
  await pg.click('.mpc-b [data-how=full]')
  await sleep(700)
  check((await toastText(pg)).includes('还没装 UU'), 'taking over without UU 远程 says to install it', await toastText(pg))

  // with the stand-in UU 远程
  if (FAKEUU) adb('install', '-r', FAKEUU)
  await pg.click('#mtabs [data-mtab=bots]')
  await pg.click('#mtabs [data-mtab=pc]')
  await sleep(800)
  check(await pg.evaluate(() => window.XiaotianNative.uuInstalled()), 'the App sees UU 远程')
  shot('pc-uu')
  await pg.click('.mpc-b [data-how=full]')
  const took = await until(async () => (await ctl('takeover'))?.how === 'full', 20000)
  await sleep(2000)
  shot('uu-full')
  check(/fakeuu/.test(top()), 'UU 远程 opens full screen on the bound computer', top())
  check(took, 'taking over pauses the Bots on the computer')
  check(await pg.evaluate(() => (localStorage.getItem('tx.uuDevice') || '').includes('fake-pc-1')), 'the computer is bound in UU 远程 (anonymous_device_id kept)')
  back()
  const gave = await until(async () => (await ctl('takeover')) === null, 20000)
  await sleep(1200)
  shot('handed-back')
  check(gave, 'back in the App, the computer goes back to the Bots')
  check(/MainActivity/.test(top()), 'Back from UU 远程 returns to the App')
  const ev = (await ctl('events')).filter((e) => e.type === 'takeover').map((e) => e.on)
  check(ev.join() === 'true,false', 'the computer got take-over then hand-back', ev)

  await pg.click('.mpc-b [data-how=pip]')
  await sleep(3000)
  check(/MainActivity/.test(top()), 'the small window: UU 远程 answers and the App stays in front', top())
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'xiaotian://uu/control?status=failure\\&reason=device_offline')
  await sleep(1200)
  shot('uu-error')
  check((await toastText(pg)).includes('电脑不在线'), 'a UU 远程 failure shows its reason', await toastText(pg))

  await pg.click('#mtabs [data-mtab=me]')
  await sleep(900)
  shot('me')

  // the light theme: the status bar follows the page
  await pg.evaluate(() => localStorage.setItem('tx.theme', '"light"'))
  await pg.reload()
  await pg.waitForSelector('#mtabs', { timeout: 20000 })
  await sleep(2500)
  shot('light')
  await pg.evaluate(() => localStorage.setItem('tx.theme', '"dark"'))

  // reopening the App goes straight to the computer
  adb('shell', 'am', 'force-stop', APP)
  launch()
  pg = await page((u) => u.startsWith(HOST))
  check(await until(() => pg.$('#mtabs'), 30000), 'reopened, the App goes straight to the computer')
  await sleep(2500)
  shot('reopen')

  // the computer goes away, then comes back
  await ctl('on?v=0')
  adb('shell', 'am', 'force-stop', APP)
  launch()
  pg = await page((u) => u.startsWith('file:'))
  check(await until(() => pg.$('#err:not([hidden])'), 30000), 'computer unreachable: the start page says so')
  await sleep(800)
  shot('offline')
  await ctl('on?v=1')
  await pg.click('#retry')
  pg = await page((u) => u.startsWith(HOST))
  check(await until(() => pg.$('#mtabs'), 30000), '重试 opens the computer again')
  await sleep(2000)

  // unpair from the phone
  await pg.click('#mtabs [data-mtab=me]')
  await sleep(700)
  await pg.evaluate(() => { window.confirm = () => true })
  await pg.click('[data-act=m-unpair]')
  pg = await page((u) => u.startsWith('file:'))
  check(await until(() => pg.$('#scan'), 20000), 'unpaired: back to the start page')
  await sleep(800)
  shot('unpaired')
  check((await ctl('state')).devices.length === 0, 'the computer no longer lists the phone')
  check(JSON.parse(await pg.evaluate(() => window.XiaotianNative.hosts())).length === 0, 'the App forgot the computer')
}

try {
  await main()
} catch (e) {
  check(false, 'test run', String(e && e.stack || e))
  try { shot('crash') } catch {}
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
const bad = results.filter((r) => !r.ok)
console.log(`${results.length - bad.length}/${results.length} passed`)
process.exit(bad.length ? 1 : 0)
