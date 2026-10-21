// 常驻感知: 小天 keeps running when the user is away. It notices new files, runs queued work while the
// user is idle or at night, and prepares the morning brief so the first screen shows results.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { load, update, save, id, now, localISO, today, flags, bus, settings, EVAL } from './store.js'
import { entries } from './ledger.js'
import { reflections, runReflect } from './memory.js'

const expand = (p) => p.replace(/^~/, os.homedir())

export function observe(kind, text, data) {
  update('observations', [], (l) => { l.push({ id: id('obs'), at: now(), kind, text, data, seen: false }); if (l.length > 500) l.splice(0, l.length - 500) })
  bus.push({ type: 'observation' })
}

export function briefPrompt(reason = '例行') {
  const obs = load('observations', []).filter((o) => !o.seen).slice(-30)
  const jobs = load('later', []).filter((j) => j.status === 'done' && !j.reported)
  const since = Date.now() - 18 * 3600e3
  const acts = entries().filter((e) => Date.parse(e.at) > since && e.status === 'done').slice(-30)
  return [
    `【小天${reason}·每日简报】现在是 ${localISO().replace('T', ' ')}。请为用户做今天的“每日简报”。简报是单独的一页，不在对话里，用户扫一眼就要知道今天怎么样：`,
    '1. 用 calendar_list 看今天和明天的日程，用 todo_list 看待办，用 mail_inbox 看有没有新邮件；',
    '2. 结合下面的“新发现”和“后台做完的事”；',
    '3. 调用一次 brief_publish。summary 一句话说清今天；hero 点出最要紧的事；sections 按重要程度排：要拍板的事用 decide（每张都要给按钮），今天的日程用 schedule 块画成时间轴（冲突标 conflict），新文件用 files 块，做完的事用 done，还在做的用 doing。能用图文块的就不要只写文字。',
    '只写真实存在的事，不要编造。没有要定的事就不要硬凑。',
    '',
    '新发现：', ...(obs.length ? obs.map((o) => `- ${o.at.slice(0, 16).replace('T', ' ')} ${o.text}`) : ['- 无']),
    '后台做完的事：', ...(jobs.length ? jobs.map((j) => `- ${j.title}：${j.result || ''}`) : ['- 无']),
    '最近替用户做过的动作：', ...(acts.length ? acts.map((e) => `- ${e.title}`) : ['- 无']),
  ].join('\n')
}

export async function runBrief(reason) {
  if (!bus.say) throw new Error('小天还没准备好')
  const obsIds = load('observations', []).filter((o) => !o.seen).map((o) => o.id)
  const jobIds = load('later', []).filter((j) => j.status === 'done' && !j.reported).map((j) => j.id)
  await bus.say(briefPrompt(reason), { kind: 'brief' })
  update('observations', [], (l) => { for (const o of l) if (obsIds.includes(o.id)) o.seen = true })
  update('later', [], (l) => { for (const j of l) if (jobIds.includes(j.id)) j.reported = true })
  update('state', {}, (s) => { s.lastBriefDate = today() })
}

export async function runOneJob() {
  const job = load('later', []).find((j) => j.status === 'queued')
  if (!job) return false
  update('later', [], (l) => { const j = l.find((x) => x.id === job.id); j.status = 'running'; j.startedAt = now() })
  bus.push({ type: 'later' })
  const result = await bus.say(
    `【小天后台任务】${job.title}\n${job.instructions}\n\n用户现在不在电脑前。能直接做的就做（所有动作都会记进操作记录、可以撤回）；需要用户拍板或对外发送的事先不要做，记下来留给简报。做完用两三句话总结结果。`,
    { kind: 'job' })
  update('later', [], (l) => { const j = l.find((x) => x.id === job.id); j.status = 'done'; j.doneAt = now(); j.result = (result || '').slice(0, 400) })
  bus.push({ type: 'later' })
  return true
}

export const name = 'tianxi-ambient'

export function apply(ctx) {
  if (EVAL) return // the eval runner calls runBrief / runOneJob itself
  // Watch folders for new files. No model call: just remember what appeared.
  ctx.effect(() => {
    const watchers = []
    for (const p of settings().watch) {
      const dir = expand(p)
      try {
        const seen = new Set(fs.readdirSync(dir))
        watchers.push(fs.watch(dir, (_ev, file) => {
          if (!file || seen.has(file) || settings().watchOn === false || file.startsWith('.') || /\.(crdownload|part|tmp)$/i.test(file)) return
          setTimeout(() => {
            if (!fs.existsSync(path.join(dir, file))) return
            seen.add(file)
            observe('file', `${path.basename(dir)} 里出现了新文件 ${file}`, { path: path.join(dir, file) })
          }, 1500)
        }))
      } catch {}
    }
    return () => watchers.forEach((w) => w.close())
  })

  // The heartbeat: brief once a day, queued work while the user is away.
  let running = false
  const tick = async () => {
    if (running || !bus.say || bus.busy()) return
    running = true
    try {
      const s = settings(); const st = load('state', {})
      const hhmm = localISO().slice(11)
      if (s.briefOn !== false && st.lastBriefDate !== today() && hhmm >= s.briefTime) { await runBrief('例行'); return }
      const h = new Date().getHours()
      const night = s.nightFrom > s.nightTo ? (h >= s.nightFrom || h < s.nightTo) : (h >= s.nightFrom && h < s.nightTo)
      const away = flags.idleSec >= s.idleMinutes * 60
      const next = load('later', []).find((j) => j.status === 'queued')
      if (next && (away || (next.when === 'night' ? night : away || night))) await runOneJob()
      else if (s.reflectAtNight && night && away) {
        // 反思 once a night, after the queue is empty, only when something happened since the last one.
        const last = reflections()[0], since = last ? Date.parse(last.at) : 0
        const fresh = load('transcript', []).some((t) => t.role === 'user' && Date.parse(t.at) > since) || entries().some((e) => Date.parse(e.at) > since)
        if (Date.now() - since > 16 * 3600e3 && fresh) await runReflect('夜间')
      }
    } catch (e) { console.error('[tianxi] ambient', e) } finally { running = false }
  }
  ctx.effect(() => { const t = setInterval(tick, 30_000); const t0 = setTimeout(tick, 8_000); return () => { clearInterval(t); clearTimeout(t0) } })
}
