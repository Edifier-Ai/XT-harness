// Writes a task pack for running the same tasks by hand in other products (today's 天禧, Claude Code, ...).
import fs from 'node:fs'
import path from 'node:path'
const [src, out] = process.argv.slice(2)
const tasks = (await import(path.resolve(src, 'eval/tasks.js'))).default
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
const lines = ['# 天禧评测任务包（手动对照用）', '', '用法：每个任务把对应文件夹复制成一个干净的工作目录，在被测产品里打开这个目录，按顺序发出“要说的话”，然后按“判分标准”判断是否通过。', '日程、待办、邮件、记忆、简报、后台类任务依赖天禧自己的数据，其他产品如果没有对应能力，记为“不支持”。', '']
for (const t of tasks) {
  const dir = path.join(out, `${t.id}_${t.title}`); fs.mkdirSync(dir, { recursive: true })
  for (const [s, d] of Object.entries(t.fixtures || {})) fs.cpSync(path.resolve(src, 'eval/fixtures', s), path.join(dir, d), { recursive: true })
  lines.push(`## ${t.id} ${t.title}（${t.cat}）`, '', ...(t.say || ['（由天禧自动触发：今日简报）']).map((x, i) => `${i + 1}. ${x}`), '', '判分：见任务清单.md 同编号条目。', '')
}
fs.writeFileSync(path.join(out, '任务说明.md'), lines.join('\n'))
console.log('task pack ok', tasks.length)
