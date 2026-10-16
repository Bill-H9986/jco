// M5 员工实时状态（A5）：内核活动事件 → 员工卡「在忙」→ 回合结束回落；无归属不点卡。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

const sendActivity = (app, act) =>
  app.evaluate(({ BrowserWindow }, payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.webContents.send('kernel:activity', payload)
      } catch {
        /* 忽略 */
      }
    }
  }, act)

test('团队页：发布会话干活 → 发布卡「在忙」→ 回合结束回落', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    // 场景：发布页派活后的会话（带归属标签）
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-chats-v1',
        JSON.stringify({
          activeId: 'cprobe1',
          chats: [{ id: 'cprobe1', title: '发布任务', staff: 'publish', messages: [] }],
        }),
      )
    })
    await win.evaluate(() => {
      window.location.href = 'J.Co管家团队.html'
    })
    const pubBadge = win.locator('.staff[href="J.Co工作台-发布.html"] .s-badge')
    const pubLive = win.locator('.staff[href="J.Co工作台-发布.html"] .s-live')
    const say = win.locator('.b-say')
    const roster = win.locator('.roster')
    await expect(pubBadge).toHaveText('空闲')
    await expect(roster).toContainText('7 空闲') // 统计真化：7 张卡全空闲

    // 工具调用 → 点亮
    await sendActivity(app, {
      kind: 'tool',
      phase: 'call',
      session: 'jco-chat-cprobe1',
      tool: 'jco_open_page',
      t: Date.now(),
    })
    await expect(pubBadge).toHaveText('在忙')
    await expect(pubLive).toContainText('正在打开平台页面')
    await expect(say).toContainText('发布')
    await expect(roster).toContainText('1 在忙')

    // 换个动作 → 文案跟着走
    await sendActivity(app, {
      kind: 'tool',
      phase: 'call',
      session: 'jco-chat-cprobe1',
      tool: 'jco_upload_file',
      t: Date.now(),
    })
    await expect(pubLive).toContainText('正在上传文件')

    // 回合结束 → 回落
    await sendActivity(app, { kind: 'turn', phase: 'end', session: 'jco-chat-cprobe1', t: Date.now() })
    await expect(pubBadge).not.toHaveText('在忙')
    await expect(pubBadge).toHaveText(/空闲|有产出/)
    await expect(roster).toContainText('7 空闲') // 统计跟着回落
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('团队页：无归属会话用工具 → 不点员工卡，汇报区显示', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co管家团队.html'
    })
    const pubBadge = win.locator('.staff[href="J.Co工作台-发布.html"] .s-badge')
    const say = win.locator('.b-say')
    await expect(pubBadge).toHaveText('空闲')

    await sendActivity(app, {
      kind: 'tool',
      phase: 'call',
      session: 'jco-chat-cunknown',
      tool: 'jco_save_report',
      t: Date.now(),
    })
    await expect(pubBadge).toHaveText('空闲') // 员工卡不动（不张冠李戴）
    await expect(say).toContainText('我正在干活：正在整理战报')

    await sendActivity(app, { kind: 'turn', phase: 'end', session: 'jco-chat-cunknown', t: Date.now() })
    await expect(say).not.toContainText('我正在干活')
  } finally {
    await app.close()
  }
})
