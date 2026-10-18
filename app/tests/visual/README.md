# J.Co 视觉基准骨架

状态：W0-06 骨架；W1-02 建立消息组件基准，W5-02 补齐全站关键状态。

## 运行

```powershell
cd app
$env:JCO_VISUAL = '1'
npx playwright test -c playwright.visual.config.mjs
```

首次运行会把应用壳截图写到 `test-results/visual/`，供人工核对。W1-02 接入
`toHaveScreenshot()` 后，基准图放 `tests/visual/baseline/`。

## 命名

```text
<页面>-<状态>-<主题>-<视口>.png
```

示例：

- `chat-normal-light-1440x900.png`
- `chat-long-message-dark-390x844.png`
- `task-waiting-light-1440x900.png`

## 规则

- 固定窗口尺寸、字体、主题和测试数据；动态区域必须 mask；
- 深浅色、窄窗口、长文本、空态、错误态都要有独立基准；
- 每次 UI 改动先跑视觉回归，再提交；
- 不接受“看起来没变”作为证据，必须有截图或像素对比结果。
