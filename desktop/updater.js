// 天禧AI 概念版 · differential updates from the GitHub repository.
// The repository carries release/manifest.json: the version plus the sha256 of every file of the
// 天禧 layer (app/… = this client code, bundle/… = the DSH plugins and web page). The client compares
// hashes with what it already has and downloads only the files that changed, then unpacks the new
// version to update/<version>. main.js starts it next time; if it fails to start, main.js falls back.
// Electron and the DSH runtime (the base layer) are not updated this way: a manifest that needs a
// newer base says so, and the user downloads the full package once.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const vnum = (v) => String(v || '0').split('.').map((x) => parseInt(x, 10) || 0)
const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false }
const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }

function createUpdater({ userDir, boot, runtimeDir, shippedApp, shippedBundle, getSource, log }) {
  const UPD = path.join(userDir, 'update')
  fs.mkdirSync(UPD, { recursive: true })
  let state = { checking: false, latest: null, pending: null, error: '', checkedAt: 0, downloaded: 0 }

  async function gh(src, repoPath, raw) {
    const url = `${process.env.TIANXI_UPDATE_API || 'https://api.github.com'}/repos/${src.repo}/contents/${repoPath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(src.branch || 'main')}`
    const headers = { accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'user-agent': 'TianxiAI-Concept', 'x-github-api-version': '2022-11-28' }
    if (src.token) headers.authorization = 'Bearer ' + src.token
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
    if (r.status === 404) throw new Error(src.token ? '找不到更新仓库，检查仓库名和令牌' : '找不到更新仓库；私有仓库要在设置里填只读令牌')
    if (r.status === 401 || r.status === 403) throw new Error(`GitHub 拒绝了（HTTP ${r.status}），令牌可能过期或没给 Contents 读权限`)
    if (!r.ok) throw new Error('GitHub HTTP ' + r.status)
    return Buffer.from(await r.arrayBuffer())
  }

  // Where a file of the given logical path already sits on this machine (running version, then shipped copy).
  function localCopy(rel) {
    const dirs = rel.startsWith('app/') ? [boot.appDir, shippedApp] : [boot.bundleDir || shippedBundle, shippedBundle]
    return [...new Set(dirs.filter(Boolean))].map((d) => path.join(d, rel.slice(rel.indexOf('/') + 1)))
  }

  async function check({ install = true } = {}) {
    if (state.checking) return status()
    const src = getSource()
    if (!src.repo) { state.error = '还没设置更新仓库'; return status() }
    state.checking = true; state.error = ''
    try {
      const man = JSON.parse((await gh(src, 'release/manifest.json', true)).toString('utf8'))
      state.latest = { version: man.version, notes: man.notes || '', minBase: man.minBase || '' }
      state.checkedAt = Date.now()
      const have = state.pending ? state.pending.version : boot.version
      const bad = readJSON(path.join(UPD, 'bad.json'), [])
      if (!newer(man.version, have) || bad.includes(man.version) || !install) return status()
      if (man.minBase && newer(man.minBase, boot.shipped)) throw new Error(`新版本 ${man.version} 需要新底座，请重新下载完整包一次`)
      await apply(src, man)
      state.pending = { version: man.version, notes: man.notes || '' }
      log(`installed ${man.version}, downloaded ${state.downloaded} files`)
    } catch (e) { state.error = e.message; log('check failed: ' + e.message) } finally { state.checking = false }
    return status()
  }

  async function apply(src, man) {
    const dir = path.join(UPD, man.version), tmp = dir + '.tmp'
    fs.rmSync(tmp, { recursive: true, force: true })
    state.downloaded = 0
    for (const [rel, f] of Object.entries(man.files || {})) {
      if (!/^(app|bundle)\/[^\0]+$/.test(rel) || rel.split('/').includes('..')) throw new Error('清单里有不认识的路径：' + rel)
      let buf = null
      for (const p of localCopy(rel)) { try { const b = fs.readFileSync(p); if (sha256(b) === f.sha256) { buf = b; break } } catch {} }
      if (!buf) {
        buf = await gh(src, f.path, true)
        if (sha256(buf) !== f.sha256) throw new Error('下载的文件校验不对：' + rel)
        state.downloaded++
      }
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true })
      fs.writeFileSync(path.join(tmp, rel), buf)
    }
    fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(tmp, dir)
    // Bundle code imports DSH packages by name; update/node_modules points at the shipped runtime.
    const nm = path.join(UPD, 'node_modules')
    if (!fs.existsSync(nm)) fs.symlinkSync(path.join(runtimeDir, 'node_modules'), nm, 'junction')
    // prev: where main.js goes back to if this version fails to start.
    const prev = boot.version !== boot.shipped && fs.existsSync(path.join(UPD, boot.version)) ? boot.version : null
    fs.writeFileSync(path.join(UPD, 'current.json'), JSON.stringify({ version: man.version, prev, notes: man.notes || '', at: Date.now() }))
    // Keep the running version and the new one.
    for (const d of fs.readdirSync(UPD)) if (/^\d+\.\d+\.\d+(\.tmp)?$/.test(d) && d !== man.version && d !== boot.version) fs.rmSync(path.join(UPD, d), { recursive: true, force: true })
  }

  // Called once the window shows a working 天禧: this version started fine.
  function started() { try { fs.rmSync(path.join(UPD, 'booting.json'), { force: true }) } catch {} }

  const status = () => ({ version: boot.version, shipped: boot.shipped, fellBack: boot.fellBack || null, ...state, source: { repo: getSource().repo, branch: getSource().branch, hasToken: !!getSource().token } })
  return { check, started, status, newer }
}

module.exports = { createUpdater }
