// M9 单元⑤：账号中心真化回归——平台卡真状态 / 登录登记持久化 / 弹层。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const ACCOUNTS_FILE = path.join(os.tmpdir(), 'jco-test-kernel-data', 'accounts.json')

test('账号中心：5 平台真状态 / 「我登录好了」登记并持久化 / 弹层', async () => {
  fs.rmSync(ACCOUNTS_FILE, { force: true })
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co账号中心.html'
    })
    await win.waitForTimeout(1300)

    // 初始：5 平台全未登录
    await expect(win.locator('.pf-card')).toHaveCount(5)
    await expect(win.locator('#statsRow')).toContainText('已登记 0 个')
    await expect(win.locator('.pf-card', { hasText: '抖音' }).locator('.a-state')).toHaveText('未登录')

    // 打开登录弹层 → 点「我登录好了」→ 登记并更新
    await win.locator('.pf-card', { hasText: '抖音' }).locator('button', { hasText: '去登录' }).click()
    await expect(win.locator('#overlay.show')).toBeVisible()
    await expect(win.locator('#sheetTitle')).toHaveText('登录抖音')
    await win.locator('#sheetOk').click()
    await win.waitForTimeout(300)
    await expect(win.locator('#statsRow')).toContainText('已登记 1 个')
    await expect(win.locator('.pf-card', { hasText: '抖音' }).locator('.a-state')).toHaveText('已登记')
    const saved = await win.evaluate(async () => await window.jco.accounts.get())
    expect(saved.data.platforms.dy.ok).toBe(true)
    expect(typeof saved.data.platforms.dy.at).toBe('number')

    // 重启页面后状态保留（真持久化）
    await win.reload()
    await win.waitForTimeout(1300)
    await expect(win.locator('#statsRow')).toContainText('已登记 1 个')
    await expect(win.locator('.pf-card', { hasText: '抖音' }).locator('button', { hasText: '重新登录' })).toBeVisible()
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(ACCOUNTS_FILE, { force: true })
  }
})
