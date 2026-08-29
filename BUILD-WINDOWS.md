# 在 Windows 上验证 Quartz 安装包

正式发布由 [release workflow](.github/workflows/release.yml) 执行，维护流程见 [RELEASE.md](RELEASE.md)。本页只说明 Windows 本地构建验证。

## 环境

安装 Node.js 20，并在 PowerShell 中确认：

```powershell
node -v
npm -v
```

获取源码并安装锁定依赖：

```powershell
git clone https://github.com/Skywalker144/Quartz.git
cd Quartz
npm ci
```

不要从其他平台复制 `node_modules/` 或 `dist/`。

## 构建与检查

```powershell
npm test
npm run dist:win
```

构建结果位于 `dist\`，其中包括：

- `Quartz-Setup-<version>.exe`
- `latest.yml`
- 对应的 `.blockmap`

安装后检查启动、主窗口、QuickBar、导出和应用内更新状态。

## 下载受阻

Electron 与 electron-builder 的构建依赖需要联网下载。需要镜像时，在同一 PowerShell 会话设置：

```powershell
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
npm ci
npm run dist:win
```

安装包使用 [package.json](package.json) 中的应用图标与 NSIS 配置。公开发布不得从本地命令上传；按 [RELEASE.md](RELEASE.md) 推送标签，由工作流生成并发布全部平台产物。
