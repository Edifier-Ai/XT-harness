// 语音输入 and 语音通话. Recognition runs on this computer (SenseVoice through the host); speech out uses
// the system's own voices (Windows: 晓晓 / 慧慧 etc.). Loaded after app.js and shares its globals.

// ---------- microphone ----------
const RATE = 16000
function Mic() {
  let stream, ac, src, proc
  const m = {
    chunks: [], level: 0, onFrame: null,
    async open() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      ac = new AudioContext({ sampleRate: RATE })
      src = ac.createMediaStreamSource(stream)
      proc = ac.createScriptProcessor(2048, 1, 1)
      proc.onaudioprocess = (e) => {
        const d = new Float32Array(e.inputBuffer.getChannelData(0))
        let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]
        m.level = Math.sqrt(s / d.length)
        m.onFrame ? m.onFrame(d, m.level) : m.chunks.push(d)
      }
      src.connect(proc); proc.connect(ac.destination)
    },
    close() { try { proc && (proc.onaudioprocess = null); src?.disconnect(); proc?.disconnect(); ac?.close() } catch {} stream?.getTracks().forEach((t) => t.stop()) },
  }
  return m
}
const micError = (e) => /NotAllowed|Permission/i.test(e?.name || e?.message || '') ? '麦克风被拦住了：在 Windows 设置 → 隐私和安全性 → 麦克风里，允许桌面应用使用麦克风' : /NotFound/i.test(e?.name || '') ? '没找到麦克风，插上耳机或麦克风再试' : '打不开麦克风：' + (e?.message || e)
function wavBase64(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0)
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  let o = 44; for (const p of parts) for (let i = 0; i < p.length; i++, o += 2) { const x = Math.max(-1, Math.min(1, p[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true) }
  const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000))
  return btoa(s)
}
async function transcribe(parts) {
  const r = await api('voice/transcribe', { wav: wavBase64(parts) })
  if (r.error) throw new Error(r.error)
  // SenseVoice may keep its tags (<|zh|><|NEUTRAL|>…); drop them.
  return String(r.text || '').replace(/<\|[^|]*\|>/g, '').trim()
}

// ---------- the recognizer model (downloaded once) ----------
const fmtMB = (b) => (b / 1048576).toFixed(b > 1e8 ? 0 : 1) + ' MB'
const voiceSt = () => S.voice || { available: false, phase: 'missing' }
let voiceWaiter = null
function ensureVoice(then) {
  const v = voiceSt()
  if (v.usable) return then()
  if (!v.available) return toastText('这台电脑上的天禧没有语音识别组件，重装最新完整版后就有了')
  voiceWaiter = then
  modal = { kind: 'voice' }; toggleMenu(false); $('#modal').hidden = false; renderModal(true)
}
function voiceModal() {
  const v = voiceSt()
  const down = ['checking', 'downloading', 'cancelling'].includes(v.phase), loading = ['loading', 'waking'].includes(v.phase)
  const pct = v.total ? Math.round(v.done / v.total * 100) : 0
  let body
  if (v.usable && !loading) body = `<p class="vtx">好了，现在可以说话了。</p><div class="facts2"><button class="pbtn blue" data-act="voice-go">开始</button></div>`
  else if (down || loading) body = `<p class="vtx">${loading ? '正在载入识别模型…' : v.phase === 'downloading' ? `正在下载 ${esc(v.resource)}　${fmtMB(v.done)} / ${fmtMB(v.total)}` : '正在准备…'}</p>
      <div class="vbar"><i style="width:${loading ? 100 : pct}%"></i></div><div class="facts2"><button class="pbtn" data-act="voice-cancel">取消</button><span class="hint">可以关掉这个窗口，下载会在后台继续</span></div>`
  else body = `${v.phase === 'failed' ? `<p class="vtx bad">上次没下载成功${v.reason === 'network' ? '：连不上下载地址，检查网络或代理后再试' : '：' + esc(v.message)}</p>` : ''}
      <div class="facts2"><button class="pbtn blue" data-act="voice-prep">下载识别模型（约 230 MB）</button></div>`
  return `<button class="mx" data-act="modal-close">${ico('x', 20)}</button>
    <div class="vhead"><span class="vic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></svg></span><h2>打开语音</h2></div>
    <p class="vsub">语音识别在这台电脑上运行，你说的话不会上传。第一次用要下载一个识别模型（SenseVoice，中英日韩粤都能听），之后不用联网也能用。</p>${body}`
}
const _renderModal = renderModal
renderModal = function (enter) {
  if (modal?.kind !== 'voice') return _renderModal(enter)
  const box = $('#mbox'); box.className = 'mbox voice'; box.innerHTML = voiceModal(); if (enter) replay(box, 'pop')
}
function voiceChanged(st) {
  const was = S.voice?.usable; S.voice = st
  if (modal?.kind === 'voice') renderModal()
  if (!was && st.usable && voiceWaiter && modal?.kind === 'voice' && !['loading', 'waking'].includes(st.phase)) { const f = voiceWaiter; voiceWaiter = null; closeModal(); f() }
}

// ---------- 语音输入: speak, see it typed into the box ----------
let rec = null
async function dictateStart() {
  if (rec) return
  const m = Mic()
  try { await m.open() } catch (e) { return toastText(micError(e)) }
  const t0 = Date.now()
  rec = { m, t0, timer: setInterval(() => drawRec(), 90) }
  $('#ring').classList.add('rec'); drawRec()
}
function drawRec() {
  if (!rec) return
  let bar = $('#recBar')
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'recBar'; bar.className = 'recbar'
    bar.innerHTML = `<button class="rcx" data-act="dict-cancel" title="取消（Esc）">${ico('x', 18)}</button><div class="rw" id="recW"></div>
      <div class="rpill"><span class="rnum"><b id="recM">00</b><small>MIN.</small></span><button class="rcore" data-act="dict-done" title="说完了"><i></i></button><span class="rnum"><b id="recS">00</b><small>SEC.</small></span></div>`
    $('#ring').appendChild(bar)
    rec.levels = []
  }
  rec.levels.push(Math.min(1, rec.m.level * 9)); if (rec.levels.length > 48) rec.levels.shift()
  $('#recW').innerHTML = rec.levels.map((l) => `<i style="height:${Math.max(3, Math.round(l * 24))}px;opacity:${(0.35 + l * 0.65).toFixed(2)}"></i>`).join('')
  const s = Math.floor((Date.now() - rec.t0) / 1000), mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0')
  const S2 = $('#recS'); if (S2.textContent !== ss) { S2.textContent = ss; replay(S2, 'tick') }
  $('#recM').textContent = mm
  bar.style.setProperty('--lv', Math.min(1, rec.m.level * 8).toFixed(2))
  if (s >= 110) dictateStop(true)
}
async function dictateStop(keep) {
  if (!rec) return
  const r = rec; rec = null; clearInterval(r.timer); r.m.close()
  const bar = $('#recBar')
  if (!keep || Date.now() - r.t0 < 400) { bar?.remove(); $('#ring').classList.remove('rec'); return }
  // the core turns green for a beat, then the pill settles into "recognizing"
  if (bar) { bar.classList.add('done'); await new Promise((r) => setTimeout(r, 420)); bar.classList.add('busy') }
  try {
    const text = await transcribe(r.m.chunks)
    if (!text) toastText('没听清，再说一次？')
    else { const i = inp.selectionStart ?? inp.value.length; inp.value = inp.value.slice(0, i) + text + inp.value.slice(i); grow(); inp.focus() }
  } catch (e) { toastText('识别出错：' + e.message) }
  $('#recBar')?.remove(); $('#ring').classList.remove('rec'); renderHead()
}
$('#bMic').onclick = () => rec ? dictateStop(true) : ensureVoice(dictateStart)

// ---------- 语音通话: talk back and forth, hands free ----------
let call = null
const plain = (t) => String(t || '').replace(/```[\s\S]*?```/g, '（代码略）').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>|~]/g, '').replace(/^\s*[-+]\s+/gm, '').replace(/\n{2,}/g, '\n').trim()
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => /^zh/i.test(v.lang))
  const pref = S.settings?.ttsVoice
  return vs.find((v) => v.name === pref) || vs.find((v) => /Xiaoxiao|晓晓/i.test(v.name)) || vs.find((v) => /Natural|Online/i.test(v.name) && /CN/i.test(v.lang)) || vs.find((v) => /zh-CN/i.test(v.lang)) || vs[0]
}
function speak(text, done) {
  speechSynthesis.cancel()
  const parts = plain(text).slice(0, 900).split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return done()
  const v = pickVoice(); let i = 0
  const next = () => {
    if (!call || call.state !== 'speaking') return
    if (i >= parts.length) return done()
    const u = new SpeechSynthesisUtterance(parts[i++]); if (v) { u.voice = v; u.lang = v.lang } else u.lang = 'zh-CN'
    u.rate = +(S.settings?.ttsRate || 1.08); u.onend = next; u.onerror = next
    speechSynthesis.speak(u)
  }
  next()
}
async function callStart() {
  if (call) return
  const m = Mic()
  try { await m.open() } catch (e) { return toastText(micError(e)) }
  call = { m, aid: cur, state: 'listening', muted: false, you: '', bot: '', pre: [], seg: null, loud: 0, quiet: 0, floor: 0.006, t0: Date.now() }
  m.onFrame = onCallFrame
  const ov = document.createElement('div'); ov.id = 'callOv'; ov.className = 'callov'; $('#app').appendChild(ov)
  drawCall(true); call.tick = setInterval(drawCallLive, 80)
}
// Voice activity: speech starts after ~250 ms above the noise floor and ends after ~0.9 s of quiet.
function onCallFrame(d, lvl) {
  const c = call; if (!c) return
  if (c.state !== 'listening' || c.muted) { c.pre = []; return }
  if (!c.seg) c.floor = c.floor * 0.97 + Math.min(lvl, 0.05) * 0.03
  const thr = Math.max(0.012, c.floor * 3.2)
  if (!c.seg) {
    c.pre.push(d); if (c.pre.length > 4) c.pre.shift()
    c.loud = lvl > thr ? c.loud + 1 : 0
    if (c.loud >= 2) { c.seg = [...c.pre]; c.pre = []; c.quiet = 0 }
  } else {
    c.seg.push(d); c.quiet = lvl > thr * 0.7 ? 0 : c.quiet + 1
    if (c.quiet >= 7 || c.seg.length > 900) { const seg = c.seg; c.seg = null; c.loud = 0; if (seg.length > 6) heard(seg) }
  }
}
async function heard(seg) {
  const c = call; if (!c) return
  c.state = 'hearing'; drawCall()
  let text = ''
  try { text = await transcribe(seg) } catch (e) { c.bot = '识别出错：' + e.message }
  if (call !== c) return
  if (!text) { c.state = 'listening'; drawCall(); return }
  c.you = text; c.bot = ''; c.state = 'thinking'; c.sentAt = new Date().toISOString(); c.sawBusy = false; drawCall()
  await api('say', { text, agent: c.aid })
}
// Follows the bot's reply through the same live updates the chat uses.
function replyOf(c) {
  const l = S.transcripts[c.aid] || []
  return l.filter((t) => t.role === 'assistant' && t.at >= c.sentAt && !t.internal).map((t) => t.text).join('\n')
}
function drawCallLive() {
  const c = call; if (!c) return
  if (c.state === 'thinking') {
    if (busy(c.aid)) c.sawBusy = true
    c.bot = replyOf(c)
    const waitAsk = S.approvals.find((a) => a.agent === c.aid)
    if (!waitAsk && (c.sawBusy || Date.now() - Date.parse(c.sentAt) > 4000) && !busy(c.aid)) {
      c.state = 'speaking'; drawCall()
      speak(c.bot || '好了。', () => { if (call === c && c.state === 'speaking') { c.state = 'listening'; drawCall() } })
    }
  }
  const cap = $('#callBot'); if (cap && cap.dataset.t !== c.bot) { cap.dataset.t = c.bot; cap.textContent = plain(c.bot).slice(-260) }
  const ask = S.approvals.find((a) => a.agent === c.aid), box = $('#callAsk')
  if (box && (box.dataset.id || '') !== (ask?.id || '')) drawCall()
}
const CALLSAY = { listening: '在听，你说', hearing: '听到了，正在识别…', thinking: '在想…', speaking: '正在说' }
const MICSVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></svg>'
function callStage(ov) {
  const a = agentOf(call.aid)
  ov.innerHTML = `<div class="camb"></div><div class="ctop"><span>${esc(a.name)} · 语音通话</span></div>
    <div class="cmid"><h1 class="chero">和 <b>${esc(a.name)}</b> 说话</h1>
      <div class="sphere"><canvas id="callCv"></canvas><div class="core">${MICSVG}</div></div>
      <div class="cdyn" id="cDyn"></div></div>
    <div class="cbtns" id="cBtns"></div>`
  sphere($('#callCv'))
}
function drawCall(enter) {
  const c = call, ov = $('#callOv'); if (!c || !ov) return
  if (!ov.firstChild) callStage(ov)
  const a = agentOf(c.aid), ask = S.approvals.find((x) => x.agent === c.aid)
  ov.className = 'callov s-' + c.state + (c.muted ? ' muted' : '') + (enter ? ' fade' : '')
  $('#cDyn').innerHTML = `<div class="cst">${c.muted ? '麦克风已静音' : CALLSAY[c.state]}</div>
      ${c.you ? `<div class="cyou">“${esc(c.you)}”</div>` : ''}
      <div class="cbot" id="callBot"></div>
      <div id="callAsk" data-id="${ask?.id || ''}">${ask ? `<div class="cask"><b>${esc(a.name)}要你确认</b><span>${esc(ask.reason || toolLabel(ask.tool))}</span><div><button class="pbtn" data-act="call-ask" data-id="${ask.id}" data-ok="0">不行</button><button class="pbtn blue" data-act="call-ask" data-id="${ask.id}" data-ok="1">可以</button></div></div>` : ''}</div>`
  const cut = c.state === 'thinking' || c.state === 'speaking'
  $('#cBtns').innerHTML = `<button class="gl ${c.muted ? 'on' : ''}" data-act="call-mute" title="${c.muted ? '打开麦克风' : '静音'}">${c.muted ? MICSVG.replace('</svg>', '<path d="M4 4l16 16"/></svg>') : MICSVG}</button>
      <button class="glow" data-act="call-cut" ${cut ? '' : 'disabled'}>${cut ? '打断，我来说' : c.muted ? '已静音' : '说完会自动发送'}<span class="bars"><i></i><i></i><i></i><i></i></span></button>
      <button class="gl end" data-act="call-end" title="挂断（Esc）"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`
  const cap = $('#callBot'); cap.dataset.t = c.bot; cap.textContent = plain(c.bot).slice(-260)
}
// A sphere of dots that breathes with whoever is talking: you while it listens, the bot while it speaks.
const SPH = { listening: [77, 141, 255], hearing: [122, 168, 255], thinking: [150, 120, 255], speaking: [71, 212, 255], muted: [140, 140, 150] }
function sphere(cv) {
  const N = 1500, pts = []
  for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]) }
  const ctx = cv.getContext('2d'); let lv = 0, col = SPH.listening.slice(), t0 = performance.now()
  const frame = (now) => {
    const c = call; if (!c || !cv.isConnected) return
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
    const target = c.muted ? 0 : c.state === 'listening' ? Math.min(1, c.m.level * 9) : c.state === 'speaking' ? 0.3 + 0.25 * Math.abs(Math.sin(now / 130)) * Math.abs(Math.sin(now / 370)) : c.state === 'thinking' ? 0.12 : 0.18
    lv += (target - lv) * 0.18
    const want = SPH[c.muted ? 'muted' : c.state] || SPH.listening
    for (let k = 0; k < 3; k++) col[k] += (want[k] - col[k]) * 0.08
    const t = (now - t0) / 1000, R = Math.min(W, H) * 0.36, cx = W / 2, cy = H / 2
    const ry = t * (c.state === 'thinking' ? 0.9 : 0.35), rx = 0.35 + Math.sin(t * 0.3) * 0.15
    const cy1 = Math.cos(ry), sy1 = Math.sin(ry), cx1 = Math.cos(rx), sx1 = Math.sin(rx)
    const amp = 0.05 + lv * 0.2
    for (const [x0, y0, z0] of pts) {
      // a slow travelling wave over the surface, louder when someone talks
      const n = Math.sin(x0 * 3.1 + t * 1.7) * Math.sin(y0 * 2.3 - t * 1.3) + Math.cos(z0 * 4.2 + t * 2.1) * 0.6
      const r = 1 + amp * n
      let x = x0 * r, y = y0 * r, z = z0 * r
      const x2 = x * cy1 + z * sy1, z2 = -x * sy1 + z * cy1; x = x2; z = z2
      const y3 = y * cx1 - z * sx1, z3 = y * sx1 + z * cx1; y = y3; z = z3
      const p = 2.6 / (2.6 + z), d = (z + 1.3) / 2.6
      const a = 0.12 + (1 - d) * 0.85
      ctx.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a.toFixed(3)})`
      const s = (0.6 + (1 - d) * 1.4) * p
      ctx.fillRect(cx + x * R * p - s / 2, cy + y * R * p - s / 2, s, s)
    }
    cv.parentNode.style.setProperty('--lv', lv.toFixed(3))
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
function callEnd() {
  const c = call; if (!c) return
  call = null; clearInterval(c.tick); c.m.close(); speechSynthesis.cancel()
  const ov = $('#callOv'); if (ov) { ov.classList.add('out'); setTimeout(() => ov.remove(), 220) }
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return
  const act = el.dataset.act
  if (act === 'dict-cancel') dictateStop(false)
  else if (act === 'dict-done') dictateStop(true)
  else if (act === 'voice-prep') { api('voice/prepare', {}).then((r) => { if (r.error) toastText(r.error) }); S.voice = { ...voiceSt(), phase: 'checking' }; renderModal() }
  else if (act === 'voice-cancel') api('voice/cancel', {})
  else if (act === 'voice-go') { const f = voiceWaiter; voiceWaiter = null; closeModal(); f?.() }
  else if (act === 'call-end') callEnd()
  else if (act === 'call-mute') { call.muted = !call.muted; call.seg = null; drawCall() }
  else if (act === 'call-cut' && call) {
    if (call.state === 'speaking') speechSynthesis.cancel()
    else if (call.state === 'thinking') api('cancel', { agent: call.aid })
    call.state = 'listening'; call.seg = null; drawCall()
  }
  else if (act === 'call-ask') api('approval', { id: el.dataset.id, allow: el.dataset.ok === '1' })
})
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (call || rec) && !modal) { e.stopImmediatePropagation(); call ? callEnd() : dictateStop(false) } }, true)
// The wave button in an empty box starts a call; typing turns it back into send.
$('#send').onclick = () => { if (busy(cur) && !inp.value.trim()) api('cancel', { agent: cur }); else if (!inp.value.trim()) ensureVoice(callStart); else send() }
if (window.speechSynthesis) speechSynthesis.getVoices()
