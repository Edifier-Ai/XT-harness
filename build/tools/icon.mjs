// node build/tools/icon.mjs <outdir> [mac]: renders 小天's icon (blue-violet ball, white eyes) at every .ico size with the bundled Chromium; pack with Pillow (see git log 0.15.2).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs'
const D = process.argv[2]
// mac: the ball sits inside Apple's icon grid (about 80% of the square) so it matches other Dock icons
const MACI = process.argv[3] === 'mac'
// small sizes: bigger eyes, no highlight, ball fills the square
const D2 = `<radialGradient id="ib" cx="50%" cy="95%" r="95%"><stop offset="0" stop-color="#f4f1ff"/><stop offset=".25" stop-color="#b3a6ff"/><stop offset=".55" stop-color="#6a4cf0"/><stop offset=".8" stop-color="#3a2bb0"/><stop offset="1" stop-color="#241a7a"/></radialGradient><radialGradient id="il" cx="12%" cy="72%" r="55%"><stop offset="0" stop-color="#2a63ff" stop-opacity=".85"/><stop offset="1" stop-color="#2a63ff" stop-opacity="0"/></radialGradient><radialGradient id="ir" cx="90%" cy="66%" r="55%"><stop offset="0" stop-color="#8a3cff" stop-opacity=".8"/><stop offset="1" stop-color="#8a3cff" stop-opacity="0"/></radialGradient>`
const svg = (n) => {
  const small = n <= 32
  const r = small ? 49 : 46, ew = small ? 11 : 8.8, eh = small ? 21 : 18
  const c = (f) => `<circle cx="50" cy="50" r="${r}" fill="url(#${f})"/>`
  const vb = MACI ? '-12 -12 124 124' : '0 0 100 100'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${n}" height="${n}"><defs>${D2}</defs>
${c('ib')}${c('il')}${c('ir')}
${small ? '' : '<ellipse cx="34" cy="22" rx="13" ry="6" fill="#fff" opacity=".18" transform="rotate(-28 34 22)"/>'}
<rect x="${40 - ew / 2}" y="${47 - eh / 2}" width="${ew}" height="${eh}" rx="${ew / 2}" transform="rotate(-16 40 47)" fill="#fff"/>
<rect x="${61 - ew / 2}" y="${45 - eh / 2}" width="${ew}" height="${eh}" rx="${ew / 2}" transform="rotate(-16 61 45)" fill="#fff"/></svg>`
}
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
for (const n of MACI ? [16, 32, 64, 128, 256, 512, 1024] : [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
  const p = await b.newPage({ viewport: { width: n, height: n } })
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg(n)}</body></html>`)
  await p.screenshot({ path: `${D}/${n}.png`, omitBackground: true }); await p.close()
}
await b.close()
