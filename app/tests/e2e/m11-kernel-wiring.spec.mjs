// M11 W1-05：应用内真实内核聊天不启动浏览器；任务审批后用真实内核执行。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const TEST_WORK_TASKS = path.join(os.tmpdir(), 'jco-test-kernel-data', 'work-tasks')

test('M11 W1-05：真实内核聊天无浏览器；任务审批后真实执行完成', async () => {
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

    const browserBefore = await win.evaluate(async () => Boolean((await window.jco.publish.session.status()).active))
    const tasksBefore = await win.evaluate(async () => ((await window.jco.tasks.sessions()).tasks || []).length)
    const frame = win.frameLocator('#jcoFrame')
    await frame.locator('#inp').fill('你好')
    await frame.locator('#send').click()
    await expect(frame.locator('.msg.ai .bubble').last()).not.toHaveText('', { timeout: 30_000 })
    await expect(frame.locator('.typing')).toHaveCount(0, { timeout: 30_000 })
    await win.waitForTimeout(500)
    expect(await win.evaluate(async () => Boolean((await window.jco.publish.session.status()).active))).toBe(
      browserBefore,
    )
    expect(await win.evaluate(async () => ((await window.jco.tasks.sessions()).tasks || []).length)).toBe(tasksBefore)

    await frame.locator('#inp').fill('帮我写一条短文案')
    await frame.locator('#inp').dispatchEvent('input')
    await expect(frame.locator('#send')).toBeEnabled({ timeout: 5000 })
    await frame.locator('#send').click()
    await expect(frame.locator('.task-card')).toBeVisible({ timeout: 30_000 })
    await frame.locator('.task-card [data-task-confirm]').click()
    await win.waitForFunction(() => /^#\/task\/w[a-z0-9]+/.test(location.hash), undefined, { timeout: 20_000 })
    await expect(win.locator('#tvStatus')).toHaveText('等你确认')
    await win.locator('#tvApproval button', { hasText: '确认继续' }).click()
    await expect(win.locator('#tvStatus')).toHaveText('已完成', { timeout: 60_000 })
    await expect(win.locator('#tvTimeline')).toContainText('任务执行完成')
    const taskId = await win.evaluate(() => decodeURIComponent((location.hash.match(/^#\/task\/(.+)$/) || [])[1] || ''))
    const stored = await win.evaluate(async (id) => (await window.jco.tasks.session(id)).task, taskId)
    expect(stored.status).toBe('done')
    expect(stored.messages.length).toBeGreaterThan(0)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(TEST_WORK_TASKS, { recursive: true, force: true })
  }
})
