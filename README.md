<div align="center">

# Quartz

**简洁、快速、黑白极简的桌面 AI 对话应用。**

[![Release](https://img.shields.io/github/v/release/Skywalker144/Quartz?color=111&label=release)](https://github.com/Skywalker144/Quartz/releases)
[![License](https://img.shields.io/badge/license-MIT-111)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-111)

</div>

Quartz 是一个以键盘为先、黑白极简的桌面 LLM 客户端，支持
**OpenRouter / OpenAI / Anthropic / DeepSeek / Google**，内置全局 Option+Space 速答、一键导出、对话内搜索。

---

## 功能

- **多家模型** —— OpenRouter / OpenAI / Anthropic / DeepSeek / Google，可按对话切换模型。「推荐模型」一点即加；填入 DeepSeek Key 会自动配好它的模型。
- **全局速答（⌥Space）** —— 类似 Spotlight 的浮条，随处呼出：输入、回车，得到简洁的流式回答；再回车（或点按钮）即可把这轮对话带进 Quartz 继续，⌘C 直接复制答案。
- **导出** —— 把任意对话存为 **Markdown / PDF / PNG**（或复制为 Markdown），保留 KaTeX 公式和代码块。
- **对话内搜索（⌘F）** —— 既搜所有对话，又在当前对话里**高亮每一处命中**，支持 ↑/↓ 遍历。
- **系统提示词库** —— 多套提示词按对话切换；内置一套犀利的「专家」默认提示。
- **推理 · 联网 · 上下文压缩** —— 可切换深度思考强度、联网搜索（OpenRouter），或压缩较早的对话以省上下文。
- **回答版本** —— 重新生成、或编辑后重发，并在多个答案间切换。
- **节点导航图** —— 对话的迷你地图，快速跳转。
- **自动命名 · 删除可撤销 · 归档** —— 干净又不怕误删的对话管理。
- **黑白界面** —— 浅色/深色（跟随系统）、字体/字号/密度/正文宽度可调、G2 squircle 圆角。
- **自动更新** —— 从 GitHub Releases 检查新版本。

---

## 下载

到 [**Releases**](https://github.com/Skywalker144/Quartz/releases) 页拿最新版。

| 平台 | 文件 | 说明 |
|---|---|---|
| **macOS**（Intel / Apple Silicon） | `Quartz-<版本>-universal.dmg` | 打开 dmg，把 **Quartz** 拖进「应用程序」。 |
| **Windows**（x64） | `Quartz-Setup-<版本>.exe` | 运行安装程序；安装后支持应用内更新。 |

应用**未做商业代码签名**，所以首次打开时：
- **macOS** —— 若提示「无法验证开发者」，右键图标 →「**打开**」一次即可。
- **Windows** —— 若 SmartScreen 拦截，点「**更多信息 → 仍要运行**」。

---

## 配置

1. 打开**设置**（`⌘,` / `Ctrl+,`）→ **模型提供方**，填入任意一家的 API Key。
2. 到**管理模型**点「推荐模型」的标签启用你要的模型，再到**默认模型**设好默认。
3. **DeepSeek** 即插即用：填入 Key 会自动加上 `deepseek-v4-pro` / `deepseek-v4-flash`，并设为对话 / 命名模型。

要接入第三方兼容服务，在 **OpenAI** 或 **Anthropic** 服务商下填写 **Base URL**。地址应包含 API 版本根路径（如 `https://example.com/v1`），不要带 `/chat/completions` 或 `/messages`；留空则使用官方接口。

---

## 快捷键

> Windows/Linux 上 `⌘` → `Ctrl`。

| 快捷键 | 功能 |
|---|---|
| `⌥Space` | 速答浮条（全局） |
| `⌘⇧L`（macOS）/ `Alt+Shift+L`（Windows/Linux） | 唤起并聚焦 Quartz（全局） |
| `⌘N` | 新对话 |
| `⌘B` | 收起 / 展开侧栏 |
| `⌘1` – `⌘9` | 切换侧栏顶部第 1 – 9 个对话 |
| `⌘L` | 聚焦输入框 |
| `⌘F` | 搜索对话 |
| `⌘,` | 设置 |
| `Enter` / `Shift+Enter` | 发送 / 换行 |

两个全局快捷键都可在**设置 → 快捷键**里改。

---

## 从源码构建

需要 **Node.js 20+**。

```bash
git clone https://github.com/Skywalker144/Quartz.git
cd Quartz
npm ci
npm start          # 开发运行
```

本地打包（macOS Universal dmg+zip、Windows x64 便携 zip）：

```bash
./build.sh mac     # 或：win | all
```

构建/发布的细节（镜像、Rosetta、签名、发版）见 [RELEASE.md](RELEASE.md)。
要出 Windows 原生安装包（`.exe`，且支持自动更新），需在 Windows 电脑上构建 —— 见 [BUILD-WINDOWS.md](BUILD-WINDOWS.md)。
项目文档入口见 [docs/README.md](docs/README.md)。

---

## 给朋友发一个「开箱即用」的版本

你可以把 API Key + 默认模型打进安装包，让对方无需配置直接用 —— 复制
[`.env.example`](.env.example) 为 `.env`，填好后 `./build.sh` 即可。

> ⚠️ **打进包里的 Key 是可被提取的**。请只用一把**专用、设了额度上限**的 Key，用完即作废，
> 且**绝不要**提交 `.env`、也**绝不要**把带 Key 的包传到公开 Release。本仓库的公开 Release **不含**任何 Key。

---

## 技术

Electron · 原生 JS（无框架）· IndexedDB 存储 · 内置
[marked](https://github.com/markedjs/marked)、[KaTeX](https://katex.org/)、
[highlight.js](https://highlightjs.org/)、[DOMPurify](https://github.com/cure53/DOMPurify)。
自动更新用 [electron-updater](https://www.electron.build/auto-update)。

## License

[MIT](LICENSE) © 2026 Sky Cheng
