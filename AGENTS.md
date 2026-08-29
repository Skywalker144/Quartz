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


## 通用开发规则

执行本仓库任务前，必须完整阅读并遵循仓库根目录的 `RULES.md`。
若其与更高优先级指令或用户在当前任务中的明确要求冲突，以后者为准。
