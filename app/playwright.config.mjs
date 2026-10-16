import { defineConfig } from '@playwright/test'

// E2E 配置：以真实 Electron 应用为被测对象（不用浏览器）。
// 注意：应用有单实例锁，测试必须串行（workers: 1），并以 --jco-test 参数启动。
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.mjs',
  globalTeardown: './tests/e2e/global-teardown.mjs',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
})
