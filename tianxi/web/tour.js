// 功能介绍: shown once after the first start, and again from 我的 → 功能介绍.
// Five pages, one per thing 小天 Bot can do; each has a small picture made of the app's own pieces.
// Uses app.js's store, esc, avatar, agents and S.
;(() => {
  const TX = { id: 'tour-tx', main: true, shape: 'circle' }
  const chip = (t, k = '') => `<span class="tchip ${k}">${t}</span>`
  const PAGES = [
    {
      t: '一群有个性的 Bot',
      d: '小天是你的主 Bot，你还可以再建出差、研发、设计等专职 Bot，各有形象、性格和自己的邮箱。',
      pts: ['在左侧切换 Bot，每个 Bot 记得自己的对话', '小天把事交给别的 Bot 时，对话里会出现交接卡片，做完带回结果', '形象可以挑形状和颜色，也能一句话生成或上传图片'],
      pic: () => `<div class="tp-bots">${['circle', 'bean', 'flower', 'heart', 'drop'].map((s, i) => `<span style="--i:${i}">${avatar(i === 0 ? TX : { id: 'tour' + i, shape: s, color: ['', '#3f7fe6', '#ea6f30', '#57c16f', '#e8479a'][i] }, i === 0 ? 72 : 48, true, false)}</span>`).join('')}</div>`,
    },
    {
      t: '说一句，它去做',
      d: '记日程、建待办、写邮件、整理文件、上网查、跑命令，都能直接交给它。',
      pts: ['做事的每一步在右侧面板里，每一步都能撤回', '发邮件、删文件这类有风险的事，会先停下来问你', '连接应用里能接上地图、飞书、GitHub 等外部应用', '回复里可以带能点的界面：选方案、填表、看图表'],
      pic: () => `<div class="tp-do">${chip('📅 添加日程')}${chip('✉ 起草邮件')}${chip('🗂 整理文件', 'on')}${chip('🔎 搜索网页')}${chip('↩ 撤回这一步', 'ghost')}</div>`,
    },
    {
      t: '不用开口，它也想着你',
      d: '小天会留意你电脑上的变化，在合适的时候把事情整理好给你。',
      pts: ['每日简报：早上整理日程冲突、新文件和等你定的事', '系统感知：留意下载和桌面的新文件，你离开时做排着的事', '桌面小天：随处可拖的悬浮球，表情告诉你它在做什么'],
      pic: () => `<div class="tp-brief"><div class="tb-k">需要你定</div><div class="tb-t">下午两个会撞了</div><div class="tb-r"><i></i><i class="c"></i><i class="c"></i></div><div class="tb-b">${chip('走查挪到周五', 'on')}${chip('先不管')}</div></div>`,
    },
    {
      t: '越用越懂你',
      d: '你说过的偏好、习惯和正在做的事，小天会记下来，所有 Bot 共用。',
      pts: ['我的记忆：一张星图，每条都有出处，能改能删', '夜里反思：你不在时回想一天，提出整理记忆的建议，你点采纳才生效', '操作记录：替你做过的每件事都在这里，能撤回的随时撤回', '隐私模式：开着时，对话不会进入你的记忆'],
      pic: () => `<div class="tp-mem"><span class="core">${avatar(TX, 46, true, false)}</span>${[[18, 22], [78, 18], [86, 62], [14, 70], [54, 84], [40, 10]].map(([x, y], i) => `<i style="left:${x}%;top:${y}%;--i:${i}"></i>`).join('')}</div>`,
    },
    {
      t: '想怎么用都行',
      d: '打字、说话、换模型，按你顺手的方式来。',
      pts: ['麦克风说话转文字，波形按钮进入语音通话', '免费模式：借用已登录的 Qoder、WorkBuddy，或用智谱的免费模型', '对话框里随时切换模型和思考深度', '深色、浅色主题；新版本自动下载，重启就用上'],
      pic: () => `<div class="tp-use"><div class="tu-in"><span>给 小天 发消息</span><b class="mic"></b><b class="wave"><i></i><i></i><i></i><i></i></b></div>${chip('GLM-4.7-Flash · 免费')}${chip('思考：标准', 'ghost')}</div>`,
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
