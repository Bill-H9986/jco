// 全站导航巡检（M0 冒烟网 · 动线 1）
// 启动真实应用 → 逐页加载 15 个页面 → 全程零 JS 错误。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { PAGES } from '../pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('全站导航巡检：15 页逐页加载，零 JS 错误', async () => {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(`[pageerror] ${String(e.message).slice(0, 200)}`))
    await win.waitForTimeout(2500) // 等首屏与脚本初始化稳定

    for (const page of PAGES) {
      await win.evaluate((p) => {
        window.location.href = p
      }, page)
      await win.waitForTimeout(700)
      const current = await win.evaluate(() => decodeURIComponent(window.location.pathname.split('/').pop()))
      expect(current, `切换到 ${page} 失败`).toBe(page)
    }

    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
