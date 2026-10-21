// node build/genui/build.mjs
// Writes 小天's generative UI pieces from library.mjs:
//   tianxi/plugins/genui-prompt.md  the system prompt section that teaches the agent OpenUI Lang
//   tianxi/web/genui/openui.js      OpenUI's parser and evaluator, with the library, for the client (window.OpenUI)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { createStreamingParser } from '@openuidev/lang-core'
import { library } from './library.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

const preamble = `## 生成式界面（OpenUI Lang）

你的回复是聊天文字，需要时可以在文字里嵌一段可交互的界面。界面用 openui-lang 写，放进一个 \`\`\`openui-lang 代码块，代码块前后照常写文字。用户看到的是渲染好的界面，看不到代码。

什么时候用界面：用户要比较、挑选、填写、确认，或者结果本身就是表格、图表、日程、清单、步骤、文件时。闲聊、简单问答、一两句话能说清的，只用文字，不要画界面。

怎么用：
- 先用一句话给结论，再给界面；界面之后不要把界面里的内容再用文字说一遍。
- 一条回复最多一个界面代码块，根节点是 Card。
- 用户点了界面里的按钮或提交了表单，你会收到一条用户消息，里面有按钮的话、表单里填的值和按钮带的 context。照着直接去做，不要再问一遍。
- 发邮件、删除、花钱这类动作，按钮点了以后系统还会请用户确认；界面里不要假装已经做完。`

const additionalRules = [
  '界面里的文字都用中文，短句，不要客套。',
  'Image 和 ImageGallery 的地址只能来自工具结果或用户给的，绝不编造；Files 只放工具结果里真实存在的完整路径。',
  '让用户在几个方案里选一个：OptionCards 或一组 Buttons；要填好几个值：Form。每个 Button 都用 @ToAssistant 写清楚点了以后你要做什么。',
  '最后可以放一个 FollowUpBlock，给两三个用户接下来最可能问的话。',
  '数字要真实：来自工具、记忆或用户；没有数据时不要画图表。',
]

const examples = [
  `例 1 · 让用户挑方案并补几个条件：

周末去杭州有三种玩法，我按你上次说的不想太累排了顺序。

\`\`\`openui-lang
root = Card([header, plans, form, follow])
header = CardHeader("周末杭州", "选一个玩法，我来订")
plans = OptionCards("plan", "single", [p1, p2, p3])
p1 = OptionCard("lake", "西湖慢逛", "步行 6 公里，不赶时间")
p2 = OptionCard("tea", "龙井喝茶", "半天山里，人少")
p3 = OptionCard("city", "城市漫游", "博物馆加夜市")
form = Form("trip", btns, [fDay, fBudget])
fDay = FormControl("哪天出发", Chips("day", "single", [d1, d2]))
d1 = ChipItem("sat", "周六")
d2 = ChipItem("sun", "周日")
fBudget = FormControl("预算", Slider("budget", "continuous", 500, 3000, 100, [1500], "元"))
btns = Buttons([Button("就这样，帮我订", @ToAssistant("按我选的方案和条件订票和酒店"), "primary"), Button("再换几个", @ToAssistant("换三个不一样的玩法"), "secondary")])
follow = FollowUpBlock([FollowUpItem("那两天天气怎么样"), FollowUpItem("帮我叫上小王")])
\`\`\``,

  `例 2 · 结果本身是数据：

这个月花了 4,860 元，比上个月多 12%，主要多在外卖。

\`\`\`openui-lang
root = Card([header, stats, chart, table])
header = CardHeader("10 月开销", "截至今天")
stats = StatBlock([s1, s2, s3])
s1 = Stat("总支出", "4,860 元", "比 9 月", { direction: "up", value: 12 })
s2 = Stat("外卖", "1,320 元", "27 单")
s3 = Stat("交通", "640 元")
chart = BarChart(["第1周", "第2周", "第3周"], [Series("支出", [1500, 1900, 1460])])
table = Table([Col("类别", ["餐饮", "交通", "购物"]), Col("金额（元）", [2100, 640, 1380], "number")])
\`\`\``,

  `例 3 · 日程有冲突，让用户定：

明天上午两个会撞了，我建议把周会挪到下午。

\`\`\`openui-lang
root = Card([day, btns])
day = Timeline([t1, t2, t3])
t1 = TimelineItem("09:30–10:30", "产品周会", "会议室 3", "", true)
t2 = TimelineItem("10:00–11:00", "供应商评审", "线上", "重要", true)
t3 = TimelineItem("14:00–15:00", "空闲")
btns = Buttons([Button("周会挪到 14:00", @ToAssistant("把产品周会挪到明天 14:00，并通知参会人"), "primary"), Button("评审改期", @ToAssistant("问供应商评审能不能改到后天"), "secondary")])
\`\`\``,
]

// every example must parse cleanly against the library
const schema = library.toJSONSchema()
for (const ex of examples) {
  const code = ex.split('```openui-lang\n')[1].split('```')[0]
  const r = createStreamingParser(schema, library.root).set(code, true)
  const bad = [...(r.meta?.errors || []), ...(r.meta?.unresolved || []).map((u) => 'unresolved ' + u), ...(r.meta?.orphaned || []).map((u) => 'orphaned ' + u)]
  if (bad.length || !r.root) throw new Error('example does not parse: ' + JSON.stringify(bad) + '\n' + code)
}

const prompt = library.prompt({ preamble, additionalRules, examples, bindings: false, toolCalls: false })
fs.writeFileSync(path.join(root, 'tianxi/plugins/genui-prompt.md'), prompt + '\n')

fs.mkdirSync(path.join(root, 'tianxi/web/genui'), { recursive: true })
await esbuild.build({
  stdin: {
    contents: `export { library } from './library.mjs'
export { createStreamingParser, createStore, evaluateRoot, BuiltinActionType, ACTION_STEPS } from '@openuidev/lang-core'`,
    resolveDir: here, loader: 'js',
  },
  bundle: true, format: 'iife', globalName: 'OpenUI', minify: true, target: 'chrome120', legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: '/* OpenUI Lang runtime (@openuidev/lang-core, MIT, github.com/thesysdev/openui) and zod (MIT), with 小天\'s component library. Built by build/genui/build.mjs. */' },
  outfile: path.join(root, 'tianxi/web/genui/openui.js'),
})
console.log('prompt', prompt.length, 'chars; bundle', fs.statSync(path.join(root, 'tianxi/web/genui/openui.js')).size, 'bytes')
