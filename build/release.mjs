// Writes release/manifest.json: the sha256 of every file of the 天禧 layer, which clients compare to
// download only what changed. Usage: node build/release.mjs <version> "<what changed>"
// Commit and push the result to main; clients pick it up on their next check.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const [version, notes = ''] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('usage: node build/release.mjs x.y.z "notes"'); process.exit(1) }

// Client code that an update may replace. main.js and package.json stay with the shipped base.
const APP_FILES = ['shell.js', 'updater.js', 'preload.js', 'loading.html', 'icon.png', 'update.json']
// The oldest shipped base (Electron + DSH runtime + main.js) these files run on.
const MIN_BASE = '0.4.0'

const files = {}
const add = (logical, repoPath) => {
  const buf = fs.readFileSync(path.join(ROOT, repoPath))
  files[logical] = { path: repoPath, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length }
}
for (const f of APP_FILES) add('app/' + f, 'desktop/' + f)
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(dir + '/' + d.name) : [dir + '/' + d.name])
for (const f of walk('tianxi')) add('bundle/' + f.slice('tianxi/'.length), f)

fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true })
const man = { version, notes, minBase: MIN_BASE, at: new Date().toISOString(), files }
fs.writeFileSync(path.join(ROOT, 'release', 'manifest.json'), JSON.stringify(man, null, 1) + '\n')
console.log(`release/manifest.json ${version}: ${Object.keys(files).length} files`)
