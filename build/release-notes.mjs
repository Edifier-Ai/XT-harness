// Writes notes.md for a version's GitHub Release (the Windows and Mac workflows write it; the Android one adds its APK): what changed, then how to install.
import fs from 'node:fs'
const { version: v, notes } = JSON.parse(fs.readFileSync(new URL('../release/manifest.json', import.meta.url)))
fs.writeFileSync('notes.md', `${notes}

**Windows**：下载 \`XiaotianBot-Setup-${v}.exe\`，双击安装。

**Mac**（Apple 芯片，M1 及以后）：下载 \`XiaotianBot-${v}-mac-arm64.dmg\`。打开后把「小天 Bot」拖进「应用程序」。第一次打开如果提示无法验证开发者，到「系统设置 → 隐私与安全性」点「仍要打开」。

**安卓手机**：下载 \`XiaotianBot-${v}.apk\` 安装（测试签名，手机提示“未知来源”时选允许）。在电脑上打开 小天 Bot › 设置 › 手机，打开“允许手机连接”，用 App 扫码。想在手机上看电脑屏幕、接手操作，手机和电脑都装 UU 远程并登录同一个账号。

装好后有新版本会自动更新；手机 App 里的界面跟着电脑上的小天 Bot 一起更新。
`)
