# AtomGit（GitCode）OTA 发布

- 适用版本：`0.6.0-beta.7` 起
- 平台说明：`gitcode.com` 与 `atomgit.com` 是同一平台的两个品牌入口（同 IP、同 Cookie 体系、同页面标题），账号和仓库通用。
- 目标：源码与 Release 都放在国内可访问的平台，OTA 不再依赖 GitHub 或第三方代理。

## 1. 一次性准备

1. 在 AtomGit 新建**公开**仓库 `jco`，不要勾选“初始化 README”，这样可以直接推送现有提交历史。
2. 打开 <https://atomgit.com/setting/token-classic> 新建 access token，只勾选该仓库需要的读写的权限。
3. token 只放在本机环境变量里，不写进仓库、不写进文档。

## 2. 推送源码

```powershell
cd C:\Users\Jay\Documents\Codex\2026-10-17\zhu\work\jco-beta
git remote add atomgit https://atomgit.com/<用户名>/jco.git
git push atomgit beta/0.6.0
```

`origin` 仍保留 GitHub，两个平台互不影响。

## 3. 发布安装包到 AtomGit Release

```powershell
cd C:\Users\Jay\Documents\Codex\2026-10-17\zhu\work\jco-beta\app
$env:JCO_ATOMGIT_REPO = '<用户名>/jco'
$env:JCO_ATOMGIT_TOKEN = '<access token>'
npm run release:atomgit
```

脚本会：

1. 读取 `release/` 下已打好的通道 yml、安装包和 blockmap；
2. 创建或更新 `v<版本>` Release；
3. 用 AtomGit 提供的 OBS 预签名地址上传资产；
4. 生成 `release-feed/beta.yml`，安装包地址写成 Release 附件的绝对下载地址。

完成后把 `release-feed/beta.yml` 提交到仓库：

```powershell
git add release-feed/beta.yml
git commit -m "chore(release): 更新 AtomGit OTA 通道"
git push atomgit beta/0.6.0
```

## 4. 为什么 feed 放在仓库里

electron-updater 的 generic provider 会固定请求 `<feedUrl>/beta.yml`，而 AtomGit Release 附件目录不是静态目录结构。因此：

- `beta.yml` 只有几百字节，放进仓库根的 `release-feed/`，用 API raw 端点读取；
- `beta.yml` 里的安装包地址写成绝对 URL，指向 Release 附件的下载 API；
- 安装包本身不进 Git，仓库体积不受影响。

更新源形如：

```text
https://api.gitcode.com/api/v5/repos/<用户名>/jco/raw/release-feed?ref=main
```

注意：网页版 `/<用户名>/jco/raw/<分支>/<路径>` 会被前端路由接管，必须用 API raw 端点；`ref` 要和实际推送分支一致。

## 5. 实测结果（2026-10-19）

- 221 MB 安装包上传成功，耗时约 70 秒；附件下载 API 可直接匿名访问并 302 到 OBS。
- 完整下载 221,629,374 字节，用时 59.1 秒（约 3.57 MB/s），SHA-512 与通道文件一致。
- Range 请求返回 `206` 和正确的 `Content-Range`，断点续传可用。
- 网页版 raw 路由会被前端 SPA 接管，必须使用 API raw 端点。
- 差分更新依赖安装包同目录的 `.blockmap`；当前绝对 URL 方案下会回退全量下载。若确认全量下载可接受，可在更新器里显式关闭差分下载，避免每次多一次失败请求。
- 正式对外分发前仍需 Windows 代码签名；当前为内测策略。

## 6. 回滚

把已安装版的更新源切回 GitHub：

```powershell
node scripts/point-installed-updater.mjs https://github.com/Bill-H9986/jco/releases/latest/download
```

## 7. 排错顺序

1. `git ls-remote https://atomgit.com/<用户名>/jco.git` 能读到分支；
2. 浏览器直接打开 `release-feed/beta.yml` 的 raw 地址能下载；
3. 浏览器直接打开 `beta.yml` 里的安装包地址能开始下载；
4. 应用 `%APPDATA%\J.Co\update-channel.json` 的 `feedUrl` 指向 AtomGit；
5. 设置页检查更新进入 `checking → available`，再手动点下载。

## 8. 安装链路实测与修复

2026-10-19 在真机安装了 `0.6.0-beta.7`，完整跑通：

- 应用自动检查 AtomGit feed，发现 `beta.8` / `beta.9` / `beta.10`；
- 顶部与设置页显示“发现新版本”，不自动下载；
- 点「下载更新」后下载 221 MB，进度到 100%，SHA-512 校验通过；
- 点「重启并安装」后应用退出，安装包静默安装，应用自动重启，版本号更新。

期间发现并修复一个真实缺陷：应用重启后 electron-updater 的内存状态丢失，早期实现会回退到过期的 `installer.exe`，导致“点了重启并安装但版本不变”。`0.6.0-beta.9` 起改为：

1. 优先使用 electron-updater 记录的下载文件；
2. 其次使用 `pending/download`（最新下载，已由更新器校验）；
3. 最后才回退到 `installer.exe`。

该修复已用 `beta.9 → beta.10` 真机升级验证。
