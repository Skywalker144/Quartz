<div align="center">

# Quartz

**A fast, minimal, monochrome desktop AI chat app.**

[![Release](https://img.shields.io/github/v/release/Skywalker144/Quartz?color=111&label=release)](https://github.com/Skywalker144/Quartz/releases)
[![License](https://img.shields.io/badge/license-MIT-111)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-111)

</div>

Quartz is a clean, keyboard-first desktop client for chatting with frontier LLMs through
**OpenRouter, OpenAI, Anthropic, DeepSeek, and Google** — with a global Option+Space quick-ask,
one-click export, in-chat search, and a sharp black-and-white design.

> The app interface is in **Simplified Chinese (简体中文)**.

---

## Features

- **Multi-provider** — OpenRouter / OpenAI / Anthropic / DeepSeek / Google, switch models per conversation. One-click "suggested model" chips make setup painless; entering a DeepSeek key auto-configures its models.
- **Global quick-ask (⌥Space)** — a Spotlight-style bar that pops up anywhere: type, hit Enter, get a concise streamed answer. Press Enter again (or the button) to continue the thread inside Quartz; ⌘C copies the answer.
- **Export** — save any conversation as **Markdown, PDF, or PNG** (or copy as Markdown), with KaTeX math and code blocks preserved.
- **In-chat search (⌘F)** — search across conversations *and* highlight every match in the open one, with ↑/↓ traversal.
- **System-prompt library** — keep multiple prompts, switch per conversation; ships with a strong "expert" default.
- **Reasoning · web search · context compaction** — toggle deep-thinking effort, web search (OpenRouter), or summarize older turns to save context.
- **Answer versions** — regenerate or edit-and-resend, then flip between answers.
- **Node-map navigator** — a mini map of the conversation for quick jumps.
- **Auto-title, delete-with-undo, archive** — tidy, forgiving conversation management.
- **Monochrome UI** — light/dark (follows system), adjustable font/size/density/width, squircle corners.
- **Auto-update** notifications from GitHub Releases.

---

## Download

Get the latest build from the [**Releases**](https://github.com/Skywalker144/Quartz/releases) page.

| Platform | File | Notes |
|---|---|---|
| **macOS** (Apple Silicon) | `Quartz-<ver>-arm64.dmg` | Open the dmg, drag **Quartz** to Applications. |
| **Windows** (x64) | `Quartz-<ver>-win-x64.zip` | Unzip, run `Quartz.exe` (portable, no installer). |

The app is **not commercially code-signed**, so on first launch:
- **macOS** — if you see "cannot verify the developer", right-click the app → **Open** once.
- **Windows** — if SmartScreen warns, click **More info → Run anyway**.

---

## Setup

1. Open **Settings** (`⌘,` / `Ctrl+,`) → **模型提供方 (Providers)** and paste an API key for any provider.
2. In **管理模型 (Manage Models)**, click the suggested-model chips to enable the ones you want, then set your defaults under **默认模型 (Defaults)**.
3. **DeepSeek** is plug-and-play: pasting its key auto-adds `deepseek-v4-pro` / `deepseek-v4-flash` and sets them as the chat / title models.

---

## Keyboard shortcuts

> On Windows/Linux, `⌘` → `Ctrl`.

| Shortcut | Action |
|---|---|
| `⌥Space` | Quick-ask bar (global) |
| `⌥⌘Space` | Open & focus Quartz (global) |
| `⌘N` | New conversation |
| `⌘L` | Focus the input box |
| `⌘F` | Search conversations |
| `⌘,` | Settings |
| `Enter` / `Shift+Enter` | Send / newline |

All global shortcuts are configurable under **Settings → 快捷键**.

---

## Build from source

Requires **Node.js 18+**.

```bash
git clone https://github.com/Skywalker144/Quartz.git
cd Quartz
npm install
npm start          # run in dev
```

Package distributables (macOS arm64 dmg+zip, Windows x64 portable zip):

```bash
./build.sh mac     # or: win | all
```

Maintainer build/release details (mirrors, Rosetta, signing, publishing) are in [RELEASE.md](RELEASE.md).
For a native Windows installer (`.exe`, with auto-update), build on a Windows PC — see [BUILD-WINDOWS.md](BUILD-WINDOWS.md).

---

## Shipping a pre-configured build to a friend

You can bundle an API key + default model so a recipient can use Quartz without any setup — copy
[`.env.example`](.env.example) to `.env`, fill it in, then `./build.sh`.

> ⚠️ **A bundled key is extractable** from the app bundle. Only ship a **dedicated, low-limit** key,
> revoke it afterward, and **never** commit `.env` or put your key in a public release. The public
> releases here contain **no** key.

---

## Tech

Electron · vanilla JS (no framework) · IndexedDB for storage · vendored
[marked](https://github.com/markedjs/marked), [KaTeX](https://katex.org/),
[highlight.js](https://highlightjs.org/), and [DOMPurify](https://github.com/cure53/DOMPurify).
Auto-update via [electron-updater](https://www.electron.build/auto-update).

## License

[MIT](LICENSE) © 2026 steve.tu
