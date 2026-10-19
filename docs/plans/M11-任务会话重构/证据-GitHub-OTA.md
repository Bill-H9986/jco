# GitHub Releases OTA 证据

- 日期：2026-10-19
- 仓库：`https://github.com/Bill-H9986/jco`
- Release：`https://github.com/Bill-H9986/jco/releases/tag/v0.6.0-beta.7`
- OTA feed：`https://github.com/Bill-H9986/jco/releases/latest/download`

## 已验证

1. `0.6.0-beta.5`/`0.6.0-beta.6` NSIS 包构建成功，`qa-packaged` 冒烟通过。
2. Release 资产存在：
   - `beta.yml`
   - `J.Co-0.6.0-beta.6.exe`（无空格 artifactName）
   - `J.Co-0.6.0-beta.6.exe.blockmap`
3. `beta.yml` 的 `path` 已对齐 GitHub 实际资产名（空格→点），安装包下载地址返回 200。
4. 已安装 `0.6.0-beta.4` 通过 GitHub feed 真实进入：
   `idle → available → downloading`。
5. 当前网络从 GitHub release-assets 下载约 30–50 KB/s；改用临时 `gh-proxy.com` 镜像后，30 秒下载到 100%，随后 OTA 安装完成，安装目录版本变为 `0.6.0-beta.6`。
6. `0.6.0-beta.6` 在 GitHub 直连下点击“检查更新”，状态返回“已是最新版本”，按钮恢复可点；不再无限停在“检查中…”。
7. `0.6.0-beta.7` 已上传：自动检查发现新版本后，应用壳顶部显示常驻更新横幅；下载按钮由用户点击，下载完成后仍需用户点“重启并安装”。关闭应用不会自动安装。

## 调研结论

- electron-builder issue #1600 的维护者明确建议：中国区不要把 GitHub Releases 直接作为更新源，使用 generic/custom mirror 或 S3。
- electron-builder issue #2398 记录了网络切换/连接重置时 electron-updater 错误可能不按预期冒泡；因此主进程必须有超时和看门狗。
- `gh-proxy.com`、`ghfast.top`、`ghproxy.net` 当前可访问，其中 `gh-proxy.com` 实测 5 MB 首段约 531 KB/s；它们只用于临时验证，不作为正式生产源。

## 仍未完成

- Windows Authenticode 签名暂缓（用户明确要求）；
- 生产更新镜像尚未建立：建议 GitHub 作为源，GitHub Actions 同步到自建 R2/OSS/COS 的 generic HTTPS feed；
- `beta.7` 的 OTA 实测等待用户从 `beta.6` 点击下载/安装；
- 本机 Git 到 `github.com:443` 偶发连接重置，最后几个发布脚本/文档提交待补推；GitHub Release 资产不受影响。
