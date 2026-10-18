// M11 W4-04：团队页员工状态由结构化 Task 状态/事件驱动。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const WORK_TASKS = path.join(os.tmpdir(), 'jco-test-kernel-data', 'work-tasks')

function task(id, title, ownerRole, status) {
  const now = Date.now()
  return {
    id,
    title,
    goal: title,
    type: ownerRole === 'publisher' ? 'publish' : 'operate',
    ownerRole,
    status,
    inputs: [],
    constraints: [],
    deliverables: ['结果'],
    approvalPolicy: {},
    createdAt: now,
    updatedAt: now,
    runId: `${id}-run1`,
    events: [],
    approvals: [],
    artifacts: [],
    messages: [],
    summary: '',
  }
}

test('M11 W4-04：结构化 Task 驱动团队员工状态，取消后回落', async () => {
  fs.mkdirSync(WORK_TASKS, { recursive: true })
  fs.writeFileSync(
    path.join(WORK_TASKS, 'w-test-pub.json'),
    JSON.stringify(task('w-test-pub', '测试发布任务', 'publisher', 'running')),
  )
  fs.writeFileSync(
    path.join(WORK_TASKS, 'w-test-ops.json'),
    JSON.stringify(task('w-test-ops', '测试运营任务', 'operator', 'waiting_user')),
  )
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(() => {
      window.location.href = 'J.Co管家团队.html'
    })
    await win.waitForTimeout(1200)

    const pubBadge = win.locator('.staff[href="J.Co工作台-发布.html"] .s-badge')
    const opsBadge = win.locator('.staff[href="J.Co工作台-运营.html"] .s-badge')
    await expect(pubBadge).toHaveText('在忙')
    await expect(win.locator('.staff[href="J.Co工作台-发布.html"] .s-live')).toContainText('测试发布任务')
    await expect(opsBadge).toHaveText('在等你')
    await expect(win.locator('.roster')).toContainText('1 在忙')
    await expect(win.locator('.roster')).toContainText('1 在等你')

    await win.evaluate(() => window.jco.tasks.cancel('w-test-pub'))
    await win.evaluate(() => window.jco.tasks.cancel('w-test-ops'))
    await expect(pubBadge).toHaveText('空闲')
    await expect(opsBadge).toHaveText('空闲')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(WORK_TASKS, { recursive: true, force: true })
  }
})
