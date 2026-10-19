# GitHub Releases OTA 证据

- 日期：2026-10-19
- 仓库：`https://github.com/Bill-H9986/jco`
- Release：`https://github.com/Bill-H9986/jco/releases/tag/v0.6.0-beta.5`
- OTA feed：`https://github.com/Bill-H9986/jco/releases/latest/download`

## 已验证

1. `0.6.0-beta.5` NSIS 包构建成功，`qa-packaged` 冒烟通过。
2. Release 资产存在：
   - `beta.yml`
   - `J.Co.Setup.0.6.0-beta.5.exe`
   - `J.Co.Setup.0.6.0-beta.5.exe.blockmap`
3. `beta.yml` 的 `path` 已对齐 GitHub 实际资产名（空格→点），安装包下载地址返回 200。
4. 已安装 `0.6.0-beta.4` 通过 GitHub feed 真实进入：
   `idle → available → downloading`。
5. 当前网络从 GitHub release-assets 下载约 30–50 KB/s；到 4.6% 时主动停止测试进程，避免长时间占用本机。未把这写成“已完成安装”。

## 仍未完成

- 221 MB 整包下载/安装未在本次网络条件下跑完；
- Windows Authenticode 签名未提供；
- 本机 Git 到 `github.com:443` 偶发连接重置，最后几个发布脚本/文档提交待补推；GitHub Release 资产不受影响。
