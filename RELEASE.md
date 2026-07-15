# 构建与发布 Quartz

维护者笔记。日常使用见 [README.md](README.md)。

## 准备

- **Node.js 18+**
- macOS（Apple Silicon）用于打 mac 版（`arm64`）。
- 仓库自带 `vendor/` 里的前端库，所以应用运行期没有网络依赖；`electron-updater` 是唯一打进包的 npm 依赖。

## 一键打包

```bash
./build.sh mac     # macOS arm64：dmg + zip + latest-mac.yml
./build.sh win     # Windows x64：便携 zip
./build.sh all
./build.sh mac --publish   # 打包并上传到 GitHub Release（需要 GH_TOKEN）
```

`build.sh` 会自动设两个环境变量：

- `CSC_IDENTITY_AUTO_DISCOVERY=false` —— ad-hoc 签名（没有 Apple 开发者证书）。
- `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/` —— 国内/代理友好的 Electron 下载镜像。

## 平台坑

### 在 Mac 上打 Windows
electron-builder 会用它自带的 **x86 Wine** 跑 `rcedit` 给 exe 写图标/版本号。Apple Silicon 上
**没装 Rosetta 2** 时这一步会失败（`bad CPU type`），但应用本体已经打好了 —— `build.sh` 于是
自己把 `win-unpacked/` 压成 zip，得到一个能跑的便携版（默认图标、无版本信息）。

- 想要干净的 Windows 包（带图标+版本），装一次 Rosetta：`softwareupdate --install-rosetta --agree-to-license`。
- 想要原生 **`.exe` 安装包（NSIS）且自动更新可用**，请在 Windows 电脑上构建 —— 见 [BUILD-WINDOWS.md](BUILD-WINDOWS.md)。便携 zip **不支持**自动更新。

### 代码签名 & 自动更新
都是 **ad-hoc 签名**（无证书），所以：

- **macOS** 无法**自行安装**更新（Squirrel.Mac 要求 Developer ID 签名）。Quartz 仍会检查更新源、
  在左下角弹「有新版本 · 前往下载」打开 Release 页。要真正一键自更新需 $99/年的 Apple 开发者证书。
- **Windows** 自动更新**只**在 NSIS 安装包（在 PC 上打）下可用，便携 zip 不行。

## 发一个版本

1. 升 `package.json` 里的 `version`（如 `0.2.0`）。electron-updater 靠版本号比较，必须递增。
2. 打包：`./build.sh all`。
3. 建一个 tag 为 `v<版本>` 的 GitHub Release，把**全部**这些传上去：
   `Quartz-<ver>-arm64.dmg`、`Quartz-<ver>-arm64-mac.zip`、`latest-mac.yml`、`Quartz-<ver>-win-x64.zip`
   （`.yml` 是自动更新检查的关键 —— 别漏）。

用 GitHub CLI 最省事：

```bash
gh release create v0.2.0 --title "Quartz 0.2.0" --notes "..." \
  dist/Quartz-0.2.0-arm64.dmg dist/Quartz-0.2.0-arm64-mac.zip \
  dist/Quartz-0.2.0-win-x64.zip dist/latest-mac.yml
```

或让 electron-builder 直接发布：`GH_TOKEN=<token> ./build.sh mac --publish`
（用 `package.json` 里的 `build.publish` 配置；`releaseType: "release"` 表示直接发布而非草稿），
再把 Windows zip 附到那个 Release 上。

> 公开 Release **绝不能**含 API Key —— 用空的 `.env` 来打公开版。给朋友的带 Key 版本是私下发的，永不公开。
