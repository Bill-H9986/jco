// W5-02：应用壳视觉基准（独立验证壳层截图；全站页由 full-site.visual.spec 覆盖）。
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { APP_DIR, assertVisual, ELECTRON_BIN, settleWindow } from './visual-support.mjs'

test('W5-02：应用壳关键状态（浅色 1440×900）', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    await win.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('jco-side-pinned', '1')
      localStorage.setItem('jco-shell-reset-v2', '1')
    })
    await win.evaluate(() => {
      window.location.href = 'J.Co应用壳.html'
    })
    await win.waitForTimeout(800)
    expect(decodeURIComponent(win.url())).toContain('J.Co应用壳.html')
    await expect(win.locator('#jcoFrame')).toBeVisible()
    await win.evaluate(() => document.documentElement.classList.add('side-pinned'))
    await settleWindow(win)
    await assertVisual(app, 'shell-light-1440x900.png')
  } finally {
    await app.close()
  }
})
