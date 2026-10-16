import { defineConfig } from 'vitest/config'

// 单元测试配置：只认 tests/unit/（E2E 由 Playwright 负责，互不干扰）
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.mjs'],
    environment: 'node',
  },
})
