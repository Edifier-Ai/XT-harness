// 天禧AI 概念版 · start-up.
// Picks which client code to run: the newest installed update under %APPDATA%\TianxiAI-Concept\update,
// or the code that shipped in this folder. An update that failed to start last time is skipped for good.
'use strict'
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const USER = path.join(app.getPath('appData'), 'TianxiAI-Concept')
const UPD = path.join(USER, 'update')
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const shipped = readJSON(path.join(__dirname, 'package.json'), {}).version || '0.0.0'

let boot = { version: shipped, appDir: __dirname, bundleDir: null, shipped, fellBack: null }
const cur = readJSON(path.join(UPD, 'current.json'), null)
if (cur && cur.version) {
  const bad = readJSON(path.join(UPD, 'bad.json'), [])
  const marker = path.join(UPD, 'booting.json')
  const last = readJSON(marker, null)
  // The last two starts of this version never reached a working window: treat it as broken.
  if (last && last.tries >= 2 && !bad.includes(last.version)) { bad.push(last.version); try { fs.writeFileSync(path.join(UPD, 'bad.json'), JSON.stringify(bad)) } catch {} }
  // Newest installed version that is not broken: the current one, else the one before it, else what shipped.
  const pick = [cur.version, cur.prev].find((v) => v && !bad.includes(v) && fs.existsSync(path.join(UPD, v)))
  if (bad.includes(cur.version)) boot.fellBack = cur.version
  if (pick) {
    const appDir = path.join(UPD, pick, 'app'), bundleDir = path.join(UPD, pick, 'bundle')
    boot = { ...boot, version: pick,
      appDir: fs.existsSync(path.join(appDir, 'shell.js')) ? appDir : __dirname,
      bundleDir: fs.existsSync(path.join(bundleDir, 'cordis.patch.yml')) ? bundleDir : null }
  }
  try { if (pick) fs.writeFileSync(marker, JSON.stringify({ version: pick, tries: last && last.version === pick ? (last.tries || 1) + 1 : 1, at: Date.now() })); else fs.rmSync(marker, { force: true }) } catch {}
}
global.TIANXI_BOOT = boot
try { require(path.join(boot.appDir, 'shell.js')) } catch (e) {
  if (boot.appDir === __dirname) throw e
  // The update's client code does not even load: mark it broken and run what shipped.
  try { const bad = readJSON(path.join(UPD, 'bad.json'), []); bad.push(boot.version); fs.writeFileSync(path.join(UPD, 'bad.json'), JSON.stringify(bad)); fs.rmSync(path.join(UPD, 'booting.json'), { force: true }) } catch {}
  global.TIANXI_BOOT = { version: shipped, appDir: __dirname, bundleDir: null, shipped, fellBack: boot.version }
  require(path.join(__dirname, 'shell.js'))
}
