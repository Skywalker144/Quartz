# Quartz 文档索引

- 开发原则与行为约束：[RULES.md](../RULES.md)
- 仓库开发、验证与发布约束：[AGENTS.md](../AGENTS.md)
- 用户说明与本地构建入口：[README.md](../README.md)
- 正式发布流程：[RELEASE.md](../RELEASE.md)
- 正式发布执行源：[release.yml](../.github/workflows/release.yml)
- 版本变化记录：[CHANGELOG.md](../CHANGELOG.md)
- Windows 本地打包验证：[BUILD-WINDOWS.md](../BUILD-WINDOWS.md)

## 代码入口

- 桌面主进程与窗口生命周期：[main.js](../main.js)
- 主进程服务：[main/](../main/)
- 主窗口启动编排：[app.js](../app.js)
- 主窗口领域模块：[renderer/](../renderer/)
- 提供商与流式请求共享核心：[quartz-core.js](../shared/quartz-core.js)
- QuickBar 入口：[quickbar.js](../quickbar.js)
