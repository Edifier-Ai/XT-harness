// Scripted OpenAI-compatible chat-completions server for offline testing.
import fs from "node:fs"; const require_dump=b=>fs.writeFileSync("last-req.json",JSON.stringify(b,null,1));
import http from 'node:http'
const PORT = +process.env.FAKE_PORT || 4010
const ALL = [] // [{re, sys?, tool, args(text)}] loaded from rules.mjs
try { const m = await import(process.env.FAKE_RULES || './rules.mjs'); ALL.push(...m.default) } catch (e) { console.error('no rules', e.message) }
const log = (...a) => console.error('[fake]', ...a)
const isCtx=t=>/^(Current runtime context|Time sampled)/.test(t.trim())
function lastUser(msgs){for(let i=msgs.length-1;i>=0;i--){const m=msgs[i];if(m.role==='user'&&!isCtx(textOf(m.content)))return i}return -1}
function textOf(c){ if(typeof c==='string')return c; if(Array.isArray(c))return c.map(p=>p.text||'').join(''); return '' }
function decide(body){
  const msgs = body.messages||[]; const last = msgs[msgs.length-1]||{}
  // a rule may also ask for something in the system prompt (rule.sys), e.g. which Bot is answering
  const sysText = msgs.filter(m=>m.role==='system'||m.role==='developer').map(m=>textOf(m.content)).join('\n')
  const RULES = ALL.filter(r=>!r.sys || r.sys.test(sysText))
  const tools = (body.tools||[]).map(t=>t.function?.name)
  if (last.role==='tool' || (last.role==='user' && isCtx(textOf(last.content)) && msgs.slice(lastUser(msgs)).some(m=>m.role==='tool'))) {
    // count tool messages after last user to allow chained calls
    const lu = lastUser(msgs)
    const user = textOf(msgs[lu]?.content)
    const done = msgs.slice(lu).filter(m=>m.role==='assistant').flatMap(m=>(m.tool_calls||[]).map(t=>t.function.name))
    for (const r of RULES) { if (r.re.test(user)) { const steps = r.steps || [r]; const next = steps[done.length]; if (next && tools.includes(next.tool)) return { tool: next.tool, args: next.args(user, msgs) } ; return { text: r.final ? r.final(user, msgs) : '好的，已经办好了。' } } }
    return { text: '好的，已经办好了。' }
  }
  const user = textOf(msgs[lastUser(msgs)]?.content)
  for (const r of RULES) { if (r.re.test(user)) { const s=(r.steps||[r])[0]; if (s.tool && tools.includes(s.tool)) return { tool: s.tool, args: s.args(user, msgs) }; if (r.final) return {text:r.final(user,msgs)} } }
  return { text: `（假模型）收到：${user.slice(0,60)}` }
}
let n=0
http.createServer((req,res)=>{
  const parts=[]; req.on('data',d=>parts.push(d)); req.on('end',()=>{ const raw=Buffer.concat(parts).toString('utf8');
    if (req.url.endsWith('/models')) { res.writeHead(200,{'content-type':'application/json'}); return res.end(JSON.stringify({data:[{id:'fake-tianxi'}]})) }
    let body={}; try{body=JSON.parse(raw)}catch{}; if(process.env.FAKE_DUMP && (body.tools||[]).length) require_dump(body)
    const d = decide(body); const id='c'+(++n)
    log(req.url, 'msgs', (body.messages||[]).length, 'tools', (body.tools||[]).length, '->', d.tool||'text')
    const call = d.tool ? [{index:0,id:'call_'+n,type:'function',function:{name:d.tool,arguments:JSON.stringify(d.args)}}] : undefined
    if (body.stream) {
      res.writeHead(200,{'content-type':'text/event-stream'})
      const send=o=>res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:Date.now()/1000|0,model:body.model,...o})+'\n\n')
      if (call) send({choices:[{index:0,delta:{role:'assistant',tool_calls:call},finish_reason:null}]})
      else for (const piece of d.text.match(/.{1,12}/gs)) send({choices:[{index:0,delta:{content:piece},finish_reason:null}]})
      send({choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})
      res.write('data: [DONE]\n\n'); res.end()
    } else {
      res.writeHead(200,{'content-type':'application/json'})
      res.end(JSON.stringify({id,object:'chat.completion',model:body.model,choices:[{index:0,message:{role:'assistant',content:call?null:d.text,tool_calls:call},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}))
    }
  })
}).listen(PORT,'127.0.0.1',()=>log('listening',PORT))
