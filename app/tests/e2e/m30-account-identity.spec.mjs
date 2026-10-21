// M30：主壳与 15 个内容页的用户显示名必须统一为 admin，头像首字母为 A。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { PAGES } from '../pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

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

test('M30：主壳与全部内容页账号统一显示 admin', async () => {
  test.setTimeout(120_000)
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-account-identity-'))
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir },
  })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    await expect(win.locator('.side-foot .me > span')).toHaveText('admin')
    await expect(win.locator('.side-foot .me > .ava')).toHaveText('A')

    for (const page of PAGES) {
      const frame = await openPage(win, page)
      if (page !== 'J.Co设计系统.html') {
        await expect(frame.locator('.side-foot .me > span'), `${page}: 账号名未统一`).toHaveText('admin')
        await expect(frame.locator('.side-foot .me > .ava'), `${page}: 头像首字母未统一`).toHaveText('A')
      }
      await expect(frame.locator('.mm-head .ava'), `${page}: 账号菜单头像未统一`).toHaveText('A')
      await expect(frame.locator('.mm-who b'), `${page}: 账号菜单名未统一`).toHaveText('admin')
    }
  } finally {
    try {
      await app.close()
    } catch {}
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
