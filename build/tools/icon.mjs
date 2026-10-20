import sharp from '/tmp/claude-0/-home-claude/1a7f2990-e239-52a7-b5bd-64bf7feee52f/scratchpad/dsh/rt/node_modules/sharp/dist/index.mjs'
import fs from 'node:fs'
const svg = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100"><defs><radialGradient id="g" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#ffb46b"/><stop offset=".3" stop-color="#e2502e"/><stop offset=".62" stop-color="#5a2fd0"/><stop offset=".88" stop-color="#141432"/></radialGradient></defs><circle cx="50" cy="50" r="47" fill="url(#g)"/></svg>`)
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(sizes.map((s) => sharp(svg(s)).png().toBuffer()))
fs.writeFileSync('../icon.png', await sharp(svg(256)).png().toBuffer())
const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
let off = head.length
sizes.forEach((s, i) => { const o = 6 + 16 * i; head.writeUInt8(s >= 256 ? 0 : s, o); head.writeUInt8(s >= 256 ? 0 : s, o + 1); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(pngs[i].length, o + 8); head.writeUInt32LE(off, o + 12); off += pngs[i].length })
fs.writeFileSync('../icon.ico', Buffer.concat([head, ...pngs]))
console.log('icon ok')
