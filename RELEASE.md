# 构建与发布 Quartz

维护者说明。公开发布的唯一正式入口是 [`.github/workflows/release.yml`](.github/workflows/release.yml)：推送 `v*` 标签后，GitHub Actions 自动构建 macOS Universal 与 Windows NSIS 安装包，并由 electron-builder 创建 GitHub Release。

## 发布产物

每个正式版本必须包含：

- `Quartz-<ver>-universal.dmg`
- `Quartz-<ver>-universal-mac.zip`
- `Quartz-Setup-<ver>.exe`
- `latest-mac.yml`、`latest.yml`
- 上述安装包对应的 `.blockmap`

`latest-mac.yml` 和 `latest.yml` 是自动更新入口，不能遗漏。工作流使用 Node.js 20，两个平台串行发布，避免同时创建同一个 Release 导致 `422 already_exists`。

## 发布一个版本

以下以 `0.1.41` 为例。

### 1. 准备版本内容

确认当前分支为 `main`，并检查工作区只包含本版本计划发布的变更：

```bash
git status --short
git diff --check
npm version 0.1.41 --no-git-tag-version
```

`npm version --no-git-tag-version` 会同时更新 `package.json` 和 `package-lock.json`，但不会创建提交或标签。随后在 `CHANGELOG.md` 最上方增加：

```markdown
## 0.1.41 — 2026-08-24
```

Release 页面正文会由 macOS Job 自动提取这个版本的 changelog 小节。

### 2. 发布前验证

```bash
npm test
node --check main.js
bash -n build.sh
git diff --check
```

如果修改涉及应用生命周期、自动更新、打包或签名，还应先完成对应平台的真实打包验证。macOS 本地验证可运行：

```bash
./build.sh mac
codesign --verify --deep --strict dist/mac-universal/Quartz.app
```

### 3. 提交并推送 main

先审查完整 diff，只暂存本次确认过的文件：

```bash
git diff
git add <本版本已审核的文件>
git diff --cached --check
git commit -m "Release 0.1.41"
git push origin main
```

### 4. 创建并推送标签

标签必须是 annotated tag，版本必须与 `package.json` 完全一致，而且必须指向刚推到 `main` 的 release commit：

```bash
git tag -a v0.1.41 -m "Quartz 0.1.41"
git push origin v0.1.41
```

正常发布不要同时运行 `gh release create`、`./build.sh --publish` 或其他上传命令。标签推送会触发 Actions，electron-builder 会自动创建 Release 并上传全部产物。

### 5. 核对线上发布

等待 `Release` workflow 的 macOS 和 Windows Job 都成功，然后检查：

- Release 不是 draft 或 prerelease。
- Release notes 与 `CHANGELOG.md` 的当前版本内容一致。
- 所有 DMG、ZIP、EXE、YML、blockmap 均已上传。
- `latest-mac.yml` 和 `latest.yml` 中的 `version`、文件名、大小和 SHA-512 与资产一致。

可使用 GitHub Actions / Releases 网页，也可以在 GitHub CLI 登录有效时运行：

```bash
gh run list --workflow Release --limit 5
gh run watch <run-id> --exit-status
gh release view v0.1.41
```

## 公开构建与密钥

公开 Release **绝不能包含 API Key**。`.env` 已被 Git 忽略；Actions 会创建一个空 `.env`，只用于满足 electron-builder 的 `files` 列表。给个人使用的带 Key 构建不得上传到公开 Release。

## 本地打包

`build.sh` 用于本地验证或私下构建，不是正式发布的默认入口：

```bash
./build.sh mac     # macOS Universal：dmg + zip
./build.sh win     # Windows x64 便携 zip；不是 NSIS，不支持自动更新
./build.sh all
```

脚本默认设置：

- `CSC_IDENTITY_AUTO_DISCOVERY=false`：使用 ad-hoc 签名。
- 不强制设置 `ELECTRON_MIRROR`：当前 electron-builder 还会把该变量错误应用到 `dmg-builder` 等辅助产物，可能导致 DMG 构建请求不存在的镜像地址。需要代理时应配置网络或预热缓存，不要在正式 DMG 构建中全局覆盖该变量。

如果发布机器已经安装 Developer ID Application 证书，可用 `CSC_IDENTITY_AUTO_DISCOVERY=true ./build.sh mac` 启用证书发现。正式切换签名还需要 notarization，并应在后续版本持续使用同一身份，不能在无人确认时更改。

Apple Silicon Mac 本地构建 Windows 包时，electron-builder 可能因为缺少 Rosetta 2 而无法运行 x86 Wine/rcedit。`build.sh` 会退回到便携 ZIP；正式 Windows Release 始终由 `windows-latest` Actions Runner 构建 NSIS 安装包。

## 失败恢复

- 某个 Job 失败：先检查日志，再 rerun failed jobs 或重跑同一次 workflow。
- Release 只有部分资产：优先重跑失败的矩阵 Job，不要手动创建第二个 Release。
- 不要移动、覆盖或重新创建已公开标签，除非维护者明确决定采用该恢复方案。
- `workflow_dispatch` 只用于恢复；日常发布始终使用推送 `v<version>` 标签。
