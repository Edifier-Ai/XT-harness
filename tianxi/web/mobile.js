// 小天 Bot on a phone: the same page as the desktop client, laid out as an app with four tabs (Bot · 简报 · 电脑 · 我的).
// It turns on for narrow screens outside the desktop client (index.html decides) and wraps a few of app.js's functions
// (setView, renderPage, renderAll, openProc, openModal) to add what only a phone has: the 电脑 tab, where UU 远程 shows the
// computer's screen and lets you take over, the 我的 tab, and back navigation.
// In the 小天 App (Android) window.XiaotianNative opens UU 远程, scans pairing codes and remembers the computers paired with.
'use strict'
;(() => {
  if (!window.MOB) return
  const H = document.documentElement
  const NATIVE = window.XiaotianNative || null
  const nat = (fn, d) => { try { return NATIVE ? fn() : d } catch { return d } }
  const UU_DL = 'https://uuyc.163.com/'
  // the phone's app store first (UU 远程's package is com.netease.uuremote), else its website
  const uuGet = () => nat(() => NATIVE.openUrl('market://details?id=com.netease.uuremote') || NATIVE.openUrl(UU_DL))
  const APK = 'https://github.com/Edifier-Ai/XT-harness/releases/latest'
  const ROOTS = { bots: 'chat', brief: 'brief', pc: 'mpc', me: 'mme' }
  let mtab = 'bots', inChat = false, hello = null, online = true, booted = false
  const SV = {
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    chat: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/></svg>',
    eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    hand: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.5 7-6.5 7-2.6 0-4.2-1.3-5.6-3.4L3.4 13.6a1.5 1.5 0 0 1 2.5-1.7L8 14.5"/></svg>',
    plus: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    apps: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
    scan: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/></svg>',
    unlink: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9.5 14.5l5-5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2"/></svg>',
  }

  // ---------- the parts app.js does not have: tab bar, host strip, back button, "doing" strip, the sheet's shade ----------
  document.body.insertAdjacentHTML('beforeend', `<nav class="mtabs" id="mtabs" aria-label="主导航">
    <button data-mtab="bots">${SV.chat}<span>Bot</span></button>
    <button data-mtab="brief">${ico('brief', 23)}<span>简报</span><i class="mdot" id="mdBrief" hidden></i></button>
    <button data-mtab="pc">${ico('comp', 23)}<span>电脑</span><i class="mdot live" id="mdPc" hidden></i></button>
    <button data-mtab="me">${ico('me', 23)}<span>我的</span><i class="mdot" id="mdMe" hidden></i></button></nav>
    <div class="mshade" id="mshade"></div>
    <div class="munpaired" id="munpaired" hidden></div>`)
  const rtop = $('.rtop')
  rtop.insertAdjacentHTML('afterbegin', `<button class="mme" data-mtab="me" aria-label="我的"><span class="uav" id="mmeAv">你</span><i class="n" id="mmeN" hidden></i></button><div class="mtitle">小天 Bot</div>`)
  rtop.insertAdjacentHTML('afterend', '<button class="mhost" id="mhost" data-mtab="pc"></button>')
  $('.chead').insertAdjacentHTML('afterbegin', `<button class="rb mback" data-act="m-back" aria-label="返回">${SV.back}</button>`)
  $('.chead').insertAdjacentHTML('beforeend', `<button class="rb mpcb" data-mtab="pc" aria-label="看电脑">${ico('comp', 19)}<i class="mdot live" id="mdHead" hidden></i></button>`)
  $('#vChat .composer').insertAdjacentHTML('beforebegin', '<button class="mdoing" id="mdoing" data-act="m-watch" hidden></button>')

  // ---------- where we are ----------
  const isSub = () => !['chat', 'brief', 'mpc', 'mme'].includes(view)
  function sync() {
    const chat = view === 'chat'
    H.classList.toggle('m-chat', chat && inChat)
    H.classList.toggle('m-bots', chat && !inChat)
    H.classList.toggle('m-page', !chat)
    H.classList.toggle('m-sub', !chat && isSub())
    document.querySelectorAll('#mtabs [data-mtab]').forEach((b) => b.classList.toggle('on', b.dataset.mtab === mtab))
    $('#mshade').classList.toggle('on', chat && inChat && panelOn())
  }
  // Every step forward (a chat, a page under 我的, the steps sheet, a dialog) is one entry in the history and remembers the
  // screen it left, so the phone's back gesture and the App's back key walk back the way you came.
  const roots = new Set(Object.values(ROOTS))
  const atRoot = () => (view === 'chat' ? !inChat : roots.has(view))
  const stack = []
  const forward = () => { stack.push({ mtab, view, viewArg, inChat, cur }); try { history.pushState({ m: stack.length }, '') } catch {} }
  addEventListener('popstate', () => {
    if (modal) closeModal()
    else if (panelOn() && inChat) closeProc()
    const s = stack.pop(); if (!s) return
    mtab = s.mtab; inChat = s.inChat; cur = s.cur
    if (!(s.view === 'chat' && s.inChat) && panelOn()) closeProc()
    _setView(s.view, s.viewArg); sync()
  })
  window.mobBack = () => { if (stack.length) { history.back(); return true } return false }
  function go(tab) {
    if (!atRoot()) forward()
    mtab = tab; inChat = false
    if (panelOn()) closeProc()
    _setView(ROOTS[tab]); sync()
  }

  // ---------- wrapping app.js ----------
  const _setView = setView
  setView = (v, arg) => {
    if (v === 'settings' || v === 'plugins') return _setView(v, arg)
    if (v === 'chat') { if (!(view === 'chat' && inChat)) forward(); inChat = true }
    else if (roots.has(v)) { if (!atRoot()) forward(); mtab = Object.keys(ROOTS).find((k) => ROOTS[k] === v); inChat = false }
    else { forward(); inChat = false }
    _setView(v, arg); sync()
  }
  const _openProc = openProc
  openProc = (sel, tab) => { if (!panelOn()) forward(); _openProc(sel, tab); sync() }
  const _openModal = openModal
  openModal = (kind, tab) => { if (!modal) forward(); _openModal(kind, tab) }
  const _renderPage = renderPage
  renderPage = () => {
    if (view !== 'mpc' && view !== 'mme') {
      _renderPage()
      // a page opened from somewhere (记忆, 操作记录, a Bot's profile) gets a way back
      const ph = $('#pg .phead')
      if (isSub() && ph && !ph.querySelector('.mback2')) ph.insertAdjacentHTML('afterbegin', `<button class="rb mback2" data-act="m-back" aria-label="返回">${SV.back}</button>`)
      return
    }
    const P = $('#pg'), y = $('#vPage').scrollTop
    P.innerHTML = view === 'mpc' ? pagePC() : pageMe()
    if (entering) { entering = false; $('#vPage').scrollTop = 0; replay(P, 'fade') } else $('#vPage').scrollTop = y
  }
  const _renderAll = renderAll
  renderAll = (keep) => { _renderAll(keep); booted = true; mrender() }

  // ---------- this computer ----------
  const pcName = () => hello?.pc || S.device || '电脑'
  const osName = () => ({ win32: 'Windows', darwin: 'Mac', linux: 'Linux' }[hello?.platform] || '')
  const busyAgents = () => agents().filter((a) => busy(a.id))
  function hostLine() {
    if (!online) return '<i class="off"></i><span>连不上，看看手机和电脑是不是在同一个 Wi-Fi</span>'
    if (S.takeover?.how === 'full') return '<i class="warn"></i><span>你在接手 · Bot 停着等你</span>'
    const b = busyAgents()[0]
    return `<i></i><span>在线${b ? ` · ${esc(b.name)}${esc(nowDoing(b.id))}` : ''}</span>`
  }
  function mrender() {
    if (!booted) return
    $('#mmeAv').textContent = userInitial()
    const { open, nr } = openCount()
    setCount($('#mmeN'), open + nr); $('#mmeN').hidden = !(open + nr)
    $('#mdMe').hidden = !nr; $('#mdBrief').hidden = !open
    const working = busyAgents().length > 0
    $('#mdPc').hidden = !working; $('#mdHead').hidden = !working
    $('#mhost').innerHTML = `<span class="mi">${ico('comp', 19)}</span><span class="mt"><b>${esc(pcName())}</b><small>${hostLine()}</small></span>${ico('chev', 16)}`
    // what this bot is doing on the computer, one tap from watching it there
    const d = $('#mdoing')
    // (a question waiting for you is already a card in the chat)
    if (view === 'chat' && (busy(cur) || S.takeover?.how === 'full') && !S.approvals.some((x) => x.agent === cur)) {
      const a = agentOf(cur)
      d.hidden = false
      d.innerHTML = `<span class="eq"><i></i><i></i><i></i></span><span class="m"><b>${S.takeover?.how === 'full' ? '你在接手电脑，' + esc(a.name) + '停着等你' : esc(a.name) + esc(nowDoing(cur))}</b><small>${esc(pcName())}</small></span><span class="go">${S.takeover?.how === 'full' ? '交还' : '看着'}</span>`
    } else d.hidden = true
    sync()
  }

  // ---------- UU 远程: watch in a small window, or take over full screen ----------
  const UU_ERR = {
    no_device: '你的 UU 账号下还没有电脑。先在电脑上装好 UU 远程，和手机登录同一个账号。', user_cancel: '', timeout: '选电脑超时了，再试一次。',
    not_logined: '手机上的 UU 远程还没登录。', superseded: '', logout: 'UU 远程退出登录了，登录后再试。', internal_error: 'UU 远程出了点问题，再试一次。',
    busy: '这台电脑正被别的设备远程控制。', device_offline: '电脑不在线：UU 远程没打开或者没联网。', device_not_found: 'UU 里找不到这台电脑了，重新选一次。',
    pip_unsupported: '这台手机不支持小窗，换成全屏接手。', login_timeout: 'UU 远程登录超时了。', network_unavailable: '手机没有网络。', not_allowed: 'UU 远程不允许这次操作。',
    connect_timeout: '连接超时了，再试一次。', connect_failed: '没连上电脑，再试一次。', invalid_request: '请求不对，更新一下小天 App。',
  }
  // taking: 'opening' from asking UU 远程 for full screen until the App goes to the background, then 'away';
  // only coming back from 'away' hands the computer back (the App also comes forward between binding and opening)
  let wantOpen = null, taking = false, opens = 0
  const uuId = () => store.get('uuDevice', '')
  function uuOpen(how) {
    if (!NATIVE) { toastText('看屏幕和接手要用小天 App', ['下载', () => window.open(APK, '_blank')]); return }
    if (!nat(() => NATIVE.uuInstalled(), false)) { toastText('手机上还没装 UU 远程', ['去下载', uuGet]); return }
    const id = uuId()
    if (!id) { wantOpen = how; return uuBind() }
    const url = `uuremote://external/device/control?anonymous_device_id=${encodeURIComponent(id)}&window_type=${how === 'pip' ? 1 : 0}` + (how === 'pip' ? '&callback=' + encodeURIComponent('xiaotian://uu/control') : '')
    if (how === 'full') {
      const n = ++opens
      taking = 'opening'; api('phone/takeover', { on: true, how: 'full' }).catch(() => {})
      setTimeout(() => { if (n === opens && taking === 'opening' && !document.hidden) { handBack(true); toastText('UU 远程没有打开，Bot 接着做') } }, 8000)
    }
    if (!nat(() => NATIVE.openUrl(url), false)) { if (taking) handBack(true); toastText('没能打开 UU 远程') }
  }
  function uuBind() {
    const nonce = Math.random().toString(36).slice(2, 12)
    store.set('uuNonce', nonce)
    const url = `uuremote://external/device/authorize?callback=${encodeURIComponent('xiaotian://uu/authorize')}&nonce=${nonce}`
    if (!nat(() => NATIVE.openUrl(url), false)) toastText('没能打开 UU 远程')
  }
  // UU 远程 answers through the xiaotian:// address the App registered
  window.onXiaotianLink = (href) => {
    let u; try { u = new URL(href) } catch { return }
    const q = u.searchParams
    if (u.pathname.endsWith('/authorize')) {
      if (q.get('nonce') && q.get('nonce') !== store.get('uuNonce', '')) return
      const id = q.get('anonymous_device_id')
      if (id) {
        store.set('uuDevice', id); toastText(`${pcName()} 已在 UU 远程里选好`)
        const how = wantOpen; wantOpen = null; renderAll(true)
        if (how) setTimeout(() => uuOpen(how), 300)
      } else { wantOpen = null; const m = UU_ERR[q.get('error')]; if (m) toastText(m) }
    } else if (u.pathname.endsWith('/control')) {
      if (q.get('status') === 'failure') {
        const r = q.get('reason') || ''
        if (r === 'device_not_found') store.set('uuDevice', '')
        if (taking) handBack(true)
        const m = UU_ERR[r] ?? 'UU 远程没打开小窗。'; if (m) toastText(m)
      }
    }
  }
  // back in the App after taking over: hand the computer back to the Bots
  async function handBack(quiet) {
    taking = false
    await api('phone/takeover', { on: false }).catch(() => {})
    if (!quiet) toastText(`交还给${agentOf(S.mainId).name}了，它接着做`)
  }
  const away = () => { if (taking === 'opening') taking = 'away' }
  const resumed = () => { if (taking === 'away' || (!taking && S.takeover?.how === 'full')) handBack() }
  window.onXiaotianPause = away
  window.onXiaotianResume = resumed
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) away()
    else if (taking === 'away') setTimeout(() => { if (!document.hidden && taking === 'away') handBack() }, 400)
  })

  // ---------- 电脑 ----------
  const wall = () => { const hr = new Date().getHours(); return hr < 6 || hr >= 20 ? 'night' : hr < 11 ? 'morning' : hr < 17 ? 'noon' : 'evening' }
  function pagePC() {
    const take = S.takeover?.how === 'full'
    const uuApp = nat(() => NATIVE.uuInstalled(), false)
    const doing = busyAgents()
    const main = agentOf(S.mainId)
    let h = `<div class="mh"><h2>电脑</h2>${NATIVE ? `<button class="rb" data-act="m-scan" aria-label="再连一台电脑">${SV.plus}</button>` : ''}</div>`
    h += `<div class="mpc"><div class="mpc-h"><div class="m"><b>${esc(pcName())}</b><span>${[osName(), hello ? (hello.uu?.installed ? '装了 UU 远程' : '没装 UU 远程') : ''].filter(Boolean).join(' · ')}</span></div><span class="mon ${online ? 'on' : ''}"><i></i>${online ? '在线' : '连不上'}</span></div>
      <button class="mscr wall-${wall()} ${take ? 'take' : ''}" data-act="m-uu" data-how="pip" aria-label="小窗看着这台电脑">
        <span class="win"><span class="bar"><i></i><i></i><i></i></span><span class="ln"></span><span class="ln s"></span><span class="ln"></span></span>
        <span class="mw">${take ? '' : avatar(doing[0] || main, 26, false, false)}<span>${take ? '你在操作这台电脑，Bot 停着等你' : doing[0] ? esc(doing[0].name) + esc(nowDoing(doing[0].id)) : esc(main.name) + '在待命'}</span></span>
        <span class="tag"><i></i>${NATIVE ? '点开看实时画面 · UU 远程' : '实时画面在小天 App 里看'}</span>
      </button>`
    if (take) h += `<div class="mtake"><span class="m"><b>你在接手这台电脑</b><small>Bot 先停着等你，用完点交还。</small></span><button class="pbtn" data-act="m-handback">交还</button></div>`
    else h += `<div class="mpc-b"><button data-act="m-uu" data-how="pip">${SV.eye}小窗看着</button><button class="pri" data-act="m-uu" data-how="full">${SV.hand}全屏接手</button></div>`
    if (!NATIVE) h += `<div class="mnote">看屏幕和接手要用小天 App（安卓）和 UU 远程。<button class="lk" data-act="open-url" data-u="${APK}">下载小天 App</button></div>`
    else if (!uuApp) h += `<div class="mnote">手机上还没装 UU 远程。<button class="lk" data-act="m-uuget">去下载</button></div>`
    else if (!uuId()) h += `<div class="mnote">第一次用时，在 UU 远程里选一下这台电脑。</div>`
    h += '</div>'
    // what the Bots on this computer are doing, and what they do on their own
    const rows = []
    for (const a of agents()) {
      const ask = S.approvals.find((x) => x.agent === a.id)
      if (ask) rows.push(`<button class="mrow2" data-act="to-agent" data-id="${a.id}">${avatar(a, 32)}<span class="m"><b>${esc(a.name)}等你确认</b><small class="warn">${esc(ask.reason || toolLabel(ask.tool))}</small></span>${ico('chev', 16)}</button>`)
      else if (busy(a.id)) rows.push(`<button class="mrow2" data-act="m-steps" data-id="${a.id}">${avatar(a, 32)}<span class="m"><b>${esc(String(turnTitle(turnsOf(a.id).filter((t) => t.running).pop() || {})).slice(0, 40))}</b><small>${esc(a.name)}${esc(nowDoing(a.id))}</small></span>${ico('chev', 16)}</button>`)
    }
    const st = S.settings || {}
    const jobs = S.later.filter((j) => j.status === 'queued' || j.status === 'running')
    for (const j of jobs) rows.push(`<div class="mrow2"><span class="dot"></span><span class="m"><b>${esc(j.title)}</b><small>${j.status === 'running' ? '正在做' : j.when === 'night' ? '排着，夜里做' : '排着，你离开电脑时做'}</small></span></div>`)
    if (st.briefOn !== false) rows.push(`<div class="mrow2"><span class="dot"></span><span class="m"><b>每日简报</b><small>每天 ${esc(st.briefTime || '08:00')} 左右</small></span></div>`)
    if (st.reflectAtNight !== false) rows.push(`<div class="mrow2"><span class="dot"></span><span class="m"><b>夜里反思</b><small>${esc(st.nightFrom ?? 23)}:00 后，你不在时</small></span></div>`)
    h += `<div class="msec">这台电脑上的 Bot</div><div class="mlist">${rows.join('')}</div>`
    const hosts = nat(() => JSON.parse(NATIVE.hosts() || '[]'), []).filter((x) => !x.current)
    if (hosts.length) h += `<div class="msec">其他电脑</div><div class="mlist">${hosts.map((x) => `<button class="mrow2" data-act="m-host" data-id="${esc(x.id)}"><span class="mi">${ico('comp', 18)}</span><span class="m"><b>${esc(x.name)}</b><small>${esc(x.origin.replace(/^https?:\/\//, ''))}</small></span>${ico('chev', 16)}</button>`).join('')}</div>`
    h += '<div class="mfine">看屏幕和接手由 UU 远程提供：电脑上装好 UU 远程，和手机登录同一个账号。你接手时 Bot 会先停下，交还后接着做。</div>'
    return h
  }

  // ---------- 我的 ----------
  function pageMe() {
    const { open, nr } = openCount()
    const me = S.settings?.callMe || S.user || '你'
    const todaySteps = S.ledger.filter((e) => dayOf(e.at) === todayStr()).length
    const fresh = S.brief && S.brief.date === todayStr()
    const m = curModel()
    const row = (act, icon, label, right = '', extra = '') => `<button class="mrow2" data-act="${act}" ${extra}><span class="mi">${icon}</span><span class="m"><b>${label}</b></span>${right ? `<em>${right}</em>` : ''}${ico('chev', 16)}</button>`
    const apps = (S.apps?.apps || []).filter((a) => a.enabled !== false).length
    return `<div class="mme-h"><span class="uav big">${esc(userInitial())}</span><span class="m"><b>${esc(me)}</b><small>${open + nr ? `${open + nr} 件事等你看` : '没有要你看的事'}</small></span></div>
      <div class="mlist">${row('go', ico('brief', 19), '每日简报', fresh ? `${open ? open + ' 件等你定 · ' : ''}今天 ${hhmm(S.brief.at)}` : '今天还没整理', 'data-v="brief"')}${row('go', ico('memory', 19), '我的记忆', `${S.memories.length} 条`, 'data-v="memory"')}${row('go', ico('reflect', 19), '反思', nr ? `${nr} 条建议` : '', 'data-v="reflect"')}${row('go', ico('ledger', 19), '操作记录', todaySteps ? `今天 ${todaySteps} 步` : '', 'data-v="ledger"')}</div>
      <div class="mlist">${row('m-tab', ico('comp', 19), '电脑', `${esc(pcName())}${online ? '' : ' · 连不上'}`, 'data-t="pc"')}${row('apps', SV.apps, '连接应用', apps ? `已连 ${apps} 个` : '')}${row('go', ico('sense', 19), '系统感知', '', 'data-v="later"')}</div>
      <div class="mlist"><button class="mrow2" data-act="priv"><span class="mi">${ico('priv', 19)}</span><span class="m"><b>隐私模式</b><small>开着时说的话不进记忆</small></span><i class="tg ${S.privateMode ? 'on' : ''}"></i></button>${m ? row('m-model', ico('model', 19), '模型', esc(m.label)) : ''}${row('set-open', ico('settings', 19), '设置', '', 'data-t="general"')}${row('tour', ico('guide', 19), '功能介绍')}</div>
      <div class="mlist"><button class="mrow2 red" data-act="m-unpair"><span class="mi">${SV.unlink}</span><span class="m"><b>断开这台电脑</b></span></button></div>`
  }
  // the models this computer can use, as a sheet
  function modelSheet() {
    const m = curModel(), groups = {}
    for (const x of S.models || []) (groups[x.group] ||= []).push(x)
    const el = document.createElement('div'); el.className = 'msheet'
    el.innerHTML = `<div class="grab"></div><b class="t">换模型</b>${Object.entries(groups).map(([g, list]) => `<div class="pg">${esc(g)}</div>` + list.map((x) => `<button data-model="${esc(x.provider + '|' + x.model)}" class="${x === m ? 'on' : ''}"><span>${esc(x.label)}</span>${x.free ? '<i class="fr">免费</i>' : ''}${x === m ? ico('check', 16) : ''}</button>`).join('')).join('')}<div class="mfine">模型和免费模式在电脑上的 设置 › 模型 里管理。</div>`
    const shade = document.createElement('div'); shade.className = 'mshade on top'
    const close = () => { el.remove(); shade.remove() }
    shade.onclick = close
    el.onclick = (e) => { const b = e.target.closest('[data-model]'); if (!b) return; const [provider, model] = b.dataset.model.split('|'); choose({ provider, model }).then(() => renderAll(true)); close() }
    document.body.append(shade, el)
  }

  // ---------- not paired (yet), or the computer went away ----------
  function unpaired() {
    const u = $('#munpaired')
    u.hidden = false
    u.innerHTML = `<div class="box"><span class="big">${ico('phone', 34, 1.6)}</span><b>这台手机还没连上电脑</b><span>在电脑上打开 小天 Bot › 设置 › 手机，打开“允许手机连接”，再用${NATIVE ? '下面的按钮' : '手机相机'}扫电脑上的二维码。</span>${NATIVE ? `<button class="pbtn pri" data-act="m-scan">${SV.scan}扫码连接</button>` : ''}</div>`
  }
  async function sayHello() {
    const was = online
    try {
      const r = await fetch('/api/phone/hello', { headers: { 'x-tianxi-token': TOKEN }, signal: AbortSignal.timeout(8000) })
      online = r.status !== 502 && r.status !== 503
      if (r.status === 401) { unpaired(); return }
      if (r.ok) {
        hello = await r.json()
        // the App keeps this computer in its list, to come back to it next time
        nat(() => NATIVE.paired(location.origin, TOKEN, hello.pc))
        if (sessionStorage.getItem('tx.paired')) { sessionStorage.removeItem('tx.paired'); setTimeout(() => toastText(`连上了 ${hello.pc}`), 800) }
      }
    } catch { online = false }
    if (online && !was) refresh()
    mrender(); if (view === 'mpc' || view === 'mme') renderPage()
  }
  // whether the computer is still there (and whether UU 远程 is running on it): asked now and then while the page is open
  setInterval(() => { if (!document.hidden) sayHello() }, 20000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sayHello() })

  // ---------- taps ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-mtab]')
    if (t) { e.stopPropagation(); go(t.dataset.mtab); return }
    const el = e.target.closest('[data-act]')
    if (!el) return
    const act = el.dataset.act
    const stop = () => { e.stopPropagation(); e.preventDefault() }
    // opening a chat on a phone: no keyboard until you tap the input
    if (act === 'agent-open') { stop(); cur = el.dataset.id; store.set('agent', cur); procSel = null; setView('chat') }
    else if ((act === 'proc-close' || act === 'modal-close') && stack.length) { stop(); history.back() }
    else if (act === 'm-back') { stop(); history.back() }
    else if (act === 'm-tab') { stop(); go(el.dataset.t) }
    else if (act === 'm-uu') { stop(); uuOpen(el.dataset.how) }
    else if (act === 'm-watch') { stop(); S.takeover?.how === 'full' ? handBack() : NATIVE ? uuOpen('pip') : openProc(null, 'computer') }
    else if (act === 'm-handback') { stop(); handBack() }
    else if (act === 'm-steps') { stop(); cur = el.dataset.id; store.set('agent', cur); setView('chat'); openProc(null, 'computer') }
    else if (act === 'm-model') { stop(); modelSheet() }
    else if (act === 'm-scan') { stop(); nat(() => NATIVE.scan()) }
    else if (act === 'm-host') { stop(); nat(() => NATIVE.switchHost(el.dataset.id)) }
    else if (act === 'm-open') { stop(); nat(() => NATIVE.openUrl(el.dataset.u)) }
    else if (act === 'm-uuget') { stop(); uuGet() }
    else if (act === 'm-unpair') {
      stop()
      if (!confirm(`断开 ${pcName()}？这台手机要重新扫码才能再连。`)) return
      await api('phone/unpair', {}).catch(() => {})
      try { localStorage.removeItem('tx.ptoken'); localStorage.removeItem('tx.uuDevice') } catch {}
      if (NATIVE) nat(() => NATIVE.forget()); else unpaired()
    }
    else if (act === 'open-url' && NATIVE) { stop(); nat(() => NATIVE.openUrl(el.dataset.u)) }
  }, true)
  $('#mshade').onclick = () => { if (stack.length) history.back(); else { closeProc(); sync() } }

  // no voice on a phone page (the browser allows the microphone only on https): the button just sends
  const sendBtn = $('#send')
  sendBtn.onclick = () => { if (busy(cur) && !inp.value.trim()) api('cancel', { agent: cur }); else if (inp.value.trim()) send(); else inp.focus() }
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) e.stopImmediatePropagation() }, true)   // Enter is a new line; the arrow sends

  // the App colours the status and navigation bars like the page, and flips their icons in the light theme
  if (NATIVE && NATIVE.bars) {
    const hex = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? '#' + m.slice(1, 4).map((x) => (+x).toString(16).padStart(2, '0')).join('') : '' }
    // the colour right under the status bar: the first element there with a background of its own
    const top = () => { for (let el = document.elementFromPoint(innerWidth / 2, 2); el; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c)) return c } return getComputedStyle(document.body).backgroundColor }
    let last = ''
    const bars = () => { const c = hex(top()), k = c + H.dataset.theme; if (c && k !== last) { last = k; nat(() => NATIVE.bars(c, H.dataset.theme === 'light')) } }
    new MutationObserver(() => setTimeout(bars, 80)).observe(H, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    bars()
  }

  sync(); sayHello()
})()
