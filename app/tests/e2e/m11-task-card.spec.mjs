// M11 W1-03：任务卡确认前不建 Task；确认后独立任务详情；发布审批门。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { saveElectronScreenshot } from '../support/electron-screenshot.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const TEST_WORK_TASKS = path.join(os.tmpdir(), 'jco-test-kernel-data', 'work-tasks')

test('M11 W1-03：任务卡 → 确认 → 独立详情 → 审批门', async () => {
  fs.rmSync(TEST_WORK_TASKS, { recursive: true, force: true })
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(() => {
      localStorage.removeItem('jco-chats-v1')
      localStorage.removeItem('jco-chat-v1')
      sessionStorage.clear()
    })
    await win.reload()
    await win.waitForTimeout(1500)

    const taskCountBefore = await win.evaluate(async () => ((await window.jco.tasks.sessions()).tasks || []).length)
    const frame = win.frameLocator('#jcoFrame')
    await frame.locator('#inp').fill('帮我把这条视频发到抖音')
    await frame.locator('#send').click()
    await expect(frame.locator('.task-card')).toBeVisible({ timeout: 30_000 })

    expect(await win.evaluate(async () => ((await window.jco.tasks.sessions()).tasks || []).length)).toBe(
      taskCountBefore,
    )
    await expect(frame.locator('.task-card')).toContainText('确认前不会创建 Task')
    await frame.locator('.task-card [data-task-confirm]').click()

    await win.waitForFunction(() => /^#\/task\/w[a-z0-9]+/.test(location.hash), undefined, { timeout: 20_000 })
    await expect(win.locator('#jcoTaskView')).toBeVisible()
    await expect(win.locator('#tvTitle')).toContainText('发到抖音')
    await expect(win.locator('#tvStatus')).toHaveText('等你确认')
    await expect(win.locator('#tvApproval')).toContainText('发布前需要你亲手确认')
    await expect(win.locator('#tvTimeline')).toContainText('任务已确认')
    expect(await win.evaluate(async () => ((await window.jco.tasks.sessions()).tasks || []).length)).toBe(
      taskCountBefore + 1,
    )
    await saveElectronScreenshot(app, path.join(APP_DIR, 'test-results', 'm11-w1-03-task-detail.png'))

    await win.locator('#tvApproval button', { hasText: '确认继续' }).click()
    await expect(win.locator('#tvStatus')).not.toHaveText('等你确认')
    await expect(win.locator('#tvApproval')).toContainText('当前没有待审批事项')

    const taskId = await win.evaluate(() => decodeURIComponent((location.hash.match(/^#\/task\/(.+)$/) || [])[1] || ''))
    await win.locator('#tvBack').click()
    await win.waitForFunction(() => /^#\/chat\//.test(location.hash), undefined, { timeout: 10_000 })
    await win.evaluate((id) => window.jco.tasks.cancel(id), taskId)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(TEST_WORK_TASKS, { recursive: true, force: true })
  }
})
