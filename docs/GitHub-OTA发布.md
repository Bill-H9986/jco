# GitHub Releases OTA 发布

- 适用版本：`0.6.0-beta.5` 起
- 目标：安装版不再靠手动发安装包，统一从 GitHub Releases 检查、下载、安装新版本。

## 1. 一次性准备

```powershell
gh auth login
```

登录后确认：

```powershell
gh auth status
```

仓库可以是公开仓库；如果使用私有仓库，GitHub CLI 和发布账号需要具备仓库 `Contents: Read and write` 权限。

## 2. 打包并发布

```powershell
cd C:\Users\Jay\Documents\Codex\2026-10-17\zhu\work\jco-beta\app
$env:JCO_GITHUB_REPO = '你的GitHub用户名/jco'
npm run release:github
```

脚本会：

1. 编译 TypeScript；
2. 以 `https://github.com/<owner/repo>/releases/latest/download` 为更新源打包 NSIS；
3. 跑 `qa-packaged`；
4. 用 `gh release create` 上传安装包、blockmap 和 `beta.yml`，并标记为 latest。

## 3. 让已装旧版切到 GitHub OTA

旧版如果还指向 `127.0.0.1:8787` 测试源，不需要重新安装，执行：

```powershell
cd C:\Users\Jay\Documents\Codex\2026-10-17\zhu\work\jco-beta\app
node scripts/point-installed-updater.mjs https://github.com/你的GitHub用户名/jco/releases/latest/download
```

然后重启 J.Co。应用会在启动约 15 秒后检查 GitHub Release；发现新版本会后台下载，退出应用时自动安装。

## 4. 为什么用 `releases/latest/download`

当前更新器使用 electron-updater 的 generic provider。GitHub 的固定短地址会跳到“最新 Release”的资产目录，因此：

- Release 必须发布为 latest（不要把 beta 标成 GitHub prerelease）；
- 资产必须有 `beta.yml`、`J.Co Setup <version>.exe`、`J.Co Setup <version>.exe.blockmap`；
- 版本号继续使用 `0.6.0-beta.N`，但 GitHub Release 的 latest 标记用于定位资产。

## 5. 仍保留的安全边界

- 更新 yml 里带 SHA-512，下载后会校验；
- 当前安装包仍是 `NotSigned`，正式对外分发前应提供 Windows 代码签名证书或明确内测策略；
- 发布、删除、支付等业务动作仍由人在应用内确认，OTA 只更新程序本身。

## 6. 排错顺序

1. `gh auth status` 是否已登录；
2. Release 是否 latest，资产是否有 `beta.yml`；
3. 应用 `%APPDATA%\J.Co\update-channel.json` 的 `feedUrl` 是否指向 GitHub；
4. 设置页自动更新状态是否进入 `checking → available → downloading → downloaded`；
5. 仍失败时查看应用日志和 `app-update.yml` 的 `url`。
