// 主题切换动线（M0 冒烟网 · 动线 2）
// 设置页 #segTheme：深色/浅色真切换（CSS 变量变化），测试结束恢复「跟随系统」。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('设置页：深色/浅色主题真切换，最后恢复跟随系统', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co设置.html'
    })
    await win.waitForTimeout(900)
    await win.locator('#segTheme').waitFor()

    const bgVar = () => win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())

    // 深色：CSS 变量真变 #1c1c1e
    await win.locator('#segTheme button[data-v="dark"]').click()
    await win.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#1c1c1e',
      null,
      { timeout: 5000 },
    )
    await expect(win.locator('#segTheme button[data-v="dark"]')).toHaveClass(/on/)

    // 浅色：回到 #f7f7f7
    await win.locator('#segTheme button[data-v="light"]').click()
    await win.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#f7f7f7',
      null,
      { timeout: 5000 },
    )
    await expect(win.locator('#segTheme button[data-v="light"]')).toHaveClass(/on/)

    // 恢复「跟随系统」（把设置文件还原为测试前状态）
    await win.locator('#segTheme button[data-v="sys"]').click()
    await win.waitForTimeout(400)
    await expect(win.locator('#segTheme button[data-v="sys"]')).toHaveClass(/on/)
    expect(await bgVar()).not.toBe('#1c1c1e')
  } finally {
    await app.close()
  }
})
