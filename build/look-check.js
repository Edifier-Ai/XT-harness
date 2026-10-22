// Checks 拖到窗口上看 on a real desktop (the Windows and Mac CI runners), in Electron, with the client's own code
// (desktop/room.js, desktop/look.js): it opens a plain app, finds its window under its middle the way the desktop 小天
// does (DIP → helper pixels), frames it, and takes a picture of it. Writes what it saw to look-check.txt and the
// pictures next to it; exits 1 when something is missing or wrong.
// Usage: electron build/look-check.js <out dir>
'use strict'
const { app, BrowserWindow, desktopCapturer, screen, systemPreferences, nativeImage } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { createRoom } = require('../desktop/room.js')
const { capture, makeFrame } = require('../desktop/look.js')

const OUT = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('.js')) || 'look-check')
fs.mkdirSync(OUT, { recursive: true })
const lines = [], results = []
const log = (s) => { lines.push(s); fs.writeFileSync(path.join(OUT, 'look-check.txt'), lines.join('\n') + '\n') }
const check = (ok, what, data) => { results.push(!!ok); log(`${ok ? 'PASS' : 'FAIL'} ${what} ${data === undefined ? '' : JSON.stringify(data)}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin'

// how much a picture varies: a blank or one-colour picture is not a picture of a window
function spread(img) {
  const { width, height } = img.getSize(), px = img.toBitmap()
  const seen = new Set()
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 40))) for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 40))) {
    const i = (y * width + x) * 4; seen.add(`${px[i] >> 4},${px[i + 1] >> 4},${px[i + 2] >> 4}`)
  }
  return seen.size
}

app.whenReady().then(async () => {
  const room = createRoom({ log: (m) => log('[room] ' + m), self: 'Electron' })
  let child
  try {
    if (WIN) child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore' })
    else execFileSync('open', ['-a', 'Calculator'])
    await sleep(2500)
    if (MAC) { try { execFileSync('osascript', ['-e', 'tell application "Calculator" to activate']) } catch {} await sleep(1000) }
    const want = WIN ? /notepad/i : /calculator|计算器/i
    let f = null
    for (let i = 0; i < 15; i++) { f = await room.front(); if (f?.front && want.test(f.front.app || '')) break; await sleep(700) }
    const w = f?.front
    check(w && want.test(w.app || ''), 'the app is in front', w)
    if (!w) throw new Error('no window')
    const raw = { x: w.x, y: w.y, width: w.w, height: w.h }
    const rect = MAC ? raw : screen.screenToDipRect(null, raw)
    log(`display ${JSON.stringify(screen.getDisplayMatching(rect).bounds)} scale ${screen.getDisplayMatching(rect).scaleFactor} · window in DIP ${JSON.stringify(rect)}`)

    // the ball in the window's middle, in DIP, turned back into the helper's pixels: the window under it is that window
    const mid = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const p = MAC ? mid : screen.dipToScreenPoint(mid)
    const under = await room.at(p.x, p.y, [String(process.pid)])
    check(under && under.id === w.id, 'the window under a DIP point is found', under)

    // a window of our own over it is left out (the ball sits right there while you drag it)
    const ball = new BrowserWindow({ x: Math.round(mid.x - 60), y: Math.round(mid.y - 60), width: 120, height: 120, frame: false, transparent: true, alwaysOnTop: true, focusable: false, show: false, backgroundColor: '#00000000' })
    await ball.loadURL('data:text/html,<body style="margin:0;background:transparent"><div style="width:72px;height:72px;margin:24px;border-radius:50%;background:%236a4cf0"></div>')
    ball.showInactive(); await sleep(600)
    const under2 = await room.at(p.x, p.y, [String(process.pid)])
    check(under2 && under2.id === w.id, '小天 itself is left out when it sits over the window', under2)

    if (MAC) log(`screen recording permission: ${systemPreferences.getMediaAccessStatus('screen')}`)
    // the frame around it, then a picture of the screen there: the frame's colour sits just outside the window's edge
    const frame = makeFrame(BrowserWindow)
    frame.show(rect); await sleep(900)
    const d = screen.getDisplayMatching(rect)
    const scr = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) } })
    const s = scr.find((x) => String(x.display_id) === String(d.id)) || scr[0]
    if (s && !s.thumbnail.isEmpty()) {
      fs.writeFileSync(path.join(OUT, 'screen-with-frame.png'), s.thumbnail.toPNG())
      const k = s.thumbnail.getSize().width / d.bounds.width, bmp = s.thumbnail.toBitmap(), W = s.thumbnail.getSize().width
      // 2.5 DIP outside the left edge, half way down (BGRA)
      const x = Math.round((rect.x - d.bounds.x - 2.5) * k), y = Math.round((rect.y - d.bounds.y + rect.height / 2) * k)
      const i = (y * W + x) * 4, rgb = [bmp[i + 2], bmp[i + 1], bmp[i]]
      const near = Math.abs(rgb[0] - 0x7b) < 40 && Math.abs(rgb[1] - 0x63) < 40 && Math.abs(rgb[2] - 0xff) < 40
      check(near || (MAC && spread(s.thumbnail) < 4), 'the frame is drawn around the window', { at: [x, y], rgb })
    } else check(MAC, 'a picture of the screen', 'none')
    frame.hide()
    ball.destroy()

    // the picture of that window
    const shot = await capture({ id: w.id, rect }, { desktopCapturer, screen, dir: OUT })
    check(shot && fs.existsSync(shot.file), 'a picture of the window is saved', shot)
    if (shot) {
      const img = nativeImage.createFromPath(shot.file), sz = img.getSize(), n = spread(img)
      log(`picture ${JSON.stringify(sz)} taken from the ${shot.how}, ${n} colours`)
      check(shot.how === 'window', 'taken from the window itself (by its id)', shot.how)
      check(sz.width > 100 && sz.height > 60 && Math.abs(sz.width / sz.height - rect.width / rect.height) < 0.08, 'its size matches the window', { sz, rect })
      check(n > 2, 'it shows something (not one flat colour)', n)
    }
  } catch (e) { check(false, 'ran through', e.stack) }
  room.stop()
  try { if (WIN) child?.kill(); else execFileSync('osascript', ['-e', 'tell application "Calculator" to quit']) } catch {}
  const bad = results.filter((r) => !r).length
  log(`${results.length - bad}/${results.length}`)
  app.exit(bad ? 1 : 0)
})
