// M29：所有页面级浮层、菜单和弹窗在切页时必须统一关闭。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const AWAY_PAGE = 'J.Co工作台-选题.html'

async function activeFrame(win) {
  const handle = await win.locator('#jcoFrame').elementHandle()
  return handle ? await handle.contentFrame() : null
}

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  let found = null
  await expect
    .poll(
      async () => {
        const frame = await activeFrame(win)
        if (!frame || !decodeURIComponent(frame.url()).endsWith(`/${page}`)) return false
        try {
          const ready = await frame.evaluate(() => document.documentElement.getAttribute('data-jco-ready'))
          if (ready === '1') found = frame
          return ready === '1'
        } catch {
          return false
        }
      },
      { message: `页面未打开：${page}`, timeout: 10_000 },
    )
    .toBe(true)
  return found
}

async function closeByPageHide(win, page) {
  await openPage(win, page === AWAY_PAGE ? 'J.Co主界面-首页.html' : AWAY_PAGE)
  await win.waitForTimeout(150)
  return await openPage(win, page)
}

test('M29：页面浮层、菜单和弹窗切页后统一关闭', async () => {
  test.setTimeout(120_000)
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-overlay-lifecycle-'))
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir },
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
    await win.waitForTimeout(2400)

    let frame = await openPage(win, 'J.Co主界面-首页.html')
    await frame.locator('#modePill').click()
    await expect(frame.locator('.mode-pop')).toBeVisible()
    frame = await closeByPageHide(win, 'J.Co主界面-首页.html')
    expect.soft(await frame.locator('.mode-pop').count(), '首页工作方式菜单切页后仍存在').toBe(0)

    await frame.evaluate(() => document.querySelector('button[aria-label="通知"]')?.click())
    await expect(frame.locator('.notif-pop')).toBeVisible()
    frame = await closeByPageHide(win, 'J.Co主界面-首页.html')
    expect.soft(await frame.locator('.notif-pop').count(), '首页通知面板切页后仍存在').toBe(0)

    frame = await openPage(win, 'J.Co工作台-选题.html')
    await frame.locator('button', { hasText: '贴一条爆款' }).click()
    await expect(frame.locator('#inspoOverlay')).toHaveClass(/show/)
    frame = await closeByPageHide(win, 'J.Co工作台-选题.html')
    expect.soft(await frame.locator('#inspoOverlay.show').count(), '选题爆款弹窗切页后仍存在').toBe(0)

    frame = await openPage(win, 'J.Co工作台-创作.html')
    await frame.evaluate(() => {
      openOwn()
      openPrompter()
    })
    await expect(frame.locator('#ownOverlay')).toHaveClass(/show/)
    await expect(frame.locator('#prompter')).toBeVisible()
    frame = await closeByPageHide(win, 'J.Co工作台-创作.html')
    expect.soft(await frame.locator('#ownOverlay.show').count(), '文案自出题弹窗切页后仍存在').toBe(0)
    expect.soft(await frame.locator('#prompter:not([hidden])').count(), '文案提词器切页后仍存在').toBe(0)

    frame = await openPage(win, 'J.Co自动任务.html')
    await frame.locator('#newTask').click()
    await expect(frame.locator('#taskOverlay')).toHaveClass(/show/)
    frame = await closeByPageHide(win, 'J.Co自动任务.html')
    expect.soft(await frame.locator('#taskOverlay.show').count(), '自动任务新建弹窗切页后仍存在').toBe(0)

    frame = await openPage(win, 'J.Co设置.html')
    await frame.evaluate(() => openKnowledgeEditor(null))
    await expect(frame.locator('#kbModal')).toBeVisible()
    frame = await closeByPageHide(win, 'J.Co设置.html')
    expect.soft(await frame.locator('#kbModal:not([hidden])').count(), '设置知识弹窗切页后仍存在').toBe(0)

    frame = await openPage(win, 'J.Co账号中心.html')
    await frame.evaluate(() => openSheet('dy'))
    await expect(frame.locator('#overlay')).toHaveClass(/show/)
    frame = await closeByPageHide(win, 'J.Co账号中心.html')
    expect.soft(await frame.locator('#overlay.show').count(), '账号登录说明弹窗切页后仍存在').toBe(0)

    expect(errors, `页面 JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    try {
      await app.close()
    } catch {}
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
