// W5-01：唯一应用壳 + 15 个内容页 + 新任务详情的全站巡检。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { ALL_PAGES, PAGES, SHELL_PAGE } from '../pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('M11 W5-01：16 个页面零 JS 错误，应用壳路由与任务详情可用', async () => {
  expect(PAGES).toHaveLength(15)
  expect(ALL_PAGES).toHaveLength(16)

  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
    await win.waitForTimeout(2400)

    await expect(win.locator('html')).toHaveAttribute('data-jco-ready', '1')
    await expect(win.locator('#jcoFrame')).toBeVisible()

    for (const page of ALL_PAGES) {
      await win.evaluate((target) => {
        window.location.href = target
      }, page)
      await expect
        .poll(
          () => win.evaluate(() => decodeURIComponent(window.location.pathname.split('/').pop() || '')).catch(() => ''),
          {
            message: `切换到 ${page} 失败`,
            timeout: 5000,
          },
        )
        .toBe(page)
      await expect(win.locator('html')).toHaveAttribute('data-jco-ready', '1', { timeout: 3000 })
      expect((await win.locator('body').innerText()).trim().length, `${page} 页面内容为空`).toBeGreaterThan(0)
    }

    // 从内容页回到唯一应用壳，验证壳内切页与 iframe 路由。
    await win.evaluate((shell) => {
      window.location.href = shell
    }, SHELL_PAGE)
    await expect(win.locator('#jcoFrame')).toBeVisible({ timeout: 5000 })
    await win.evaluate(() => window.__jcoGo('J.Co工作台-发布.html'))
    await expect(win.locator('#jcoFrame')).toHaveAttribute('src', 'J.Co工作台-发布.html')
    await expect(win.locator('.nav .nav-item.active')).toHaveText('发布')
    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await expect(win.locator('#jcoFrame')).toHaveAttribute('src', 'J.Co主界面-首页.html')
    await expect(win.locator('.nav .nav-item.active')).toHaveText('首页')

    // 新任务详情必须能在壳内打开，不退出应用壳。
    const proposed = await win.evaluate(() =>
      window.jco.tasks.propose({
        title: 'W5 全站巡检任务',
        goal: '验证独立任务详情和取消入口',
        type: 'operate',
        ownerRole: 'operator',
        deliverables: ['巡检结果'],
        constraints: ['不自动发布'],
      }),
    )
    await win.evaluate((id) => window.jco.tasks.confirm(id), proposed.task.id)
    await win.evaluate((id) => {
      location.hash = `#/task/${id}`
    }, proposed.task.id)
    await expect(win.locator('#jcoTaskView')).toBeVisible({ timeout: 5000 })
    await expect(win.locator('#tvTitle')).toContainText('W5 全站巡检任务')
    await expect(win.locator('#tvStatus')).toHaveText('等你确认')
    await win.evaluate((id) => window.jco.tasks.cancel(id), proposed.task.id)

    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
