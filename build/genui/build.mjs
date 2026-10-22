// node build/genui/build.mjs   (run `npm install` in build/genui first)
// 小天's generative UI is OpenUI's own (openui.com, github.com/thesysdev/openui, MIT): the chat component library,
// its prompt and its React renderer. This writes
//   tianxi/plugins/genui-prompt.md   OpenUI's chat prompt, with 小天's rules (Chinese, card kinds, never made-up data)
//   tianxi/web/genui/openui.js       the library and renderer for the client (window.OpenUI, see entry.jsx)
//   tianxi/web/genui/openui.css      OpenUI's component styles
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { createStreamingParser } from '@openuidev/lang-core'
import { openuiChatLibrary as library, openuiChatPromptOptions as official } from '@openuidev/react-ui'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

const preamble = `## 生成式界面（OpenUI Lang）

你的回复是聊天文字，可以在里面嵌一张用 openui-lang 写的可交互卡片。卡片放进一个代码块，代码块第一行是 \`\`\`openui-lang 加一个空格再加用途名，里面只写 openui-lang，从 root = Card(...) 开始。用户看到的是画好的卡片，看不到代码。

什么时候画卡片：回答有实质内容时就画，而且卡片就是回答的主体，要做完整、做好看：介绍或解释一样东西、比较、推荐、计划、查到的结果和数据、需要用户挑选或填写。用下面的组件把内容组织好：标题、要点卡片组、图标、标签、图表、表格、分节、下一步按钮。只有闲聊、一两句话就能说清的才只用文字。

真实（最重要，高于下面所有规则和示例）：
- 卡片里的每个事实、数字、名字、日期、价格、链接、图片都必须来自工具结果、记忆、用户说过的话，或者是你确定无误的公认常识。
- 绝不为了让卡片好看去编造数据或内容。没有真实数字就不画图表、不放指标卡、不填表格；需要数据时先用工具去查。查不到就在卡片里说没查到，或者只用文字回答。
- 下面的示例只示范结构和组件怎么用，里面的内容和数字都是虚构的，不能照搬。规则里凡是让你“生成看起来合理的数据”的意思，一律不适用。

格式：
- 卡片前用一两句话说结论；卡片之后不要把卡片里的内容再用文字说一遍。
- 一条回复最多一个卡片代码块。
- 用途名：2 到 6 个字，说这一类卡片是干什么的，不带具体的人、地点、日期，比如 \`\`\`openui-lang 城市天气、\`\`\`openui-lang 出行方案。同一类事每次都用同一个名字：用户可以把卡片钉到桌面，同一类卡片用过两次会自己收进“我的工具”。
- 卡片里的文字都用中文，短句，不要客套。
- 用户点了卡片里的按钮或提交了表单，你会收到一条用户消息，里面有按钮的话和表单里填的值。照着直接去做，不要再问一遍。
- 发邮件、删除、花钱这类动作，按钮点了以后系统还会请用户确认；卡片里不要假装已经做完。`

// OpenUI's rules, less the one that asks for made-up data
const rules = official.additionalRules
  .filter((r) => !/realistic\/plausible data/i.test(r))
  .map((r) => r.startsWith('Quantitative asks get a chart') ? 'Quantitative asks with REAL numbers (from tools, memory or the user) get a chart (plus KPI cards where useful) — never draw a chart from numbers you do not actually have.' : r)
const additionalRules = [
  ...rules,
  'Icon names are lucide names in English; every visible text (titles, labels, buttons, tags) is Chinese.',
]

// one example of a whole 小天 reply: a line of text, then the card in its fence with its kind
const examples = [
  `Example — a whole reply in 小天 (text first, then the card in a fenced block with its kind; the content here is made up and only shows the shape):

明天上午两个会撞了，我建议把周会挪到下午。

\`\`\`openui-lang 日程冲突
root = Card([header, clash, free, btns])
header = CardHeader("明天上午", "两个会时间重叠")
clash = ContextCardBlock([c1, c2], "grid", true)
c1 = ContextCardItem("weekly", t1, "**09:30–10:30** 产品周会 · 会议室 3")
t1 = Tag("可挪", i1, "sm", "info")
i1 = Icon("calendar-clock", "time")
c2 = ContextCardItem("review", t2, "**10:00–11:00** 供应商评审 · 线上")
t2 = Tag("重要", i2, "sm", "warning")
i2 = Icon("star", "status")
free = EntityList([{ left: "下午空档", right: "14:00–15:00", rightVariant: "text" }], "default")
btns = Buttons([Button("周会挪到 14:00", @ToAssistant("把产品周会挪到明天 14:00，并通知参会人"), "primary"), Button("评审改期", @ToAssistant("问供应商评审能不能改到后天"), "secondary")])
\`\`\``,
  ...official.examples,
]

// every example must parse cleanly against the library
const schema = library.toJSONSchema()
for (const ex of examples) {
  const code = ex.includes('```openui-lang') ? ex.split(/```openui-lang[^\n]*\n/)[1].split('```')[0] : ex.slice(ex.indexOf('root = '))
  const r = createStreamingParser(schema, library.root).set(code, true)
  const bad = [...(r.meta?.errors || []), ...(r.meta?.unresolved || []).map((u) => 'unresolved ' + u)]
  if (bad.length || !r.root) throw new Error('example does not parse: ' + JSON.stringify(bad).slice(0, 600) + '\n' + code.slice(0, 400))
}

const prompt = library.prompt({ ...official, preamble, additionalRules, examples })
fs.writeFileSync(path.join(root, 'tianxi/plugins/genui-prompt.md'), prompt + '\n')

fs.mkdirSync(path.join(root, 'tianxi/web/genui'), { recursive: true })
await esbuild.build({
  entryPoints: [path.join(here, 'entry.jsx')],
  bundle: true, format: 'iife', globalName: 'OpenUI', minify: true, target: 'chrome120', legalComments: 'none',
  jsx: 'automatic', loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: '/* OpenUI (github.com/thesysdev/openui, MIT): chat component library, React renderer and lang-core, with React (MIT), Radix UI (MIT), Recharts (MIT), lucide (ISC) and zod (MIT). Built by build/genui/build.mjs. */' },
  outfile: path.join(root, 'tianxi/web/genui/openui.js'),
})
fs.copyFileSync(path.join(here, 'node_modules/@openuidev/react-ui/dist/components/index.css'), path.join(root, 'tianxi/web/genui/openui.css'))
const size = (f) => (fs.statSync(path.join(root, 'tianxi/web/genui', f)).size / 1024).toFixed(0) + ' KB'
console.log('prompt', prompt.length, 'chars; openui.js', size('openui.js'), '; openui.css', size('openui.css'))
