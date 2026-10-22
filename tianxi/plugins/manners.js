// 会察言观色的小天: what a Bot wants to tell you (the brief is ready, a 圆桌 waits for you, a step needs your OK, a Bot
// asks to be made regular) is not pushed at you. It is held, and the desktop 小天 shows it is holding something in
// (a 憋着 face). It is said when you pause: not while a window fills the screen, not in a meeting or a call, not
// while you type. Only so many times a day; a step waiting for your OK does not count, but it still waits for a
// pause. What was held and said, and why it waited, is kept, so the 系统感知 page can show it.
// The desktop client tells the runtime what is in front (POST /api/room); without it nothing is said on its own.
import { load, update, id, now, today, bus, flags, settings, onChange, agentById, MAIN } from './store.js'

const PAUSE = [3, 120]   // idle seconds that count as a pause: you are there, but not on the mouse or the keys
const GAP = +process.env.TIANXI_NUDGE_GAP || 90e3   // at least this long between two things said on its own (tests shorten it)
const LATER = 20 * 60e3  // 等会儿
export const nudges = () => load('nudges', [])
const room = () => flags.room || {}
const cap = () => { const c = settings().nudgeCap; return c === undefined || c === null || c === '' ? 4 : +c }

// a timed entry on 小天's calendar that is going on now
function busyEvent() {
  const t = Date.now()
  return load('calendar', []).find((e) => e.start && e.end && String(e.start).length > 10 && Date.parse(e.start) <= t && t < Date.parse(e.end))
}

/** What keeps 小天 quiet now, in words; '' when it may speak. */
export function quietWhy() {
  const r = room()
  if (!r.at || Date.now() - r.at > 120e3) return '桌面客户端没在告诉小天你在做什么'
  if (r.full) return `你在全屏${r.app ? '用 ' + r.app : ''}`
  if (r.meeting) return `你在${r.meeting}`
  const ev = busyEvent(); if (ev) return `日程上你在「${ev.title}」`
  if (r.typing) return '你在打字'
  const idle = Math.max(0, (+r.idleSec || 0) + (Date.now() - r.at) / 1000)
  if (idle >= PAUSE[1]) return '你不在电脑前'
  if (idle < PAUSE[0]) return '你在用电脑'
  return ''
}

const saidToday = () => nudges().filter((n) => n.saidDay === today() && !n.urgent && !n.asked)
let lastSaid = 0
export function mannerState() {
  const l = nudges()
  const r = room()
  return {
    held: l.filter((n) => n.state === 'held').map(pub),
    said: l.filter((n) => n.saidDay === today()).map(pub).reverse(),
    why: quietWhy(), cap: cap(), used: saidToday().length,
    room: { full: !!r.full, meeting: r.meeting || '', typing: !!r.typing, app: r.app || '', orb: !!r.orb, known: !!r.at && Date.now() - r.at < 120e3 },
  }
}
const pub = ({ id, what, text, go, agent, urgent, at, state, saidAt, asked, notBefore }) => ({ id, what, text, go, agent, urgent, at, state, saidAt, asked, notBefore })

let sent = ''
function changed() {
  const m = mannerState(), k = JSON.stringify(m)
  if (k !== sent) { sent = k; bus.push({ type: 'manner', manner: m }) }
}

/** Something a Bot wants to tell you. The same what+ref again replaces the one still waiting. */
// text may be a function of how many times it came (several 动态 are said as one line)
export function nudge({ what, ref = '', text, go = null, agent = MAIN, urgent = false }) {
  let n
  const words = (k) => String(typeof text === 'function' ? text(k) : text).slice(0, 160)
  update('nudges', [], (l) => {
    const old = l.find((x) => x.what === what && x.ref === ref && x.state !== 'done')
    if (old) { old.count = (old.count || 1) + 1; Object.assign(old, { text: words(old.count), go, agent, urgent, at: now() }); if (old.state === 'said') { old.state = 'held'; delete old.saidDay } n = old }
    else { n = { id: id('nd'), what, ref, text: words(1), go, agent, urgent, at: now(), state: 'held', count: 1 }; l.push(n) }
    if (l.length > 300) l.splice(0, l.length - 300)
  })
  tick()
  return n
}
/** It no longer needs saying: you answered it, or saw it somewhere else. */
export function unnudge(what, ref = '') {
  let any = false
  update('nudges', [], (l) => { for (const n of l) if (n.what === what && n.ref === ref && n.state !== 'done') { n.state = 'done'; n.doneAt = now(); any = true } })
  if (any) changed()
}
function patch(nid, fn) { let out; update('nudges', [], (l) => { const n = l.find((x) => x.id === nid); if (n) { fn(n); out = n } }); changed(); return out }

function say(n, asked) {
  const s = patch(n.id, (x) => { x.state = 'said'; x.saidAt = now(); x.saidDay = today(); x.asked = !!asked })
  if (!asked) lastSaid = Date.now()
  bus.push({ type: 'nudge-say', nudge: pub(s), asked: !!asked })
  return s
}

/** Say the next thing held, if now is a good moment. */
function tick() {
  const ready = nudges().filter((n) => n.state === 'held' && (!n.notBefore || Date.parse(n.notBefore) <= Date.now()))
  if (ready.length && !quietWhy()) {
    // a step waiting for your OK goes first and does not wait out the gap; the rest keep to the gap and the cap
    const left = cap() - saidToday().length
    const n = ready.find((x) => x.urgent) || (left > 0 && Date.now() - lastSaid >= GAP ? ready[0] : null)
    if (n) say(n, false)
  }
  changed()
}

export const name = 'tianxi-manners'

export function apply(ctx) {
  bus.nudge = nudge
  bus.unnudge = unnudge
  const last = nudges().filter((n) => n.saidAt && !n.asked).map((n) => Date.parse(n.saidAt)).sort().pop()
  if (last) lastSaid = last
  ctx.effect(() => { const t = setInterval(tick, 1000); return () => clearInterval(t) })

  // things worth telling, from the stores
  let brief = load('brief', null)?.at || '', refl = load('reflections', [])[0]?.id || ''
  ctx.effect(() => onChange((name) => {
    if (name === 'brief') {
      const b = load('brief', null)
      if (b?.at && b.at !== brief && b.date === today()) nudge({ what: 'brief', ref: b.date, text: `今天的简报好了${b.summary ? '：' + b.summary : ''}`, go: { view: 'brief' } })
      brief = b?.at || ''
    }
    if (name === 'reflections') {
      const r = load('reflections', [])[0]
      if (r && r.id !== refl) {
        const n = (r.proposals || []).length + (r.lessons || []).length
        nudge({ what: 'reflect', ref: r.id, text: n ? `${agentById(MAIN).name}反思完了，有 ${n} 条想跟你确认` : `${agentById(MAIN).name}反思完了`, go: { view: 'reflect' } })
      }
      refl = r?.id || ''
    }
  }))

  bus.state.set('manner', mannerState)
  Object.assign(bus.routes, {
    // the desktop client: what is in front, whether you type, how long since you last touched mouse or keys
    'POST /api/room': async (b) => {
      flags.room = { idleSec: +b.idleSec || 0, typing: !!b.typing, full: !!b.full, meeting: String(b.meeting || '').slice(0, 40), app: String(b.app || '').slice(0, 60), title: String(b.title || '').slice(0, 120), orb: !!b.orb, at: Date.now() }
      flags.idleSec = flags.room.idleSec; flags.lastSeen = Date.now()
      tick()
      return { ok: true }
    },
    // you clicked the desktop 小天 to hear what it is holding: it says the next one now (not counted)
    'POST /api/nudge/ask': async () => {
      const n = nudges().filter((x) => x.state === 'held').sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))[0]
      return { ok: true, nudge: n ? pub(say(n, true)) : null }
    },
    'POST /api/nudge/done': async (b) => ({ ok: true, nudge: patch(b.id, (n) => { n.state = 'done'; n.doneAt = now() }) || null }),
    'POST /api/nudge/later': async (b) => ({ ok: true, nudge: patch(b.id, (n) => { n.state = 'held'; delete n.saidDay; n.notBefore = new Date(Date.now() + LATER).toISOString() }) || null }),
    // you opened the page it was about: nothing left to say
    'POST /api/nudge/seen': async (b) => {
      let any = false
      update('nudges', [], (l) => { for (const n of l) if (n.state !== 'done' && n.go && n.go.view === b.view && (!n.go.arg || !b.arg || n.go.arg === b.arg)) { n.state = 'done'; n.doneAt = now(); any = true } })
      if (any) changed()
      return { ok: true }
    },
  })
}
