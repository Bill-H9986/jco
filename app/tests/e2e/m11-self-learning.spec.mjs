// M11 W8-01：业务资料由用户填一次；内容任务完成后，AI 总管自动写入可追溯的本机记忆。
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
const BRAND_FILE = path.join(TEST_KERNEL_DIR, 'brand-profile.json')
const WORK_TASKS = path.join(TEST_KERNEL_DIR, 'work-tasks')

test('M11 W8-01：业务档案手动填一次，任务完成后 AI 总管自动记住经验', async () => {
  fs.rmSync(BRAND_FILE, { force: true })
  fs.rmSync(WORK_TASKS, { recursive: true, force: true })
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(() => {
      window.location.href = 'J.Co设置.html'
    })
    await win.waitForTimeout(1500)

    await win.locator('#brandIndustry').fill('健身')
    await win.locator('#brandBusiness').fill('给上班族做线上健身课程和训练营')
    await win.locator('#brandProducts').fill('七日入门训练营、一对一私教')
    await win.locator('#brandAudience').fill('久坐上班族')
    await win.locator('#brandPlatforms').fill('抖音、视频号')
    await win.locator('#brandTone').fill('直接、专业')
    await win.locator('#btnBrandSave').click()
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.brand.get()).data.business), { timeout: 5000 })
      .toBe('给上班族做线上健身课程和训练营')

    const proposed = await win.evaluate(async () =>
      window.jco.tasks.propose({
        title: '账号运营复盘',
        goal: '总结一条以后发内容时能复用的经验，并给出下一步建议',
        type: 'content',
        ownerRole: 'writer',
        inputs: [],
        constraints: ['只写建议，不执行发布'],
        deliverables: ['一段可复用的运营经验'],
        approvalPolicy: { requireFinalApproval: false },
      }),
    )
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true)
    const taskId = proposed.task.id
    const confirmed = await win.evaluate((id) => window.jco.tasks.confirm(id), taskId)
    expect(confirmed.ok, JSON.stringify(confirmed)).toBe(true)
    await expect
      .poll(
        async () =>
          await win.evaluate(async (id) => {
            const result = await window.jco.tasks.session(id)
            return result?.task ? result.task.status : ''
          }, taskId),
        { timeout: 90_000 },
      )
      .toBe('done')

    const brand = await win.evaluate(async () => await window.jco.brand.get())
    const learned = brand.data.knowledge.find((entry) => entry.sourceTaskId === taskId)
    expect(learned, JSON.stringify(brand.data.knowledge)).toBeTruthy()
    expect(learned.source).toBe('ai')
    expect(learned.title).toContain('AI总管记录')
    expect(learned.content.length).toBeGreaterThan(20)
    expect(learned.sourceTaskTitle).toBe('账号运营复盘')
    await expect(win.locator('#kbList')).toContainText('AI 总管自动记录')
    await expect(win.locator('#kbList')).toContainText(learned.title)
    await expect(win.locator('#kbList')).toContainText('来自任务：账号运营复盘')
    await expect(win.locator('#kbCount')).toContainText('已记住')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(BRAND_FILE, { force: true })
    fs.rmSync(WORK_TASKS, { recursive: true, force: true })
  }
})
