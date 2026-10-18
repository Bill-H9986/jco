// W1 视觉基准：消息阅读面和独立任务详情。固定数据、固定窗口、固定主题。

import crypto from 'node:crypto'
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
const BASELINE_DIR = path.join(__dirname, 'baseline')

async function captureWindow(app) {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((item) => item.isVisible()) || BrowserWindow.getAllWindows()[0]
    if (!win) return ''
    const image = await win.capturePage()
    return image.toPNG().toString('base64')
  })
  return Buffer.from(png, 'base64')
}

async function assertVisual(app, name) {
  const actual = await captureWindow(app)
  const file = path.join(BASELINE_DIR, name)
  if (process.env.JCO_UPDATE_VISUAL === '1') {
    fs.mkdirSync(BASELINE_DIR, { recursive: true })
    fs.writeFileSync(file, actual)
    return
  }
  expect(fs.existsSync(file), `缺少视觉基准：${file}`).toBe(true)
  const expected = fs.readFileSync(file)
  const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
  expect(hash(actual), `视觉基准不一致：${name}`).toBe(hash(expected))
}

test('W1 消息阅读面：浅色 1440×900', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2600)
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-chats-v1',
        JSON.stringify({
          activeId: 'visual-chat',
          chats: [
            {
              id: 'visual-chat',
              title: '视觉基准',
              updatedAt: 1,
              messages: [
                { role: 'user', text: '帮我把这条视频的标题改得更有吸引力', t: 1 },
                {
                  role: 'ai',
                  text: '可以。先给你三个方向：\n\n- 更具体：把结果写进标题\n- 更有冲突：先给反常识结论\n- 更短：只留一个记忆点\n\n**建议先试第一版。**',
                  t: 2,
                },
              ],
            },
          ],
        }),
      )
      localStorage.setItem('jco-side-pinned', '1')
      window.location.href = 'J.Co总管.html'
    })
    await win.waitForTimeout(1500)
    await expect(win.locator('#stream .msg')).toHaveCount(2)
    await win.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready
      if (document.activeElement) document.activeElement.blur()
    })
    await win.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
    await win.waitForTimeout(500)
    await assertVisual(app, 'chat-message-light-1440x900.png')
  } finally {
    await app.close()
  }
})

test('W1 独立任务详情：浅色 1440×900', async () => {
  fs.rmSync(TEST_WORK_TASKS, { recursive: true, force: true })
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2600)
    const proposed = await win.evaluate(() =>
      window.jco.tasks.propose({
        title: '发布前检查',
        goal: '把视频标题、封面和话题准备好，停在发布按钮前',
        type: 'publish',
        ownerRole: 'publisher',
        deliverables: ['发布草稿'],
        constraints: ['不自动发布'],
      }),
    )
    await win.evaluate((id) => window.jco.tasks.confirm(id), proposed.task.id)
    await win.evaluate((id) => {
      location.hash = `#/task/${id}`
    }, proposed.task.id)
    await expect(win.locator('#jcoTaskView')).toBeVisible({ timeout: 10_000 })
    await expect(win.locator('#tvStatus')).toHaveText('等你确认')
    await win.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
    await win.evaluate(() => {
      document.querySelectorAll('#tvTimeline time').forEach((element) => {
        element.textContent = '--:--'
      })
      if (document.activeElement) document.activeElement.blur()
    })
    await win.waitForTimeout(200)
    await assertVisual(app, 'task-detail-light-1440x900.png')
    await win.evaluate((id) => window.jco.tasks.cancel(id), proposed.task.id)
  } finally {
    await app.close()
    fs.rmSync(TEST_WORK_TASKS, { recursive: true, force: true })
  }
})
