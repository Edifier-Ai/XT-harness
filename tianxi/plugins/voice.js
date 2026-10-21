// 语音: local speech recognition through DSH's SenseVoice provider (SenseVoiceSmall + Silero VAD on sherpa-onnx).
// Nothing leaves the computer; the model (~240 MB) downloads once, from hf-mirror.com first.
import { bus } from './store.js'

export const name = 'tianxi-voice'
export const inject = ['speechToText']

const PROVIDER = 'sensevoice-local'

export function apply(ctx) {
  const stt = ctx.speechToText
  const info = () => stt.snapshot().providers.find((p) => p.id === PROVIDER)
  const state = () => {
    const p = info()
    if (!p) return { available: false, phase: 'missing' }
    const s = p.preparation || { phase: 'ready' }
    // standby = files on disk, recognizer not loaded yet; it loads on the first transcription.
    return {
      available: true, phase: s.phase, step: s.step || '',
      resource: s.resource || '', done: s.completedBytes || 0, total: s.totalBytes || 0,
      message: s.message || '', reason: s.download?.reason || '',
      usable: ['ready', 'standby', 'waking', 'loading'].includes(s.phase),
    }
  }
  let t = null
  const changed = () => { clearTimeout(t); t = setTimeout(() => bus.push({ type: 'voice', state: state() }), 250) }
  ctx.effect(() => {
    const ac = new AbortController()
    ;(async () => { try { for await (const _ of stt.follow(ac.signal)) changed() } catch {} })()
    return () => ac.abort()
  })
  bus.voice = {
    state,
    prepare: () => { stt.prepare(PROVIDER, {}); changed() },
    cancel: async () => { await stt.cancelPreparation(PROVIDER); changed() },
    async transcribe(wav, language = 'auto') {
      const spec = stt.resolve({ audio: new Uint8Array(wav), providerId: PROVIDER, language })
      const r = await stt.transcribe(spec, AbortSignal.timeout(120000))
      return { text: String(r.text || '').trim(), seconds: r.audioSeconds }
    },
  }
  ctx.effect(() => () => { if (bus.voice?.state === state) bus.voice = undefined })
}
