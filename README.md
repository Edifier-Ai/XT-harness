# XT-harness · 天禧AI 概念版

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）做的个人智能体概念版，Windows 桌面客户端。

## 目录

| 目录 | 内容 |
| --- | --- |
| `tianxi/` | 天禧层：DSH 插件（操作记录与撤回、记忆与反思、动作工具与邮箱、常驻感知与简报、多智能体客户端服务）、网页界面、评测任务 |
| `desktop/` | Windows 客户端（Electron）：`main.js` 启动时选版本，`shell.js` 是客户端本体，`updater.js` 负责差分更新 |
| `build/` | 打包脚本、`release.mjs`（生成更新清单）、使用说明 |
| `release/manifest.json` | 当前发布版本的清单：每个文件的 sha256 |
| `dev/fake/` | 本地测试用的模拟大模型 |

## 更新是怎么做的

客户端分两层：

- **底座**：Electron 和 DSH 运行时，几百 MB，很少变。变了才需要重新下载完整包。
- **天禧层**：`desktop/` 里的客户端代码和 `tianxi/` 整个目录，大约 1MB。

客户端启动 20 秒后检查一次，之后每两小时检查一次，读的是本仓库 `main` 分支上的 `release/manifest.json`。
依次尝试 GitHub API、raw.githubusercontent.com 和 jsDelivr，走系统代理；每个文件都按清单里的 sha256 校验，对不上就换一条线路。
如果版本号比本机的新，就逐个比对文件的 sha256，只下载改过的文件，校验通过后装进
`%APPDATA%\TianxiAI-Concept\update\<版本>`。下次启动时用新版本。

- 用户不在电脑前时，会自动重启换上新版本；正在用的时候，页面上会提示“现在重启”。
- 新版本连续两次没能启动，会被标记为坏版本，自动退回上一个版本。

## 发布一个新版本

```bash
node build/release.mjs 0.4.1 "这次改了什么"
git add -A && git commit -m "0.4.1: 这次改了什么" && git push origin main
```

底座变了的时候，要把 `build/release.mjs` 里的 `MIN_BASE` 改成新底座的版本号，再用
`build/assemble.sh` 重新打完整包。还没升级底座的客户端会提示用户下载完整包。
