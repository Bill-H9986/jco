// M11 W3-02：运营页战报/评论读统一 ops 数据层；评论回复必须走 Task + Approval。
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
const OPS_FILE = path.join(TEST_KERNEL_DIR, 'ops.json')
const WORK_TASKS = path.join(TEST_KERNEL_DIR, 'work-tasks')

test('M11 W3-02：战报/评论统一数据层，评论回复走审批，拒绝后不发送', async () => {
  fs.rmSync(OPS_FILE, { force: true })
  fs.rmSync(WORK_TASKS, { recursive: true, force: true })
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(async () => {
      await window.jco.ops.save({
        report: {
          platform: 'douyin',
          at: Date.now(),
          metrics: { views: 12345, fans: 67, comments: 8 },
          note: '测试战报解读',
        },
        comments: [
          { id: 'c-review', platform: 'douyin', author: '测试用户甲', text: '多少钱？', draft: '我发你一份价格表。' },
          { id: 'c-skip', platform: 'douyin', author: '测试用户乙', text: '怎么参加？', draft: '我发你流程。' },
        ],
      })
      window.location.href = 'J.Co工作台-运营.html'
    })
    await win.waitForTimeout(1600)

    await expect(win.locator('#statViews')).toContainText('1.2')
    await expect(win.locator('#statComments')).toContainText('8')
    await expect(win.locator('#cmts .cmt')).toHaveCount(2)
    await expect(win.locator('#cmts .cmt').first()).toContainText('测试用户甲')
    const bodyText = await win.evaluate(() => document.body.innerText)
    expect(bodyText.includes('美好明天')).toBe(false)

    // 改回复草稿 → 统一层持久化。
    await win.locator('#cmts .cmt').first().locator('textarea').fill('改好的回复')
    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.ops.get()
            return (data.data.comments || []).find((item) => item.id === 'c-review')?.draft || ''
          }),
        { timeout: 5000 },
      )
      .toBe('改好的回复')

    // 跳过一条评论。
    await win.locator('#cmts .cmt').nth(1).locator('.act-skip').click()
    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.ops.get()
            return (data.data.comments || []).find((item) => item.id === 'c-skip')?.status || ''
          }),
        { timeout: 5000 },
      )
      .toBe('skipped')

    // 提交回复审批：任务进入 waiting_user，评论标记 pending_approval。
    await win.locator('#cmts .cmt').first().locator('.act-send').click()
    await win.waitForTimeout(1800)
    await expect
      .poll(
        async () => {
          const list = await win.evaluate(async () => (await window.jco.tasks.sessions()).tasks || [])
          return list.find((item) => item.structured && String(item.name || '').includes('回复评论'))?.id || ''
        },
        { timeout: 5000 },
      )
      .not.toBe('')
    const taskId = await win.evaluate(async () => {
      const list = (await window.jco.tasks.sessions()).tasks || []
      return list.find((item) => item.structured && String(item.name || '').includes('回复评论'))?.id || ''
    })
    const task = await win.evaluate((id) => window.jco.tasks.session(id), taskId)
    expect(task.ok).toBe(true)
    expect(task.task.type).toBe('operate')
    expect(task.task.status).toBe('waiting_user')
    expect(task.task.goal).toContain('不得点赞、删除或发布其他内容')
    expect(task.task.inputs.join('|')).toContain('commentId:c-review')
    expect(task.task.approvals.some((item) => item.status === 'pending')).toBe(true)
    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.ops.get()
            const item = (data.data.comments || []).find((entry) => entry.id === 'c-review')
            return item ? `${item.status}|${item.taskId}` : ''
          }),
        { timeout: 5000 },
      )
      .toBe(`pending_approval|${taskId}`)

    // 拒绝审批：任务取消，评论回到 rejected，不会发送。
    await win.evaluate((id) => window.jco.tasks.approval(id, 'reject'), taskId)
    const after = await win.evaluate((id) => window.jco.tasks.session(id), taskId)
    expect(after.task.status).toBe('cancelled')
    const rejected = await win.evaluate(async () => {
      const data = await window.jco.ops.get()
      return (data.data.comments || []).find((item) => item.id === 'c-review')?.status || ''
    })
    expect(rejected).toBe('rejected')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(OPS_FILE, { force: true })
    fs.rmSync(WORK_TASKS, { recursive: true, force: true })
  }
})
