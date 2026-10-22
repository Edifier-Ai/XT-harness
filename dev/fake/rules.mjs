const after = (u, k) => (u.split(k)[1] || u).replace(/^[：:，,\s]+/, '').slice(0, 60)
const lastToolText = (msgs) => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'tool') { const c = msgs[i].content; return typeof c === 'string' ? c : (c || []).map((p) => p.text || '').join('') } return '' }
const lastToolJSON = (msgs) => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'tool') { try { const c = msgs[i].content; return JSON.parse(typeof c === 'string' ? c : c.map(p => p.text).join('')) } catch { return null } } return null }
// 钉到桌面 · 我的工具: a weather card, its updates and a button pressed on it; a meeting countdown that has run out
const hm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
const weather = (city, now, note) => '```openui-lang 城市天气\n' + [
  'root = Card([header, stats, form])',
  `header = CardHeader("${city}天气", "${note}")`,
  'stats = SnippetCardBlock([s1, s2, s3], "grid", true)',
  `s1 = SnippetCardItem("now", IconText(Icon("thermometer", "weather"), "neutral", "m", "现在", "小雨"), BoldText("number", "${now}°"))`,
  's2 = SnippetCardItem("high", IconText(Icon("sun", "weather"), "neutral", "m", "最高"), BoldText("number", "25°"))',
  's3 = SnippetCardItem("rain", IconText(Icon("umbrella", "weather"), "neutral", "m", "降雨"), BoldText("number", "60%"))',
  'form = Form("city", btns, [fc])',
  'fc = FormControl("换个城市", Select("city", [o1, o2, o3], "选城市"))',
  'o1 = SelectItem("sh", "上海")',
  'o2 = SelectItem("bj", "北京")',
  'o3 = SelectItem("sz", "深圳")',
  'btns = Buttons([Button("看这个城市", @ToAssistant("换成这个城市的天气"), "primary")])',
].join('\n') + '\n```'
const cityOf = (u) => /北京|bj/.test(u) ? '北京' : /深圳|sz/.test(u) ? '深圳' : '上海'
// 圆桌: who is speaking comes from the Bot's own system prompt
const said = (u) => [...u.split('发言：')[1]?.split('\n\n')[0].matchAll(/^(?:（回应）)?([^：\n]+)：/gm) || []].map((m) => m[1])
export default [
  // 拖给小天: a file is read first; what it says and offers comes from what was read
  { re: /【拖给你】[\s\S]*- (表格|文档|文件)：/, steps: [{ tool: 'read', args: (u) => ({ file_path: /- (?:表格|文档|文件)：(.+?)（/.exec(u)[1] }) }],
    final: (u, msgs) => { const t = lastToolText(msgs); const n = new Set(t.match(/供应商[A-Z]/g) || []).size
      return n ? JSON.stringify({ say: `一份报价单，列了 ${n} 家供应商`, actions: [{ label: '比一比报价', ask: '把这份报价单里各家的报价比一比' }, { label: '写成一段话', ask: '把这份报价单写成一段话' }] }) : JSON.stringify({ say: '没读出内容', actions: [] }) } },
  { re: /【拖给你】[\s\S]*- 一段文字：/, final: (u) => /评审/.test(u) ? JSON.stringify({ say: '一段会议安排：周五下午三点方案评审', actions: [{ label: '加进日程', ask: '把这段文字里的会议加进日程' }, { label: '记下来', ask: '把这段文字记到记忆里' }] }) : JSON.stringify({ say: '一段文字', actions: [] }) },
  { re: /【拖给你】[\s\S]*- (图片|窗口截图)：/, final: (u) => JSON.stringify({ say: /窗口截图/.test(u) ? `这是「${(/「(.+?)」，刚截的/.exec(u) || [, '一个窗口'])[1]}」的窗口` : '一张图片', actions: [{ label: '说说内容', ask: '说说这张图里有什么' }] }) },
  { re: /^把这份报价单里各家的报价比一比/, final: () => '比过了：供应商B 最便宜。' },
  { re: /^把这段文字里的会议加进日程/, tool: 'calendar_add', args: () => ({ title: '方案评审', start: '2026-10-23T15:00', end: '2026-10-23T16:00', reason: '你拖给我的那段文字里写的' }), final: () => '已经加进日程：周五 15:00 方案评审。' },
  { sys: /你是“小天”/, re: /【圆桌·第一轮】/, final: () => '我倾向坐高铁：深圳北站离华贸近，路上还能改材料，晚点也不怕。' },
  { re: /【圆桌·第一轮】/, final: () => '我建议坐飞机：北京到深圳高铁要 8 小时，飞机 3 个多小时，能省下半天。' },
  { sys: /你是“小天”/, re: /【圆桌·第二轮】/, final: () => '飞机确实省时间，但要避开红眼航班；我还是偏高铁。' },
  { re: /【圆桌·第二轮】/, final: () => '同意不坐红眼，选白天的航班就行，我还是选飞机。' },
  { re: /整理成一张分歧卡/, final: (u) => { const [a, b] = [...new Set(said(u))]; return JSON.stringify({ agree: ['不坐红眼航班'], splits: [{ point: '坐飞机还是高铁', sides: [{ agent: a, stance: '高铁，离客户近、路上能干活' }, { agent: b, stance: '飞机，省下半天' }] }], options: [{ label: '坐高铁', agents: [a], memory: '去深圳出差优先坐高铁' }, { label: '坐白天的航班', agents: [b], memory: '去深圳出差坐白天的航班' }] }) } },
  { re: /用户点了赞/, final: (u) => (/^(.+?)（/.exec(u) || [, '小天'])[1] + '：后台汇总周报时，把要点加进待办' },
  { re: /【动态里的纠正】/, steps: [{ tool: 'memory_save', args: (u) => ({ text: '周报要点不要加进待办，发邮件给我', kind: '偏好', quote: (/「(.+?)」/.exec(u.split('评论：')[1] || '') || [, ''])[1] }) }], final: () => '好的，以后周报要点直接发邮件给你，不再加进待办。' },
  { re: /【试用期·方案没通过】/, final: () => '明白了，下次我先问你哪些文件不能动。' },
  { re: /让大家讨论一下/, tool: 'roundtable_start', args: (u) => ({ question: after(u, '讨论一下') }), final: () => '好，我叫上大家开了个圆桌，讨论完你来拍板。' },
  { re: /【试用期·方案通过】/, steps: [
      { tool: 'folder_list', args: () => ({ path: process.env.FAKE_DIR || '~/Downloads' }) },
      { tool: 'file_move', args: (u, msgs) => { const r = lastToolJSON(msgs); const f = r?.items?.find(i => !i.dir); return { from: r.dir + '/' + (f?.name || 'none'), to: r.dir + '/文档/' + (f?.name || 'none'), reason: '照你同意的方案' } } } ],
    final: () => '照方案做好了，文档已经归到“文档”里。' },
  { sys: /你在试用期/, re: /^(?![\s\S]*【试用期)[\s\S]*整理/, steps: [
      { tool: 'folder_list', args: () => ({ path: process.env.FAKE_DIR || '~/Downloads' }) },
      { tool: 'plan_propose', args: (u, msgs) => { const r = lastToolJSON(msgs); const f = r?.items?.find(i => !i.dir); return { title: '把下载文件夹里的文档归到“文档”', steps: [`把 ${f?.name || '文件'} 移到 文档/`], why: '你说要整理下载文件夹' } } } ],
    final: () => '我先交了一个方案，你看看行不行。' },
  { re: /【桌面小组件·更新】/, final: (u) => /会议倒计时/.test(u) ? '退场：评审会已经开完了'
    : `刷新：每 30 分钟\n到期：不会到期\n${weather(cityOf(u.split('它现在是这样')[1] || u), 20 + (new Date().getSeconds() % 7), hm() + ' 的天气')}` },
  { re: /【桌面小组件·用户操作】/, final: (u) => { const c = cityOf(u.split('当初用户说的是')[0].split('它现在是这样')[0].replace(/「[^」]*」/, '')); return `已经换成${c}了。\n${weather(c, 18, hm() + ' 的天气')}` } },
  { re: /天气/, final: (u) => `${cityOf(u)}现在 21°，下午有小雨。\n\n${weather(cityOf(u), 21, hm() + ' 的天气')}` },
  { re: /倒计时/, final: () => '评审会还有 40 分钟。\n\n```openui-lang 会议倒计时\nroot = Card([h, t])\nh = CardHeader("评审会倒计时", "15:00 开始")\nt = TextContent("还有 40 分钟", "large-heavy")\n```' },
  { re: /【小天反思】|天禧反思/, tool: 'reflection_publish', args: (u) => { const ids = [...u.matchAll(/\[(mem_[0-9a-f]+)\]/g)].map((m) => m[1]); return { profile: '你是做交互创新的人，做决定看证据，讨厌空话；最近在忙概念版天禧。', insights: [{ text: '你出差很在意时间成本：不坐红眼航班，但要离客户近。', memIds: ids.slice(0, 2), evidence: ['我出差不坐红眼航班'] }], proposals: [{ op: 'merge', ids: ids.slice(0, 2), text: '出差：不坐红眼航班，酒店离客户近', why: '两条说的是同一件事' }, { op: 'add', text: '汇报材料偏好白底黑字', kind: '偏好', why: '你说过两次' }], lessons: [{ text: '整理文件前先问一句要不要建子文件夹', why: '你撤回过一次整理' }] } }, final: () => '想完了。' },
  { re: /给出差助理/, steps: [
      { tool: 'mail_draft', args: () => ({ to: 'trip@agent.local', subject: '下周深圳出差', body: '下周三去深圳拜访华贸电子，帮忙订机票酒店，用户不坐红眼航班。', reason: '订票是出差助理的分工' }) },
      { tool: 'mail_send', args: (u, msgs) => ({ id: lastToolJSON(msgs)?.draft?.id || 'x', reason: '交给出差助理' }) } ],
    final: () => '已经交给出差助理了，它订好会回信。' },
  { re: /【新邮件】/, steps: [
      { tool: 'memory_search', args: () => ({ query: '出差 航班' }) },
      { tool: 'show_ui', args: () => ({ title: '深圳 · 机票备选', blocks: [{ type: 'table', columns: ['航班', '时间', '价格'], rows: [['CA1301', '07:00–10:20', '¥1,280'], ['ZH9102', '08:30–11:45', '¥980']] }, { type: 'choices', options: [{ label: '订 ZH9102', say: '订 ZH9102', primary: true }, { label: '再看看', say: '再看看别的' }] }] }) } ],
    final: () => '收到天禧的委托：下周三去深圳。给你挑了两班白天的航班，选一个我就订。' },
  { re: /每日简报|今日简报/, steps: [
      { tool: 'calendar_list', args: () => ({}) },
      { tool: 'todo_list', args: () => ({}) },
      { tool: 'brief_publish', args: () => ({ greeting: '早上好', summary: '今天 3 个会，下午两个撞了；下载里来了报价单和两张现场照片。', hero: { title: '下午 15:00 评审和走查撞了', text: '走查可以挪到周五 10:00，杨润那边周五上午有空。' }, sections: [
        { kind: 'decide', size: 'l', title: '评审和走查冲突', detail: '周四 15:00–16:00 两个会重叠', blocks: [{ type: 'schedule', items: [{ start: '10:00', end: '11:00', title: '晨会' }, { start: '15:00', end: '16:00', title: '概念版天禧评审', conflict: true }, { start: '15:30', end: '16:30', title: 'UI 走查', conflict: true }] }], actions: [{ label: '挪走查到周五', say: '把走查挪到周五10点', primary: true }, { label: '先不动', say: '先不动' }] },
        { kind: 'info', size: 'm', title: '下载里的新文件', blocks: [{ type: 'files', items: [{ path: process.env.FAKE_DIR + '/现场1.jpg', note: '华贸产线' }, { path: process.env.FAKE_DIR + '/华贸电子报价单.xlsx', note: '报价 ¥128,000' }, { path: process.env.FAKE_DIR + '/会议纪要.docx' }] }] },
        { kind: 'done', size: 's', title: '整理了下载文件夹', detail: '12 个文件归档到 4 个子文件夹，可撤回' },
        { kind: 'done', size: 's', title: '竞品周报三条要点已写好', blocks: [{ type: 'bar', unit: '条', items: [{ label: 'OPPO', value: 5 }, { label: 'vivo', value: 3 }, { label: '荣耀', value: 2 }] }] },
        { kind: 'doing', size: 's', title: '出差助理在订下周深圳的机票', blocks: [{ type: 'progress', items: [{ label: '已比价 6 班航班', value: 0.6 }] }] } ] }) } ],
    final: () => '今天的首页准备好了。' },
  { re: /晚点|有空/, tool: 'later_add', args: () => ({ title: '汇总竞品周报', instructions: '汇总本周竞品动态，写成三条要点', when: 'idle', reason: '你说有空再做' }), final: () => '好，等你离开电脑时我再做。' },
  { re: /汇总本周竞品/, tool: 'todo_add', args: () => ({ title: '看竞品周报三条要点', reason: '后台任务产出' }), final: () => '竞品周报三条要点：1. A 2. B 3. C' },
  { re: /记住/, tool: 'memory_save', args: (u) => ({ text: after(u, '记住'), kind: '偏好', quote: u }), final: () => '记住了。' },
  { re: /行程|排一下/, tool: 'show_ui', args: () => ({ title: '深圳 · 供应商走访', subtitle: '10/20–10/21', blocks: [
      { type: 'timeline', items: [{ time: '07:00', title: 'CA1301 北京→深圳' }, { time: '11:30', title: '华贸电子', tag: '待确认' }] },
      { type: 'form', fields: [{ key: 'flight', label: '航班偏好', kind: 'select', options: ['最早到', '最省钱', '最舒适'], value: '最早到' }, { key: 'stay', label: '每家停留', kind: 'range', min: 1, max: 3, step: 0.5, value: 1.5, unit: '小时' }], submit: { label: '重新排', say: '按这些参数重新排行程' } },
      { type: 'choices', options: [{ label: '就这么定', say: '就按这个行程订', primary: true }] } ] }), final: () => '行程排好了，你可以直接调。' },
  { re: /开会|日程|约/, tool: 'calendar_add', args: () => ({ title: '概念版天禧评审', start: '2026-10-22T15:00', end: '2026-10-22T16:00', people: ['杨润'], reason: '你让我约评审' }), final: () => '已经加到周四 15:00。' },
  { re: /发邮件/, steps: [
      { tool: 'mail_draft', args: () => ({ to: '王经理', subject: '合同补签', body: '王经理好，合同第 7 页缺签字页，麻烦补签。', reason: '你让我发补签提醒' }) },
      { tool: 'mail_send', args: (u, msgs) => ({ id: lastToolJSON(msgs)?.draft?.id || 'x', reason: '你让我发出' }) } ],
    final: () => '邮件处理完了。' },
  { re: /整理/, steps: [
      { tool: 'folder_list', args: () => ({ path: process.env.FAKE_DIR || '~/Downloads' }) },
      { tool: 'file_move', args: (u, msgs) => { const r = lastToolJSON(msgs); const f = r?.items?.find(i => !i.dir); return { from: r.dir + '/' + (f?.name || 'none'), to: r.dir + '/文档/' + (f?.name || 'none'), reason: '按类型归档' } } } ],
    final: () => '整理好了，有 1 个文件归到了“文档”。' },
]
