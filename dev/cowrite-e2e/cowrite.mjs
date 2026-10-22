// 同场共创, end to end in Chrome against dev/phone-e2e/host.mjs (the 小天 runtime with the scripted model, which
// streams the doc tools' arguments a few characters at a time). You and 小天 write in the same document at once:
// its paragraph grows with its cursor, your edit made meanwhile reaches it, the paragraph you are in is yours, its
// changes can be taken back, 续写提示, Markdown marks, a deck that plays, and real .docx / .pptx files.
// Writes NN-name.png and results.json. Usage: node dev/cowrite-e2e/cowrite.mjs <out dir> <chrome path>
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OUT = path.resolve(process.argv[2] || 'shots-cowrite')
const exe = process.argv[3] || process.env.CHROME
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:3090', T = 'e2etoken'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (p, body) => (await fetch(`${BASE}/api/${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-tianxi-token': T }, body: body ? JSON.stringify(body) : undefined })).json()
const results = []
const check = (ok, what, x) => { results.push({ ok: !!ok, what, ...(x !== undefined ? { x } : {}) }); console.log(ok ? 'PASS' : 'FAIL', what, x === undefined ? '' : JSON.stringify(x).slice(0, 300)) }
async function until(fn, ms = 20000, every = 120) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v } catch {} if (Date.now() - t > ms) return null; await sleep(every) } }
let n = 0
const shot = async (pg, name, wait = 350) => { await sleep(wait); await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) }) }
const BRIDGE = () => {
  window.__opened = []
  const own = { platform: 'win32', getConfig: async () => ({ configured: true }), updateStatus: async () => ({}), phoneState: async () => ({ on: false, devices: [] }), openFile: async (p) => { window.__opened.push(p) } }
  window.tianxiApp = new Proxy(own, { get: (t, k) => k in t ? t[k] : () => Promise.resolve(null) })
  localStorage.setItem('tx.tourSeen', 'true'); localStorage.setItem('tx.theme', '"dark"')
}
const DOCS = path.join(os.homedir(), 'Documents', '小天')

async function main() {
  fs.rmSync(DOCS, { recursive: true, force: true })
  const b = await chromium.launch(exe ? { executablePath: exe } : {})
  const ctx = await b.newContext({ viewport: { width: 1600, height: 980 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(BRIDGE)
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', (e) => errs.push(e.message))
  await pg.goto(`${BASE}/?t=${T}`)
  await pg.waitForSelector('#inp')
  await sleep(1500)
  const say = async (t) => { await pg.click('#inp'); await pg.fill('#inp', t); await pg.keyboard.press('Enter') }
  const docNow = async () => { const id = await pg.evaluate(() => window.deskDoc()); return id ? (await api('doc/get', { id })).doc : null }
  const reply = () => pg.evaluate(() => [...document.querySelectorAll('#msgs .aw')].map((x) => x.innerText).pop() || '')
  const idle = () => until(async () => (await api('state')).agentStatus.tianxi === 'idle', 30000)

  // ---------- 小天 opens a document beside the chat and writes it while you watch ----------
  await say('帮我写一份华南市场推广方案')
  check(await until(() => pg.evaluate(() => document.getElementById('app').classList.contains('deskon')), 20000), 'the document opens beside the chat')
  check(await pg.inputValue('#dkTitle') === '华南市场推广方案', 'with the title 小天 gave it', await pg.inputValue('#dkTitle'))
  // its paragraph grows, with its cursor and name
  const g1 = await until(() => pg.evaluate(() => { const l = document.querySelector('#dkPaper .blk.live'); return l && l.querySelector('.cur b')?.textContent === '小天' ? l.innerText.length : 0 }), 15000, 30)
  check(g1, 'a paragraph appears as 小天 writes it, with its cursor', g1)
  await sleep(250)
  const g2 = await pg.evaluate(() => [...document.querySelectorAll('#dkPaper .blk.live')].map((x) => x.innerText).join('').length)
  check(g2 > 0, 'and keeps growing', { g1, g2 })
  await shot(pg, 'xiaotian-writing', 0)
  check(/小天正在写/.test(await pg.innerText('#dkWho')), 'the top says 小天 is writing', await pg.innerText('#dkWho'))
  check(/小天正在写第/.test(await pg.innerText('#dkF')), 'the status line says which paragraph', await pg.innerText('#dkF'))
  check(await pg.locator('#msgs .dkcard').count() === 1, 'the chat shows the document as a card')

  // ---------- you fix its first section while it writes the second ----------
  const firstDone = await until(async () => { const d = await docNow(); return d && d.blocks.length >= 3 && d.blocks.find((x) => /华东/.test(x.text)) }, 20000, 60)
  check(firstDone, 'the first section is in', firstDone && firstDone.text)
  const pid = firstDone && firstDone.id
  check(await pg.locator('#dkPaper .blk.t-h1').count() === 1 && await pg.locator('#dkPaper .blk.t-h2').count() >= 1, 'a title and a section heading', await pg.evaluate(() => [...document.querySelectorAll('#dkPaper .blk')].map((x) => x.className)))
  const live2 = await until(() => pg.evaluate(() => !!document.querySelector('#dkPaper .blk.live')), 8000, 30)
  check(live2, '小天 starts the second section')
  // select 华东的上海、杭州 in its paragraph and type over it
  await pg.evaluate((id) => {
    const bx = document.querySelector(`#dkPaper [data-id="${id}"] .bx`); bx.focus()
    const t = bx.firstChild, i = t.textContent.indexOf('华东的上海、杭州')
    const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + '华东的上海、杭州'.length)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
  }, pid)
  await pg.keyboard.type('华南的深圳、广州', { delay: 25 })
  const both = await pg.evaluate((id) => ({ mine: document.activeElement?.closest('[data-id]')?.dataset.id === id, its: !!document.querySelector('#dkPaper .blk.live .cur') }), pid)
  check(both.mine && both.its, 'two cursors at once: yours in its first section, its in the second', both)
  await shot(pg, 'two-cursors', 50)
  await idle()
  await sleep(600)
  const r1 = await reply()
  check(/看到你把 b\d+ 改成了“[^”]*华南的深圳、广州/.test(r1), 'your edit made while it wrote reached 小天 (in its next tool result)', r1)
  const d1 = await docNow()
  check(d1.blocks.find((x) => x.id === pid)?.text.includes('华南的深圳、广州'), 'what you typed is kept, not written over', d1.blocks.find((x) => x.id === pid)?.text)
  check(d1.blocks.length === 8 && d1.blocks.filter((x) => x.type === 'li').length === 3, 'all of it is in: 8 paragraphs, 3 points', d1.blocks.map((x) => x.type))
  await pg.click('#dkTitle'); await pg.click('.dk-tb'); await sleep(400)
  // who wrote what
  const mk = await pg.evaluate((id) => document.querySelector(`#dkPaper [data-id="${id}"] .mk`).dataset.t, pid)
  check(mk === '小天写的，你改过', 'the margin says who wrote it and who changed it', mk)
  check(/撤回|改回去/.test(await pg.innerText('#dkF')), 'the status line offers to take back what 小天 just wrote', await pg.innerText('#dkF'))
  await pg.hover(`#dkPaper [data-id="${pid}"]`)
  await shot(pg, 'written-marks')

  // ---------- the paragraph you are in is yours: 小天 waits ----------
  await pg.evaluate((id) => { const bx = document.querySelector(`#dkPaper [data-id="${id}"] .bx`); bx.focus(); const s = getSelection(); s.selectAllChildren(bx); s.collapseToEnd() }, pid)
  await pg.keyboard.press('Backspace'); await pg.keyboard.type('。')
  await sleep(500)
  await api('say', { text: '把为什么是华南那段改短一点', agent: 'tianxi', doc: d1.id })
  await idle(); await sleep(500)
  const r2 = await reply()
  check(/你正在改这一段，我先不动/.test(r2), 'asked to change the paragraph you are in, 小天 does not', r2)
  check(await pg.evaluate((id) => document.querySelector(`#dkPaper [data-id="${id}"]`).dataset.wait || '', pid) === '小天想改这段，等你写完', 'the paragraph says 小天 is waiting for you', await pg.evaluate((id) => document.querySelector(`#dkPaper [data-id="${id}"]`).dataset.wait || '', pid))
  await shot(pg, 'xiaotian-waits')
  const d2 = await docNow()
  check(d2.blocks.find((x) => x.id === pid).text.endsWith('广州两座城市试点，看渠道和用户的反馈，再决定要不要铺到更多城市。'), 'your paragraph is untouched', d2.blocks.find((x) => x.id === pid).text)
  // you leave it: now it may
  await pg.click('.dk-tb'); await sleep(700)
  await api('say', { text: '把为什么是华南那段改短一点', agent: 'tianxi', doc: d1.id })
  await idle(); await sleep(500)
  check(/改短了/.test(await reply()), 'once you leave it, 小天 changes it', await reply())
  const d3 = await docNow()
  check(d3.blocks.find((x) => x.id === pid).text === '先在两座城市试点，看反馈再决定要不要扩大。', 'the new text is in the document', d3.blocks.find((x) => x.id === pid).text)
  check(await until(() => pg.evaluate((id) => document.querySelector(`#dkPaper [data-id="${id}"] .bx`).innerText === '先在两座城市试点，看反馈再决定要不要扩大。', pid)), 'and on the page')
  // 撤回 from the status line
  await until(() => pg.evaluate(() => !!document.querySelector('#dkF [data-act=undo]')), 8000)
  await pg.click('#dkF [data-act=undo]')
  const back = await until(async () => (await docNow()).blocks.find((x) => x.id === pid).text.includes('华南的深圳、广州'), 8000)
  check(back, '撤回 puts your words back', (await docNow()).blocks.find((x) => x.id === pid).text)

  // ---------- your own writing: Enter, Markdown marks, 续写提示 ----------
  await pg.evaluate((id) => { const bx = document.querySelector(`#dkPaper [data-id="${id}"] .bx`); bx.focus(); const s = getSelection(); s.selectAllChildren(bx); s.collapseToEnd() }, pid)
  await pg.keyboard.press('Enter')
  const nb = await until(() => pg.evaluate((id) => { const a = document.activeElement?.closest('[data-id]'); return a && a.dataset.id !== id ? a.dataset.id : '' }, pid), 5000)
  check(nb, 'Enter starts a new paragraph under it, with the cursor there', nb)
  await pg.keyboard.type('最后，试点的结果要拿数据说话，再决定', { delay: 15 })
  const gh = await until(() => pg.evaluate(() => document.activeElement?.dataset.ghost || ''), 12000)
  check(gh === '要不要铺到更多城市。', 'when you stop, 小天 offers the rest of the sentence after your cursor', gh)
  check(/Tab/.test(await pg.innerText('#dkF')), 'the status line says Tab takes it', await pg.innerText('#dkF'))
  await shot(pg, 'ghost-suggestion', 100)
  await pg.keyboard.press('Tab')
  const took = await until(async () => (await docNow()).blocks.find((x) => x.id === nb)?.text === '最后，试点的结果要拿数据说话，再决定要不要铺到更多城市。', 5000)
  check(took, 'Tab takes it into your paragraph', (await docNow()).blocks.find((x) => x.id === nb)?.text)
  await pg.keyboard.press('Enter')
  await sleep(300)
  await pg.keyboard.type('## 三、风险', { delay: 20 })
  const h2 = await until(async () => { const d = await docNow(); const x = d.blocks[d.blocks.findIndex((y) => y.id === nb) + 1]; return x && x.type === 'h2' && x.text === '三、风险' && x }, 5000)
  check(h2, '“## ” at the start makes a heading', h2)
  check(await pg.evaluate(() => document.activeElement?.closest('.blk')?.classList.contains('t-h2')), 'and it looks like one')
  // Backspace at the start of an empty paragraph joins it to the one above
  await pg.keyboard.press('Enter'); await sleep(300)
  const before = (await docNow()).blocks.length
  await pg.keyboard.press('Backspace')
  check(await until(async () => (await docNow()).blocks.length === before - 1, 5000), 'Backspace on an empty paragraph removes it')

  // ---------- 存成 Word ----------
  await pg.click('[data-act=dk-export]')
  const docxPath = path.join(DOCS, '华南市场推广方案.docx')
  check(await until(() => fs.existsSync(docxPath), 8000), 'a .docx is saved under 文档/小天', docxPath)
  await until(() => pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /存好了/.test(t.innerText))), 5000)
  await pg.evaluate(() => [...document.querySelectorAll('.toast button')].find((x) => x.textContent === '打开')?.click())
  check(await until(() => pg.evaluate(() => window.__opened[0] || '')) === docxPath, '“打开” opens it with its app', await pg.evaluate(() => window.__opened))
  check((await api('state')).ledger.some((e) => e.tool === 'doc_export' && e.undo), 'saving it is in 操作记录 and can be taken back')

  // ---------- a deck: written live, edited, played, saved as .pptx ----------
  await say('做一份介绍小天 Bot 的三页幻灯片')
  const sl = await until(() => pg.evaluate(() => document.querySelector('#dkPaper .sl.live .cur') ? document.querySelectorAll('#dkPaper .sl').length : 0), 20000, 30)
  check(sl, 'the deck opens and its slides appear as 小天 writes them', sl)
  check(await pg.inputValue('#dkTitle') === '认识小天 Bot', 'the pane now shows the deck', await pg.inputValue('#dkTitle'))
  const pillNow = () => pg.evaluate(() => { const e = document.querySelector('#dkWho .pz.bot em'); return e ? { t: e.textContent, o: +getComputedStyle(e).opacity } : null })
  await until(async () => (await pillNow())?.o > 0.9, 800, 30)
  const pill = await pillNow()
  check(pill && /小天正在写/.test(pill.t) && pill.o > 0.9, 'the header says 小天 is writing, and it stays readable', pill)
  await shot(pg, 'deck-writing', 0)
  await idle(); await sleep(600)
  check(!(await pg.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /里写了/.test(t.textContent)))), 'no toast for what is written in the open pane: its footer says it')
  check(await pg.locator('#dkPaper .sl').count() === 3, 'three slides', await pg.locator('#dkPaper .sl').count())
  check(await pg.evaluate(() => document.querySelector('#dkPaper .sl').classList.contains('cover')), 'the first one is a cover')
  check(await pg.evaluate(() => document.querySelectorAll('#dkPaper .sl')[1].querySelectorAll('.spt').length) === 3, 'the second has its three points as bullets')
  // change the second slide's title
  await pg.click('#dkPaper .sl:nth-child(2) .sl-t')
  await pg.keyboard.press('End'); await pg.keyboard.type('？')
  check(await until(async () => (await docNow()).blocks[1].text.startsWith('它能做什么？\n管日程'), 5000), 'you can edit a slide’s title in place', (await docNow()).blocks[1].text)
  await pg.click('.dk-tb'); await sleep(500)
  await shot(pg, 'deck')
  await pg.click('[data-act=dk-play]')
  check(await until(() => pg.evaluate(() => !!document.querySelector('.dk-show .sh-pg.cover'))), '放映 shows the deck full screen, from the cover')
  await pg.keyboard.press('ArrowRight')
  check(await until(() => pg.evaluate(() => document.querySelector('.dk-show .sh-n')?.textContent === '2 / 3')), 'the arrow keys turn the page')
  await shot(pg, 'deck-playing')
  await pg.keyboard.press('Escape')
  check(await until(() => pg.evaluate(() => !document.querySelector('.dk-show'))), 'Esc ends it')
  await pg.click('[data-act=dk-export]')
  const pptxPath = path.join(DOCS, '认识小天 Bot.pptx')
  check(await until(() => fs.existsSync(pptxPath), 8000), 'a .pptx is saved', pptxPath)

  // ---------- the list of documents, a new one from the + menu, 资料库, closing ----------
  await pg.click('[data-act=dk-list]')
  const rows = await pg.evaluate(() => [...document.querySelectorAll('#dkMenu .row span')].map((x) => x.textContent))
  check(rows.length === 2 && rows.includes('华南市场推广方案'), 'the list shows what you wrote with 小天', rows)
  await pg.click('#dkMenu .row [data-act=dk-open] >> text=华南市场推广方案')
  check(await until(async () => await pg.inputValue('#dkTitle') === '华南市场推广方案'), 'and opens one again')
  await pg.click('#bPlus'); await pg.click('#bDoc')
  check(await until(async () => await pg.inputValue('#dkTitle') === '未命名文档'), '+ → 一起写文档 opens a new one')
  check(await pg.evaluate(() => document.activeElement?.id) === 'dkTitle', 'with its title ready to type')
  await pg.keyboard.type('周会纪要'); await pg.keyboard.press('Enter')
  await pg.keyboard.type('今天定了试点城市。', { delay: 15 })
  const nd = await until(async () => { const d = await docNow(); return d.title === '周会纪要' && d.blocks[0].text === '今天定了试点城市。' && d }, 6000)
  check(nd, 'you write in it straight away', nd && { title: nd.title, text: nd.blocks[0].text })
  await pg.click('[data-act=dk-close]')
  check(await until(() => pg.evaluate(() => !document.getElementById('app').classList.contains('deskon'))), '× puts it away')
  // putting the pane away brings back the side panel if it was open before
  if (!(await pg.evaluate(() => document.getElementById('app').classList.contains('procon')))) await pg.click('[data-act=panel-toggle]')
  await sleep(300)
  await pg.click('[data-act=ptab][data-t=files]'); await sleep(300)
  const lib = await pg.evaluate(() => [...document.querySelectorAll('.pcont .lib .li')].map((x) => x.innerText))
  check(lib.length === 3 && lib.some((x) => /华南市场推广方案/.test(x)) && lib.some((x) => /认识小天 Bot/.test(x)) && lib.some((x) => /周会纪要/.test(x)), '资料库 lists the documents written together, once each', lib)
  await pg.click('#msgs .dkcard >> nth=0')
  check(await until(() => pg.evaluate(() => document.getElementById('app').classList.contains('deskon') && !document.getElementById('app').classList.contains('procon'))), 'the card in the chat opens it again, in place of the side panel')

  // light theme
  await pg.evaluate(() => document.querySelector('[data-act="theme-flip"]').click())
  await sleep(1200); await shot(pg, 'light', 1000)
  await pg.evaluate(() => document.querySelector('[data-act="theme-flip"]').click())

  check(!errs.length, 'no page errors', errs)
  await b.close()
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} passed`)
  process.exit(bad.length ? 1 : 0)
}
main().catch((e) => { console.error(e); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1)); process.exit(1) })
