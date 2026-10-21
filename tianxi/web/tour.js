// 功能介绍: shown once after the first start, and again from the avatar menu → 功能介绍.
// Five pages, one per thing 小天 Bot can do; each has a small picture made of the app's own pieces.
// Uses app.js's store, esc, avatar, agents and S.
;(() => {
  const TX = { id: 'tour-tx', main: true, shape: 'circle' }
  const chip = (t, k = '') => `<span class="tchip ${k}">${t}</span>`
  const bot = (i, size = 30) => avatar({ id: 'tour' + i, shape: ['bean', 'flower', 'heart', 'drop'][i], color: ['#3f7fe6', '#ea6f30', '#57c16f', '#e8479a'][i] }, size, true, false)
  const PAGES = [
    {
      t: '一群有个性的 Bot',
      d: '小天是你的主 Bot，你还可以再建出差、研发、设计等专职 Bot，各有形象、性格和自己的邮箱。',
      pts: ['在左侧切换 Bot，每个 Bot 记得自己和你的对话', '小天会把事交给合适的 Bot，交接在对话里一行带过，做完带回结果', '形象可以挑形状和颜色，也能一句话生成或上传图片'],
      pic: () => `<div class="tp-bots"><span style="--i:0">${avatar(TX, 72, true, false)}</span>${[0, 1, 2, 3].map((i) => `<span style="--i:${i + 1}">${bot(i, 48)}</span>`).join('')}</div>`,
    },
    {
      t: '生成式 UI',
      d: '回复不只是文字。需要比较、挑选、填写、确认的时候，小天直接在对话里画出能点的界面。',
      pts: ['挑方案、填表、选日期，点一下就交回给它接着做', '账单、进度、行程用图表、时间线和清单来看', '每日简报的每张卡片也是现场生成的'],
      pic: () => `<div class="tp-ui"><div class="tu-h">周末杭州 · 选一个玩法</div><div class="tu-opts"><span class="on"><b>西湖慢逛</b><small>步行 6 公里</small></span><span><b>龙井喝茶</b><small>半天山里</small></span></div><div class="tu-bars">${[46, 72, 58, 90, 64].map((h, i) => `<i style="height:${h}%;--i:${i}"></i>`).join('')}</div><div class="tu-go">${chip('就这样，帮我订', 'on')}</div></div>`,
    },
    {
      t: '系统感知与主动服务',
      d: '小天留意你电脑上的变化，不用你开口，在合适的时候把事情整理好。',
      pts: ['系统感知：留意下载、桌面里的新文件，你离开或夜里做排着的事', '每日简报：早上把日程冲突、新文件和等你定的事整理成一页', '桌面小天：随处可拖的悬浮球，表情告诉你它在做什么', '有风险的事先停下来问你，做过的每一步都能撤回'],
      pic: () => `<div class="tp-brief"><div class="tb-k">需要你定</div><div class="tb-t">下午两个会撞了</div><div class="tb-r"><i></i><i class="c"></i><i class="c"></i></div><div class="tb-b">${chip('走查挪到周五', 'on')}${chip('先不管')}</div></div>`,
    },
    {
      t: '一切皆插件',
      d: '小天会的本事都能插拔：用哪些、接哪些、换哪个模型，你说了算。',
      pts: ['连接应用：接上地图、飞书、GitHub、Notion、浏览器，或自己添加', '日程、邮件、文件、网页这些自带能力，也能一项项开关', '模型也是插件：接自己的 Key，或用免费模式，对话里随时切换', '语音输入、语音通话同样按需打开'],
      pic: () => `<div class="tp-plug">${[['高', '#2a8cf7', 1], ['飞', '#3370ff', 1], ['G', '#f2f2f2', 0, '#111'], ['N', '#f2f2f2', 1, '#111'], ['历', '#3f7fe6', 1], ['✉', '#e8483f', 0], ['⌖', '#0e8a6a', 1], ['AI', '#6a4cf0', 1]].map(([t, c, on, fg], i) => `<span style="--i:${i}"><b style="background:${c};color:${fg || '#fff'}">${t}</b><i class="${on ? 'on' : ''}"></i></span>`).join('')}</div>`,
    },
    {
      t: '让记忆流转起来',
      d: '你说过的偏好、习惯和正在做的事，记一次，所有 Bot 都知道，交接时也跟着走。',
      pts: ['我的记忆：一张星图，每条都有出处，能改能删', '记忆在 Bot 之间共用，换个 Bot 不用再说一遍', '夜里反思：把记忆合并、更新、补全，你点采纳才生效', '隐私模式：开着时，对话不会进入你的记忆'],
      pic: () => `<div class="tp-flow"><svg viewBox="0 0 240 220" class="fl">${[[40, 40], [200, 44], [208, 176], [34, 172]].map(([x, y]) => `<path d="M120 110 L${x} ${y}"/>`).join('')}</svg><span class="core">${avatar(TX, 54, true, false)}</span>${[[40, 40], [200, 44], [208, 176], [34, 172]].map(([x, y], i) => `<span class="sat" style="left:${x}px;top:${y}px">${bot(i)}</span>`).join('')}${[0, 1, 2, 3].map((i) => `<i class="pk" style="--i:${i}"></i>`).join('')}</div>`,
    },
  ]
  let at = 0, el = null
  function render(dir = 0) {
    const p = PAGES[at], last = at === PAGES.length - 1
    el.innerHTML = `<div class="tbox" role="dialog" aria-label="功能介绍">
      <button class="tx-close" data-tour="close" title="跳过">✕</button>
      <div class="tpic"><div class="tglow"></div><div class="tart ${dir > 0 ? 'in-r' : dir < 0 ? 'in-l' : ''}">${p.pic()}</div></div>
      <div class="tbody">
        <div class="tnums">${PAGES.map((_, i) => `<button class="${i === at ? 'on' : i < at ? 'past' : ''}" data-tour="go" data-i="${i}">${i + 1}</button>`).join('')}</div>
        <div class="tcopy ${dir > 0 ? 'in-r' : dir < 0 ? 'in-l' : ''}">
          <h2>${esc(p.t)}</h2><p>${esc(p.d)}</p>
          <ul>${p.pts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>
        <div class="tfoot">${at ? '<button class="tb2" data-tour="prev">上一步</button>' : '<span></span>'}<button class="tb1" data-tour="${last ? 'close' : 'next'}">${last ? '开始使用' : '下一步'}</button></div>
      </div></div>`
  }
  function go(i) { const d = Math.sign(i - at); at = Math.max(0, Math.min(PAGES.length - 1, i)); render(d) }
  function close() {
    store.set('tourSeen', 1)
    el.classList.add('out'); setTimeout(() => { el.remove(); el = null }, 260)
  }
  window.openTour = () => {
    if (el) return
    at = 0; el = document.createElement('div'); el.className = 'tour'; document.body.appendChild(el); render()
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tour]'); if (!b) { if (e.target === el) close(); return }
      const a = b.dataset.tour
      if (a === 'close') close(); else if (a === 'next') go(at + 1); else if (a === 'prev') go(at - 1); else if (a === 'go') go(+b.dataset.i)
    })
  }
  addEventListener('keydown', (e) => {
    if (!el) return
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(at + 1); else if (e.key === 'ArrowLeft') go(at - 1)
  })
})()
