// 拖到窗口上看: a picture of one window, for 小天 to look at. The window's own picture comes first (it is right even
// when something covers part of it); when there is none (no permission, or the window cannot be captured), the part
// of the screen it covers. Uses Electron's desktopCapturer and screen, passed in, so the CI check runs this same code.
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const fit = (W, H, max = 1600) => { const k = Math.min(1, max / Math.max(W, H)); return { width: Math.max(1, Math.round(W * k)), height: Math.max(1, Math.round(H * k)) } }

/** w: { id, rect } with rect in DIP; saves a PNG under dir and returns { file, how: 'window' | 'screen' }, or null. */
async function capture(w, { desktopCapturer, screen, dir, keep = 20 }) {
  const r = w.rect, d = screen.getDisplayMatching(r), sf = d.scaleFactor || 1
  let how = 'window'
  const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: fit(r.width * sf, r.height * sf) })
  let img = list.find((s) => s.id === `window:${w.id}:0`)?.thumbnail
  if (!img || img.isEmpty()) {
    how = 'screen'
    const scr = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.bounds.width * sf), height: Math.round(d.bounds.height * sf) } })
    const s = scr.find((x) => String(x.display_id) === String(d.id)) || scr[0]
    if (!s || s.thumbnail.isEmpty()) return null
    const size = s.thumbnail.getSize(), f = size.width / d.bounds.width
    const x = Math.max(0, Math.round((r.x - d.bounds.x) * f)), y = Math.max(0, Math.round((r.y - d.bounds.y) * f))
    const cw = Math.min(size.width - x, Math.round(r.width * f)), ch = Math.min(size.height - y, Math.round(r.height * f))
    if (cw < 2 || ch < 2) return null
    img = s.thumbnail.crop({ x, y, width: cw, height: ch })
    const want = fit(cw, ch)
    if (want.width < cw) img = img.resize(want)
  }
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `look-${Date.now()}.png`)
  fs.writeFileSync(file, img.toPNG())
  try { for (const old of fs.readdirSync(dir).filter((n) => n.startsWith('look-')).sort().slice(0, -keep)) fs.rmSync(path.join(dir, old), { force: true }) } catch {}
  return { file, how }
}

// The frame drawn around the window it is aimed at: a click-through window of its own, under the ball, over the rest.
const FRAME_HTML = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}div{position:fixed;inset:0;border:3px solid #7b63ff;border-radius:10px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.55);animation:in .22s ease-out}@keyframes in{from{opacity:0;transform:scale(1.015)}}</style><div></div>'
function makeFrame(BrowserWindow, pad = 4) {
  let win = null
  return {
    /** r: the window's rect in DIP */
    show(r) {
      const at = { x: Math.round(r.x - pad), y: Math.round(r.y - pad), width: Math.round(r.width + pad * 2), height: Math.round(r.height + pad * 2) }
      if (!win || win.isDestroyed()) {
        win = new BrowserWindow({ ...at, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000', webPreferences: { sandbox: true, contextIsolation: true } })
        win.setIgnoreMouseEvents(true)
        win.setAlwaysOnTop(true, 'pop-up-menu')
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(FRAME_HTML))
      } else {
        win.setBounds(at)
        win.webContents.executeJavaScript("(d=>{d.style.animation='none';void d.offsetWidth;d.style.animation=''})(document.querySelector('div'))").catch(() => {})
      }
      win.showInactive()
      return win
    },
    hide() { if (win && !win.isDestroyed()) win.hide() },
    get win() { return win },
  }
}

module.exports = { capture, makeFrame }
