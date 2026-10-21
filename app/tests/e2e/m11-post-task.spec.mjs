// W6-01：后期页必须走 TaskService 的 propose/confirm，并登记后期产物。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('W6-01：后期页创建 edit Task，产物进入统一任务详情', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  let win
  let taskId = ''
  let fixture = ''
  try {
    win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    const assets = await win.evaluate(async () => window.jco.sys.listAssets())
    expect(assets.ok, assets.error || '读取成片目录失败').toBe(true)
    fixture = path.join(assets.dir, 'fixture-clip.mp4')
    fs.writeFileSync(fixture, 'fixture')
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-后期.html'
    })
    await win.waitForTimeout(1200)

    const pageSrc = await win.evaluate(() => [...document.scripts].map((s) => s.textContent || '').join('\n'))
    expect(pageSrc).toContain('tasks.propose')
    expect(pageSrc).toContain('tasks.confirm')
    expect(pageSrc).not.toContain('tasks.dispatch')
    await expect(win.locator('.asset-row', { hasText: 'fixture-clip.mp4' })).toBeVisible()
    await win.locator('.asset-row', { hasText: 'fixture-clip.mp4' }).click()
    await win.locator('#askInp').fill('把视频裁到前 1 秒')
    await win.locator('#askGo').click()
    await win.waitForFunction(
      async () => {
        const result = await window.jco.tasks.sessions()
        return (result.tasks || []).some((task) => task.name?.startsWith('后期：'))
      },
      undefined,
      { timeout: 5000 },
    )
    const postTask = await win.evaluate(async () => {
      const result = await window.jco.tasks.sessions()
      return (result.tasks || []).find((task) => task.name?.startsWith('后期：'))
    })
    taskId = postTask.id
    const detail = await win.evaluate(async (id) => window.jco.tasks.session(id), taskId)
    expect(detail.task.type).toBe('edit')
    expect(detail.task.ownerRole).toBe('editor')
    expect(detail.task.inputs.some((input) => input.kind === 'artifact' && input.ref === 'fixture-clip.mp4')).toBe(true)
    expect(detail.task.inputs.some((input) => input.kind === 'text' && input.ref.includes('前 1 秒'))).toBe(true)
    expect(detail.task.approvals.some((item) => item.status === 'pending')).toBe(true)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    if (taskId && win) {
      try {
        await win.evaluate((id) => window.jco.tasks.cancel(id), taskId)
      } catch {}
    }
    if (fixture) {
      try {
        fs.rmSync(fixture, { force: true })
      } catch {}
    }
    await app.close()
  }
})
