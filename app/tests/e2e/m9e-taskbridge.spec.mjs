// M9 单元⑥（批 1a）：任务会话桥回归——任务分区列表 / 任务视图回看 / 空参拒绝。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const TASK_FILE = path.join(APP_DIR, 'kernel', 'task-sessions', 'e2etask1.json')

test('任务会话桥：总管「任务」分区显示 / 点开看完整过程 / 切回对话 / 空参拒绝', async () => {
  // 预置一条已完成的任务台账（模拟"派活任务跑完"）
  fs.mkdirSync(path.dirname(TASK_FILE), { recursive: true })
  fs.writeFileSync(
    TASK_FILE,
    JSON.stringify({
      id: 'e2etask1',
      name: 'E2E 测试任务',
      staff: 'publish',
      state: 'done',
      startedAt: Date.now() - 60000,
      endedAt: Date.now() - 30000,
      summary: '做完了，等你确认',
      messages: [
        { role: 'user', text: '把这条发到抖音准备一下', t: Date.now() - 60000 },
        { role: 'assistant', text: '准备好了：标题和话题都填好，最后一步等你点发布。', t: Date.now() - 30000 },
      ],
    }),
    'utf8',
  )
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co总管.html'
    })
    await win.waitForTimeout(1500)
    // 侧栏默认收起（图标条），先点「固定展开」让任务/会话列表可操作
    await win.locator('.side-toggle').click()
    await win.waitForTimeout(500)

    // 任务分区：列表出现该任务（带 ✓）
    const taskItem = win.locator('#taskList .convo')
    await expect(taskItem).toHaveCount(1)
    await expect(taskItem.first()).toContainText('E2E 测试任务')
    await expect(taskItem.first()).toContainText('✓')

    // 点开任务视图：daymark + 两条消息
    await taskItem.first().click()
    await expect(win.locator('#chat .stream .daymark').last()).toContainText('任务视图 · E2E 测试任务')
    await expect(win.locator('#chat .stream .msg.user .bubble').last()).toContainText('把这条发到抖音准备一下')
    await expect(win.locator('#chat .stream .msg.ai .bubble').last()).toContainText('最后一步等你点发布')

    // 点对话区任一会话切回 → 任务项不再高亮
    await win.locator('.convos:not(#taskList) .convo').first().click()
    await win.waitForTimeout(400)
    await expect(win.locator('#taskList .convo.active')).toHaveCount(0)

    // 空参拒绝
    const bad = await win.evaluate(() => window.jco.tasks.dispatch({}))
    expect(bad.ok).toBe(false)
    // 旧物清零（批 4）：总管页内不再引用 jco-handoff
    const pageSrc = await win.evaluate(() => [...document.scripts].map((s) => s.textContent || '').join('\n'))
    expect(pageSrc.includes('jco-handoff')).toBe(false)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    try {
      fs.rmSync(TASK_FILE, { force: true })
    } catch {}
  }
})

test('任务会话桥：jco-open-task 落地自动打开任务视图（发布页派活跳转的消费端）', async () => {
  const TASK_FILE2 = path.join(APP_DIR, 'kernel', 'task-sessions', 'f123.json')
  fs.mkdirSync(path.dirname(TASK_FILE2), { recursive: true })
  fs.writeFileSync(
    TASK_FILE2,
    JSON.stringify({
      id: 'f123',
      name: '发到「抖音」测试',
      staff: 'publish',
      state: 'running',
      startedAt: Date.now() - 5000,
      endedAt: 0,
      summary: '',
      messages: [{ role: 'user', text: '帮我发一条视频到抖音', t: Date.now() - 5000 }],
    }),
    'utf8',
  )
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    // 模拟发布页跳转前：在发布页写入 jco-open-task（真实跳转动作）
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-发布.html'
    })
    await win.waitForTimeout(1000)
    await win.evaluate(() => {
      sessionStorage.setItem('jco-open-task', 'f123')
    })
    await win.evaluate(() => {
      window.location.href = 'J.Co总管.html'
    })
    await win.waitForTimeout(2000)
    // 任务视图自动打开；预置的 running 台账在启动时被如实标为中断（批 1a 语义），故显示"没跑成"
    const daymarks = win.locator('#chat .stream .daymark')
    await expect(daymarks).toHaveCount(1)
    await expect(daymarks.first()).toContainText('任务视图 · 发到「抖音」测试（没跑成')
    // 消费后 jco-open-task 已清（不会重复打开）
    const left = await win.evaluate(() => sessionStorage.getItem('jco-open-task'))
    expect(left).toBe(null)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    try {
      fs.rmSync(TASK_FILE2, { force: true })
    } catch {}
  }
})
