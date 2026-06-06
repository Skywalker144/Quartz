# 在 Windows 上打包 Quartz（.exe 安装包）

Mac 在 Apple Silicon 上无法干净地交叉编译 Windows 安装包（自带的 Wine 跑不起来），所以在
Windows 电脑上原生构建最省事，而且只有这样才能出**带自动更新的 NSIS `.exe` 安装包**。

## 1. 装好 Node.js
装 Node.js **LTS（18/20/22 均可）**：https://nodejs.org/ 。装完在 PowerShell 里验证：

```powershell
node -v
npm -v
```

## 2. 拿到源码
直接 clone 仓库（推荐）：

```powershell
git clone https://github.com/Skywalker144/Quartz.git
cd Quartz
```

> 如果是手动拷贝：**只拷源文件，不要拷 `node_modules/` 和 `dist/`**（Mac 的 `node_modules` 里是
> macOS 原生二进制，到 Windows 用不了，必须重新 `npm install`）。需要的文件：
> `index.html styles.css app.js quickbar.html quickbar.css quickbar.js main.js preload.js`、
> `package.json package-lock.json`、整个 `vendor/` 文件夹。

## 3. 安装依赖并打包

```powershell
npm install
npm run dist:win
```

完成后，安装包在：

```
dist\Quartz Setup 0.1.0.exe
```

双击即可安装，装好后开始菜单里就有 **Quartz**。

---

## 如果下载卡住（代理 / 网络问题）
构建会联网下载 Electron 本体和 electron-builder 的 nsis/winCodeSign 助手，国内网络可能卡。
在**同一个 PowerShell 窗口**里先设置镜像再跑命令：

```powershell
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"

npm install
npm run dist:win
```

## 发布带自动更新的版本
在 Windows 上 `npm run dist:win` 会生成 `latest.yml`——把它和 `Quartz Setup <ver>.exe` 一起传到
GitHub Release，Windows 端的自动更新（后台下载 → 左下角「重启以更新」）就能工作。详见
[RELEASE.md](RELEASE.md)。

## 备注
- 当前用的是**默认 Electron 图标**。想换：准备一个 256×256 的 `build\icon.ico`，electron-builder 会自动用它。
- 安装包**未做代码签名**，SmartScreen 首次运行可能提示「未知发布者」——点「更多信息 → 仍要运行」即可。去掉提示需购买 Windows 代码签名证书。
- 想出免安装绿色版：把 `package.json` 里 `build.win.target` 的 `"nsis"` 改成 `"portable"`，重新打包即可得到单文件 `Quartz <ver>.exe`。
