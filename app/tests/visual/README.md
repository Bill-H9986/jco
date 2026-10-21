# J.Co 全站视觉基准

状态：W5-02 已补齐 17 张全站关键状态基准。

## 运行

```powershell
cd app
npm run test:visual
```

基准图在 `tests/visual/baseline/`。当前覆盖唯一应用壳、14 个内容页、总管消息面和独立任务详情。首次建立或有意更新基准时：

```powershell
$env:JCO_UPDATE_VISUAL = '1'
npm run test:visual
```

测试模式固定逻辑视口 `1440×900`、`DPR 1`，因此 Windows runner 的屏幕缩放和分辨率不会改变基准尺寸。
当前测试用 Electron `capturePage()` 截图；全站页用 Sharp 做像素差比对。
`baseline/ci/` 与 `baseline/local/` 两套基准都按各自环境严格允许 1% 内的抗锯齿噪声。
这样避开 iframe 字体等待导致的 Playwright 截图超时，也不会把字体亚像素差异误报成 UI 回归。

视觉基准的规范生成环境是 GitHub 的 `windows-latest` runner。需要有意更新 CI 基准时，手动运行
`Visual Baseline` 工作流，下载 `app/tests/visual/baseline/ci/` 构建产物后再提交；不要拿另一台
Windows 机器的字体栅格化结果直接覆盖，否则会把环境差异误当成 UI 回归。

## 命名

```text
<页面>-<状态>-<主题>-<视口>.png
```

示例：

- `chat-message-light-1440x900.png`
- `task-detail-light-1440x900.png`

## 规则

- 固定窗口尺寸、DPR、字体、主题和测试数据；动态时间在截图前固定；
- 不允许用修改容差掩盖 DPR 或窗口尺寸漂移；先统一测试环境，再比较 UI；
- 深浅色、窄窗口、长文本、空态、错误态都要有独立基准；
- 每次 UI 改动先跑视觉回归，再提交；
- 不接受“看起来没变”作为证据，必须有截图或像素对比结果。

当前基准：

- `shell-light-1440x900.png`
- `home-light-1440x900.png`
- `chat-message-light-1440x900.png`
- `topics-light-1440x900.png`
- `materials-light-1440x900.png`
- `scripts-light-1440x900.png`
- `video-light-1440x900.png`
- `post-light-1440x900.png`
- `publish-light-1440x900.png`
- `ops-light-1440x900.png`
- `team-light-1440x900.png`
- `skills-light-1440x900.png`
- `auto-tasks-light-1440x900.png`
- `accounts-light-1440x900.png`
- `settings-light-1440x900.png`
- `design-system-light-1440x900.png`
- `task-detail-light-1440x900.png`
