// 同场共创: a document or a slide deck that opens beside the chat, written by a Bot and by you at the same time.
// The Bot writes with the doc_* tools. While its arguments stream in, the paragraph it is writing shows up live with
// its cursor. You type in the same document: whatever you changed is told to the Bot in its next doc_* result (what
// you wrote wins), and the paragraph your cursor is in stays yours until you leave it. Every change the Bot makes goes
// into 操作记录 and can be taken back; 存成 Word / PPT writes a real .docx / .pptx.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { HOME, id, now, bus, agentList, agentById, quick, plainOf, MAIN } from './store.js'
import { record, defineUndo } from './ledger.js'
import { docx, pptx } from './ooxml.js'

const T = { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] }
const WHY = { type: 'string', description: '一句话说明为什么这样写（会写进操作记录给用户看）' }
const DIR = path.join(HOME, 'docs')
const LOCK_MS = 15e3            // a paragraph your cursor was in this recently is yours
const DOC_TYPES = new Set(['h1', 'h2', 'p', 'li', 'quote'])
const NAME = { h1: '标题', h2: '小标题', p: '正文', li: '要点', quote: '引用', slide: '页' }

// ---------- the documents: one JSON file each, written a moment after the last change ----------
const all = new Map()
let loaded = false
function loadAll() {
  if (loaded) return
  loaded = true
  try { for (const f of fs.readdirSync(DIR)) if (f.endsWith('.json')) { try { const d = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); if (d?.id && Array.isArray(d.blocks)) all.set(d.id, d) } catch {} } } catch {}
}
const pending = new Map()
function persist(d) {
  clearTimeout(pending.get(d.id))
  pending.set(d.id, setTimeout(() => write(d.id), 300))
}
function write(did) {
  pending.delete(did)
  const d = all.get(did), f = path.join(DIR, did + '.json')
  try {
    fs.mkdirSync(DIR, { recursive: true })
    if (!d) { fs.rmSync(f, { force: true }); return }
    fs.writeFileSync(f + '.tmp', JSON.stringify(d)); fs.renameSync(f + '.tmp', f)
  } catch (e) { console.error('[tianxi] doc save', e.message) }
}
const flush = () => { for (const [did, t] of pending) { clearTimeout(t); write(did) } }
export const docOf = (did) => { loadAll(); return all.get(did) || null }
const docs = () => { loadAll(); return [...all.values()] }
const meta = (d) => ({ id: d.id, title: d.title, kind: d.kind, agent: d.agent, at: d.createdAt, updatedAt: d.updatedAt, n: d.blocks.filter((b) => b.text.trim()).length, calls: (d.calls || []).slice(-20) })
function changed(d, from = '') {
  d.rev = (d.rev || 0) + 1; d.updatedAt = now()
  persist(d)
  bus.push({ type: 'doc', doc: d, from })
}
const words = (d) => d.kind === 'slides' ? '幻灯片' : '文档'
const unit = (d) => d.kind === 'slides' ? '页' : '段'
const clip = (s, n = 120) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s }

// a block as the model or you wrote it: Markdown marks become the block's kind
function shape(d, type, text) {
  let t = String(text ?? '').replace(/\r/g, '').slice(0, 6000)
  if (d.kind === 'slides') return { type: 'slide', text: t.split('\n').map((l, i) => i ? l.replace(/^\s*(?:[-*•·]|\d+[.、)])\s+/, '') : l.replace(/^#+\s*/, '')).join('\n').trim() }
  let k = DOC_TYPES.has(type) ? type : /^(title|heading1?)$/i.test(type) ? 'h1' : /^(subtitle|heading2|h3)$/i.test(type) ? 'h2' : /^(bullet|list|item)$/i.test(type) ? 'li' : 'p'
  const m = /^(#{1,3})\s+/.exec(t) || /^([-*•])\s+/.exec(t) || /^(>)\s*/.exec(t)
  if (m) { k = m[1] === '>' ? 'quote' : /^[-*•]$/.test(m[1]) ? 'li' : m[1].length === 1 ? 'h1' : 'h2'; t = t.slice(m[0].length) }
  return { type: k, text: k === 'p' || k === 'quote' ? t.trim() : t.replace(/\n+/g, ' ').trim() }
}
function mk(d, type, text, by) {
  d.seq = (d.seq || 0) + 1
  return { id: 'b' + d.seq, ...shape(d, type, text), by, last: by, at: now() }
}

export function newDoc({ kind, title, agent, by = 'me' }) {
  loadAll()
  const d = {
    id: id('dc'), kind: kind === 'slides' ? 'slides' : 'doc', title: String(title || '').trim().slice(0, 80) || (kind === 'slides' ? '未命名幻灯片' : '未命名文档'),
    agent: agentList().some((a) => a.id === agent) ? agent : MAIN, by, createdAt: now(), updatedAt: now(), rev: 0, seq: 0, blocks: [], gone: [], calls: [],
  }
  d.blocks.push(mk(d, d.kind === 'slides' ? 'slide' : 'p', '', by))
  all.set(d.id, d)
  changed(d)
  return d
}

// ---------- who is where ----------
const active = new Map()   // aid -> the doc that Bot is writing with you now
const focus = new Map()    // doc -> { block, at }: the paragraph your cursor is in
const lockOf = (did) => { const f = focus.get(did); return f && f.block && Date.now() - f.at < LOCK_MS ? f.block : '' }
const seen = new Map()     // `${aid}|${doc}` -> { title, texts: Map(block -> text) } as that Bot last saw it
function saw(aid, d) { seen.set(aid + '|' + d.id, { title: d.title, texts: new Map(d.blocks.map((b) => [b.id, b.text])) }) }
const who = (aid, by) => by === 'me' ? '用户' : by === aid ? '你' : agentById(by)?.name || '别的 Bot'
// what others changed since this Bot last looked, one line each
function since(aid, d) {
  const s = seen.get(aid + '|' + d.id); if (!s) return []
  const out = []
  if (s.title !== d.title) out.push(`- 用户把标题改成了《${d.title}》`)
  for (const b of d.blocks) {
    if (b.last === aid) continue
    if (!s.texts.has(b.id)) { if (b.text.trim()) out.push(`- ${who(aid, b.last)}新加了 [${b.id}]：“${clip(b.text)}”`) }
    else if (s.texts.get(b.id) !== b.text) out.push(`- ${who(aid, b.last)}把 [${b.id}] 改成了：“${clip(b.text)}”（原来是：“${clip(s.texts.get(b.id), 80)}”）`)
  }
  for (const g of d.gone || []) if (s.texts.has(g.id) && !d.blocks.some((b) => b.id === g.id) && g.by !== aid && s.texts.get(g.id).trim()) out.push(`- ${who(aid, g.by)}删掉了 [${g.id}]：“${clip(g.text, 80)}”`)
  return out
}
function gone(d, b, by) { (d.gone ||= []).push({ id: b.id, text: b.text, by, at: now() }); if (d.gone.length > 40) d.gone.splice(0, d.gone.length - 40) }

// the document as a Bot reads it
function view(aid, d, full = true) {
  const lock = lockOf(d.id), ch = since(aid, d)
  const l = [`《${d.title}》· ${words(d)} · id ${d.id} · ${d.blocks.filter((b) => b.text.trim()).length} ${unit(d)}`]
  if (lock) l.push(`用户的光标在 [${lock}]，这一${unit(d)}先别改。`)
  if (ch.length) l.push('你上次看过之后（以用户的为准，不要改回去）：', ...ch)
  if (full) {
    l.push(d.kind === 'slides' ? '全部（[页id] 谁写的：第一行是标题 / 后面是要点）：' : '全文（[段id] 类型·谁写的：内容）：')
    for (const b of d.blocks) {
      const by = who(aid, b.by) + (b.last !== b.by ? `，${who(aid, b.last)}改过` : '')
      l.push(d.kind === 'slides' ? `[${b.id}] ${by}：${b.text.split('\n').join(' / ') || '（空）'}` : `[${b.id}] ${NAME[b.type] || '正文'}·${by}：${b.text || '（空）'}`)
    }
  }
  saw(aid, d)
  return l.join('\n')
}
const docFor = (aid, did) => {
  const d = docOf(did || active.get(aid))
  if (!d) throw new Error(did ? `没有这份文档（${did}）。用 doc_open 新开一份。` : '现在没有和用户一起写的文档。先用 doc_open 打开一份。')
  active.set(aid, d.id)
  return d
}
const at = (d, after) => after === 'start' ? 0 : after ? d.blocks.findIndex((b) => b.id === after) + 1 : d.blocks.length

// ---------- what the Bot is writing right now (its tool call, while it streams) ----------
// A tolerant reading of JSON cut off mid-way: close what is open, drop a dangling key.
function partial(s) {
  const stack = []
  let str = false, bs = false
  for (const ch of s) {
    if (str) { if (bs) bs = false; else if (ch === '\\') bs = true; else if (ch === '"') str = false; continue }
    if (ch === '"') str = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let t = s
  if (str) { if (bs) t = t.slice(0, -1); t += '"' }
  const close = stack.reverse().join('')
  for (const c of [t, t.replace(/,\s*$/, ''), t.replace(/,?\s*"[^"]*"\s*:?\s*$/, ''), t.replace(/[,:]\s*$/, '')]) { try { return JSON.parse(c + close) } catch {} }
  return null
}
const live = new Map()    // aid -> { doc, op, after, block, blocks:[{type,text}] }
const liveT = new Map()
function pushLive(aid, now = false) {
  const go = () => { liveT.delete(aid); const l = live.get(aid); bus.push({ type: 'doc-live', agent: aid, live: l || null }) }
  if (now) { clearTimeout(liveT.get(aid)); return go() }
  if (!liveT.has(aid)) liveT.set(aid, setTimeout(go, 60))
}
function endLive(aid) { if (live.has(aid)) { live.delete(aid); pushLive(aid, true) } }
function onStream({ aid, name, args }) {
  if (name !== 'doc_write' && name !== 'doc_edit') return
  const a = partial(args); if (!a) return
  const d = docOf(a.id || active.get(aid)); if (!d) return
  if (name === 'doc_write') {
    const blocks = (Array.isArray(a.blocks) ? a.blocks : []).filter((b) => b && typeof b === 'object').map((b) => shape(d, String(b.type || ''), b.text))
    live.set(aid, { doc: d.id, op: 'write', after: typeof a.after === 'string' ? a.after : '', blocks })
  } else {
    if (typeof a.block !== 'string') return
    live.set(aid, { doc: d.id, op: 'edit', block: a.block, blocks: [shape(d, d.blocks.find((b) => b.id === a.block)?.type || 'p', a.text ?? '')] })
  }
  pushLive(aid)
}

// ---------- undo ----------
defineUndo('doc-unwrite', async ({ doc, ids }) => {
  const d = docOf(doc); if (!d) return '这份文档已经删掉了'
  const out = d.blocks.filter((x) => ids.includes(x.id))
  for (const b of out) gone(d, b, 'me')
  d.blocks = d.blocks.filter((b) => !ids.includes(b.id))
  if (!d.blocks.length) d.blocks.push(mk(d, d.kind === 'slides' ? 'slide' : 'p', '', 'me'))
  changed(d)
  return `已从《${d.title}》里撤回 ${out.length} ${unit(d)}`
})
defineUndo('doc-unedit', async ({ doc, block, before, after }) => {
  const d = docOf(doc); if (!d) return '这份文档已经删掉了'
  const b = d.blocks.find((x) => x.id === block)
  if (b) Object.assign(b, before)
  else d.blocks.splice(at(d, after), 0, { id: block, ...before })
  changed(d)
  return `已把《${d.title}》里那一${unit(d)}改回去`
})
defineUndo('doc-back', async ({ doc }) => {
  if (docOf(doc.id)) return '这份文档还在'
  all.set(doc.id, doc); changed(doc)
  return `已找回《${doc.title}》`
})

// ---------- 存成 Word / PPT ----------
function exportDoc(d) {
  const base = path.join(os.homedir(), 'Documents', '小天')
  fs.mkdirSync(base, { recursive: true })
  const ext = d.kind === 'slides' ? '.pptx' : '.docx'
  const name = d.title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || '未命名'
  let f = path.join(base, name + ext)
  for (let i = 2; fs.existsSync(f); i++) f = path.join(base, `${name} (${i})${ext}`)
  const blocks = d.blocks.filter((b) => b.text.trim())
  fs.writeFileSync(f, d.kind === 'slides' ? pptx(d.title, blocks) : docx(d.title, blocks))
  record({ tool: 'doc_export', agent: '', title: `把《${d.title}》存成了 ${d.kind === 'slides' ? 'PPT' : 'Word'}：${f}`, why: '你点了存成文件', detail: { doc: d.id }, undo: { kind: 'file-restore', data: { path: f, before: null }, label: '删掉这个文件' } })
  return f
}

// ---------- 续写提示: half a sentence more, where your cursor stopped ----------
async function suggest(d, b) {
  const before = d.blocks.slice(0, d.blocks.indexOf(b)).map((x) => x.text).filter(Boolean).join('\n').slice(-1200)
  const sys = '你是用户写文档时的搭档。用户正在写一段话，光标停在这段的末尾。接着他的最后一个字往下续写半句到一句（10 到 40 个字），语气、用词和上下文一致。只输出接下来的字：不重复已有的内容，不解释，不加引号。没把握就什么都不输出。'
  const out = await quick(sys, `文档《${d.title}》\n前文：\n${before || '（没有）'}\n\n正在写的这一段：\n${b.text}`, { max: 120, timeout: 20000 })
  let t = plainOf(out).replace(/^["“「]|["”」]$/g, '')
  if (t.startsWith(b.text)) t = t.slice(b.text.length)
  t = t.replace(/^[\s，,]+(?=\S)/, (m) => /[，,]/.test(m) && !/[，,。！？；：]$/.test(b.text) ? '，' : '')
  return t.length < 2 ? '' : t.slice(0, 60)
}

export const name = 'tianxi-cowrite'
export const inject = ['tools']

export function apply(ctx) {
  const reg = (t) => ctx.tools.register(defineTool({ output: T, ...t }))
  const aidOf = (exec) => bus.aidOf(exec?.agent) || MAIN
  const track = (d, exec) => { if (exec?.callId) { (d.calls ||= []).push(exec.callId); if (d.calls.length > 40) d.calls.splice(0, d.calls.length - 40) } }

  reg({
    name: 'doc_open',
    description: '在聊天右边打开一份和用户一起写的文档或幻灯片（同场共创）。用户要你写文档、方案、报告、总结、讲稿或做 PPT、幻灯片时，先用它打开，再用 doc_write 一节一节写进去，不要把长文写在聊天里。用户看得见你正在写的段落和光标，也能同时改。给 id 就重新打开那一份。',
    parameters: { title: { type: 'string', required: true, description: '文档或幻灯片的标题' }, kind: { type: 'string', enum: ['doc', 'slides'], description: 'doc 是文档（默认），slides 是幻灯片 / PPT' }, id: { type: 'string', description: '已有文档的 id，重新打开它' } },
    async execute(a, exec) {
      const aid = aidOf(exec)
      let d = a.id ? docOf(a.id) : null
      const fresh = !d
      if (!d) d = newDoc({ kind: a.kind, title: a.title, agent: aid, by: aid })
      active.set(aid, d.id); track(d, exec); changed(d)
      bus.push({ type: 'doc-open', id: d.id, agent: aid })
      if (fresh) { saw(aid, d); return `已在聊天右边打开${words(d)}《${d.title}》（id ${d.id}），现在是空的。用 doc_write 一节一节写进去：${d.kind === 'slides' ? '每次写一两页' : '每次写一节（一个小标题和它下面的一两段）'}，写完一节再写下一节。用户会边看边改，每次结果里会告诉你用户改了什么。` }
      return view(aid, d)
    },
  })
  reg({
    name: 'doc_read',
    description: '读一下和用户一起写的文档或幻灯片的最新内容：每一段的 id、类型、谁写的，用户的光标在哪一段，以及你上次看过之后用户改了什么。动手改之前先读。',
    parameters: { id: { type: 'string', description: '文档 id；不填就是现在开着的那份' } },
    async execute(a, exec) { const aid = aidOf(exec); return view(aid, docFor(aid, a.id)) },
  })
  reg({
    name: 'doc_write',
    description: '往和用户一起写的文档或幻灯片里写新内容。一次写一节（文档：一个小标题和它下面的一两段；幻灯片：一两页），写完一节再调用一次写下一节，用户能看着你一段段写出来。文档的 type：h1 标题、h2 小标题、p 正文、li 要点、quote 引用；不要在 text 里写 # 或 - 这类 Markdown 记号。幻灯片每个 block 是一页，type 填 slide，text 第一行是这一页的标题，后面每行一个要点（3 到 5 行，每行一句短话）。结果里会告诉你用户刚改了什么，以用户的为准。',
    parameters: {
      id: { type: 'string', description: '文档 id；不填就是现在开着的那份' },
      after: { type: 'string', description: '写在哪一段后面（段 id）；填 start 写在最前面；不填写在最后' },
      blocks: { type: 'array', required: true, items: { type: 'json' }, description: '[{"type":"h2","text":"一、背景"},{"type":"p","text":"……"}]' },
      reason: WHY,
    },
    async execute(a, exec) {
      const aid = aidOf(exec), d = docFor(aid, a.id)
      const items = (Array.isArray(a.blocks) ? a.blocks : []).filter((b) => b && typeof b === 'object' && String(b.text ?? '').trim())
      if (!items.length) { endLive(aid); return '没有写进去：blocks 是空的。' }
      let after = a.after && (a.after === 'start' || d.blocks.some((b) => b.id === a.after)) ? a.after : ''
      // a document that is still empty: what is written takes the empty line's place
      const lock = lockOf(d.id)
      if (d.blocks.every((b) => !b.text.trim() && b.id !== lock)) { d.blocks = []; after = '' }
      const add = items.map((b) => mk(d, String(b.type || ''), b.text, aid))
      d.blocks.splice(at(d, after), 0, ...add)
      track(d, exec); endLive(aid); changed(d, aid)
      const ids = add.map((b) => b.id)
      record({ tool: 'doc_write', title: `在《${d.title}》里写了 ${add.length} ${unit(d)}：“${clip(add[0].text.split('\n')[0], 24)}”${add.length > 1 ? '等' : ''}`, why: a.reason, detail: { doc: d.id, ids }, undo: { kind: 'doc-unwrite', data: { doc: d.id, ids }, label: '撤回这几' + unit(d) } })
      const ch = since(aid, d)
      saw(aid, d)
      return [`已写入 ${add.length} ${unit(d)}：${ids.map((x) => `[${x}]`).join(' ')}。`, ...(ch.length ? ['你写的时候用户改了这些（以用户的为准，后面接着写也照这个来）：', ...ch] : []), lockOf(d.id) ? `用户的光标在 [${lockOf(d.id)}]。` : ''].filter(Boolean).join('\n')
    },
  })
  reg({
    name: 'doc_edit',
    description: '改写和用户一起写的文档或幻灯片里的某一段（或某一页）；text 留空就是删掉这一段。用户的光标正在的那一段不能改，会告诉你等一等。改之前先 doc_read 看最新内容。',
    parameters: {
      id: { type: 'string', description: '文档 id；不填就是现在开着的那份' },
      block: { type: 'string', required: true, description: '段 id，比如 b3' },
      text: { type: 'string', required: true, description: '这一段的新内容；幻灯片是整页（第一行标题，后面每行一个要点）' },
      type: { type: 'string', description: '换成别的类型（h1 / h2 / p / li / quote），不填就不变' },
      reason: WHY,
    },
    async execute(a, exec) {
      const aid = aidOf(exec), d = docFor(aid, a.id)
      const i = d.blocks.findIndex((b) => b.id === a.block)
      if (i < 0) { endLive(aid); return `没有 [${a.block}] 这一${unit(d)}，可能被用户删掉了。先 doc_read 看看最新内容。` }
      if (lockOf(d.id) === a.block) {
        endLive(aid)
        bus.push({ type: 'doc-live', agent: aid, live: null, wait: { doc: d.id, block: a.block } })
        return `没改：用户正在改 [${a.block}]，这一${unit(d)}先别动。先写别的地方，等用户写完了再 doc_read 看一眼。`
      }
      const b = d.blocks[i], before = { type: b.type, text: b.text, by: b.by, last: b.last, at: b.at }
      // what someone else wrote since this Bot last looked is not written over unseen
      const s = seen.get(aid + '|' + d.id)
      if (!s) { endLive(aid); return '没改：你还没看过这份' + words(d) + '。下面是最新内容，看完再改：\n' + view(aid, d) }
      if (b.last !== aid && s.texts.get(b.id) !== b.text) {
        endLive(aid); s.texts.set(b.id, b.text)
        return `没改：${who(aid, b.last)}刚改过 [${b.id}]，你还没看过。现在是：“${b.text}”。在这个基础上想好再改。`
      }
      const text = String(a.text ?? '')
      if (!text.trim()) {
        gone(d, b, aid); d.blocks.splice(i, 1)
        if (!d.blocks.length) d.blocks.push(mk(d, d.kind === 'slides' ? 'slide' : 'p', '', 'me'))
        record({ tool: 'doc_edit', title: `删掉了《${d.title}》里的一${unit(d)}：“${clip(before.text, 24)}”`, why: a.reason, detail: { doc: d.id, ids: [b.id] }, undo: { kind: 'doc-unedit', data: { doc: d.id, block: b.id, before, after: d.blocks[i - 1]?.id || 'start' }, label: '恢复' } })
      } else {
        Object.assign(b, shape(d, a.type || b.type, text), { last: aid, at: now() })
        record({ tool: 'doc_edit', title: `改了《${d.title}》的一${unit(d)}：“${clip(before.text, 20)}” → “${clip(b.text, 20)}”`, why: a.reason, detail: { doc: d.id, ids: [b.id] }, undo: { kind: 'doc-unedit', data: { doc: d.id, block: b.id, before }, label: '改回去' } })
      }
      track(d, exec); endLive(aid); changed(d, aid)
      const ch = since(aid, d)
      saw(aid, d)
      return [`已${text.trim() ? '改好' : '删掉'} [${a.block}]。`, ...(ch.length ? ['用户在这期间改了这些（以用户的为准）：', ...ch] : [])].join('\n')
    },
  })

  // what the Bot is about to write, as it streams; gone when the call ends or the turn does
  ctx.effect(() => { bus.toolStream.add(onStream); return () => bus.toolStream.delete(onStream) })
  ctx.effect(() => { const f = ({ aid }) => endLive(aid); bus.turnEnd.add(f); return () => bus.turnEnd.delete(f) })
  ctx.on('tools/result', (exec) => { if (/^doc_/.test(exec.name)) endLive(bus.aidOf(exec.agent) || MAIN) })
  ctx.effect(() => () => flush())

  // a message sent while a document is open beside the chat says so to the Bot (you only see what you typed)
  bus.sayNote = (b) => {
    const d = b.doc && docOf(b.doc); if (!d) return ''
    const aid = agentList().some((a) => a.id === b.agent) ? b.agent : MAIN
    active.set(aid, d.id)
    return `\n\n（用户旁边开着和你一起写的${words(d)}《${d.title}》，id ${d.id}，${d.blocks.filter((x) => x.text.trim()).length} ${unit(d)}${lockOf(d.id) ? `，光标在 [${lockOf(d.id)}]` : ''}。用户说的“这里、这段、上面、下一页”多半指它；要动它先用 doc_read 看最新内容，再用 doc_write / doc_edit 写在里面。）`
  }
  bus.state.set('docs', () => docs().sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).slice(0, 60).map(meta))

  const mine = (b) => { const d = docOf(b.id); if (!d) throw new Error('这份文档已经不在了'); return d }
  const blockOf = (d, bid) => { const b = d.blocks.find((x) => x.id === bid); if (!b) throw new Error('这一段已经不在了'); return b }
  const touch = (d, bid) => focus.set(d.id, { block: bid, at: Date.now() })
  const by = (b) => { b.last = 'me'; b.at = now() }
  Object.assign(bus.routes, {
    'POST /api/doc/new': async (b) => { const d = newDoc({ kind: b.kind, title: b.title, agent: b.agent }); active.set(d.agent, d.id); return { ok: true, doc: d } },
    'POST /api/doc/get': async (b) => ({ ok: true, doc: mine(b), live: [...live.entries()].filter(([, l]) => l.doc === b.id).map(([agent, l]) => ({ agent, ...l })) }),
    'POST /api/doc/active': async (b) => { const d = mine(b); active.set(d.agent, d.id); return { ok: true } },
    'POST /api/doc/title': async (b) => { const d = mine(b); const t = String(b.title || '').trim().slice(0, 80); if (t && t !== d.title) { d.title = t; changed(d, 'me') } return { ok: true } },
    'POST /api/doc/focus': async (b) => { const d = mine(b); if (b.block) touch(d, String(b.block)); else focus.delete(d.id); return { ok: true } },
    // your typing in one paragraph (and turning it into a heading or a point)
    'POST /api/doc/edit': async (b) => {
      const d = mine(b), x = blockOf(d, b.block)
      const s = b.type ? shape(d, b.type, b.text) : { type: x.type, text: String(b.text ?? '').replace(/\r/g, '').slice(0, 6000) }
      if (x.text !== s.text || x.type !== s.type) { Object.assign(x, s); by(x); changed(d, 'me') }
      touch(d, x.id)
      return { ok: true }
    },
    // Enter: the paragraph splits where the cursor is
    'POST /api/doc/split': async (b) => {
      const d = mine(b), x = blockOf(d, b.block), t = String(b.text ?? x.text), k = Math.max(0, Math.min(t.length, +b.at || 0))
      x.text = t.slice(0, k); by(x)
      const n = mk(d, d.kind === 'slides' ? 'slide' : x.type === 'li' ? 'li' : 'p', t.slice(k), 'me')
      d.blocks.splice(d.blocks.indexOf(x) + 1, 0, n)
      touch(d, n.id); changed(d, 'me')
      return { ok: true, id: n.id }
    },
    // Backspace at the start: it joins the one above
    'POST /api/doc/merge': async (b) => {
      const d = mine(b), x = blockOf(d, b.block), i = d.blocks.indexOf(x)
      if (i === 0) return { ok: false }
      const p = d.blocks[i - 1], k = p.text.length
      p.text += String(b.text ?? x.text); by(p)
      gone(d, x, 'me'); d.blocks.splice(i, 1)
      touch(d, p.id); changed(d, 'me')
      return { ok: true, into: p.id, at: k }
    },
    // pasted lines, or a new slide
    'POST /api/doc/insert': async (b) => {
      const d = mine(b)
      const lines = (Array.isArray(b.lines) ? b.lines : ['']).map(String).slice(0, 200)
      const add = lines.map((t) => mk(d, d.kind === 'slides' ? 'slide' : b.type || 'p', t, 'me'))
      d.blocks.splice(at(d, b.after || ''), 0, ...add)
      touch(d, add[add.length - 1].id); changed(d, 'me')
      return { ok: true, ids: add.map((x) => x.id) }
    },
    'POST /api/doc/drop': async (b) => {
      const d = mine(b), x = blockOf(d, b.block)
      gone(d, x, 'me'); d.blocks.splice(d.blocks.indexOf(x), 1)
      if (!d.blocks.length) d.blocks.push(mk(d, d.kind === 'slides' ? 'slide' : 'p', '', 'me'))
      changed(d, 'me')
      return { ok: true }
    },
    'POST /api/doc/suggest': async (b) => {
      const d = mine(b), x = blockOf(d, b.block)
      if ([...live.values()].some((l) => l.doc === d.id) || x.text.trim().length < 4) return { ok: true, text: '' }
      return { ok: true, text: await suggest(d, x) }
    },
    'POST /api/doc/export': async (b) => ({ ok: true, path: exportDoc(mine(b)) }),
    'POST /api/doc/remove': async (b) => {
      const d = mine(b)
      all.delete(d.id); write(d.id); focus.delete(d.id)
      for (const [aid, did] of active) if (did === d.id) active.delete(aid)
      record({ tool: 'doc_remove', agent: '', title: `删掉了${words(d)}《${d.title}》`, why: '你在文档列表里删的', undo: { kind: 'doc-back', data: { doc: d }, label: '找回来' } })
      bus.push({ type: 'doc-gone', id: d.id })
      return { ok: true }
    },
  })
}
