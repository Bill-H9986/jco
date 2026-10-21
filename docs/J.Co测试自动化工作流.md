# J.Co 测试自动化工作流

适用版本：`0.6.0-beta.25` 起

## 1. 依据

- Electron 官方《Automated Testing》：桌面应用应该用 WebDriver/Playwright 驱动真实 Electron 进程做端到端测试。
  <https://www.electronjs.org/docs/latest/tutorial/automated-testing>
- Playwright Electron API：支持 `_electron.launch`、主进程 `evaluate`、`firstWindow`、截图与 console 监听。
  <https://playwright.dev/docs/api/class-electron>
- Martin Fowler《The Practical Test Pyramid》：单元 → 集成 → 契约 → UI/E2E → 验收 → 探索性测试，按成本分层，避免只堆 E2E。
  <https://martinfowler.com/articles/practical-test-pyramid.html>

## 2. J.Co 的特殊性

J.Co 不是普通网页，测试必须覆盖四层运行时：

1. **Electron 主进程**：窗口、托盘、更新、IPC、文件保存。
2. **应用壳 + iframe 页面**：16 个内容页、侧栏、主题、任务视图。
3. **本地内核子进程**：DSH Harness、模型路由、草稿/任务/知识库 JSON 存储。
4. **外部 AI 与平台**：Agnes 文本/图片/视频接口、发布平台浏览器会话。

因此采用“金字塔 + 两层外部适配”：

```text
        ┌──────────────┐
        │ 探索性 & 验收 │  人工按交付清单走查（低频）
        ├──────────────┤
        │ E2E（Playwright）│  页面/流程/视觉回归（中频）
        ├──────────────┤
        │ 集成（内核/IPC） │  bridge、JSON store、任务服务（高频）
        ├──────────────┤
        │ 单元（vitest）  │  纯函数、规范化、状态机（最高频）
        └──────────────┘
```

外部 AI 调用单独做“契约冒烟”，不放进每次 gate，避免限流拖垮回归。

## 3. 分层与命令

| 层 | 范围 | 工具/命令 | 通过标准 |
|---|---|---|---|
| L0 静态 | 类型、lint、全项目扫描 | `npm run typecheck`、`npm run lint`、`npm run check:all` | 0 error、0 新增违规 |
| L1 单元 | 纯函数、数据规范化、更新版本比较、任务状态机 | `npx vitest run` | 全绿 |
| L2 集成 | 内核 bridge、草稿/任务/知识库读写、IPC 契约 | `tests/unit/kernel-layer.test.mjs`、`ipc-contracts.test.mjs` | 全绿 |
| L3 E2E | 页面加载、导航、核心流程、后台任务跨页恢复 | `npx playwright test` | 全绿，无 pageerror；切页/刷新任务不丢 |
| L4 视觉 | 浅色/深色关键页截图 | `npm run test:visual` | 像素差 ≤ 容差 |
| L5 契约冒烟 | Agnes 文本/图片/视频真实调用 | `npm run test:ai-smoke`、`npm run test:live-media`（手动/夜间） | 返回结构正确、图片比例正确、视频模型真的出成片 |
| L6 验收 | 交付清单逐项走查 | `outputs/交付测试进度.md` | 每项有证据 |
| L7 安装升级 | NSIS 安装、OTA、回滚 | `release:package`、`qa-packaged`、安装脚本 | 版本正确、数据不丢 |

统一门禁：`npm run gate` = L0 + L1 + L2 + L3 + L4。

GitHub Actions 的 Windows 质量门禁没有个人模型凭据，因此显式设置：

- `JCO_TEST_KERNEL_FAKE=1`：可重复测试内核只验证聊天、任务、审批、恢复和记录接线；
- `JCO_TEST_MEDIA_FAKE=1`：媒体桥只产生确定性测试结果；
- 真实模型、真实媒体、浏览器和安装生命周期仍由独立本机发布门覆盖。

测试内核不会进入普通用户运行路径，也不会把“假模型回复”当成真实模型质量证据。

## 4. 无人机宣传题验收用例

主题固定为：

> 无人机装调检修操作工，人社局等级证，免费就业培训；数字人小雅出镜。

### 4.1 内容结构验收（L1/L3，不依赖真实 AI）

给定一份合法分镜数据：

- 30 秒视频必须有 6 段，每段 4–6 秒，比例 9:16，清晰度 720P；
- 60 秒视频必须有 12 段，总时长 55–65 秒；
- 每段口播文案非空、画面描述非空；
- 文案必须包含“无人机/装调检修/等级证/培训”中至少两个关键词；
- 不得出现“包就业/百分百通过/官方指定”等绝对化承诺。

自动化：`tests/e2e/delivery-drone-campaign.spec.mjs` 用固定分镜注入草稿，验证创作页、发布页、任务页对数据的处理。

### 4.2 真实 AI 契约冒烟（L5，单独执行）

`scripts/ai-smoke.mjs`（新增）：

1. 调用一次文本模型，要求输出 6 段分镜 JSON；
2. 调用一次图片模型，生成 1 张 9:16 主视觉；
3. 调用一次视频模型，生成 1 段 5 秒 720P；
4. 断言：分镜 JSON 可解析、图片有 b64、视频有 url；
5. 遇到 429/503 自动等待重试，最多 3 次。

`scripts/live-media-smoke.mjs` 从真实 UI 再走一遍：

1. 做图选 2K、3:4、1 张，断言落盘图片是 3:4 且宽度不低于 1536；
2. 注入 1 段已过文本分镜的草稿，点“全部出片”，断言视频接口真的返回成片；
3. 可用 `--image-only` 或 `--video-only` 单独跑。

该层不进 `gate`，只在发版前或夜间跑，避免免费额度被回归测试耗尽。

### 4.3 发布验收（L3/L6）

- 有已通过成片时，发布页显示真实文件名与“已通过”；
- 无成片时显示空态，发布按钮禁用；
- 未登录平台时不可勾选，按钮禁用；
- 标题、话题、介绍可编辑，发布动作必须由人确认。

### 4.4 视觉验收（L4）

自动化测试统一使用 `1440×900` 逻辑视口和 `DPR 1`；生产窗口仍根据用户屏幕自适应。这样视觉基准与控件坐标不会因 runner 分辨率或系统缩放变化而假红。

- 16 个页面浅色基准；
- 关键页深色抽查：首页、总管、创作、发布、设置；
- 页头统一断言：`h1` x=32、y=36、字号 22px（后期页为紧凑工具栏，x 对齐）。

### 4.5 创作后台任务恢复（L3/L7）

- 生成中切到首页或其他页面，再回创作页：任务仍在跑，进度继续，最后草稿自动打开；
- 生成中刷新应用壳：主进程任务不中断，返回后按已完成项收口；
- 应用重启：未完成任务显示“已中断”，已完成图片/视频保留，失败项可重试；
- 页面保存不能覆盖后台刚写入的图片/视频结果；
- 自动化入口：`tests/e2e/m14-create-work-state.spec.mjs`（`JCO_TEST_MEDIA_FAKE=1`，不烧额度）。

## 5. 执行节奏

| 时机 | 跑哪几层 |
|---|---|
| 每次提交 | L1 目标测试 + pre-commit（typecheck/lint） |
| 每个工作单元 | L1 + L2 + 目标 E2E |
| 每轮心跳 | 一个未测页面/流程（L3/L6），失败则修到 L0–L4 全绿 |
| 每日一次 | `npm run gate` 全量 |
| 发版前 | gate + L5 契约冒烟 + L7 安装升级 |
| 交付前 | L6 清单逐项签字 + 探索性测试 |

## 6. 失败处理

1. 先复现并记录到 `outputs/交付测试进度.md`（步骤、期望、实际、截图/日志）。
2. 只做最小修复，不顺手重构无关代码。
3. 修完跑目标测试 + `npm run gate`，全绿再提交。
4. 一个工作单元一个 Conventional Commit。
5. 需要登录、密钥、外部授权时标 blocked，写 `outputs/需要你处理.md`。

## 7. 证据留存

- E2E：`test-results/`、Playwright 报告；
- 视觉：`tests/visual/baseline/local/` 与 `tests/visual/baseline/ci/`；
- 交付自检：`outputs/交付自检/`；
- AI 冒烟：`outputs/ai-smoke/`；
- 真实媒体 UI 冒烟：终端 JSON 输出（图片尺寸、视频状态/路径）；
- 进度：`outputs/交付测试进度.md`。
