# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.3.0](///compare/v0.2.0...v0.3.0) (2026-10-16)

### Features

* **m2:** 多平台发布机制全量接通——平台表（抖音/视频号/小红书/B站/快手，单一来源）+ 会话服务按平台启动（独立登录态目录+域名白名单）+ 平台切换自动换会话 + 发布页按钮动态跟随勾选平台 + 任务卡带平台名；E2E 4 条全绿；真机验证：切视频号→1秒跳转→AI 识别登录页如实交接（请用户扫码） b745576
* **m2:** 发布操作要点注入系统提示词（权限弹窗清障/封面弹窗四步路径/快照纪律/如实汇报）+ 回合超时 90 秒→3 分钟（适配多步发布任务） fb44396
* **m2:** 发布页「让 AI 发到抖音」入口上线——一键启动发布会话 + 带任务跳总管自动开干（照抄首页 handoff 模式）；应用退出自动收会话（无孤儿浏览器）；两道门双过（preflight 0 违规 / 守门员仅计划内新增）；E2E 4 条全绿；真机验证：1 秒跳转、AI 接活（背红线 + 要素材路径） 5db449b
* **m2:** 发布引擎核心落地——通用引擎子进程 + 抖音适配包 + IPC/preload 接线 + 编译与打包适配；单测 16 项先红后绿；真机预检通过 opening→awaiting_login→stopped 78336e2
* **m2:** 数据层接线——「让 AI 发到抖音」任务卡自动带最近成片路径（草稿 videos[].path，来自做视频页落盘）+ 最近封面图路径（活动日志）；找不到时如实问用户；preflight 0 违规；真机验证任务卡自动含路径 35e7ea1
* **m2:** AI 操作工具集第一版（AI 的『手』）——8 个白名单原子工具（open_page/snapshot/click/type_text/upload_file/scroll/screenshot/wait）+ 域名白名单强制 + 红线安全断言测试 dd848ea
* **m2:** AI 之手全链路落地——内核工具插件（8 工具白名单·瘦代理）+ 发布会话服务（回环 HTTP + 随机 token）+ bridge 第三 patch + 主进程/preload 接线；首次联调一次通过：聊天一句指令 → AI 调用 jco_open_page → 浏览器真实打开抖音发布页 → AI 回复确认（零 JS 错误） be5f0c6
* **m3:** 打包适配——kernel 全量解包+路径映射（补丁/插件/sessionFile 全走 asar.unpacked）+ publish/** 纳入包 + 敏感运行时文件排除 + 正式应用图标（蓝底白 J）；打包版冒烟全链路通过（点按钮→会话就绪→跳总管→任务卡） 5c5d99d

### Bug Fixes

* **m2:** 抖音适配：登录后跳首页自动回位（detectLogin 兜底）+ 浏览器降自动化痕迹参数——真机联调验证：全流程 30 秒跑到 ready（视频上传 100% / 标题话题填写 / 停在发布前） c22c510
* **m2:** 工具错误可行动化（实战第三课）——点击被遮挡时直接告知改点哪个编号；点击触发文件对话框时自动取消并指引改用 upload_file；click 超时 15s→8s（快速失败快速换招） 39f75fc
* **m2:** 实战改进——upload_file 支持「按钮+文件对话框拦截」真人模式；快照列出隐藏的文件选择控件（AI 上传直路）；工具描述同步 d645448
* **m2:** 位置权限弹窗根除（会话服务启动时预设拒绝定位）+ 总管页等待上限 100 秒→4 分钟（preflight 0 违规）+ 发布操作要点同步 590e887
* **m2:** chooser 清理改用 setFiles([])（Playwright 文件选择器无 cancel API）+ 操作要点升级（封面两条路可选 / 收尾汇报必须在最后一句话） 0e087d9

## 0.2.0 (2026-10-16)

### Features

* **m0:** 打包闭环——electron-builder 出包（npmRebuild=false 跳过原生重编译 / 敏感文件排除 / 原生模块解包）+ 打包版冒烟脚本 + 主进程设置路径适配 8423bc4
