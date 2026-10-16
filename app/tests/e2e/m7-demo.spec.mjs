// M7 演示标记（诚实声明）：5 个未真化页面挂标；已真化页面不许有（防止乱铺）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('演示标记：5 个未真化页面挂标、已真化页面无标', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    const demoPages = [
      // 选题/创作/素材/账号中心均已摘标；剩后期 1 页待方向拍板
      'J.Co工作台-后期.html',
    ]
    for (const p of demoPages) {
      await win.evaluate((x) => {
        window.location.href = x
      }, p)
      await expect(win.locator('.demo-note')).toHaveCount(1)
      await expect(win.locator('.demo-note')).toContainText('演示版')
    }
    // 反向：已真化页不许出现标记
    for (const p of [
      'J.Co自动任务.html',
      'J.Co管家团队.html',
      'J.Co工作台-选题.html',
      'J.Co工作台-创作.html',
      'J.Co工作台-素材.html',
      'J.Co账号中心.html',
    ]) {
      await win.evaluate((x) => {
        window.location.href = x
      }, p)
      await expect(win.locator('.demo-note')).toHaveCount(0)
    }
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
