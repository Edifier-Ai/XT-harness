// 拖给小天: something dragged onto the desktop 小天 (files, a picture, some text, a link), or the window 小天 itself was
// dragged onto (a picture of that window). The Bot it was given to first looks at it, only looking, and offers two or
// three things to do with it, drawn from what it saw; picking one runs it in that Bot's chat like anything you ask
// there. Nothing is offered that the thing itself does not suggest, and no one is named who is not a Bot or in memory.
import fs from 'node:fs'
import path from 'node:path'
import { HOME, id, now, bus, agentList, agentById, jsonOf, plainOf, fileFact, MAIN } from './store.js'
import { keepLooking } from './ledger.js'
import { memories } from './memory.js'

const DIR = path.join(HOME, 'drops')
const drops = new Map()   // id -> what was given, the last few
const KIND = { img: '图片', doc: '文档', xls: '表格', ppt: '演示文稿', pdf: 'PDF', zip: '压缩包', dir: '文件夹' }
const size = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'
const pub = ({ id, to, state, say, actions, err, at }) => ({ id, to, state, say, actions, err, at })
function set(did, patch) {
  const d = drops.get(did); if (!d) return
  Object.assign(d, patch)
  bus.push({ type: 'drop', drop: pub(d) })
}

// a picture dragged out of a web page has no file behind it: its bytes are kept here
function keep(up) {
  fs.mkdirSync(DIR, { recursive: true })
  const name = path.basename(String(up?.name || 'drop')).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'drop'
  let f = path.join(DIR, `${Date.now().toString(36)}-${name}`)
  fs.writeFileSync(f, Buffer.from(String(up?.b64 || ''), 'base64'))
  const x = fileFact(f)
  if (x.kind === 'img' && !path.extname(f)) { fs.renameSync(f, f + '.' + x.ext); f += '.' + x.ext }
  return f
}

/** What was given, one line each, as the Bot is told it. */
function lines(d) {
  const l = []
  for (const p of d.files) {
    const x = fileFact(p)
    l.push(`- ${KIND[x.kind] || '文件'}：${x.path}${!x.exists ? '（找不到这个文件）' : x.kind === 'dir' ? '' : `（${size(x.size)}）`}`)
  }
  if (d.shot) l.push(`- 窗口截图：${d.shot}（${d.window?.app ? d.window.app + ' 的窗口' : '一个窗口'}${d.window?.title ? '「' + d.window.title + '」' : ''}，刚截的）`)
  if (d.url) l.push(`- 链接：${d.url}`)
  if (d.text) l.push(`- 一段文字：\n「${d.text}」`)
  return l.join('\n')
}

function prompt(d) {
  const me = agentById(d.to)
  const bots = agentList().filter((a) => !a.id.startsWith('_') && a.id !== d.to).map((a) => `${a.name}（${a.role || '助手'}）`)
  const people = memories().filter((m) => m.kind === '人物').slice(-12).map((m) => String(m.text).slice(0, 60))
  return [
    `【拖给你】用户刚把东西拖到桌面上的小天身上，交给你（${me.name}）：`,
    lines(d),
    '',
    '先看一眼它是什么：图片和截图用 read_image 看，文件用 read 读开头一部分，链接用 web_fetch 打开。这一步只能看，不能改动任何东西。',
    '然后想 2 到 3 件用户此刻最可能想让你拿它做的事，要具体到这个东西本身（比如“把表里三家的报价比一比”，而不是“处理文件”）。',
    '只用一个 JSON 回答，不要别的文字：{"say":"一句话说你看到了什么，30 字以内","actions":[{"label":"按钮上的字，2 到 8 个字","ask":"选了它之后你要做的事，写成用户对你说的一句话"}]}',
    `只根据你实际看到的内容提建议；没看成就在 say 里直说，actions 可以少于 2 个。要说“交给谁、发给谁”时，只能是这些 Bot：${bots.join('、') || '（没有别的 Bot）'}${people.length ? `，或你记得的这些人：${people.join('；')}` : ''}。不要编出别的人。`,
  ].join('\n')
}

async function look(d) {
  let reply = ''
  try { reply = await bus.say(prompt(d), { agent: d.to, kind: 'drop' }) } catch (e) { return set(d.id, { state: 'failed', err: e.message }) }
  const j = jsonOf(reply)
  const actions = (Array.isArray(j?.actions) ? j.actions : [])
    .map((a) => ({ label: plainOf(a?.label).replace(/["“”「」]/g, '').slice(0, 12), ask: plainOf(a?.ask).slice(0, 400) }))
    .filter((a) => a.label && a.ask).slice(0, 3)
  const say = plainOf(j ? j.say : reply).slice(0, 80)
  if (!say && !actions.length) return set(d.id, { state: 'failed', err: '没看明白，换个方式再给我一次' })
  set(d.id, { state: 'ready', say: say || '你想让我拿它做什么？', actions })
}

// what goes into the chat box when you would rather say it yourself
function draft(d) {
  if (d.files.length) return `关于${d.files.length > 1 ? '这些文件' : '这个文件'} ${d.files.join('、')}：`
  if (d.shot) return `关于这张截图 ${d.shot}${d.window?.title ? `（「${d.window.title}」）` : ''}：`
  if (d.url) return `关于 ${d.url}：`
  return `关于这段文字「${d.text.slice(0, 300)}」：`
}

export const name = 'tianxi-drop'

export function apply(ctx) {
  // while it looks at what it was given, a Bot only looks
  ctx.effect(() => keepLooking((aid) => bus.kindNow(aid) === 'drop' ? '你在看用户拖给你的东西，这时只能看，不能改任何东西。' : ''))
  Object.assign(bus.routes, {
    'POST /api/drop': async (b) => {
      const to = agentList().some((a) => a.id === b.to && !a.id.startsWith('_')) ? b.to : MAIN
      const files = (Array.isArray(b.files) ? b.files : []).map(String).filter(Boolean).slice(0, 10)
      for (const u of (Array.isArray(b.uploads) ? b.uploads : []).slice(0, 5)) files.push(keep(u))
      const s = b.shot ? fileFact(b.shot) : null
      const d = {
        id: id('dp'), to, files, shot: s?.exists ? s.path : '', at: now(), state: 'looking',
        window: b.window ? { app: String(b.window.app || '').slice(0, 60), title: String(b.window.title || '').slice(0, 120) } : null,
        text: String(b.text || '').trim().slice(0, 4000), url: String(b.url || '').trim().slice(0, 1000),
      }
      if (!d.files.length && !d.shot && !d.text && !d.url) throw new Error('这个拖不进来，换成文件、文字或图片试试')
      drops.set(d.id, d); if (drops.size > 20) drops.delete(drops.keys().next().value)
      look(d).catch((e) => { console.error('[tianxi] drop', e); set(d.id, { state: 'failed', err: e.message }) })
      return { ok: true, id: d.id }
    },
    // i: which thing it offered; 'chat' to say it yourself in that Bot's chat; 'close' when you let it go
    'POST /api/drop/do': async (b) => {
      const d = drops.get(b.id); if (!d) throw new Error('这次拖进来的东西已经过期了，再拖一次吧')
      if (b.i === 'close') { d.state = 'closed'; return { ok: true } }
      if (b.i === 'chat') { d.state = 'chat'; return { ok: true, go: { view: 'chat', arg: d.to, draft: draft(d) } } }
      const a = d.actions?.[+b.i]; if (!a) throw new Error('没有这个选项')
      d.state = 'done'
      bus.say(`${a.ask}\n\n（这是我拖给你的：\n${lines(d)}）`, { agent: d.to, display: `拖给${agentById(d.to).name}：${a.label}` }).catch((e) => console.error('[tianxi] drop do', e))
      return { ok: true }
    },
  })
}
