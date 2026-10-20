// M26：测试模式下系统开关不得碰真实注册表/托盘，且状态仍可跨重启验证。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_NAME = 'J.Co'

function loginRegistrySnapshot() {
  try {
    return execFileSync('reg', ['query', RUN_KEY, '/v', RUN_NAME], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
  } catch {
    return null
  }
}

function launch(profileDir) {
  return electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir },
  })
}

async function openSettings(win) {
  await win.evaluate(() => window.__jcoGo('J.Co设置.html'))
  let found = null
  await expect
    .poll(
      async () => {
        const node = await win.locator('#jcoFrame').elementHandle()
        const frame = node ? await node.contentFrame() : null
        if (!frame || !decodeURIComponent(frame.url()).endsWith('/J.Co设置.html')) return false
        try {
          const ready = await frame.evaluate(() => document.documentElement.getAttribute('data-jco-ready'))
          if (ready === '1') found = frame
          return ready === '1'
        } catch {
          return false
        }
      },
      { timeout: 8000 },
    )
    .toBe(true)
  return found
}

test('M26：测试模式系统开关跨重启恢复且不触碰真实系统', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-system-switch-profile-'))
  const loginRegistryBefore = loginRegistrySnapshot()
  let app = null
  try {
    app = await launch(profileDir)
    let win = await app.firstWindow()
    await win.waitForTimeout(2400)
    let settings = await openSettings(win)
    await expect(settings.locator('#tgLogin')).not.toHaveClass(/on/)
    await expect(settings.locator('#tgTray')).not.toHaveClass(/on/)

    await settings.locator('#tgLogin').click()
    await settings.locator('#tgTray').click()
    await expect.poll(async () => await win.evaluate(async () => (await window.jco.sys.getLogin()).enabled)).toBe(true)
    await expect.poll(async () => await win.evaluate(async () => (await window.jco.sys.getTray()).enabled)).toBe(true)
    await app.close()
    app = null
    expect(loginRegistrySnapshot()).toBe(loginRegistryBefore)

    app = await launch(profileDir)
    win = await app.firstWindow()
    await win.waitForTimeout(2600)
    settings = await openSettings(win)
    await expect(settings.locator('#tgLogin')).toHaveClass(/on/)
    await expect(settings.locator('#tgTray')).toHaveClass(/on/)
    expect(await win.evaluate(async () => (await window.jco.sys.getLogin()).enabled)).toBe(true)
    expect(await win.evaluate(async () => (await window.jco.sys.getTray()).enabled)).toBe(true)

    await settings.locator('#tgLogin').click()
    await settings.locator('#tgTray').click()
    await expect.poll(async () => await win.evaluate(async () => (await window.jco.sys.getLogin()).enabled)).toBe(false)
    await expect.poll(async () => await win.evaluate(async () => (await window.jco.sys.getTray()).enabled)).toBe(false)
    await app.close()
    app = null
    expect(loginRegistrySnapshot()).toBe(loginRegistryBefore)
  } finally {
    try {
      const win = await app?.firstWindow()
      await win?.evaluate(async () => {
        await window.jco.sys.login(false)
        await window.jco.sys.tray(false)
      })
    } catch {}
    try {
      if (app) await app.close()
    } catch {}
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
