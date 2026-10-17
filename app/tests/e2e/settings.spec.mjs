// 设置页内测收口：发布确认固定开启 / 不出现旧版原型文案 / 页面无 JS 错误
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('设置页：发布确认固定开启 / 版本文案诚实 / 无 JS 错误', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2200)
    await win.evaluate(() => {
      window.location.href = 'J.Co设置.html'
    })
    await win.waitForTimeout(1000)

    const confirm = win.locator('#tgConfirmPublish')
    await expect(confirm).toHaveClass(/on/)
    await confirm.click()
    await win.waitForTimeout(200)
    await expect(confirm).toHaveClass(/on/)
    await expect(win.locator('#toast')).toContainText('不能关闭')
    await expect(win.locator('body')).not.toContainText('J.Co v0.1（原型）')
    await expect(win.locator('#pathText')).toBeVisible()
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
