import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { ALL_PAGES, SHELL_PAGE } from '../pages.mjs'
import { APP_DIR, assertVisual, ELECTRON_BIN, settleWindow } from './visual-support.mjs'

const CAPTURE_PAGES = [
  ['shell', SHELL_PAGE],
  ['home', 'J.Co主界面-首页.html'],
  ['topics', 'J.Co工作台-选题.html'],
  ['materials', 'J.Co工作台-素材.html'],
  ['scripts', 'J.Co工作台-创作.html'],
  ['video', 'J.Co工作台-做视频.html'],
  ['post', 'J.Co工作台-后期.html'],
  ['publish', 'J.Co工作台-发布.html'],
  ['ops', 'J.Co工作台-运营.html'],
  ['team', 'J.Co管家团队.html'],
  ['skills', 'J.Co技能库.html'],
  ['auto-tasks', 'J.Co自动任务.html'],
  ['accounts', 'J.Co账号中心.html'],
  ['settings', 'J.Co设置.html'],
  ['design-system', 'J.Co设计系统.html'],
]

test('W5-02：应用壳与 14 个内容页关键状态', async () => {
  expect(ALL_PAGES).toHaveLength(16)
  expect(CAPTURE_PAGES).toHaveLength(15)

  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
    await win.waitForTimeout(2200)
    await win.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('jco-side-pinned', '1')
      localStorage.setItem('jco-shell-reset-v2', '1')
    })

    for (const [name, page] of CAPTURE_PAGES) {
      await win.evaluate((target) => {
        window.location.href = target
      }, page)
      await expect
        .poll(
          () => win.evaluate(() => decodeURIComponent(window.location.pathname.split('/').pop() || '')).catch(() => ''),
          { message: `视觉基线切页失败：${page}`, timeout: 5000 },
        )
        .toBe(page)
      await expect(win.locator('html')).toHaveAttribute('data-jco-ready', '1', { timeout: 5000 })
      if (page === SHELL_PAGE) {
        await expect(win.locator('#jcoFrame')).toBeVisible()
        await expect(win.frameLocator('#jcoFrame').locator('html')).toHaveAttribute('data-jco-ready', '1', {
          timeout: 5000,
        })
        await win.evaluate(() => {
          document.documentElement.classList.add('side-pinned')
        })
      }
      await settleWindow(win)
      await assertVisual(app, `${name}-light-1440x900.png`)
    }

    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
