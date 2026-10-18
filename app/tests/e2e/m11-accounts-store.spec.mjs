// M11 W3-03：账号登录登记迁统一 accounts.json；旧 localStorage 迁移；发布页读取同一登记。
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

test('M11 W3-03：登录登记迁移、登记持久化、发布页读取同一账号状态', async () => {
  fs.rmSync(ACCOUNTS_FILE, { force: true })
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)

    // 旧 jco-login-v1 首次进入时迁入 accounts.json。
    await win.evaluate(() => {
      localStorage.setItem('jco-login-v1', JSON.stringify({ dy: { ok: true, at: Date.now() } }))
      window.location.href = 'J.Co账号中心.html'
    })
    await win.waitForTimeout(1500)
    await expect(win.locator('#statsRow')).toContainText('已登记 1 个')
    await expect
      .poll(async () => await win.evaluate(async () => !!(await window.jco.accounts.get()).data.platforms.dy?.ok), {
        timeout: 5000,
      })
      .toBe(true)

    // 新登记写 accounts.json，不再双写旧 key。
    await win.locator('.pf-card', { hasText: '视频号' }).locator('button', { hasText: '去登录' }).click()
    await expect(win.locator('#overlay.show')).toBeVisible()
    await win.locator('#sheetOk').click()
    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.accounts.get()
            return {
              sph: !!data.data.platforms.sph?.ok,
              legacy: Object.keys(JSON.parse(localStorage.getItem('jco-login-v1') || '{}')).length,
            }
          }),
        { timeout: 5000 },
      )
      .toEqual({ sph: true, legacy: 1 })

    await win.reload()
    await win.waitForTimeout(1400)
    await expect(win.locator('#statsRow')).toContainText('已登记 2 个')
    await expect(win.locator('.pf-card', { hasText: '视频号' }).locator('.a-state')).toHaveText('已登记')

    // 发布页读取同一统一登记。
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-发布.html'
    })
    await win.waitForTimeout(1500)
    await expect(win.locator('#platforms .pf', { hasText: '抖音' })).toContainText('已登记')
    await expect(win.locator('#platforms .pf', { hasText: '视频号' })).toContainText('已登记')
    await expect(win.locator('#platforms .pf', { hasText: 'B站' })).toContainText('未登录')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(ACCOUNTS_FILE, { force: true })
  }
})
