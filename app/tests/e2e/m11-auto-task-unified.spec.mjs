// M11 W1-04：自动任务也进入 work-tasks；auto-runs.json 只读兼容，不再写第二套台账。
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
const TASKS_FILE = path.join(TEST_KERNEL_DIR, 'auto-tasks.json')
const RUNS_FILE = path.join(TEST_KERNEL_DIR, 'auto-runs.json')
const WORK_TASKS_DIR = path.join(TEST_KERNEL_DIR, 'work-tasks')

test('M11 W1-04：马上跑创建同一 Task 台账，不写 auto-runs', async () => {
  fs.mkdirSync(TEST_KERNEL_DIR, { recursive: true })
  fs.rmSync(WORK_TASKS_DIR, { recursive: true, force: true })
  const runsBefore = fs.existsSync(RUNS_FILE) ? fs.readFileSync(RUNS_FILE, 'utf8') : null
  const tasksBefore = fs.existsSync(TASKS_FILE) ? fs.readFileSync(TASKS_FILE, 'utf8') : null
  fs.writeFileSync(
    TASKS_FILE,
    JSON.stringify({
      items: [
        {
          id: 'auto-w104',
          name: '自动任务统一测试',
          desc: '写一条短文案，验证自动任务进入统一任务台账',
          icon: 'ti-file-text',
          on: false,
          createdAt: Date.now(),
          schedule: { kind: 'weekly', time: '23:59', weekday: 7 },
        },
      ],
    }),
    'utf8',
  )
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2600)
    const started = await win.evaluate(() => window.jco.tasks.run('auto-w104'))
    expect(started.ok).toBe(true)
    expect(started.taskId).toMatch(/^w[a-z0-9]+$/)

    await expect
      .poll(
        async () =>
          await win.evaluate(async (taskId) => {
            const result = await window.jco.tasks.session(taskId)
            return result?.ok ? result.task.status : ''
          }, started.taskId),
        { timeout: 60_000 },
      )
      .toMatch(/^(done|failed)$/)

    const list = await win.evaluate(async () => (await window.jco.tasks.sessions()).tasks || [])
    const autoTask = list.find((task) => task.id === started.taskId)
    expect(autoTask).toBeTruthy()
    expect(autoTask.sourceAutomationId).toBe('auto-w104')
    expect(fs.existsSync(RUNS_FILE) ? fs.readFileSync(RUNS_FILE, 'utf8') : null).toBe(runsBefore)
  } finally {
    await app.close()
    fs.rmSync(WORK_TASKS_DIR, { recursive: true, force: true })
    if (tasksBefore === null) fs.rmSync(TASKS_FILE, { force: true })
    else fs.writeFileSync(TASKS_FILE, tasksBefore, 'utf8')
    if (runsBefore === null) fs.rmSync(RUNS_FILE, { force: true })
    else fs.writeFileSync(RUNS_FILE, runsBefore, 'utf8')
  }
})
