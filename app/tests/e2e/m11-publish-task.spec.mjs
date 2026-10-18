// M11 W3-01：发布页创建 Task + Approval；拒绝审批后任务取消，不启动真实发布。
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
const DRAFTS_FILE = path.join(TEST_KERNEL_DIR, 'drafts.json')
const ACCOUNTS_FILE = path.join(TEST_KERNEL_DIR, 'accounts.json')
const WORK_TASKS = path.join(TEST_KERNEL_DIR, 'work-tasks')

test('M11 W3-01：发布页走 Task + Approval，拒绝后不启动真实发布', async () => {
  fs.rmSync(DRAFTS_FILE, { force: true })
  fs.rmSync(ACCOUNTS_FILE, { force: true })
  fs.rmSync(WORK_TASKS, { recursive: true, force: true })
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(async () => {
      await window.jco.drafts.save({
        items: [
          {
            id: 1,
            idea: '发布测试成片',
            status: 'review',
            type: 'video',
            ratio: '9:16',
            duration: '30 秒',
            res: '1080P',
            voice: '标准女声',
            method: 'assemble',
            shots: [{ line: '第一句', pic: '画面A' }],
            videos: { 0: { status: 'done', url: 'file:///nonexistent.mp4', path: 'C:/nonexistent.mp4' } },
            images: [],
          },
        ],
      })
      await window.jco.accounts.save({ platforms: { dy: { ok: true, at: Date.now() } } })
      window.location.href = 'J.Co工作台-发布.html'
    })
    await win.waitForTimeout(1500)
    await win.locator('#titleInp').fill('发布任务测试')
    await win.locator('#tagInp').fill('#测试 #自媒体')
    await win.locator('#segTime button[data-v="now"]').click()
    await win.locator('#pubBtn').click()
    await win.waitForTimeout(1800)

    await expect
      .poll(
        async () => {
          const list = await win.evaluate(async () => (await window.jco.tasks.sessions()).tasks || [])
          return list.find((item) => item.structured && String(item.name || '').includes('发布'))?.id || ''
        },
        { timeout: 5000 },
      )
      .not.toBe('')
    const taskId = await win.evaluate(async () => {
      const list = (await window.jco.tasks.sessions()).tasks || []
      return list.find((item) => item.structured && String(item.name || '').includes('发布'))?.id || ''
    })
    const result = await win.evaluate((id) => window.jco.tasks.session(id), taskId)
    expect(result.ok).toBe(true)
    expect(result.task.type).toBe('publish')
    expect(result.task.status).toBe('waiting_user')
    expect(result.task.goal).toContain('抖音')
    expect(result.task.goal).toContain('绝对不要点「发布」')
    expect(result.task.inputs.join('|')).toContain('platform:douyin')
    expect(result.task.approvals.some((item) => item.status === 'pending' && item.type === 'publish')).toBe(true)

    // 拒绝审批：任务取消，且不进入真实发布会话。
    const rejected = await win.evaluate((id) => window.jco.tasks.approval(id, 'reject'), taskId)
    expect(rejected.ok).toBe(true)
    const after = await win.evaluate((id) => window.jco.tasks.session(id), taskId)
    expect(after.task.status).toBe('cancelled')
    const fakePublish = await win.evaluate(() => {
      try {
        return (JSON.parse(localStorage.getItem('jco-publish-v1') || '{"items":[]}').items || []).length
      } catch {
        return 0
      }
    })
    expect(fakePublish).toBe(0)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(DRAFTS_FILE, { force: true })
    fs.rmSync(ACCOUNTS_FILE, { force: true })
    fs.rmSync(WORK_TASKS, { recursive: true, force: true })
  }
})
