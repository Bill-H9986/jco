# J.Co 视觉基准骨架

状态：W1-06 已建立消息阅读面和任务详情基准；W5-02 补齐全站关键状态。

## 运行

```powershell
cd app
npm run test:visual
```

基准图在 `tests/visual/baseline/`。首次建立或有意更新基准时：

```powershell
$env:JCO_UPDATE_VISUAL = '1'
npm run test:visual
```

当前测试用 Electron `capturePage()` 固定窗口截图，再按 PNG 内容 SHA-256 精确比对；
这样避开 iframe 字体等待导致的 Playwright 截图超时。

## 命名

```text
<页面>-<状态>-<主题>-<视口>.png
```

示例：

- `chat-message-light-1440x900.png`
- `task-detail-light-1440x900.png`

## 规则

- 固定窗口尺寸、字体、主题和测试数据；动态时间在截图前固定；
- 深浅色、窄窗口、长文本、空态、错误态都要有独立基准；
- 每次 UI 改动先跑视觉回归，再提交；
- 不接受“看起来没变”作为证据，必须有截图或像素对比结果。
