# 在 Windows 上打包 ChatBox（.exe 安装包）

Mac 无法直接交叉编译 Windows 安装包（缺 Wine），所以在 Windows 电脑上原生构建最省事。

## 1. 装好 Node.js
装 Node.js **LTS（18/20/22 均可）**：https://nodejs.org/ 。装完在 PowerShell 里验证：

```powershell
node -v
npm -v
```

## 2. 把项目拷到 Windows
**只拷源文件，不要拷 `node_modules/` 和 `dist/`**（Mac 的 node_modules 里是 macOS 原生二进制，到 Windows 用不了，必须重新 `npm install`）。

需要拷的东西：

```
index.html  styles.css  app.js  main.js  preload.js
package.json  package-lock.json
vendor/         （整个文件夹，里面是 marked + katex）
BUILD-WINDOWS.md（可选）
```

放到任意目录，例如 `C:\Users\你\ChatBox`。

## 3. 安装依赖并打包

```powershell
cd C:\Users\你\ChatBox
npm install
npm run dist:win
```

完成后，安装包在：

```
dist\ChatBox Setup 0.1.0.exe
```

双击即可安装。装好后开始菜单里就有 ChatBox。

---

## 如果下载卡住（代理 / 网络问题）
构建分两步会联网下载，国内网络可能卡。分别对应两个镜像环境变量，在 **同一个 PowerShell 窗口** 里先设置再跑命令：

```powershell
# Electron 本体（npm install 阶段会下）
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
# electron-builder 的 nsis / winCodeSign 助手（dist:win 阶段会下）
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"

npm install
npm run dist:win
```

> 说明：第一条解决 `npm install` 时 Electron 二进制下载失败；第二条解决打包时 `winCodeSign`/`nsis` 助手下载失败。两条都设上最稳。

## 备注
- 当前用的是 **默认 Electron 图标**（白底原子图标）。想换成自定义图标，准备一个 256×256 的 `build\icon.ico`，electron-builder 会自动用它，无需改配置。
- 安装包**未做代码签名**，Windows SmartScreen 首次运行可能提示"未知发布者"——点「更多信息 → 仍要运行」即可。要去掉这个提示需要购买 Windows 代码签名证书。
- 想出免安装绿色版：把 `package.json` 里 `build.win.target` 的 `"nsis"` 改成 `"portable"`（或加一个），重新 `npm run dist:win`，会得到一个单文件 `ChatBox 0.1.0.exe` 直接运行。
