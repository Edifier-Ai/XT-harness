// 一群 Bot (试用期 · 圆桌 · Bot 动态), end to end in Chrome against dev/phone-e2e/host.mjs (the 小天 runtime with the
// scripted model, FAKE_DIR holding a few files to tidy). Writes NN-name.png (dark, then light) and results.json.
// Usage: node dev/bots-e2e/bots.mjs <out dir> <chrome path> <FAKE_DIR>
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(process.argv[2] || 'shots-bots')
const exe = process.argv[3] || process.env.CHROME
const DL = process.argv[4] || process.env.FAKE_DIR
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:3090', T = 'e2etoken'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (p, body) => (await fetch(`${BASE}/api/${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-tianxi-token': T }, body: body ? JSON.stringify(body) : undefined })).json()
const results = []
const check = (ok, what, x) => { results.push({ ok: !!ok, what, ...(x !== undefined ? { x } : {}) }); console.log(ok ? 'PASS' : 'FAIL', what, x === undefined ? '' : JSON.stringify(x).slice(0, 300)) }
async function until(fn, ms = 20000) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v } catch {} if (Date.now() - t > ms) return null; await sleep(250) } }
let n = 0
const shot = async (pg, name) => { await sleep(500); await pg.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) }) }
const state = () => api('state')

const BRIDGE = () => {
  const own = { platform: 'win32', getConfig: async () => ({ configured: true }), updateStatus: async () => ({}), phoneState: async () => ({ on: false, devices: [] }) }
  window.tianxiApp = new Proxy(own, { get: (t, k) => k in t ? t[k] : () => Promise.resolve(null) })
  localStorage.setItem('tx.tourSeen', 'true')
}

async function main() {
  for (const f of ['会议纪要.docx', '报价单.xlsx', '合同.pdf', '照片.jpg']) fs.writeFileSync(path.join(DL, f), 'x')
  const b = await chromium.launch(exe ? { executablePath: exe } : {})
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(BRIDGE)
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', (e) => errs.push(e.message))
  await pg.goto(`${BASE}/?t=${T}`)
  await pg.waitForSelector('#inp'); await sleep(1200)
  const send = async (text) => { await pg.fill('#inp', text); await pg.click('#send') }

  // ---------- 试用期 ----------
  await pg.click('.rtop [data-act=agent-new]')
  await pg.fill('#agName', '出差助理'); await pg.fill('#agRole', '出差助理'); await pg.fill('#agMail', 'trip')
  await pg.click('[data-act=agent-save]')
  const bot = await until(async () => (await state()).agents.find((a) => a.name === '出差助理'))
  check(bot?.trial?.need === 3, 'a new Bot starts on 试用期', bot?.trial)
  check(await until(() => pg.evaluate(() => /试用期 0\/3/.test(document.querySelector('#cName').textContent))), 'its chat says 试用期 0/3')
  check(await pg.$('.ag[data-id="' + bot.id + '"] .ttag'), 'its row in the list says 试用')

  await send('记住我出差喜欢过道')
  await until(async () => (await state()).transcripts[bot.id].some((t) => t.role === 'tool' && t.name === 'memory_save' && t.state === 'error'), 20000)
  check(!(await state()).memories.some((m) => /过道/.test(m.text)), 'on 试用期 it cannot change anything (memory_save turned down)')

  const plan = async (k) => {
    await send(k === 1 ? '帮我整理一下下载文件夹' : '再整理一下下载文件夹')
    return until(async () => { const l = await pg.$$('.qcard.plan:not(.apply)'); return l.length >= k ? l[k - 1] : null }, 20000)
  }
  let card = await plan(1)
  check(card && /照这个做/.test(await card.innerText()), 'it hands in a plan instead of doing it', card && (await card.innerText()).slice(0, 120))
  check(fs.existsSync(path.join(DL, '会议纪要.docx')), 'nothing moved before you say yes')
  await shot(pg, 'trial-plan')
  await pg.click('.qcard.plan:not(.apply) >> nth=0 >> [data-act=b-plan-ok]')
  check(await until(() => fs.existsSync(path.join(DL, '文档', '会议纪要.docx'))), '照这个做: it does that plan')
  check(await until(() => pg.evaluate(() => /已经照做/.test(document.querySelectorAll('.qcard.plan')[0]?.innerText || ''))), 'the plan card says 已经照做')
  check(await until(async () => (await state()).agents.find((a) => a.id === bot.id).trial.ok === 1), 'one plan right: 1/3')

  card = await plan(2)
  await pg.click('.qcard.plan:not(.apply) >> nth=1 >> [data-act=b-plan-no]')
  await pg.fill(`.qcard.plan >> nth=1 >> textarea`, '先别动报价单')
  await pg.click('.qcard.plan >> nth=1 >> [data-act=b-plan-no-send]')
  check(await until(() => pg.evaluate(() => /你没同意：先别动报价单/.test(document.querySelectorAll('.qcard.plan')[1]?.innerText || ''))), '不对: the card keeps what you said')
  check(fs.existsSync(path.join(DL, '报价单.xlsx')), 'a plan you turned down is not done')
  await until(async () => (await state()).agentStatus[bot.id] === 'idle')

  for (const k of [3, 4]) {
    card = await plan(k)
    await pg.click(`.qcard.plan:not(.apply) >> nth=${k - 1} >> [data-act=b-plan-ok]`)
    await until(() => pg.evaluate((i) => /已经照做/.test(document.querySelectorAll('.qcard.plan:not(.apply)')[i]?.innerText || ''), k - 1))
  }
  const apply = await until(() => pg.$('.qcard.plan.apply'), 20000)
  check(apply && /交了 4 个方案，你同意了 3 个/.test(await apply.innerText()), 'three right: it asks to be made regular, with its real record', apply && (await apply.innerText()).slice(0, 200))
  await shot(pg, 'trial-apply')
  await pg.click('.qcard.plan.apply [data-act=b-promote]')
  check(await until(async () => !(await state()).agents.find((a) => a.id === bot.id).trial), '一键转正')
  check(await until(() => pg.evaluate(() => !/试用期/.test(document.querySelector('#cName').textContent))), 'its chat no longer says 试用期')
  check((await state()).ledger.some((e) => e.tool === 'trial_promote'), 'being made regular is in 操作记录 (can be undone)')
  await send('记住我出差喜欢靠窗')
  check(await until(async () => (await state()).memories.some((m) => /靠窗/.test(m.text))), 'made regular, it acts on its own (memory_save works)')
  await shot(pg, 'trial-regular')

  // ---------- 圆桌 ----------
  await pg.click('.ag.disc[data-v=table]')
  await pg.waitForSelector('#tbQ')
  await pg.fill('#tbQ', '下周去深圳出差，坐飞机还是高铁？')
  await pg.click('[data-act=b-tb-start]')
  check(await until(() => pg.$$eval('.tbl:first-of-type .tsay .b', (l) => l.length >= 4 && l.every((x) => x.innerText.trim().length > 4)), 30000), 'each Bot speaks, then answers the others')
  const opts = await until(() => pg.$$('.tbl .topt'), 30000)
  check(opts?.length === 2, 'a 分歧卡 with options to decide', opts?.length)
  const cardText = await pg.$eval('.tbl .tcard', (x) => x.innerText)
  check(/都同意/.test(cardText) && /分歧/.test(cardText) && /小天/.test(cardText) && /出差助理/.test(cardText), 'the card shows where they agree and who stands where')
  await shot(pg, 'table-open')
  await pg.click('.tbl .topt >> nth=1')
  check(await until(async () => (await state()).memories.some((m) => m.text === '去深圳出差坐白天的航班' && m.source === '圆桌拍板')), 'what you decide goes into memory, shared by every Bot')
  check(await until(() => pg.$eval('.tbl .tdec.big', (x) => /你拍板：坐白天的航班/.test(x.innerText))), 'the card shows your decision')
  await shot(pg, 'table-decided')
  await pg.click('.tbl .tdec.big [data-act=b-undo]')
  check(await until(async () => !(await state()).memories.some((m) => m.text === '去深圳出差坐白天的航班')), '不记这条: taken back out of memory')
  check(await until(() => pg.$eval('.tbl .tdec.big', (x) => /已经不记了/.test(x.innerText))), 'and the card says so')

  // a 圆桌 opened from the chat
  await pg.click('.ag[data-id=tianxi]')
  await send('让大家讨论一下：周会改到周二还是周四')
  const chip = await until(() => pg.$('.tbchip'), 20000)
  check(chip && /周会改到周二还是周四/.test(await chip.innerText()), 'asked in the chat, 小天 opens a 圆桌 and the chat links to it')
  check(await until(() => pg.evaluate(() => /开了个圆桌/.test(document.querySelector('#msgs').innerText))), 'and says so in one line')
  await shot(pg, 'table-from-chat')
  if (chip) {
    await pg.click('.tbchip')
    check(await until(() => pg.evaluate(() => view === 'table')), 'the link goes to 圆桌')
  }

  // ---------- Bot 动态 ----------
  await pg.click('.ag[data-id=tianxi]')
  await send('有空帮我汇总竞品周报')
  await until(async () => (await state()).later.some((j) => j.status === 'queued'))
  await api('presence', { idleSec: 3600 })
  const post = await until(async () => (await state()).feed.find((p) => p.kind === 'job'), 90000)
  check(post && post.acts.length === 1 && post.away, 'what a Bot did while you were away becomes a post, with what it changed', post)
  await api('presence', { idleSec: 0 })
  check(await until(() => pg.$('.ag.disc[data-v=feed] .ucount')), 'the list shows there is something new in 动态')
  await pg.click('.ag.disc[data-v=feed]')
  const fp = await until(() => pg.$(`.fpost[data-k="${post.id}"]`))
  check(fp && /添加待办/.test(await fp.innerText()), 'the post shows what it did, with 撤回')
  await shot(pg, 'feed')
  await pg.click(`.fpost[data-k="${post.id}"] [data-act=b-like]`)
  check(await until(async () => (await state()).memories.some((m) => m.kind === '经验' && m.source === '动态点赞')), '点赞 = 以后这样做: it becomes a 做事经验 every Bot reads')
  check(await until(() => pg.$eval(`.fpost[data-k="${post.id}"] .frx`, (x) => /记成了做事经验/.test(x.innerText))), 'the post says what was learned')
  await pg.click(`.fpost[data-k="${post.id}"] [data-act=b-cmt]`)
  await pg.fill(`#cmt_${post.id}`, '周报要点别加待办了，直接发邮件给我')
  await pg.click(`.fpost[data-k="${post.id}"] [data-act=b-cmt-send]`)
  check(await until(() => pg.$eval(`.fpost[data-k="${post.id}"] .frx`, (x) => /以后周报要点直接发邮件给你/.test(x.innerText)), 20000), '评论 = 纠正: the Bot answers under it')
  check(await until(async () => (await state()).memories.some((m) => /不要加进待办/.test(m.text))), 'and remembers the correction')
  await shot(pg, 'feed-liked')

  // ---------- light theme ----------
  await pg.evaluate(() => { localStorage.setItem('tx.theme', '"light"'); document.documentElement.dataset.theme = 'light' })
  await shot(pg, 'feed-light')
  await pg.click('.ag.disc[data-v=table]'); await shot(pg, 'table-light')
  await pg.click(`.ag[data-id="${bot.id}"]`); await sleep(400); await pg.evaluate(() => { document.querySelector('#feed').scrollTop = 0 }); await shot(pg, 'trial-light')
  await pg.evaluate((id) => setView('agent', id), bot.id); await sleep(300)
  check(await pg.evaluate(() => { const x = document.querySelector('.trialp'); x?.scrollIntoView({ block: 'center' }); return /转正 · 试用期里交了 4 个方案/.test(x?.innerText || '') }), 'its settings say when it was made regular, and can put it back on 试用期')
  await shot(pg, 'bot-settings-light')

  check(!errs.length, 'no page errors', errs)
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
  await b.close()
  const bad = results.filter((r) => !r.ok)
  console.log(`${results.length - bad.length}/${results.length}`)
  process.exit(bad.length ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
