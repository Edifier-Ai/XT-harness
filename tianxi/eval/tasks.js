// 天禧 eval tasks. Each task copies its fixtures into a fresh sandbox, sends one or more prompts to a fresh
// 天禧 agent, then `check` grades the end state (files, 天禧 data, replies). See 任务清单.md for the rationale.
//
// check(c) gets:
//   c.sb        sandbox folder (absolute)        c.M        facts from fixtures/manifest.json for this task
//   c.reply     last reply text                 c.replies  every reply, joined
//   c.tools     [{ name, args, error }]         c.ui       args of every show_ui call
//   c.data(n)   a 天禧 collection (calendar, todos, outbox, memories, later, brief, ledger)
//   c.files(rel)  files under sandbox/rel (relative paths, recursive)
//   c.read(rel)   file text                      c.exists(rel)
//   c.has(text, alts)  any alternative appears (spaces and thousands separators ignored)
//   c.judge(rubric)    model-graded yes/no with a reason (open-ended tasks)
// and returns { pass, notes }.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { localISO } from '../plugins/store.js'

const pad = (n) => String(n).padStart(2, '0')
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Next given weekday (0=Sun) strictly after today, plus today when it is that weekday. */
function weekdays(wd) {
  const out = []; const d = new Date()
  for (let i = 0; i <= 7; i++) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i); if (x.getDay() === wd) out.push(day(x)) }
  return out
}
/** Monday..Friday of next week. */
function nextWeek() {
  const d = new Date(); const toMon = ((8 - d.getDay()) % 7) || 7
  return [0, 1, 2, 3, 4].map((k) => day(new Date(d.getFullYear(), d.getMonth(), d.getDate() + toMon + k)))
}
const overlap = (a, b) => a.start < b.end && b.start < a.end
const ok = (pass, notes = '') => ({ pass: !!pass, notes })

export default [
  // ---------------- 文件 ----------------
  {
    id: '01', cat: '文件', title: '按类型整理下载文件夹', timeout: 180,
    fixtures: { '01/下载': '下载' },
    say: ['帮我把“下载”文件夹（就在当前目录下）按文件类型整理一下。'],
    check(c) {
      const files = c.files('下载')
      const names = files.map((f) => path.basename(f))
      const lost = c.M.files.filter((n) => !names.includes(n))
      const root = files.filter((f) => !f.includes('/'))
      const dirOf = (n) => path.dirname(files.find((f) => path.basename(f) === n) || '')
      const img = new Set(['IMG_0012.jpg', '截图 2026-10-12.png'].map(dirOf))
      const doc = new Set(['设计规范v3.docx', '合同v2.pdf'].map(dirOf))
      const mixed = [...img].some((d) => doc.has(d))
      return ok(!lost.length && !root.length && !mixed, `丢失 ${lost.length}，根目录残留 ${root.length}，图片与文档混放 ${mixed}`)
    },
  },
  {
    id: '02', cat: '文件', title: '找重复文件，留最新的', timeout: 180,
    fixtures: { '02/下载': '下载' },
    setup(sb) { // make the "newest" copy of each group really the newest
      const t0 = Date.now() / 1000 - 86400 * 3
      const set = (f, dt) => fs.utimesSync(path.join(sb, '下载', f), t0 + dt, t0 + dt)
      set('发票-10月.pdf', 0); set('发票-10月(1).pdf', 3600); set('团建合影 - 副本.jpg', 0); set('团建合影.jpg', 7200)
    },
    say: ['“下载”文件夹里有些重复的文件，帮我找出来，每组只留最新的那个，其余的移到“下载/待删除”文件夹里，先别真删。'],
    check(c) {
      const files = c.files('下载')
      const inRoot = (n) => files.includes(n), inTrash = (n) => files.some((f) => f.startsWith('待删除/') && path.basename(f) === n)
      const keep = c.M.newest.every(inRoot)
      const moved = c.M.groups.every((g) => g.filter((n) => !c.M.newest.includes(n)).every(inTrash))
      const uniq = c.M.unique.every(inRoot)
      return ok(keep && moved && uniq && files.length === 7, `保留最新 ${keep}，旧的移走 ${moved}，唯一文件未动 ${uniq}，文件总数 ${files.length}/7`)
    },
  },
  {
    id: '03', cat: '文件', title: '照片按拍摄日期重命名', timeout: 300,
    fixtures: { '03/照片': '照片' },
    say: ['把“照片”文件夹里的照片按拍摄日期重命名，格式像 2026-10-01_01.jpg 这样，同一天的按顺序编号。'],
    async check(c) {
      const { createHash } = await import('node:crypto')
      const files = c.files('照片').filter((f) => /\.jpe?g$/i.test(f))
      let right = 0
      for (const f of files) {
        const h = createHash('md5').update(fs.readFileSync(path.join(c.sb, '照片', f))).digest('hex')
        const m = path.basename(f).match(/^(\d{4}-\d{2}-\d{2})_\d{2,3}\.jpe?g$/i)
        if (m && c.M.dates[h] === m[1]) right++
      }
      return ok(files.length === 20 && right === 20, `20 张里命名正确 ${right} 张（现有 ${files.length} 张）`)
    },
  },
  {
    id: '04', cat: '文件', title: '读 PDF 合同找违约金', timeout: 180,
    fixtures: { '04': '.' },
    say: ['当前目录里的“采购合同.pdf”第几页提到违约金？违约金是多少钱？'],
    check(c) {
      const page = /第\s*(4|四)\s*页|page\s*4|P4/i.test(c.reply)
      const amt = c.has(c.reply, ['128000', '12.8万'])
      return ok(page && amt, `页码 ${page}，金额 ${amt}`)
    },
  },

  // ---------------- 文档 ----------------
  {
    id: '05', cat: '文档', title: '会议纪要总结与待办', timeout: 180,
    fixtures: { '05': '.' },
    say: ['把“会议纪要.docx”总结成三条要点，再列出会后的待办和负责人。'],
    check(c) {
      const facts = c.M.facts.filter((alts) => c.has(c.reply, alts)).length
      const owners = c.M.owners.filter(([who, what]) => c.reply.split('\n').some((ln) => ln.includes(who) && ln.includes(what))).length
      return ok(facts === 3 && owners === 3, `关键事实 ${facts}/3，待办与负责人对应 ${owners}/3`)
    },
  },
  {
    id: '06', cat: '文档', title: '周报改写成给老板看的版本', timeout: 180,
    fixtures: { '06': '.' },
    say: ['把“周报.docx”改成给老板看的版本，300 字以内，直接回复给我就行。'],
    check(c) {
      const len = c.reply.replace(/\s/g, '').length
      const nums = c.M.numbers.filter((n) => c.reply.includes(n)).length
      return ok(len <= 330 && len >= 80 && nums >= 4, `字数 ${len}，保留关键数字 ${nums}/5`)
    },
  },
  {
    id: '07', cat: '文档', title: 'PPT 标题与逻辑检查', timeout: 180,
    fixtures: { '07': '.' },
    say: ['列出“Q3汇报.pptx”每一页的标题，再挑出逻辑上最不顺、最不该出现在这份汇报里的一页。'],
    check(c) {
      const titles = c.M.titles.filter((t) => c.has(c.reply, [t])).length
      const odd = /团建/.test(c.reply.split(/不顺|不该|突兀|多余|无关|建议删|删掉|去掉/).slice(1).join('') || c.reply.slice(-200))
      return ok(titles === 6 && odd, `标题 ${titles}/6，挑出团建页 ${odd}`)
    },
  },

  // ---------------- 表格 ----------------
  {
    id: '08', cat: '表格', title: '按区域汇总并找环比降幅最大', timeout: 180,
    fixtures: { '08': '.' },
    say: ['“销售.xlsx”里按区域汇总 8 月和 9 月的销售额，告诉我 9 月环比下降最多的是哪个区域。'],
    check(c) {
      const sums = Object.values(c.M.sep).filter((v) => c.has(c.reply, [String(v), String(v) + '.0'])).length
      const ans = /华南/.test(c.reply.split('\n').filter((l) => /下降|降幅|最多|最大/.test(l)).join('') || c.reply)
      return ok(ans && sums >= 3, `答出华南 ${ans}，9 月汇总数对上 ${sums}/4`)
    },
  },
  {
    id: '09', cat: '表格', title: '合并两张供应商表', timeout: 240,
    fixtures: { '09': '.' },
    say: ['把“供应商A.xlsx”和“供应商B.xlsx”按供应商名称合并成一张新表“合并.xlsx”，放在当前目录，并告诉我哪些供应商只在其中一张表里出现。'],
    check(c) {
      const file = c.exists('合并.xlsx')
      const diff = [...c.M.onlyA, ...c.M.onlyB].filter((n) => c.reply.includes(n)).length
      return ok(file && diff === 3, `生成合并表 ${file}，差异项 ${diff}/3`)
    },
  },
  {
    id: '10', cat: '表格', title: '找出录错的数据', timeout: 180,
    fixtures: { '10': '.' },
    say: ['“员工采购数据.xlsx”里有哪些明显录错的数据？'],
    check(c) {
      const hit = c.M.errors.filter((alts) => alts.some((a) => c.reply.includes(a))).length
      return ok(hit >= 3, `找出预埋错误 ${hit}/4（误报需人工复核）`)
    },
  },

  // ---------------- 日程 / 待办 / 邮件 ----------------
  {
    id: '11', cat: '日程', title: '约会议', timeout: 120,
    say: ['周四下午三点约杨润开“概念版天禧评审”，一小时。'],
    check(c) {
      const thu = weekdays(4)
      const e = c.data('calendar').find((x) => /评审/.test(x.title))
      const good = e && thu.includes(e.start.slice(0, 10)) && e.start.slice(11, 16) === '15:00' && e.end.slice(11, 16) === '16:00'
      const who = e && (JSON.stringify(e.people || []) + e.title).includes('杨润')
      return ok(good && who, e ? `${e.start} - ${e.end}，含杨润 ${!!who}` : '没有建日程')
    },
  },
  {
    id: '12', cat: '日程', title: '找空档占专注时间', timeout: 180,
    seed() {
      const w = nextWeek(); const cal = []
      w.forEach((d, i) => {
        if (i === 2) cal.push({ id: 'cal_s' + i, title: '部门周会', start: d + 'T13:00', end: d + 'T15:00' })
        else cal.push({ id: 'cal_s' + i, title: ['客户拜访', '方案评审', '', '供应商会议', '月度复盘'][i], start: d + 'T13:00', end: d + 'T18:00' })
      })
      return { calendar: cal }
    },
    say: ['下周我哪天下午有连续两小时的空？帮我占上，标题写“专注时间”。'],
    check(c) {
      const cal = c.data('calendar'); const f = cal.find((x) => /专注/.test(x.title))
      if (!f) return ok(false, '没有建“专注时间”')
      const dur = (Date.parse(f.end) - Date.parse(f.start)) / 36e5
      const clash = cal.filter((x) => x !== f && overlap(x, f)).length
      const pm = f.start.slice(11, 13) >= '12'
      return ok(dur >= 2 && !clash && pm && nextWeek().includes(f.start.slice(0, 10)), `${f.start}，时长 ${dur} 小时，冲突 ${clash}`)
    },
  },
  {
    id: '13', cat: '日程', title: '处理日程冲突', timeout: 180,
    seed() {
      const d = weekdays(4).slice(-1)[0]
      return { calendar: [{ id: 'cal_a', title: '概念版天禧评审', start: d + 'T15:00', end: d + 'T16:00', people: ['杨润'] }, { id: 'cal_b', title: '设计走查', start: d + 'T15:00', end: d + 'T16:30' }] }
    },
    say: ['周四那个评审和走查时间冲突了，帮我处理一下，评审不能动。'],
    check(c) {
      const cal = c.data('calendar'); const a = cal.find((x) => x.id === 'cal_a'), b = cal.find((x) => /走查/.test(x.title))
      const fixed = a && b && !overlap(a, b) && a.start.endsWith('15:00')
      return ok(fixed, b ? `走查现在在 ${b.start}` : '走查被删了')
    },
  },
  {
    id: '14', cat: '待办', title: '从聊天记录提取我的待办', timeout: 180,
    fixtures: { '14': '.' },
    say: ['看一下“聊天记录.txt”，把里面要我（summer）做的事都加到待办里。'],
    check(c) {
      const t = c.data('todos').map((x) => x.title).join('\n')
      const mine = c.M.mine.filter((alts) => alts.some((a) => t.includes(a))).length
      const wrong = c.M.others.filter((alts) => alts.some((a) => t.includes(a))).length
      return ok(mine >= 4 && wrong <= 1, `召回 ${mine}/5，误加 ${wrong}`)
    },
  },
  {
    id: '15', cat: '邮件', title: '起草提醒补签邮件', timeout: 120,
    say: ['给王经理写封邮件，提醒他合同第 7 页的签字页要补签。'],
    check(c) {
      const m = c.data('outbox').find((x) => /王/.test(x.to))
      const good = m && /补签|签字/.test(m.subject + m.body) && /7/.test(m.subject + m.body)
      return ok(good, m ? `草稿：${m.subject}（${m.status}），确认弹窗 ${c.approvals} 次` : '没有起草')
    },
  },
  {
    id: '16', cat: '邮件', title: '三封客户邮件整理成表', timeout: 180,
    fixtures: { '16': '.' },
    say: ['把“邮件”文件夹里三封客户邮件提的需求整理成一张表：客户、日期、需求。'],
    check(c) {
      const txt = c.replies + JSON.stringify(c.ui)
      const cl = c.M.clients.filter((a) => c.has(txt, a)).length, dt = c.M.dates.filter((a) => c.has(txt, a)).length
      const table = /\|.*\|/.test(txt) || c.ui.some((u) => JSON.stringify(u).includes('"table"'))
      return ok(cl === 3 && dt === 3 && table, `客户 ${cl}/3，日期 ${dt}/3，是表格 ${table}`)
    },
  },

  // ---------------- 记忆 ----------------
  {
    id: '17', cat: '记忆', title: '记住偏好', timeout: 120,
    say: ['记住：我出差不坐红眼航班，酒店离客户近的优先。'],
    check(c) {
      const m = c.data('memories').map((x) => x.text + (x.quote || '')).join('\n')
      return ok(/红眼/.test(m) && /酒店|客户/.test(m), `记忆 ${c.data('memories').length} 条`)
    },
  },
  {
    id: '18', cat: '记忆', title: '新对话里用上偏好', timeout: 300,
    seed: () => ({ memories: [
      { id: 'mem_1', text: '出差不坐红眼航班', kind: '偏好', source: '对话', quote: '我出差不坐红眼航班', createdAt: new Date().toISOString(), uses: 0 },
      { id: 'mem_2', text: '出差酒店优先选离客户近的', kind: '偏好', source: '对话', quote: '酒店离客户近的优先', createdAt: new Date().toISOString(), uses: 0 }] }),
    say: ['帮我排一下下周三从北京去深圳拜访客户的行程，客户在南山区科技园，当天去第二天回。'],
    async check(c) {
      return c.judge('这份出差行程是否同时做到：1) 去程和回程都没有安排红眼航班（凌晨 0 点到 6 点起飞或到达）；2) 酒店明确选在南山区科技园附近或说明了离客户近。两点都做到才算通过。', c.replies + JSON.stringify(c.ui))
    },
  },
  {
    id: '19', cat: '记忆', title: '纠正记忆', timeout: 120,
    seed: () => ({ memories: [{ id: 'mem_1', text: '出差不坐红眼航班', kind: '偏好', source: '对话', quote: '我出差不坐红眼航班', createdAt: new Date().toISOString(), uses: 0 }] }),
    say: ['我之前说错了，我其实不介意坐红眼航班。'],
    check(c) {
      const ms = c.data('memories').filter((x) => /红眼/.test(x.text))
      const stale = ms.some((x) => /不坐|不要|避免|不乘/.test(x.text) && !/不介意/.test(x.text))
      return ok(!stale && ms.length <= 1, ms.map((x) => x.text).join('；') || '红眼相关记忆已删除')
    },
  },

  // ---------------- 生成式界面 ----------------
  {
    id: '20', cat: '生成式界面', title: '比较三款笔记本', timeout: 300,
    say: ['帮我比较三款 14 寸轻薄本，我更在意续航和重量。'],
    check(c) {
      const u = c.ui.map((x) => JSON.stringify(x)).join('')
      const rows = c.ui.flatMap((x) => (x.blocks || []).flatMap((b) => b.rows || b.items || [])).length
      return ok(c.ui.length > 0 && rows >= 3 && /续航/.test(u) && /重量|kg|克/.test(u), `show_ui ${c.ui.length} 次，行/项 ${rows}`)
    },
  },
  {
    id: '21', cat: '生成式界面', title: '可调参数的行程卡片', timeout: 300,
    say: ['帮我排一下下周四去深圳走访三家供应商（华贸电子、恒达科技、佳讯光电）的行程。', '按这些参数重新排 {"每家停留":"2 小时","出发":"最早一班"}'],
    check(c) {
      const forms = c.ui.filter((x) => (x.blocks || []).some((b) => b.type === 'form' || b.type === 'choices'))
      return ok(forms.length >= 1 && c.ui.length >= 2, `生成卡片 ${c.ui.length} 次，其中可操作 ${forms.length} 次`)
    },
  },

  // ---------------- 联网 ----------------
  {
    id: '22', cat: '联网', title: '查 DeepSeek API 价格', timeout: 240, review: true,
    say: ['查一下 DeepSeek API 现在的价格。'],
    check(c) {
      const link = /deepseek\.com/.test(c.reply), num = /\d+(\.\d+)?\s*(元|美元|\$|¥|USD)/.test(c.reply)
      return ok(link && num, `有官方链接 ${link}，有价格 ${num}（数字需人工复核）`)
    },
  },
  {
    id: '23', cat: '联网', title: '查联想最近一季财报', timeout: 240, review: true,
    say: ['联想集团最近一个季度的营收是多少？同比怎么样？'],
    check(c) {
      const link = /https?:\/\//.test(c.reply), num = /\d+(\.\d+)?\s*(亿|billion|十亿|万亿)/i.test(c.reply), yoy = /同比|增长|下降|%/.test(c.reply)
      return ok(link && num && yoy, `有出处 ${link}，有营收 ${num}，有同比 ${yoy}（数字需人工复核）`)
    },
  },
  {
    id: '24', cat: '联网', title: '搜报道写一页综述', timeout: 480,
    say: ['搜 3 篇关于端侧大模型的最新报道，写一页综述，存成当前目录下的“端侧大模型综述.md”，文中附上每篇的链接。'],
    async check(c) {
      const f = c.files('').find((x) => /综述/.test(x))
      if (!f) return ok(false, '没有生成文件')
      const urls = [...new Set((c.read(f).match(/https?:\/\/[^\s)\]>"']+/g) || []))]
      let live = 0
      for (const u of urls.slice(0, 6)) { try { const r = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) }); if (r.status < 400) live++ } catch {} }
      return ok(urls.length >= 3 && live >= 3, `链接 ${urls.length} 个，能打开 ${live} 个`)
    },
  },

  // ---------------- 系统 ----------------
  {
    id: '25', cat: '系统', title: '查磁盘剩余空间', timeout: 180,
    say: [process.platform === 'win32' ? '我电脑 C 盘还剩多少空间？' : '这台电脑系统盘还剩多少空间？'],
    check(c) {
      const st = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/')
      const gb = (st.bavail * st.bsize) / 1024 ** 3
      const nums = (c.reply.match(/(\d+(\.\d+)?)\s*(GB|G|吉)/gi) || []).map((x) => parseFloat(x))
      const tb = (c.reply.match(/(\d+(\.\d+)?)\s*TB/gi) || []).map((x) => parseFloat(x) * 1024)
      const hit = [...nums, ...tb].some((v) => Math.abs(v - gb) / gb < 0.1 || Math.abs(v - gb * 1.0737) / gb < 0.1)
      return ok(hit, `实际约 ${gb.toFixed(1)} GB，回复里的数字 ${[...nums, ...tb].join(', ') || '无'}`)
    },
  },
  {
    id: '26', cat: '系统', title: '压缩文件夹', timeout: 180,
    fixtures: { '26/资料': '资料' },
    say: ['把“资料”文件夹压缩成“资料.zip”，放在当前目录。'],
    check(c) {
      if (!c.exists('资料.zip')) return ok(false, '没有 zip')
      const buf = fs.readFileSync(path.join(c.sb, '资料.zip'))
      let n = 0; for (let i = buf.indexOf('PK\x01\x02'); i >= 0; i = buf.indexOf('PK\x01\x02', i + 4)) n++
      return ok(n >= c.M.count, `zip 里 ${n} 个条目（应有 ${c.M.count} 个文件）`)
    },
  },

  // ---------------- 多步 ----------------
  {
    id: '27', cat: '多步', title: '发票汇总并起草报销邮件', timeout: 480,
    fixtures: { '27': '.' },
    say: ['把“发票”文件夹里所有发票的金额汇总成一张表，存成当前目录下的“报销汇总”表格，再起草一封报销邮件给财务（财务部 李会计），写上合计金额。'],
    check(c) {
      const total = c.M.total
      const table = c.files('').some((f) => /汇总/.test(f) && /\.(xlsx|csv|md)$/i.test(f))
      const m = c.data('outbox').find((x) => /财务|会计/.test(x.to + x.subject + x.body))
      const sum = m && c.has(m.body + m.subject, [total.toFixed(2), String(total)])
      return ok(table && sum, `汇总表 ${table}，邮件 ${!!m}，合计 ${total} 写对 ${!!sum}`)
    },
  },
  {
    id: '28', cat: '多步', title: '整理今日简报', timeout: 300,
    seed() {
      const d = localISO().slice(0, 10)
      return {
        calendar: [{ id: 'cal_1', title: '概念版天禧评审', start: d + 'T15:00', end: d + 'T16:00' }, { id: 'cal_2', title: '设计走查', start: d + 'T15:30', end: d + 'T16:30' }, { id: 'cal_3', title: '供应商电话会', start: d + 'T10:00', end: d + 'T10:30' }],
        todos: [{ id: 'todo_1', title: '周五前同步评审反馈清单', done: false, createdAt: new Date().toISOString() }],
        observations: [{ id: 'obs_1', at: new Date().toISOString(), kind: 'file', text: '下载 里出现了新文件 华贸电子报价单_v3.xlsx', seen: false }],
      }
    },
    brief: true,
    check(c) {
      const b = c.data('brief')
      if (!b || !b.items) return ok(false, '没有生成简报')
      const s = JSON.stringify(b)
      const decide = b.items.filter((i) => i.kind === 'decide' && (i.actions || []).length)
      const conflict = decide.some((i) => /冲突|走查|评审/.test(i.title + (i.detail || '')))
      return ok(conflict && /报价单|华贸/.test(s), `需要你定 ${decide.length} 张，含冲突 ${conflict}，提到新文件 ${/报价单|华贸/.test(s)}`)
    },
  },
  {
    id: '29', cat: '后台', title: '交给后台稍后做', timeout: 480,
    fixtures: { '05/会议纪要.docx': '桌面/会议纪要.docx' },
    say: ['有空的时候帮我把“桌面”文件夹里的会议纪要汇总成三条要点。'],
    runJob: true,
    check(c) {
      const job = c.data('later')[0]
      const brief = JSON.stringify(c.data('brief') || {})
      return ok(job && job.status === 'done' && job.result && /华贸|11|30/.test(job.result + brief), job ? `任务 ${job.status}，结果：${(job.result || '').slice(0, 60)}` : '没有放进后台队列')
    },
  },
  {
    id: '30', cat: '撤回', title: '说“算了”撤回刚才的整理', timeout: 300,
    fixtures: { '30/下载': '下载' },
    say: ['帮我把“下载”文件夹按类型整理一下。', '算了，刚才那个整理撤回吧，恢复原样。'],
    check(c) {
      const files = c.files('下载')
      const back = files.filter((f) => !f.includes('/')).length
      const moves = c.data('ledger').filter((e) => e.tool === 'file_move' && e.undo?.kind === 'file-move-back' && String(e.undo.data.from).startsWith(c.sb))
      const undone = moves.filter((e) => e.status === 'undone').length
      return ok(moves.length > 0 && undone === moves.length && back === 8, `第一步移动 ${moves.length} 次，撤回 ${undone} 次，恢复到原位 ${back}/8`)
    },
  },
]
