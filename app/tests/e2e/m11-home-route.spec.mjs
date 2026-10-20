// M11 W1-01：壳内 home/chat/task 路由；首页发送 = 新会话，不创建任务、不启动浏览器。
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

async function launchClean() {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
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
  return { app, win, errors }
}

test('M11 W1-01：首页发送创建新会话，不创建任务、不启动浏览器', async () => {
  const { app, win, errors } = await launchClean()
  try {
    expect(await win.evaluate(() => location.hash)).toBe('#/home')
    const frame = win.frameLocator('#jcoFrame')
    await expect(frame.locator('#inp')).toBeVisible()

    const tasksBefore = await win.evaluate(async () => ((await window.jco.tasks.sessions()).tasks || []).length)
    const browserBefore = await win.evaluate(async () => Boolean((await window.jco.publish.session.status()).active))

    await frame.locator('#inp').fill('你好')
    await frame.locator('#send').click()

    await win.waitForFunction(() => /^#\/chat\/c/.test(location.hash), undefined, { timeout: 20_000 })
    await expect(win.locator('#jcoFrame')).toHaveAttribute('src', /J\.Co总管\.html/)
    await expect(win.frameLocator('#jcoFrame').locator('.msg.user').last()).toContainText('你好', {
      timeout: 20_000,
    })

    expect(await win.evaluate(async () => ((await window.jco.tasks.sessions()).tasks || []).length)).toBe(tasksBefore)
    expect(await win.evaluate(async () => Boolean((await window.jco.publish.session.status()).active))).toBe(
      browserBefore,
    )

    const data = await win.evaluate(() => JSON.parse(localStorage.getItem('jco-chats-v1') || '{}'))
    expect(
      data.chats.some((chat) => chat.messages.some((message) => message.role === 'user' && message.text === '你好')),
    ).toBe(true)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('M11 W1-01：第二个会话独立，A 的内容不被覆盖', async () => {
  const { app, win, errors } = await launchClean()
  try {
    const firstFrame = win.frameLocator('#jcoFrame')
    await firstFrame.locator('#inp').fill('第一个会话')
    await firstFrame.locator('#send').click()
    await win.waitForFunction(() => /^#\/chat\/c/.test(location.hash), undefined, { timeout: 20_000 })

    const firstChatHash = await win.evaluate(() => location.hash)
    await win.locator('#newChatSlot .convo.new-btn').click()
    await win.waitForFunction(
      (before) => /^#\/chat\/c/.test(location.hash) && location.hash !== before,
      firstChatHash,
      { timeout: 20_000 },
    )
    await expect(win.locator('#jcoFrame')).toHaveAttribute('src', 'J.Co总管.html')
    await win.waitForTimeout(900)
    const secondFrame = win.frameLocator('#jcoFrame')
    await expect(secondFrame.locator('#inp')).toBeVisible()
    await secondFrame.locator('#inp').fill('第二个会话')
    await expect(secondFrame.locator('#send')).toBeEnabled()
    await secondFrame.locator('#send').click()
    await win.waitForFunction(
      () => {
        const data = JSON.parse(localStorage.getItem('jco-chats-v1') || '{}')
        return Array.isArray(data.chats) && data.chats.filter((chat) => chat.messages.length > 0).length >= 2
      },
      undefined,
      { timeout: 20_000 },
    )

    const data = await win.evaluate(() => JSON.parse(localStorage.getItem('jco-chats-v1') || '{}'))
    const texts = data.chats.flatMap((chat) =>
      chat.messages.filter((message) => message.role === 'user').map((m) => m.text),
    )
    expect(texts).toContain('第一个会话')
    expect(texts).toContain('第二个会话')
    expect(data.chats.filter((chat) => chat.messages.length === 0).length).toBeLessThanOrEqual(1)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('M11 W1-01：task 路由仍落到总管的任务视图', async () => {
  const { app, win, errors } = await launchClean()
  try {
    const proposed = await win.evaluate(() =>
      window.jco.tasks.propose({
        title: '路由测试任务',
        goal: '验证任务详情路由',
        type: 'content',
        deliverables: ['任务详情'],
      }),
    )
    expect(proposed.ok).toBe(true)
    await win.evaluate((id) => window.jco.tasks.confirm(id), proposed.task.id)
    await win.evaluate((id) => {
      location.hash = '#/task/' + id
    }, proposed.task.id)
    await expect(win.locator('#jcoTaskView')).toBeVisible({ timeout: 10_000 })
    await expect(win.locator('#tvTitle')).toHaveText('路由测试任务')
    await win.evaluate((id) => window.jco.tasks.cancel(id), proposed.task.id)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(TEST_WORK_TASKS, { recursive: true, force: true })
  }
})
