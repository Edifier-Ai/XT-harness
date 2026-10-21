// Writes notes.md for a version's GitHub Release (both the Windows and the Mac workflow use it): what changed, then how to install.
import fs from 'node:fs'
const { version: v, notes } = JSON.parse(fs.readFileSync(new URL('../release/manifest.json', import.meta.url)))
fs.writeFileSync('notes.md', `${notes}

**Windows**：下载 \`XiaotianBot-Setup-${v}.exe\`，双击安装。

**Mac**：Apple 芯片（M1 及以后）下载 \`XiaotianBot-${v}-mac-arm64.dmg\`，Intel 芯片下载 \`XiaotianBot-${v}-mac-x64.dmg\`。打开后把「小天 Bot」拖进「应用程序」。第一次打开如果提示无法验证开发者，到「系统设置 → 隐私与安全性」点「仍要打开」。

装好后有新版本会自动更新。
`)
