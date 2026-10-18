import { defineConfig } from '@playwright/test'

// 视觉基准骨架（W0-06）：与日常 E2E 分开，只有显式运行 `npm run test:visual` 时才启动。
// 基准图放 tests/visual/baseline/；命名规则见 tests/visual/README.md。
export default defineConfig({
  testDir: './tests/visual',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
})
