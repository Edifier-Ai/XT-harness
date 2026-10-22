const after = (u, k) => (u.split(k)[1] || u).replace(/^[：:，,\s]+/, '').slice(0, 60)
const lastToolJSON = (msgs) => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'tool') { try { const c = msgs[i].content; return JSON.parse(typeof c === 'string' ? c : c.map(p => p.text).join('')) } catch { return null } } return null }
// 钉到桌面 · 我的工具: a weather card, its updates and a button pressed on it; a meeting countdown that has run out
const hm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
const weather = (city, now, note) => '```openui-lang 城市天气\n' + [
  'root = Card([header, stats, form])',
  `header = CardHeader("${city}天气", "${note}")`,
  'stats = StatBlock([s1, s2, s3])',
  `s1 = Stat("现在", "${now}°", "小雨")`,
  's2 = Stat("最高", "25°")',
  's3 = Stat("降雨", "60%")',
  'form = Form("city", btns, [fc])',
  'fc = FormControl("换个城市", Select("city", [o1, o2, o3], "选城市"))',
  'o1 = SelectItem("sh", "上海")',
  'o2 = SelectItem("bj", "北京")',
  'o3 = SelectItem("sz", "深圳")',
  'btns = Buttons([Button("看这个城市", @ToAssistant("换成这个城市的天气"), "primary")])',
].join('\n') + '\n```'
const cityOf = (u) => /北京|bj/.test(u) ? '北京' : /深圳|sz/.test(u) ? '深圳' : '上海'
export default [
  { re: /【桌面小组件·更新】/, final: (u) => /会议倒计时/.test(u) ? '退场：评审会已经开完了'
    : `刷新：每 30 分钟\n到期：不会到期\n${weather(cityOf(u.split('它现在是这样')[1] || u), 20 + (new Date().getSeconds() % 7), hm() + ' 的天气')}` },
  { re: /【桌面小组件·用户操作】/, final: (u) => { const c = cityOf(u.split('\n').slice(0, 2).join('\n').replace(/「[^」]*」/, '')); return `已经换成${c}了。\n${weather(c, 18, hm() + ' 的天气')}` } },
  { re: /天气/, final: (u) => `${cityOf(u)}现在 21°，下午有小雨。\n\n${weather(cityOf(u), 21, hm() + ' 的天气')}` },
  { re: /倒计时/, final: () => '评审会还有 40 分钟。\n\n```openui-lang 会议倒计时\nroot = Card([h, t])\nh = CardHeader("评审会倒计时", "15:00 开始")\nt = TextContent("还有 40 分钟", "large-heavy")\n```' },
  { re: /天禧反思/, tool: 'reflection_publish', args: (u) => { const ids = [...u.matchAll(/\[(mem_[0-9a-f]+)\]/g)].map((m) => m[1]); return { profile: '你是做交互创新的人，做决定看证据，讨厌空话；最近在忙概念版天禧。', insights: [{ text: '你出差很在意时间成本：不坐红眼航班，但要离客户近。', memIds: ids.slice(0, 2), evidence: ['我出差不坐红眼航班'] }], proposals: [{ op: 'merge', ids: ids.slice(0, 2), text: '出差：不坐红眼航班，酒店离客户近', why: '两条说的是同一件事' }, { op: 'add', text: '汇报材料偏好白底黑字', kind: '偏好', why: '你说过两次' }], lessons: [{ text: '整理文件前先问一句要不要建子文件夹', why: '你撤回过一次整理' }] } }, final: () => '想完了。' },
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
