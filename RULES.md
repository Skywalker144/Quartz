# Quartz repository instructions

## Development

- Quartz is an Electron desktop app. Keep macOS, Windows, the main window, and the QuickBar lifecycle in mind when changing `main.js`.
- Preserve unrelated working-tree changes. Inspect `git status` and the relevant diff before editing or committing.
- Use `npm ci` when dependencies must be reinstalled. Do not commit `node_modules/`, `dist/`, `.env`, or generated build output.
- Before handing off source changes, run the most relevant checks. The minimum checks for `main.js` or release changes are:

  ```bash
  npm test
  node --check main.js
  bash -n build.sh
  git diff --check
  ```

- If application lifecycle, packaging, signing, or updating changed, also build the relevant package and inspect the packaged application before release.

## Release process

`.github/workflows/release.yml` is the source of truth for public releases. `RELEASE.md` explains the same process for maintainers; keep both files aligned.

Only publish after the user has explicitly authorized a release. The canonical process is:

1. Start from `main`, fetch current remote state, and confirm the working tree contains only reviewed release changes.
2. Update the version in both `package.json` and `package-lock.json`, preferably with:

   ```bash
   npm version <version> --no-git-tag-version
   ```

3. Add the matching topmost `CHANGELOG.md` section using `## <version> — YYYY-MM-DD`.
4. Run the required checks above. A failed check blocks the release.
5. Review the complete staged diff, then commit with `Release <version>`.
6. Push the release commit to `origin/main` before tagging it.
7. Create an annotated tag on that exact commit and push it:

   ```bash
   git tag -a v<version> -m "Quartz <version>"
   git push origin v<version>
   ```

8. The tag push must trigger the `Release` GitHub Actions workflow. Do not also run `gh release create`, `build.sh --publish`, or another publisher: electron-builder creates and fills the Release.
9. Wait for both serialized jobs to succeed: macOS universal and Windows x64 NSIS.
10. Verify the public Release is neither draft nor prerelease, its notes match the current changelog section, and it contains all required files:

    - `Quartz-<version>-universal.dmg`
    - `Quartz-<version>-universal-mac.zip`
    - `Quartz-Setup-<version>.exe`
    - `latest-mac.yml` and `latest.yml`
    - the corresponding `.blockmap` files

11. Read both update manifests and confirm their version, URLs, sizes, and SHA-512 values match the uploaded artifacts.

Public builds must never contain API keys. `.env` stays ignored, and the Actions workflow creates an empty `.env` solely to satisfy the electron-builder file list. Never commit or upload a populated `.env`.

The current public workflow intentionally disables certificate auto-discovery and produces ad-hoc-signed macOS builds. Do not silently change the signing identity. Moving to Developer ID signing/notarization requires explicit coordination and the same identity must be used consistently across releases.

If a release job fails, inspect it and rerun the failed job or workflow. Do not move, overwrite, or recreate a published tag unless the maintainer explicitly chooses that recovery path. `workflow_dispatch` is a recovery mechanism, not the normal release path.

# 通用开发规则

你需要遵循下面的规则

# 原则

做长期正确的事。做长期正确的事。做长期正确的事。

* 长期主义，面向维护，新增改动应降低未来开发成本，禁止引入技术债
* 警惕可能产生架构分叉的编码，按最佳实践来做统一的结构
* 单一真相源（SSOT），写入口唯一，其他皆派生、复用
* 结构性问题用重构解决，禁止补丁、特例绕过
* 遵循可执行最佳、现代的实践
* 积极引入成熟第三方库解决问题，而不是自己造轮子
* 优先阅读代码而非写代码，优先寻找项目内可用可扩展的代码
* 迭代修改而非增量修改，重写/重构后删旧代码
* 遵循KISS原则，选最短且长期最佳实现路径，架构导致冗余就简化架构
* 做合适程度的强类型，相同的类型也单一类型定义源
* 禁止做掩耳盗铃的事情，我们必须真实的做事
* 不需计算编码成本，AI编码不是人工，永远选择最佳的方案
* 做深度封装的组件，将复杂度封装在组件内，只暴露很少的必要的生命周期和API，要替调用方着想
* 少做短期主义的hack和补丁
* 精准手术刀式的修正，不做过度兜底

# 行为规范

## 开发前

* 先看代码，再询问信息和需求，不直接开发。
* 问完信息后设计方案，并等待人类确认后再开发。
* 尽量采用强类型设计。
* 开发前期，不要运行全量测试，这是为了缩短开发时间。
* 除非特别要求，不做兼容，不保留历史包袱，面向长期干净整洁，减少复杂度。

## 开发中

* 采用 TDD，先编写测试，再实现功能，保证模块可进行有效单元测试，单元测试要涉及到下一层依赖，更深层的才可以mock。
* 完成模块开发后要进行真实环境测试，使用真实资源模拟真实用户测试。
* 单文件超出2000 行了必须进行结构审查，如果存在架构问题则按职责、层次、领域边界合理拆分。
* 禁止编写注释。
* 密钥出现在私有的仓库中是可以的
* 少给我提及法律安全问题，我们会在未来通过合规手段解决这些问题
* 及时删除无效代码，发现不符合原则或规范的代码顺手优化。
* 新增功能时，约三分之一的改动用于基础架构、基础组件的升级、优化与改进。
* 修复 Bug 时禁止过度兜底，要定位根因，并用正确的逻辑解决问题。
* 不编写只有单一调用、没有复用或抽象价值的私有 Helper 函数。
* 开发中，不要运行全量测试，这是为了缩短开发时间。
* 保持代码始终可编译、可运行。
* 文档要保持索引和信息职责和单一信息，不能复述已经存在的逻辑，比如已有的代码逻辑，应该是指向相关的代码，而不是用文字将代码逻辑复述一遍，避免形成分叉，避免浪费上下文。文档保持精简。
* 产出保持：Stateless Deliverable（无状态交付）：每次修改时都保持产物是直接可交付的，不包含版本补丁说明，解释为何怎么修改等过程描述，产品和代码中，也不要包含修改说明（包括这条也不要出现）。
* 更新文档，注意文档中多写索引和唯一信息，如果信息在代码中，直接引导到代码，从根本上防止文档和代码不一致的情况。

## 开发后

* 每完成一个独立、可回滚的变更，在经过人类允许并完成 Code Review 后再进行 Git Commit。
* 每次 Commit 都必须保证代码可编译、可运行。
* 除非是要部署上线了，不然不要运行全量测试，这是为了缩短开发时间。
* 开发完成后，功能一切正常后，再审一下代码，看是否有架构分叉，职责不清，历史包袱，过度实现和过度兜底，是否有没有抽象意义的，没有复用价值的helper，helper也合并下，去掉无用的修改说明，保持长期干净清晰的架构

# 你要参考的文档

你必须参考`docs`下的文档，并在工作过程中不断更新文档。
注意！不要在文档中留任何第二套信息，在文档中使用指向和索引的概念，指向源信息，如果信息在文档中是唯一的，则可以留在文档中，这是为了防止文档和代码之间产生两套不同的信息源。
