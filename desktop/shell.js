// 小天 Bot · Windows client.
// Runs the DeepSeek Harness runtime (with the dsh-tianxi plugins) as a hidden child process,
// shows the 小天 window, the floating 小天 orb, a tray icon, and reports idle time for background work.
'use strict'
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, safeStorage, powerMonitor, shell, screen, globalShortcut, dialog, net: enet } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createUpdater } = require('./updater.js')
const { createPhone } = require('./phone.js')

const APP_ID = 'com.lenovo.tianxi.concept'
app.setAppUserModelId(APP_ID)
app.setName('小天 Bot')
app.setPath('userData', path.join(app.getPath('appData'), 'TianxiAI-Concept'))
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

// ---------- paths ----------
const USER = app.getPath('userData')
const DSH_HOME = path.join(USER, 'dsh')
const TIANXI_HOME = path.join(USER, 'data')
const LOGS = path.join(USER, 'logs')
const CFG_FILE = path.join(USER, 'config.json')
const PATCH_FILE = path.join(USER, 'tianxi.cordis.yml')
const RUNTIME = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : (process.env.TIANXI_RUNTIME || path.join(__dirname, '..', 'rt'))
// Set by main.js: which version runs and where its client code and 小天 bundle live (shipped or an installed update).
const BOOT = global.TIANXI_BOOT || { version: app.getVersion(), shipped: app.getVersion(), appDir: __dirname, bundleDir: null }
const SHIPPED_BUNDLE = path.join(RUNTIME, 'node_modules', 'dsh-tianxi')
const BUNDLE = BOOT.bundleDir || SHIPPED_BUNDLE
const free = require('./freegate.js')
const PLUGINS = path.join(BUNDLE, 'plugins')
const ICON = path.join(__dirname, 'icon.png')
// Windows takes the taskbar and shortcut icon from an .ico; keep a copy at a path that survives updates.
// The .ico is copied out under a name that changes with its content: Windows caches icons by path,
// so a new name is what makes the taskbar and the shortcuts pick up a new icon after an update.
const ICO_SRC = path.join(__dirname, 'icon.ico')
const ICO = (() => {
  try {
    const f = path.join(app.getPath('userData'), `icon-${crypto.createHash('md5').update(fs.readFileSync(ICO_SRC)).digest('hex').slice(0, 8)}.ico`)
    if (!fs.existsSync(f)) fs.copyFileSync(ICO_SRC, f)
    return f
  } catch { return path.join(app.getPath('userData'), 'icon.ico') }
})()
const WIN_ICON = process.platform === 'win32' && fs.existsSync(ICO) ? ICO : ICON
const MAC = process.platform === 'darwin'
// Mac: an app opened from Finder or the Dock gets only /usr/bin:/bin:/usr/sbin:/sbin as PATH, so node, npx, git or python
// installed with Homebrew or nvm cannot be found by 小天's command tool or by connected apps. Take the login shell's PATH.
if (MAC) {
  const dirs = new Set((process.env.PATH || '').split(':').filter(Boolean))
  try {
    const sh = process.env.SHELL || '/bin/zsh'
    const out = require('node:child_process').execFileSync(sh, ['-lc', 'printf "\n__PATH__%s" "$PATH"'], { timeout: 4000, encoding: 'utf8' })
    for (const d of (out.split('__PATH__').pop() || '').trim().split(':')) if (d) dirs.add(d)
  } catch {}
  for (const d of ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin']) dirs.add(d)
  process.env.PATH = [...dirs].join(':')
}
for (const d of [DSH_HOME, TIANXI_HOME, LOGS]) fs.mkdirSync(d, { recursive: true })

// ---------- third-party model presets (all OpenAI-compatible chat completions) ----------
const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek 深度求索', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], hint: '在 platform.deepseek.com 创建 API Key。' },
  { id: 'qwen', name: '通义千问（阿里云百炼）', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'], hint: '在阿里云百炼控制台创建 API Key。' },
  { id: 'kimi', name: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn/v1', models: ['kimi-k2-turbo-preview', 'kimi-latest'], hint: '在 platform.moonshot.cn 创建 API Key。' },
  { id: 'zhipu', name: '智谱 GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4.6', 'glm-4.5-air'], hint: '在 open.bigmodel.cn 创建 API Key。' },
  { id: 'doubao', name: '豆包（火山方舟）', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', models: [], hint: '模型一栏填火山方舟里的推理接入点 ID（ep- 开头）。' },
  { id: 'magpie', name: 'Magpie 本机路由', baseURL: 'http://127.0.0.1:3425/v1', models: [], key: 'magpie', hint: '先在这台电脑上打开 Magpie。API Key 填 magpie；模型写成“服务商/模型”，比如 openrouter/xxx:free，名字以 Magpie 里显示的为准。' },
  { id: 'ollama', name: 'Ollama 本机模型（免费）', baseURL: 'http://127.0.0.1:11434/v1', models: ['qwen3:8b', 'qwen2.5:7b'], key: 'ollama', hint: '先安装 Ollama 并拉取一个支持工具调用的模型。API Key 填 ollama。本机小模型做复杂任务会吃力。' },
  { id: 'custom', name: '其他 OpenAI 兼容接口', baseURL: 'https://', models: [], hint: '任何兼容 OpenAI /chat/completions 并支持工具调用的服务都可以。' },
]

// ---------- config (API key encrypted with Windows DPAPI via safeStorage) ----------
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) } catch { return {} } }
const saveCfg = (c) => fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2))
const getKey = (c) => {
  if (!c.key) return ''
  try { return safeStorage.isEncryptionAvailable() && c.keyEnc ? safeStorage.decryptString(Buffer.from(c.key, 'base64')) : Buffer.from(c.key, 'base64').toString('utf8') } catch { return '' }
}
const putKey = (c, k) => {
  if (safeStorage.isEncryptionAvailable()) { c.key = safeStorage.encryptString(k).toString('base64'); c.keyEnc = true } else { c.key = Buffer.from(k, 'utf8').toString('base64'); c.keyEnc = false }
}
const encrypt = (k) => safeStorage.isEncryptionAvailable() ? { v: safeStorage.encryptString(k).toString('base64'), enc: true } : { v: Buffer.from(k, 'utf8').toString('base64'), enc: false }
const decrypt = (v, enc) => { try { return enc ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString('utf8') } catch { return '' } }
let cfg = loadCfg()
const gate = free.createGate({ bundleDir: BUNDLE, userDir: USER, encrypt, decrypt, openExternal: (u) => shell.openExternal(u) })

// ---------- runtime (DeepSeek Harness + 小天 plugins) ----------
const TOKEN = crypto.randomBytes(18).toString('hex')
let PORT = 0
const DSH_ENTRY = path.join(RUNTIME, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
let child = null
let quitting = false
let restarts = 0

const yamlStr = (s) => JSON.stringify(String(s))
// Every model 小天 may switch to in a chat: the user's own key, plus the free ones (signed-in software, 智谱).
// Each route is a provider in the patch; the chat's model picker chooses among them without a restart.
function routes() {
  const out = []
  const eff = (efforts) => efforts && efforts.length > 1 ? Object.fromEntries(efforts.map((l) => [l, l === 'off' ? null : l])) : false
  if (getKey(cfg) && cfg.baseURL && cfg.model) {
    const p = PRESETS.find((x) => x.id === cfg.provider)
    out.push({ id: 'tianxi', name: p ? p.name : '我的模型', baseURL: cfg.baseURL, keyEnv: 'TIANXI_API_KEY', key: getKey(cfg), models: [{ id: cfg.model, label: cfg.model, group: p ? p.name : '我的 Key', efforts: [] }] })
  }
  // signed-in software (Magpie's plugins), through the local gateway
  for (const s of gate.sites()) {
    const f = cfg.free?.[s.id]
    if (!f?.on || !f.models?.length || !gate.getAuth(s.id)) continue
    const freeOnes = f.models.filter((x) => x.free)
    const ms = f.freeOnly !== false && freeOnes.length ? freeOnes : f.models
    out.push({ id: s.id, name: s.appName, baseURL: gate.baseURL(s.id), keyEnv: 'TIANXI_KEY_GATE', key: gate.KEY, thinkingFormat: 'openai',
      models: ms.map((x) => ({ ...x, group: s.appName + (s.id.endsWith('-ai') || s.id === 'qoder' ? ' 国际版' : '') })) })
  }
  for (const c of free.cloud(BUNDLE)) {
    const k = cfg.free?.[c.id]
    if (!k?.on || !k.key) continue
    out.push({ id: c.id, name: c.name, baseURL: c.baseURL, keyEnv: 'TIANXI_KEY_' + c.id.toUpperCase(), key: decrypt(k.key, k.enc), thinkingFormat: c.thinkingFormat,
      models: c.models.map((x) => ({ ...x, group: c.name + '（云端）' })) })
  }
  return out.map((r) => ({ ...r, models: r.models.map((x) => ({ ...x, reasoningEfforts: eff(x.efforts) })) }))
}
const catalog = () => routes().flatMap((r) => r.models.map((x) => ({ provider: r.id, model: x.id, label: x.label || x.id, group: x.group || r.name, free: !!x.free, tag: x.tag || '', efforts: x.efforts || [] })))
function currentPick() {
  const all = catalog(), c = cfg.current
  return (c && all.find((x) => x.provider === c.provider && x.model === c.model) && c) || (all[0] ? { provider: all[0].provider, model: all[0].model } : null)
}
const configured = () => routes().length > 0

function writePatch(target = PATCH_FILE) {
  // The bundle's own patch (plugins + the lean 'tianxi' preset), with plugin names turned into file URLs,
  // followed by the models the user can pick from.
  const bundle = fs.readFileSync(path.join(BUNDLE, 'cordis.patch.yml'), 'utf8')
    .replace(/name: dsh-tianxi\/plugins\/([\w-]+\.js)/g, (_m, f) => 'name: ' + yamlStr(pathToFileURL(path.join(PLUGINS, f)).href))
  const rs = routes()
  const prov = rs.map((r) => `      ${r.id}:
        apiKeyEnv: ${r.keyEnv}
        api: openai-completions
        baseURL: ${yamlStr(r.baseURL)}
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens${r.thinkingFormat ? `\n          thinkingFormat: ${r.thinkingFormat}` : ''}
        models:
${r.models.map((x) => `          - id: ${yamlStr(x.id)}${x.reasoningEfforts ? `\n            reasoningEfforts:\n${Object.entries(x.reasoningEfforts).map(([l, w]) => `              ${l}: ${w === null ? 'null' : yamlStr(w)}`).join('\n')}` : ''}`).join('\n')}`).join('\n')
  const pick = currentPick() || { provider: 'tianxi', model: 'none' }
  const yml = `# Generated by 小天 Bot at start-up. Edit settings in the app instead.
${bundle}
- id: llm-pi-ai
  config:
    providers:
${prov || `      tianxi:
        apiKeyEnv: TIANXI_API_KEY
        api: openai-completions
        baseURL: "http://127.0.0.1:9/v1"
        models:
          - id: none`}
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: ${yamlStr(pick.provider)}
    model: ${yamlStr(pick.model)}${pick.effort && pick.effort !== 'off' ? `\n    reasoningEffort: ${yamlStr(pick.effort)}` : ''}
`
  fs.writeFileSync(target, yml)
}
// A signed-in account's models change (Qoder's free ones, WorkBuddy's plan); pick them up at every start.
async function refreshFree() {
  for (const s of gate.sites()) {
    if (!cfg.free?.[s.id]?.on || !gate.getAuth(s.id)) continue
    try { const ms = await gate.models(s.id); if (ms.length) { cfg.free[s.id].models = ms; saveCfg(cfg) } } catch {}
  }
}
const routeEnv = () => Object.fromEntries(routes().map((r) => [r.keyEnv, r.key || 'none']))

const freePort = (pref) => new Promise((resolve) => {
  const s = net.createServer(); s.once('error', () => { const t = net.createServer(); t.listen(0, '127.0.0.1', () => { const p = t.address().port; t.close(() => resolve(p)) }) })
  s.listen(pref, '127.0.0.1', () => s.close(() => resolve(pref)))
})

async function startRuntime() {
  if (child) return
  await gate.start(3460).catch(() => {})
  await refreshFree()
  writePatch()
  PORT = PORT || await freePort(3090)
  const log = fs.createWriteStream(path.join(LOGS, 'runtime.log'), { flags: 'a' })
  log.write(`\n===== ${new Date().toISOString()} start =====\n`)
  child = spawn(process.execPath, [DSH_ENTRY, '--profile', 'web', '--patch', PATCH_FILE, '--no-open', '--port', '0'], {
    cwd: os.homedir(), windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME, TIANXI_HOME, TIANXI_PORT: String(PORT), TIANXI_TOKEN: TOKEN, TIANXI_API_KEY: getKey(cfg) || 'none', ...routeEnv(), TIANXI_MODELS: JSON.stringify(catalog()), TIANXI_ROUTES: JSON.stringify(routes().map((r) => ({ id: r.id, baseURL: r.baseURL, keyEnv: r.keyEnv }))), TIANXI_PICK: JSON.stringify({ ...currentPick(), at: cfg.currentAt || 0 }) },
  })
  child.stdout.pipe(log); child.stderr.pipe(log)
  const me = child
  child.on('exit', (code) => {
    log.write(`===== exit ${code} =====\n`)
    if (child === me) child = null
    if (!quitting && !restarting && restarts < 5) { restarts++; setTimeout(startRuntime, 3000) }
  })
}
let restarting = false
function stopRuntime() {
  return new Promise((resolve) => {
    if (!child) return resolve()
    const c = child; child = null
    c.once('exit', () => resolve())
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { windowsHide: true })
    else c.kill()
    setTimeout(resolve, 5000)
  })
}
// Waits for the runtime to answer. Right after an update Windows may scan the new files first, so a start
// can take minutes: keep waiting while the runtime process is alive, and say so on the start-up page.
async function waitReady(ms = 300000) {
  const t0 = Date.now()
  let said = 0, n = 0
  while (Date.now() - t0 < ms) {
    // every other try goes through Chromium's network stack, in case Node's is the one that cannot get through
    const get = n++ % 2 ? (u, o) => enet.fetch(u, o) : fetch
    try { const r = await get(`http://127.0.0.1:${PORT}/api/ping`, { headers: { 'x-tianxi-token': TOKEN }, signal: AbortSignal.timeout(3000) }); if (r.ok) return true } catch {}
    const waited = Date.now() - t0
    if (waited > 15000 && said < 1) { said = 1; loadingSay('这次启动久一点，小天还在醒来') }
    if (waited > 60000 && said < 2) { said = 2; loadingSay('还在准备，刚更新完第一次会慢些') }
    if (!child && waited > 20000 && restarts >= 5) return false   // it keeps exiting: stop waiting
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}
const loadingSay = (t) => win?.webContents.executeJavaScript(`(m => m && (m.textContent = ${JSON.stringify(t)}))(document.getElementById('msg'))`).catch(() => {})
const uiURL = (page = '') => `http://127.0.0.1:${PORT}/${page}?t=${TOKEN}`
const api = (p, body) => fetch(`http://127.0.0.1:${PORT}/api/${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-tianxi-token': TOKEN }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json()).catch(() => null)

// ---------- windows ----------
let win = null, pill = null, tray = null, refreshTray = () => {}

// The home page's background (dark or light theme), so the start-up page can hand over without a flash next time.
function rememberHomeBg() {
  if (!win || win.isDestroyed() || !/^http/.test(win.webContents.getURL())) return
  win.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || getComputedStyle(document.body).backgroundColor").then((c) => { if (c && !/rgba\(.*,\s*0\)$/.test(c) && c !== cfg.homeBg) { cfg.homeBg = c; saveCfg(cfg) } }).catch(() => {})
}
function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 620, show: false, backgroundColor: '#000000',
    // Windows: no frame, the page draws its own buttons. Mac: the usual traffic lights over the page's top-left corner.
    ...(MAC ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 17 } } : { frame: false }),
    title: '小天 Bot', icon: WIN_ICON, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  if (process.platform === 'win32' && WIN_ICON === ICO) {
    try { win.setAppDetails({ appId: APP_ID, appIconPath: ICO, appIconIndex: 0, relaunchCommand: `"${process.execPath}"`, relaunchDisplayName: '小天 Bot' }) } catch {}
  }
  win.on('blur', rememberHomeBg)
  win.on('close', (e) => { rememberHomeBg(); if (!quitting) { e.preventDefault(); win.hide() } })
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  win.once('ready-to-show', () => { if (!hidden) win.show() })
}
async function loadMain() {
  if (!configured()) { await win.loadFile(path.join(BUNDLE, 'web', 'index.html')); return }
  await win.loadFile(path.join(__dirname, 'loading.html'))
  await startRuntime()
  if (await waitReady()) {
    // the start-up light floods the window, then the home page takes over on the same background colour
    const home = /^#|^rgb\(/.test(cfg.homeBg || '') ? cfg.homeBg : '#121212'
    await win.webContents.executeJavaScript(`window.finish ? window.finish(${JSON.stringify(home)}) : 0`).catch(() => {})
    win.setBackgroundColor(home)
    await win.loadURL(uiURL()); createPill(); updater.started(); syncWidgets()
  }
  else {
    loadingSay(`小天 Bot 没能启动。日志在 ${path.join(LOGS, 'runtime.log')}`)
    // keep checking: if it does come up later, go on to the home page by itself
    if (await waitReady(600000)) loadMain()
  }
}
// The floating 小天: a red ball that sits anywhere on the desktop. The window is bigger than the ball so its
// speech bubble fits; only the ball and the bubble catch the mouse (the page says when the pointer is over them).
const ORB_W = 280, ORB_H = 240, BALL_X = ORB_W / 2, BALL_Y = ORB_H / 2
let orbTimer = null, orbDrag = null, orbLast = ''
function orbHome() {
  const { workArea: a } = screen.getPrimaryDisplay()
  const p = cfg.orbPos, d = p && screen.getDisplayNearestPoint(p)
  const at = d && inside(p, d.workArea) ? p : { x: a.x + a.width - 72, y: a.y + a.height - 96 }
  return { x: Math.round(at.x - BALL_X), y: Math.round(at.y - BALL_Y) }
}
const inside = (p, a) => p.x >= a.x && p.y >= a.y && p.x <= a.x + a.width && p.y <= a.y + a.height
function createPill() {
  if (pill || cfg.pill === false) return
  pill = new BrowserWindow({
    width: ORB_W, height: ORB_H, ...orbHome(), frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  })
  pill.setAlwaysOnTop(true, 'screen-saver')
  if (MAC) pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  pill.setIgnoreMouseEvents(true, { forward: true })
  pill.loadURL(uiURL('orb.html'))
  pill.once('ready-to-show', () => { pill.showInactive(); orbTick() })
  pill.on('closed', () => { pill = null; clearInterval(orbTimer); orbTimer = null })
  // where the mouse is, relative to the window, so the eyes can follow it across the whole screen
  orbTimer = setInterval(orbTick, 33)
}
function orbTick() {
  if (!pill || pill.isDestroyed()) return
  const c = screen.getCursorScreenPoint()
  if (orbDrag) pill.setPosition(Math.round(c.x - orbDrag.dx), Math.round(c.y - orbDrag.dy))
  const b = pill.getBounds(), a = screen.getDisplayNearestPoint({ x: b.x + BALL_X, y: b.y + BALL_Y }).workArea
  const m = { x: c.x - b.x, y: c.y - b.y, top: b.y + BALL_Y - a.y, left: b.x + BALL_X - a.x, right: a.x + a.width - b.x - BALL_X }
  const k = JSON.stringify(m)
  if (k !== orbLast) { orbLast = k; pill.webContents.send('tianxi:orb', m) }
}
ipcMain.on('tianxi:orbHit', (e, on) => { if (pill && !pill.isDestroyed() && e.sender === pill.webContents) pill.setIgnoreMouseEvents(!on, { forward: true }) })
ipcMain.on('tianxi:orbDrag', (e, on) => {
  if (!pill || pill.isDestroyed() || e.sender !== pill.webContents) return
  const c = screen.getCursorScreenPoint(), b = pill.getBounds()
  if (on) { orbDrag = { dx: c.x - b.x, dy: c.y - b.y }; return }
  orbDrag = null
  // keep the ball itself on a screen, then remember where it was left
  const ball = { x: b.x + BALL_X, y: b.y + BALL_Y }, a = screen.getDisplayNearestPoint(ball).workArea
  const x = Math.min(Math.max(ball.x, a.x + 36), a.x + a.width - 36), y = Math.min(Math.max(ball.y, a.y + 36), a.y + a.height - 36)
  pill.setPosition(Math.round(x - BALL_X), Math.round(y - BALL_Y))
  cfg.orbPos = { x: Math.round(x), y: Math.round(y) }; saveCfg(cfg)
})
ipcMain.on('tianxi:orbMenu', (e) => {
  if (!pill || e.sender !== pill.webContents) return
  Menu.buildFromTemplate([
    { label: '打开小天 Bot', click: showMain },
    { label: '回到右下角', click: () => { delete cfg.orbPos; saveCfg(cfg); pill.setPosition(orbHome().x, orbHome().y) } },
    { type: 'separator' },
    { label: '隐藏桌面小天', click: () => { cfg.pill = false; saveCfg(cfg); pill?.close(); refreshTray() } },
  ]).popup({ window: pill })
})
const showMain = () => { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus() }

// 钉到桌面: a card pinned from the chat sits on the desktop in a small window of its own (web/widget.html), under
// other windows like a note. The runtime keeps the list (plugins/widgets.js); this keeps one window per pinned card.
const WIDGET_W = 384
const widgetWins = new Map()   // widget id -> BrowserWindow
let syncing = null
async function syncWidgets() {
  if (!child || syncing) return syncing
  syncing = (async () => {
    const r = await api('widgets'); if (!r?.widgets) return
    const want = new Set(r.widgets.filter((w) => w.pinned).map((w) => w.id))
    // a window whose widget was taken away closes itself after saying why; one that was simply removed closes now
    for (const [wid, w] of widgetWins) {
      const gone = r.widgets.find((x) => x.id === wid)?.retired
      if (!want.has(wid) && !w.isDestroyed() && !(gone && Date.now() - Date.parse(gone.at) < 20000)) w.close()
    }
    for (const x of r.widgets) if (want.has(x.id) && !widgetWins.has(x.id)) openWidget(x)
  })().finally(() => { syncing = null })
  return syncing
}
function widgetHome() {
  // new widgets line up to the left of the floating 小天, top-down
  const a = screen.getPrimaryDisplay().workArea, n = widgetWins.size
  return { x: a.x + a.width - WIDGET_W - 24 - Math.floor(n / 3) * (WIDGET_W + 8), y: a.y + 24 + (n % 3) * 220 }
}
function openWidget(x) {
  const p = cfg.widgetPos?.[x.id], d = p && screen.getDisplayNearestPoint(p)
  const at = p && d && inside(p, d.workArea) ? p : widgetHome()
  const w = new BrowserWindow({
    width: WIDGET_W, height: 220, x: Math.round(at.x), y: Math.round(at.y), frame: false, transparent: true, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false,
    backgroundColor: '#00000000', title: x.title || '小天小组件',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  widgetWins.set(x.id, w)
  w.loadURL(uiURL('widget.html') + '&id=' + encodeURIComponent(x.id))
  w.once('ready-to-show', () => w.showInactive())
  w.on('moved', () => { if (w.isDestroyed()) return; const b = w.getBounds(); (cfg.widgetPos ||= {})[x.id] = { x: b.x, y: b.y }; saveCfg(cfg) })
  w.on('closed', () => { if (widgetWins.get(x.id) === w) widgetWins.delete(x.id) })
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' } })
}
const widgetOf = (e) => { for (const [wid, w] of widgetWins) if (!w.isDestroyed() && w.webContents === e.sender) return [wid, w]; return [] }
ipcMain.on('tianxi:widgetFit', (e, h) => {
  const [, w] = widgetOf(e); if (!w) return
  const height = Math.round(Math.min(Math.max(+h || 0, 80), 760))
  if (w.getBounds().height !== height) w.setBounds({ ...w.getBounds(), width: WIDGET_W, height })
})
ipcMain.on('tianxi:widgetClose', (e) => { const [, w] = widgetOf(e); if (w) w.close() })
ipcMain.handle('tianxi:widgetsSync', () => syncWidgets())
ipcMain.on('tianxi:widgetMenu', (e, o = {}) => {
  const [wid, w] = widgetOf(e); if (!w) return
  Menu.buildFromTemplate([
    { label: '现在更新', click: () => api('widgets/refresh', { id: wid }) },
    { label: '在小天 Bot 里打开', click: () => { showMain(); win?.webContents.executeJavaScript(`typeof setView === 'function' && setView('tools', ${JSON.stringify(wid)})`).catch(() => {}) } },
    o.tool ? { label: '已在我的工具里', enabled: false } : { label: '收进我的工具', click: () => api('widgets/tool', { id: wid, on: true }) },
    { type: 'separator' },
    { label: '从桌面取下', click: async () => { await api('widgets/unpin', { id: wid }); if (!w.isDestroyed()) w.close() } },
  ]).popup({ window: w })
})
// a widget 小天 took away while this was not looking, or one put back from 操作记录
setInterval(() => { if (child) syncWidgets() }, 30000)

function createTray() {
  // the .ico carries a hand-tuned 16 px picture; a 256 px png shrunk down blurs the eyes
  tray = new Tray(process.platform === 'win32' && fs.existsSync(ICO) ? nativeImage.createFromPath(ICO) : nativeImage.createFromPath(ICON).resize({ width: MAC ? 18 : 16, height: MAC ? 18 : 16, quality: 'best' }))
  tray.setToolTip('小天 Bot')
  const menu = () => Menu.buildFromTemplate([
    { label: '打开小天 Bot', click: showMain },
    { label: '桌面小天（悬浮球）', type: 'checkbox', checked: cfg.pill !== false, click: (m) => { cfg.pill = m.checked; saveCfg(cfg); if (m.checked) createPill(); else pill?.close() } },
    { label: '隐私模式（对话不进入记忆）', type: 'checkbox', checked: false, click: (m) => api('private', { on: m.checked }) },
    { type: 'separator' },
    { label: '打开数据文件夹', click: () => shell.openPath(USER) },
    { label: updater.status().pending ? `新版本 ${updater.status().pending.version} 已下好，点这里重启` : `版本 ${BOOT.version} · 检查更新`, click: () => (updater.status().pending ? relaunch() : runCheck(true)) },
    { label: '退出小天 Bot', click: () => { quitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu())
  refreshTray = () => tray.setContextMenu(menu())
  // on a Mac a click on a menu-bar icon opens its menu, as everywhere else in the menu bar
  if (!MAC) tray.on('click', showMain)
}

// Mac: the app menu, without which copy, paste, undo and quit have no keyboard shortcuts.
function macMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '小天 Bot', submenu: [
      { role: 'about', label: '关于小天 Bot' }, { type: 'separator' },
      { label: '设置…', accelerator: 'Command+,', click: () => { showMain(); win?.webContents.executeJavaScript("typeof openModal === 'function' && openModal('settings')").catch(() => {}) } },
      { type: 'separator' }, { role: 'hide', label: '隐藏小天 Bot' }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '全部显示' },
      { type: 'separator' }, { label: '退出小天 Bot', accelerator: 'Command+Q', click: () => { quitting = true; app.quit() } },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '拷贝' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '窗口', submenu: [
      { role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' },
      { label: '关闭窗口', accelerator: 'Command+W', click: () => win?.hide() },
      { type: 'separator' }, { role: 'togglefullscreen', label: '进入全屏' },
    ] },
  ]))
}

// ---------- bridge for the page ----------
ipcMain.handle('tianxi:win', (e, cmd) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w) return
  if (cmd === 'min') w.minimize(); else if (cmd === 'max') w.isMaximized() ? w.unmaximize() : w.maximize(); else if (cmd === 'close') w.close()
})
ipcMain.handle('tianxi:show', () => showMain())
ipcMain.handle('tianxi:getConfig', () => ({
  provider: cfg.provider || 'deepseek', model: cfg.model || '', baseURL: cfg.baseURL || '', hasKey: !!getKey(cfg), configured: configured(),
  free: { sites: Object.fromEntries(gate.sites().map((s) => [s.id, { on: !!cfg.free?.[s.id]?.on, freeOnly: cfg.free?.[s.id]?.freeOnly !== false }])), cloud: free.cloud(BUNDLE).map((c) => ({ ...c, on: !!cfg.free?.[c.id]?.on, hasKey: !!cfg.free?.[c.id]?.key })) }, current: currentPick(),
  autoLaunch: app.getLoginItemSettings().openAtLogin, presets: PRESETS,
}))
// Ask an OpenAI-compatible endpoint which models it serves (Magpie and Ollama list theirs here).
ipcMain.handle('tianxi:listModels', async (e, c = {}) => {
  const key = c.apiKey || (PRESETS.find((p) => p.id === c.provider) || {}).key || getKey(cfg)
  try {
    const r = await fetch(String(c.baseURL || '').replace(/\/+$/, '') + '/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status }
    const j = await r.json()
    return { ok: true, models: (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean) }
  } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('tianxi:saveConfig', async (e, c) => {
  const key = c.apiKey || (PRESETS.find((p) => p.id === c.provider) || {}).key || getKey(cfg)
  const baseURL = String(c.baseURL || '').replace(/\/+$/, '')
  // Check the model answers (and accepts tools) before switching to it.
  try {
    const r = await fetch(baseURL + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: c.model, max_tokens: 8, messages: [{ role: 'user', content: '你好' }],
        tools: [{ type: 'function', function: { name: 'ping', description: 'test', parameters: { type: 'object', properties: {} } } }] }),
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) { const t = await r.text(); return { ok: false, error: `HTTP ${r.status} ${t.slice(0, 200)}` } }
  } catch (err) { return { ok: false, error: err.message } }
  cfg.provider = c.provider; cfg.model = c.model; cfg.baseURL = baseURL
  cfg.current = { provider: 'tianxi', model: c.model }; cfg.currentAt = Date.now()
  if (key && key !== getKey(cfg)) putKey(cfg, key)
  if (typeof c.autoLaunch === 'boolean') app.setLoginItemSettings({ openAtLogin: c.autoLaunch, args: ['--hidden'] })
  saveCfg(cfg)
  setTimeout(async () => { restarting = true; await stopRuntime(); restarting = false; restarts = 0; await loadMain() }, 300)
  return { ok: true }
})

// ---------- 免费模式 ----------
const restartRuntime = () => setTimeout(async () => { restarting = true; await stopRuntime(); restarting = false; restarts = 0; await loadMain() }, 300)
ipcMain.handle('tianxi:freeScan', () => gate.scan())
ipcMain.handle('tianxi:freeSignIn', (e, c = {}) => gate.signIn(c.site, c.how))
ipcMain.handle('tianxi:freeReopen', (e, site) => gate.reopen(site))
ipcMain.handle('tianxi:freeSignOut', (e, site) => {
  gate.signOut(site)
  if (cfg.free?.[site]?.on) { cfg.free[site].on = false; saveCfg(cfg); restartRuntime() }
  return { ok: true }
})
ipcMain.handle('tianxi:open', (e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url) })
// Test one model: { route: a signed-in site ('qoder-cn', 'workbuddy', ...) | 'zhipu', model, effort, apiKey? }
ipcMain.handle('tianxi:freeTest', async (e, c = {}) => {
  if (gate.siteOf(c.route)) {
    await gate.start(3460)
    return free.test({ baseURL: gate.baseURL(c.route), key: gate.KEY, model: c.model, effort: c.effort, stream: true })
  }
  const cl = free.cloud(BUNDLE).find((x) => x.id === c.route)
  if (!cl) return { ok: false, status: 0, code: 'UNKNOWN_ROUTE', message: '不认识的来源' }
  const saved = cfg.free?.[cl.id]?.key ? decrypt(cfg.free[cl.id].key, cfg.free[cl.id].enc) : ''
  const key = String(c.apiKey || saved).trim()
  if (!key) return { ok: false, status: 0, code: 'NO_KEY', message: '还没填 API Key' }
  return free.test({ baseURL: cl.baseURL, key, model: c.model })
})
// Turn a source on (and make one of its models the current one) or off: { route, on, model, effort, apiKey?, freeOnly? }
ipcMain.handle('tianxi:freeSave', async (e, c = {}) => {
  cfg.free = cfg.free || {}
  if (gate.siteOf(c.route)) {
    const prev = cfg.free[c.route] || {}
    if (c.on) {
      if (!gate.getAuth(c.route)) return { ok: false, code: 'NOT_SIGNED_IN', message: '还没登录' }
      let ms = []; try { ms = await gate.models(c.route) } catch (err) { return { ok: false, code: 'NO_MODELS', message: err.message } }
      if (!ms.length) return { ok: false, code: 'NO_MODELS', message: '这个账号下没有可用的模型' }
      await gate.start(3460)
      const t = await free.test({ baseURL: gate.baseURL(c.route), key: gate.KEY, model: c.model || ms[0].id, effort: c.effort, stream: true })
      if (!t.ok) return t
      cfg.free[c.route] = { on: true, freeOnly: c.freeOnly !== false, models: ms }
    } else cfg.free[c.route] = { ...prev, on: false }
  } else {
    const cl = free.cloud(BUNDLE).find((x) => x.id === c.route)
    if (!cl) return { ok: false, code: 'UNKNOWN_ROUTE', message: '不认识的来源' }
    const prev = cfg.free[cl.id] || {}
    if (c.on) {
      const key = String(c.apiKey || (prev.key ? decrypt(prev.key, prev.enc) : '')).trim()
      if (!key) return { ok: false, code: 'NO_KEY', message: '还没填 API Key' }
      const t = await free.test({ baseURL: cl.baseURL, key, model: c.model || cl.models[0].id })
      if (!t.ok) return t
      const k = encrypt(key); cfg.free[cl.id] = { on: true, key: k.v, enc: k.enc }
    } else cfg.free[cl.id] = { ...prev, on: false }
  }
  if (c.on && c.model) { cfg.current = { provider: c.route, model: c.model, ...(c.effort ? { effort: c.effort } : {}) }; cfg.currentAt = Date.now() }
  saveCfg(cfg)
  if (c.restart !== false) restartRuntime()
  return { ok: true }
})

// ---------- 评测: a separate runtime with its own data and a sandbox per task ----------
const EVAL_DIR = path.join(USER, 'eval')
let evalChild = null, evalOut = null
const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const killTree = (c) => { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { windowsHide: true }) : c.kill() } catch {} }
ipcMain.handle('tianxi:runEval', async (e, o = {}) => {
  if (evalChild) return { ok: false, error: '评测正在进行' }
  if (!getKey(cfg)) return { ok: false, error: '先接好模型' }
  const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace(/[:T]/g, '-')
  evalOut = path.join(EVAL_DIR, `${stamp}_${String(cfg.model || 'model').replace(/[^\w.-]/g, '_')}`)
  const base = path.join(USER, 'eval-runtime')
  fs.rmSync(base, { recursive: true, force: true })
  for (const d of [evalOut, base]) fs.mkdirSync(d, { recursive: true })
  const patch = path.join(base, 'patch.yml'); writePatch(patch)
  const log = fs.createWriteStream(path.join(evalOut, 'runtime.log'))
  const preset = PRESETS.find((p) => p.id === cfg.provider)
  evalChild = spawn(process.execPath, [DSH_ENTRY, '--profile', 'web', '--patch', patch, '--no-open', '--port', '0'], {
    cwd: evalOut, windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: path.join(base, 'dsh'), TIANXI_HOME: path.join(base, 'data'), TIANXI_API_KEY: getKey(cfg),
      TIANXI_EVAL: '1', TIANXI_EVAL_OUT: evalOut, TIANXI_EVAL_RUNS: String(o.runs || 3), TIANXI_EVAL_ONLY: o.only || '',
      TIANXI_EVAL_PROVIDER: preset ? preset.name : cfg.provider, TIANXI_JUDGE_URL: cfg.baseURL, TIANXI_JUDGE_MODEL: cfg.model },
  })
  evalChild.stdout.pipe(log); evalChild.stderr.pipe(log)
  const me = evalChild
  evalChild.on('exit', () => { if (evalChild === me) evalChild = null })
  return { ok: true, out: evalOut }
})
ipcMain.handle('tianxi:evalStop', () => { if (evalChild) { killTree(evalChild); evalChild = null } return { ok: true } })
ipcMain.handle('tianxi:evalStatus', () => {
  let history = []
  try {
    history = fs.readdirSync(EVAL_DIR).sort().reverse().slice(0, 12).map((d) => ({ dir: path.join(EVAL_DIR, d), ...(readJSON(path.join(EVAL_DIR, d, 'progress.json')) || { state: 'unknown' }) }))
  } catch {}
  return { running: !!evalChild, out: evalOut, history }
})
ipcMain.handle('tianxi:evalOpen', (e, dir) => {
  const d = dir || evalOut; if (!d || !d.startsWith(EVAL_DIR)) return
  const rep = path.join(d, '报告.md'); shell.openPath(fs.existsSync(rep) ? rep : d)
})

// ---------- updates: differential, from the GitHub repository (see updater.js) ----------
const UPDATE_DEFAULT = readJSON(path.join(__dirname, 'update.json')) || {}
const getSource = () => ({
  repo: cfg.updateRepo || UPDATE_DEFAULT.repo || '', branch: cfg.updateBranch || UPDATE_DEFAULT.branch || 'main',
  token: cfg.updateToken ? decrypt(cfg.updateToken, cfg.updateTokenEnc) : '',
})
const updater = createUpdater({
  userDir: USER, boot: BOOT, runtimeDir: RUNTIME, shippedApp: path.join(process.resourcesPath || '', 'app'), shippedBundle: SHIPPED_BUNDLE, getSource,
  // Chromium's network stack: follows the system proxy and certificates, like the browser does.
  fetch: (url, opts) => enet.fetch(url, opts),
  log: (m) => { try { fs.appendFileSync(path.join(LOGS, 'update.log'), `${new Date().toISOString()} ${m}\n`) } catch {} },
})
async function runCheck(manual) {
  const before = updater.status().pending
  const st = await updater.check()
  refreshTray()
  if (st.pending && !before) {
    // Nobody is using 小天 right now: switch over quietly. Otherwise the page offers a restart.
    if ((!win || !win.isVisible()) && powerMonitor.getSystemIdleTime() > 180 && !evalChild) return relaunch()
  }
  if (win && !win.isDestroyed() && (st.pending || manual)) win.webContents.send('tianxi:update', st)
  return st
}
async function relaunch() {
  quitting = true
  if (evalChild) killTree(evalChild)
  await stopRuntime()
  const args = process.argv.slice(1).filter((a) => a !== '--hidden')
  app.relaunch({ args: win && win.isVisible() ? args : args.concat('--hidden') })
  app.exit(0)
}
setInterval(runCheck, 2 * 3600 * 1000)
ipcMain.handle('tianxi:updateStatus', () => updater.status())
ipcMain.handle('tianxi:updateCheck', () => runCheck(true))
ipcMain.handle('tianxi:restart', () => relaunch())
ipcMain.handle('tianxi:updateSource', (e, c = {}) => {
  if (c.repo !== undefined) cfg.updateRepo = String(c.repo).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  if (c.token) { const t = encrypt(String(c.token).trim()); cfg.updateToken = t.v; cfg.updateTokenEnc = t.enc }
  if (c.clearToken) { delete cfg.updateToken; delete cfg.updateTokenEnc }
  saveCfg(cfg)
  return updater.status()
})

// ---------- 手机: a paired phone on the same Wi-Fi uses this computer's 小天 (see phone.js) ----------
const phone = createPhone({
  getCfg: () => cfg, saveCfg,
  runtime: () => ({ port: child ? PORT : 0, token: TOKEN }),
  log: (m) => { try { fs.appendFileSync(path.join(LOGS, 'phone.log'), `${new Date().toISOString()} ${m}\n`) } catch {} },
  onEvent: (ev) => {
    // you took over from the phone: 小天 waits before its next step until you hand back
    if (ev.type === 'takeover') api('takeover', { on: ev.on, how: ev.how, phone: ev.phone })
    if (win && !win.isDestroyed()) win.webContents.send('tianxi:phone', ev)
  },
})
ipcMain.handle('tianxi:phoneState', () => phone.state())
ipcMain.handle('tianxi:phoneOn', (e, on) => phone.setOn(!!on))
ipcMain.handle('tianxi:phoneRenew', () => phone.renew())
ipcMain.handle('tianxi:phoneForget', (e, id) => phone.forget(String(id || '')))

// ---------- presence: lets 小天 do queued work while you are away ----------
setInterval(() => { if (child) api('presence', { idleSec: powerMonitor.getSystemIdleTime() }) }, 30000)
powerMonitor.on('lock-screen', () => { if (child) api('presence', { idleSec: 3600 }) })
powerMonitor.on('unlock-screen', () => { if (child) api('presence', { idleSec: 0 }) })

// ---------- lifecycle ----------
app.on('second-instance', showMain)
// Mac: clicking the Dock icon brings the window back
app.on('activate', showMain)
app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => { globalShortcut.unregisterAll() })
app.on('quit', () => { phone.stop(); if (evalChild) killTree(evalChild); if (child) { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']) : child.kill() } catch {} } })
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  // started at login: stay in the tray (Windows passes --hidden; a Mac login item cannot take arguments)
  const hidden = process.argv.includes('--hidden') || (MAC && app.getLoginItemSettings().wasOpenedAtLogin)
  // First run: put a shortcut on the desktop and in the Start menu. Later runs only refresh the icon of the ones still there.
  // The product was renamed from 天禧AI 概念版 to 小天 Bot: shortcuts under the old name are replaced.
  const LNK = '小天 Bot.lnk', OLD_LNK = '天禧AI 概念版.lnk'
  if (app.isPackaged && process.platform === 'win32' && (!cfg.shortcuts || cfg.shortcutIcon !== WIN_ICON || cfg.shortcutName !== LNK)) {
    const icon = WIN_ICON === ICO ? { icon: ICO, iconIndex: 0 } : { icon: process.execPath, iconIndex: 0 }
    const opts = { target: process.execPath, ...icon, appUserModelId: APP_ID, description: '小天 Bot' }
    const sm = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    for (const dir of [app.getPath('desktop'), sm]) {
      const lnk = path.join(dir, LNK), old = path.join(dir, OLD_LNK)
      try {
        if (!cfg.shortcuts) shell.writeShortcutLink(lnk, opts)
        else if (fs.existsSync(old)) { shell.writeShortcutLink(lnk, opts); fs.rmSync(old, { force: true }) }
        else if (fs.existsSync(lnk)) shell.writeShortcutLink(lnk, 'update', icon)
      } catch {}
    }
    cfg.shortcuts = true; cfg.shortcutIcon = WIN_ICON; cfg.shortcutName = LNK; saveCfg(cfg)
  }
  if (MAC) { macMenu(); if (!app.isPackaged) app.dock?.setIcon(ICON) }
  createWindow(hidden)
  createTray()
  globalShortcut.register(MAC ? 'Command+Shift+Space' : 'Control+Alt+Space', () => { win.isVisible() && win.isFocused() ? win.hide() : showMain() })
  await loadMain()
  phone.start().catch(() => {})
  setTimeout(runCheck, 20000)
})
