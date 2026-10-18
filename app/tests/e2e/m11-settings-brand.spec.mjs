// M11 W4-01：设置页偏好落主进程 settings.json；BrandProfile 保存后选题/素材/文案/做视频同源生效。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const TEST_KERNEL_DIR = path.join(os.tmpdir(), 'jco-test-kernel-data')
const BRAND_FILE = path.join(TEST_KERNEL_DIR, 'brand-profile.json')
const SETTINGS_FILE = path.join(TEST_KERNEL_DIR, 'settings.json')

test('M11 W4-01：设置偏好落盘，BrandProfile 全站同源生效', async () => {
  fs.rmSync(BRAND_FILE, { force: true })
  fs.rmSync(SETTINGS_FILE, { force: true })
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(() => {
      window.location.href = 'J.Co设置.html'
    })
    await win.waitForTimeout(1500)

    await win.locator('#brandIndustry').fill('健身')
    await win.locator('#brandAudience').fill('上班族')
    await win.locator('#brandPlatforms').fill('抖音、视频号')
    await win.locator('#brandTone').fill('直接')
    await win.locator('#brandForbidden').fill('包过、稳赚')
    await win.locator('#btnBrandSave').click()
    await expect
      .poll(async () => await win.evaluate(async () => await window.jco.brand.get()), { timeout: 5000 })
      .toMatchObject({
        data: {
          industry: '健身',
          audience: '上班族',
          platforms: ['抖音', '视频号'],
          tone: '直接',
          forbidden: ['包过', '稳赚'],
        },
      })

    // 偏好存主进程，不再只写 localStorage。
    await win.locator('#segMode button[data-v="ask"]').click()
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.settings.get()).mode), { timeout: 5000 })
      .toBe('ask')
    await win.locator('#tgNotifyDone').click()
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.settings.get()).notifyDone), { timeout: 5000 })
      .toBe(false)
    await win.locator('#tgConfirmPublish').click()
    await expect(win.locator('#toast')).toContainText('不能关闭')
    await expect(win.locator('#tgConfirmPublish')).toHaveClass(/on/)

    // 选题 / 素材 / 文案 / 做视频都从同一 BrandProfile 组装提示词。
    for (const [page, fn, expected] of [
      ['J.Co工作台-选题.html', 'topicSystemPrompt', '健身'],
      ['J.Co工作台-素材.html', 'materialSystemPrompt', '健身'],
      ['J.Co工作台-创作.html', 'writerSystemPrompt', '健身'],
      ['J.Co工作台-做视频.html', 'shotSystemPrompt', '健身'],
    ]) {
      await win.evaluate((target) => {
        window.location.href = target
      }, page)
      await win.waitForTimeout(900)
      await expect
        .poll(async () => await win.evaluate((name) => (window[name] ? window[name]() : ''), fn), { timeout: 5000 })
        .toContain(expected)
    }
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(BRAND_FILE, { force: true })
    fs.rmSync(SETTINGS_FILE, { force: true })
  }
})
