// Tiny JSON-file store shared by every 小天 plugin. One file per collection under TIANXI_HOME.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

export const HOME = process.env.TIANXI_HOME || path.join(os.homedir(), '.tianxi')
fs.mkdirSync(HOME, { recursive: true })

const cache = new Map()
const listeners = new Set()

function file(name) { return path.join(HOME, name + '.json') }

export function load(name, fallback) {
  if (cache.has(name)) return cache.get(name)
  let v = fallback
  try { v = JSON.parse(fs.readFileSync(file(name), 'utf8')) } catch {}
  cache.set(name, v)
  return v
}

export function save(name, value) {
  cache.set(name, value)
  const tmp = file(name) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1))
  fs.renameSync(tmp, file(name))
  for (const l of listeners) { try { l(name, value) } catch {} }
}

export function update(name, fallback, fn) {
  const v = structuredClone(load(name, fallback))
  const out = fn(v)
  save(name, out === undefined ? v : out)
  return out === undefined ? v : out
}

/** Wipe every collection and start from `seed` ({ name: value }). Used by the eval runner between runs. */
export function resetAll(seed = {}) {
  for (const f of fs.readdirSync(HOME)) if (f.endsWith('.json') || f.endsWith('.tmp')) fs.rmSync(path.join(HOME, f), { force: true })
  cache.clear()
  for (const [k, v] of Object.entries(seed)) save(k, v)
}

export const EVAL = !!process.env.TIANXI_EVAL

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }

export const id = (p) => p + '_' + randomUUID().slice(0, 8)
export const now = () => new Date().toISOString()

// Local wall-clock helpers: the model and the UI both speak "YYYY-MM-DDTHH:mm" local time.
export function localISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export const today = () => localISO().slice(0, 10)

// Runtime flags shared across plugins (not persisted).
export const flags = { privateMode: false, idleSec: 0, lastSeen: Date.now(), takeover: null }

// Message bus between plugins: host.js installs `say`, ambient.js uses it to wake 小天 on its own.
export const bus = { say: null, busy: () => false, push: () => {}, agentOf: () => 'tianxi', hopsOf: () => -1, deliver: null }

export function settings() {
  return { briefTime: '08:00', watch: ['~/Downloads', '~/Desktop'], idleMinutes: 10, nightFrom: 23, nightTo: 6, callMe: '', reflectAtNight: true, ...load('settings', {}) }
}

// ---------- 智能体: 小天 is the main personal agent; the user can add more, each with its own persona and mailbox ----------
export const MAIN = 'tianxi'
export const STYLES = ['靠谱同事', '温暖贴心', '犀利有梗']
const MAIN_AGENT = { id: MAIN, name: '小天', role: '你的个人智能体', style: '靠谱同事', intro: '', email: 'xiaotian@agent.local', color: '#e2502e', main: true }
// the main agent before the product became 小天 Bot
const OLD_MAIN = { name: '天禧', email: 'tianxi@agent.local' }
export function agentList() {
  let l = load('agents', null)
  if (!Array.isArray(l) || !l.length) return [MAIN_AGENT]
  const m = l.find((a) => a.id === MAIN)
  if (m && (m.name === OLD_MAIN.name || m.email === OLD_MAIN.email)) {
    l = l.map((a) => a.id === MAIN ? { ...a, name: a.name === OLD_MAIN.name ? MAIN_AGENT.name : a.name, email: a.email === OLD_MAIN.email ? MAIN_AGENT.email : a.email } : a)
    save('agents', l)
  }
  return l.some((a) => a.id === MAIN) ? l : [MAIN_AGENT, ...l]
}
export const agentById = (aid) => agentList().find((a) => a.id === aid) || agentList()[0]
export const agentByEmail = (addr) => agentList().find((a) => a.email && String(addr || '').toLowerCase().includes(a.email.toLowerCase())) || (String(addr || '').toLowerCase().includes(OLD_MAIN.email) ? agentById(MAIN) : undefined)
export const transcriptKey = (aid) => (!aid || aid === MAIN ? 'transcript' : 'transcript_' + aid)

// ---------- what a file really is: its first bytes decide, the extension only when they say nothing ----------
const MAGIC = [
  ['img', 'png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['img', 'jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['img', 'gif', (b) => b.toString('latin1', 0, 4) === 'GIF8'],
  ['img', 'webp', (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'],
  ['img', 'bmp', (b) => b[0] === 0x42 && b[1] === 0x4d],
  ['pdf', 'pdf', (b) => b.toString('latin1', 0, 5) === '%PDF-'],
  ['zip', '7z', (b) => b.toString('latin1', 0, 6) === '7z\xbc\xaf\x27\x1c'],
  ['zip', 'rar', (b) => b.toString('latin1', 0, 4) === 'Rar!'],
]
const BY_EXT = { doc: /^(docx?|txt|md|rtf|wps)$/, xls: /^(xlsx?|csv|et)$/, ppt: /^(pptx?|dps|key)$/, pdf: /^pdf$/, zip: /^(zip|rar|7z|gz|tar)$/, img: /^(png|jpe?g|gif|webp|bmp|heic|svg)$/ }
export const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }
export function fileFact(p) {
  const f = path.resolve(String(p || '').replace(/^~/, os.homedir()))
  const name = path.basename(f), ext = path.extname(f).slice(1).toLowerCase()
  let st; try { st = fs.statSync(f) } catch { return { path: f, name, exists: false, kind: Object.keys(BY_EXT).find((k) => BY_EXT[k].test(ext)) || '', ext } }
  if (st.isDirectory()) return { path: f, name, exists: true, kind: 'dir', ext: '', size: 0 }
  let head = Buffer.alloc(0)
  try { const fd = fs.openSync(f, 'r'); head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd) } catch {}
  const m = MAGIC.find(([, , t]) => head.length >= 4 && t(head))
  // a zip may be an Office file: its extension says which
  const kind = m ? m[0] : Object.keys(BY_EXT).find((k) => BY_EXT[k].test(ext)) || ''
  return { path: f, name, exists: true, kind, ext: m && m[0] === 'img' ? m[1] : ext, size: st.size }
}
