// 小天 Bot · 手机: your phone uses the 小天 on this computer, over the same Wi-Fi.
// Off until you switch it on in 设置 › 手机. Then a second server listens on the local network: it serves the same page
// and passes /api/ through to the runtime on 127.0.0.1, with the runtime's token in place of the phone's own.
// A phone gets its own token by scanning the QR code in 设置 › 手机: a pairing code that works once, for 10 minutes.
// Seeing the screen and taking over goes through UU 远程 on the phone; this side only says whether UU is installed here.
'use strict'
const http = require('node:http')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')

const PREF_PORT = 3091
const CODE_MS = 10 * 60e3
const MAX_PHONES = 8
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)) }
const body = async (req) => { const l = []; let n = 0; for await (const d of req) { l.push(d); n += d.length; if (n > 4e5) break } try { return JSON.parse(Buffer.concat(l).toString('utf8') || '{}') } catch { return {} } }
const page = (res, code, title, text) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小天 Bot</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#f2f2f3;font:16px/1.6 'PingFang SC','Noto Sans SC',system-ui,sans-serif}div{max-width:320px;padding:24px}b{display:block;font-size:20px;margin-bottom:10px}span{color:#a3a3a8}button{display:none;margin-top:22px;height:46px;padding:0 22px;border:0;border-radius:23px;background:#f2f2f3;color:#0b0b0c;font:inherit;font-weight:700}</style></head><body><div><b>${title}</b><span>${text}</span><br><button id="s" onclick="XiaotianNative.scan()">重新扫码</button></div><script>if(window.XiaotianNative)document.getElementById('s').style.display='inline-block'</script></body></html>`)
}

// This computer's addresses on the local network, the usual home and office ranges first.
// Virtual adapters (VMs, WSL, Docker) are left out; VPN meshes such as Tailscale come last, after the Wi-Fi.
function lanAddresses() {
  const out = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/vmware|virtualbox|vbox|hyper-v|vethernet|wsl|docker|loopback|bridge|awdl|llw/i.test(name)) continue
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address })
  }
  const rank = (ip) => /^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
  return out.sort((a, b) => rank(a.address) - rank(b.address))
}

// What to call a phone: the 小天 App says its model; a browser only says Android or iPhone.
function phoneName(ua) {
  ua = String(ua || '')
  const app = /XiaotianApp\/[\d.]+ \(([^)]+)\)/.exec(ua)
  if (app && app[1].trim()) { let n = app[1].trim(); try { n = decodeURIComponent(n) } catch {} return n.slice(0, 40) }
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  const m = /Android [\d.]+; ([^;)]+?)(?: Build[^;)]*)?\)/.exec(ua)
  if (m && m[1].trim().length > 1) return m[1].trim().slice(0, 40)
  return /Android/.test(ua) ? '安卓手机' : '手机'
}

// Whether UU 远程 is on this computer: its uninstall entry or its running process (Windows), the app or the process (Mac).
let uuCache = null
function detectUU() {
  if (uuCache && Date.now() - uuCache.at < 60e3) return Promise.resolve(uuCache)
  return new Promise((resolve) => {
    const done = (installed, running) => resolve(uuCache = { installed: !!installed, running: !!running, at: Date.now() })
    if (process.platform === 'win32') {
      const keys = ['HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'].map((k) => `'${k}'`).join(',')
      const ps = `$n=@(Get-ItemProperty ${keys} -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'UU ?远程|UU ?Remote|UURemote' }).Count; $p=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'uu.?remote|uuyc' }).Count; Write-Output "$n $p"`
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15000 }, (err, out) => {
        const [n, p] = String(out || '').trim().split(/\s+/).map((x) => parseInt(x, 10) || 0)
        done(n > 0 || p > 0, p > 0)
      })
    } else if (process.platform === 'darwin') {
      const re = /uu.*(远程|remote)|uuyc/i
      const apps = ['/Applications', path.join(os.homedir(), 'Applications')].flatMap((d) => { try { return fs.readdirSync(d) } catch { return [] } })
      execFile('ps', ['-axco', 'comm'], { timeout: 5000 }, (err, out) => { const running = re.test(String(out || '')); done(apps.some((a) => re.test(a)) || running, running) })
    } else done(false, false)
  })
}

/**
 * getCfg/saveCfg: the client's config (cfg.phone = { on, port, devices: [{ id, name, hash, at, seen, ip }] }).
 * runtime(): { port, token } of the 小天 runtime. onEvent({ type: 'paired' | 'unpaired' | 'takeover', ... }).
 */
function createPhone({ getCfg, saveCfg, runtime, onEvent = () => {}, log = () => {} }) {
  let server = null, port = 0, pair = null, error = ''
  const streams = new Map()     // phone id -> its open event streams, closed when the phone is removed
  const conf = () => { const c = getCfg(); c.phone = c.phone || { on: false, devices: [] }; c.phone.devices = c.phone.devices || []; return c.phone }
  const save = () => saveCfg(getCfg())
  const tokenOf = (req, url) => String(req.headers['x-tianxi-token'] || url.searchParams.get('t') || '')
  const deviceOf = (tok) => { if (!tok) return null; const h = sha(tok); return conf().devices.find((d) => d.hash === h) || null }
  const code = () => { if (!pair || pair.exp < Date.now() || pair.fails >= 10) pair = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), exp: Date.now() + CODE_MS, fails: 0 }; return pair }
  let touched = 0
  const touch = (d, req) => {
    d.seen = new Date().toISOString(); d.ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    if (Date.now() - touched > 60e3) { touched = Date.now(); save() }
  }

  // A valid pairing code makes a new phone and hands it its token.
  function pairWith(c, ua) {
    const p = code()
    const ok = typeof c === 'string' && c.length === p.code.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(p.code))
    if (!ok) { p.fails++; return null }
    pair = null
    const token = crypto.randomBytes(24).toString('hex')
    const d = { id: 'ph' + crypto.randomBytes(4).toString('hex'), name: phoneName(ua), hash: sha(token), at: new Date().toISOString(), seen: new Date().toISOString() }
    const list = conf().devices
    list.push(d); if (list.length > MAX_PHONES) list.splice(0, list.length - MAX_PHONES)
    save()
    onEvent({ type: 'paired', name: d.name })
    log(`paired ${d.name}`)
    return { token, phone: { id: d.id, name: d.name } }
  }

  function forget(id) {
    const p = conf()
    p.devices = p.devices.filter((d) => d.id !== id)
    save()
    for (const r of streams.get(id) || []) r.destroy()
    streams.delete(id)
  }

  function forward(req, res, p, rt, d) {
    const headers = { ...req.headers, host: '127.0.0.1:' + rt.port }
    if (p.startsWith('/api/')) headers['x-tianxi-token'] = rt.token
    else delete headers['x-tianxi-token']
    const up = http.request({ host: '127.0.0.1', port: rt.port, method: req.method, path: p, headers }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers)
      r.pipe(res)
    })
    up.on('error', () => { if (!res.headersSent) json(res, 502, { error: '电脑上的小天还没准备好' }); else res.destroy() })
    res.on('close', () => up.destroy())
    if (d && p.startsWith('/api/events')) {
      const set = streams.get(d.id) || new Set(); set.add(res); streams.set(d.id, set)
      res.on('close', () => set.delete(res))
    }
    req.pipe(up)
  }

  async function handle(req, res) {
    let url
    try { url = new URL(req.url, 'http://x') } catch { res.writeHead(400); return res.end() }
    const rt = runtime()
    if (!rt.port) return json(res, 503, { error: '电脑上的小天还没准备好' })
    // the QR code: a phone's camera opens this, and the page it lands on is already signed in
    if (url.pathname === '/pair' && req.method === 'GET') {
      const r = pairWith(url.searchParams.get('c') || '', req.headers['user-agent'])
      if (!r) return page(res, 403, '这个二维码过期了', '在电脑上打开 小天 Bot › 设置 › 手机，扫新的二维码。')
      res.writeHead(302, { location: `/?t=${r.token}&paired=1`, 'cache-control': 'no-store' })
      return res.end()
    }
    if (url.pathname === '/api/phone/pair' && req.method === 'POST') {
      const b = await body(req)
      const r = pairWith(String(b.code || ''), req.headers['user-agent'])
      return r ? json(res, 200, { ok: true, ...r, pc: os.hostname() }) : json(res, 403, { error: '配对码不对或过期了' })
    }
    if (url.pathname.startsWith('/api/')) {
      const d = deviceOf(tokenOf(req, url))
      if (!d) return json(res, 401, { error: 'unpaired' })
      touch(d, req)
      if (url.pathname === '/api/phone/hello') return json(res, 200, { ok: true, pc: os.hostname(), platform: process.platform, phone: { id: d.id, name: d.name }, uu: await detectUU() })
      if (url.pathname === '/api/phone/takeover' && req.method === 'POST') {
        const b = await body(req)
        onEvent({ type: 'takeover', on: !!b.on, how: b.how === 'pip' ? 'pip' : 'full', phone: d.name })
        return json(res, 200, { ok: true })
      }
      if (url.pathname === '/api/phone/unpair' && req.method === 'POST') { forget(d.id); onEvent({ type: 'unpaired', name: d.name }); return json(res, 200, { ok: true }) }
      if (url.searchParams.has('t')) url.searchParams.set('t', rt.token)
      return forward(req, res, url.pathname + url.search, rt, d)
    }
    // the page itself, its scripts, styles and pictures: the same files the computer's window loads
    forward(req, res, url.pathname + url.search, rt, null)
  }

  const listen = (s, p) => new Promise((resolve) => {
    const fail = (e) => { s.off('listening', ok); resolve(e) }
    const ok = () => { s.off('error', fail); resolve(null) }
    s.once('error', fail); s.once('listening', ok)
    s.listen(p, '0.0.0.0')
  })
  async function start() {
    if (server) return
    const s = http.createServer((req, res) => { handle(req, res).catch((e) => { log('error ' + e.message); if (!res.headersSent) json(res, 500, { error: e.message }) }) })
    const want = conf().port || PREF_PORT
    let e = await listen(s, want)
    // the usual port is taken: take any, and remember it so paired phones find it next time
    if (e && e.code === 'EADDRINUSE') e = await listen(s, 0)
    if (e) { error = `没能打开手机连接：${e.code || e.message}`; log(error); return }
    server = s; port = s.address().port; error = ''
    if (conf().port !== port) { conf().port = port; save() }
    log(`listening on ${port}`)
  }
  function stop() {
    if (!server) return
    for (const set of streams.values()) for (const r of set) r.destroy()
    streams.clear()
    server.close(); server.closeAllConnections?.(); server = null
    log('stopped')
  }

  async function state() {
    const p = conf(), addrs = lanAddresses()
    const c = server ? code() : null
    return {
      on: !!p.on, running: !!server, port, error,
      addresses: addrs.map((a) => a.address),
      url: server && addrs[0] ? `http://${addrs[0].address}:${port}/pair?c=${c.code}` : '',
      code: c ? c.code : '', expires: c ? c.exp : 0,
      devices: p.devices.map(({ hash, ...d }) => d),
      uu: await detectUU(),
    }
  }
  async function setOn(on) {
    conf().on = !!on; save()
    if (on) await start(); else stop()
    return state()
  }
  function renew() { pair = null; return state() }

  return { start: () => (conf().on ? start() : Promise.resolve()), stop, state, setOn, renew, forget: (id) => { forget(id); return state() } }
}

module.exports = { createPhone, phoneName, lanAddresses }
