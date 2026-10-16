// M6 自动任务环（A3/A4/A5/A6）：任务页结构化+迁移+同步落盘+执行记录；团队页自动任务汇报。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const TASKS_FILE = path.join(APP_DIR, 'kernel', 'auto-tasks.json')
const RUNS_FILE = path.join(APP_DIR, 'kernel', 'auto-runs.json')

test('自动任务页：旧数据迁移（对标雷达→今日战报）+ 结构化新建 + 同步落盘', async () => {
  try {
    fs.rmSync(TASKS_FILE, { force: true })
  } catch {}
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    // 预置老用户数据（含做不到的"对标雷达"）
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-tasks-v1',
        JSON.stringify({
          items: [
            {
              id: 't1',
              name: '对标雷达',
              desc: '盯 4 个对标账号，新爆款自动拆解入库',
              when: '每天 09:12',
              icon: 'ti-flame',
              on: true,
            },
            {
              id: 't3',
              name: '评论自动跟进',
              desc: '扫一遍评论，拟好回复等你放行',
              when: '每天 12:00',
              icon: 'ti-message-dots',
              on: false,
            },
          ],
        }),
      )
    })
    await win.evaluate(() => {
      window.location.href = 'J.Co自动任务.html'
    })
    await win.waitForTimeout(1300)

    // 迁移：对标雷达换成"今日战报"（保留开关），t3 内容保留且仍是"已暂停"
    const names = (await win.locator('.tk-name').allInnerTexts()).join('|')
    expect(names).toContain('今日战报')
    expect(names).not.toContain('对标雷达')
    expect(names).toContain('评论自动跟进')
    const badges = (await win.locator('.tk-badge').allInnerTexts()).join('|')
    expect(badges).toContain('已暂停')

    // 新建一个"每天傍晚"任务 → 结构化 schedule 18:30
    await win.locator('#newTask').click()
    await win.locator('#tName').fill('每晚评论扫描')
    await win.locator('#tWhen button[data-v="evening"]').click()
    await win.locator('#tWhat').fill('扫一遍评论，拟好回复等我放行')
    await win.locator('#tSave').click()
    await win.waitForTimeout(500)
    const stored = await win.evaluate(() => JSON.parse(localStorage.getItem('jco-tasks-v1') || '{}'))
    const created = (stored.items || []).find((t) => t.name === '每晚评论扫描')
    expect(created, '新建任务应写入存储').toBeTruthy()
    expect(created.schedule).toEqual({ kind: 'daily', time: '18:30' })
    expect(created.when).toBe('每天 18:30')
    expect(typeof created.createdAt).toBe('number')

    // 同步落盘（tasks:sync → kernel/auto-tasks.json）
    await expect.poll(() => fs.existsSync(TASKS_FILE), { timeout: 5000 }).toBe(true)
    const synced = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'))
    expect(synced.items.length).toBe(3)
    expect(synced.items.map((t) => t.name).join('|')).toContain('每晚评论扫描')
    expect(synced.items.find((t) => t.id === 't1').schedule).toEqual({ kind: 'daily', time: '09:00' })

    // 任务卡显示具体时间
    const whenTexts = (await win.locator('.tk-when').allInnerTexts()).join('|')
    expect(whenTexts).toContain('每天 18:30')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('自动任务页：显示「上次执行」（成功 ✓ / 失败 ✗）', async () => {
  // 备份并预置执行记录；结束后恢复
  let backup = null
  try {
    backup = fs.readFileSync(RUNS_FILE, 'utf8')
  } catch {}
  const now = Date.now()
  fs.writeFileSync(
    RUNS_FILE,
    JSON.stringify({
      runs: {
        t1: { lastRunAt: now - 5 * 60 * 1000, dueAt: now - 10 * 60 * 1000, ok: true, summary: '战报取好了' },
        t3: { lastRunAt: now - 30 * 60 * 60 * 1000, dueAt: now - 31 * 60 * 60 * 1000, ok: false, summary: '需要登录' },
      },
    }),
    'utf8',
  )
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co自动任务.html'
    })
    await win.waitForTimeout(1300)
    const whenTexts = (await win.locator('.tk-when').allInnerTexts()).join('|')
    expect(whenTexts).toContain('上次')
    expect(whenTexts).toContain('✓')
    expect(whenTexts).toContain('✗')
  } finally {
    await app.close()
    try {
      if (backup === null) fs.rmSync(RUNS_FILE, { force: true })
      else fs.writeFileSync(RUNS_FILE, backup, 'utf8')
    } catch {}
  }
})

test('团队页：自动任务干活时汇报区显示任务名（员工卡不亮）', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  const sendActivity = (act) =>
    app.evaluate(({ BrowserWindow }, payload) => {
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          w.webContents.send('kernel:activity', payload)
        } catch {}
      }
    }, act)
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co管家团队.html'
    })
    const say = win.locator('.b-say')
    const pubBadge = win.locator('.staff[href="J.Co工作台-发布.html"] .s-badge')
    const opsBadge = win.locator('.staff[href="J.Co工作台-运营.html"] .s-badge')
    await expect(pubBadge).toHaveText('空闲')

    await sendActivity({
      kind: 'tool',
      phase: 'call',
      session: 'jco-chat-task-t2',
      tool: 'jco_save_comments',
      auto: true,
      taskName: '评论自动跟进',
      t: Date.now(),
    })
    await expect(say).toContainText('自动任务「评论自动跟进」正在忙：正在整理评论')
    await expect(opsBadge).toHaveText('空闲') // 员工卡不亮（v1 取舍）
    await expect(pubBadge).toHaveText('空闲')

    await sendActivity({
      kind: 'turn',
      phase: 'end',
      session: 'jco-chat-task-t2',
      auto: true,
      taskName: '评论自动跟进',
      t: Date.now(),
    })
    await expect(say).not.toContainText('自动任务')
  } finally {
    await app.close()
  }
})

test('自动任务页：「马上跑」并入唯一执行管道（不跳页、提示已开跑）', async () => {
  // 备份现场（进页会自动同步任务表；执行会写记录——测试后恢复）
  let tasksBak = null
  let runsBak = null
  try {
    tasksBak = fs.readFileSync(TASKS_FILE, 'utf8')
  } catch {}
  try {
    runsBak = fs.readFileSync(RUNS_FILE, 'utf8')
  } catch {}
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co自动任务.html'
    })
    await win.waitForTimeout(1300)
    // 点第一个任务的「马上跑」→ 立即提示"已开跑"，且不跳页（M7：与到点同一条管道）
    await win.locator('.task .tk-run').first().click()
    await win.waitForTimeout(250)
    const toastText = await win.locator('#toast').textContent()
    expect(toastText).toContain('已开跑')
    expect(decodeURIComponent(win.url())).toContain('自动任务') // 不再跳总管
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    try {
      if (tasksBak === null) fs.rmSync(TASKS_FILE, { force: true })
      else fs.writeFileSync(TASKS_FILE, tasksBak, 'utf8')
      if (runsBak === null) fs.rmSync(RUNS_FILE, { force: true })
      else fs.writeFileSync(RUNS_FILE, runsBak, 'utf8')
    } catch {}
  }
})
