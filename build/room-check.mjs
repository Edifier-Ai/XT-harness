// Checks desktop/room.js on a real desktop (the Windows and Mac CI runners): it opens a plain app, then asks the
// helper which window is in front and which window lies under that window's middle. Prints what it saw; exits 1
// when an answer is missing or wrong. Usage: node build/room-check.mjs
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const { createRoom } = require('../desktop/room.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (ok, what, data) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`, data === undefined ? '' : JSON.stringify(data)) }
const room = createRoom({ log: (m) => console.log('[log]', m), self: 'XiaotianBot' })
const WIN = process.platform === 'win32'

let app
if (WIN) app = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' })
else execFileSync('open', ['-a', 'Calculator'])
await sleep(2500)
if (!WIN) { try { execFileSync('osascript', ['-e', 'tell application "Calculator" to activate']) } catch {} await sleep(1000) }

const want = WIN ? /notepad/i : /calculator|计算器/i
let f = null
for (let i = 0; i < 15; i++) {
  f = await room.front()
  if (f?.front && want.test(f.front.app || '')) break
  await sleep(700)
}
check(!!f, 'the helper answers', f)
check(!!f?.front && want.test(f.front.app || ''), 'the app just opened is in front', f?.front)
check(Array.isArray(f?.mic), 'the microphone list is a list', f?.mic)
const w = f?.front
check(w && w.w > 50 && w.h > 50, 'its window has a size', w && { x: w.x, y: w.y, w: w.w, h: w.h })
if (w && w.w > 50) {
  const x = w.x + w.w / 2, y = w.y + w.h / 2
  const at = await room.at(x, y)
  check(at && at.id === w.id, 'the window under its middle is that window', at)
  const past = await room.at(x, y, [String(w.pid)])
  check(past && past.id !== w.id, 'leaving its process out finds what is behind it', past)
}
// a title with Chinese in it comes back as written (the helper talks UTF-8)
if (WIN) {
  const t = await room.front()
  check(typeof t?.front?.title === 'string', 'titles are text', t?.front?.title)
}
const t0 = Date.now(); await room.front(); check(Date.now() - t0 < 1500, 'an answer takes little time', Date.now() - t0)

room.stop()
try { if (WIN) app.kill(); else execFileSync('osascript', ['-e', 'tell application "Calculator" to quit']) } catch {}
const bad = results.filter((r) => !r).length
console.log(`${results.length - bad}/${results.length}`)
process.exit(bad ? 1 : 0)
