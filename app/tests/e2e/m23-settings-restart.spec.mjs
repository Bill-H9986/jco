// M23：设置项必须在真实主进程重启后从同一 userData profile 恢复。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

function launch(profileDir) {
  return electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir },
  })
}

test('M23：主题、模式和通知开关跨真实进程重启恢复', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-settings-profile-'))
  let app = null
  try {
    app = await launch(profileDir)
    let win = await app.firstWindow()
    await win.waitForTimeout(2400)
    const saved = await win.evaluate(async () => {
      const settings = await window.jco.settings.save({ mode: 'ask', notifyDone: false })
      const theme = await window.jco.sys.theme('dark')
      return { settings, theme }
    })
    expect(saved.settings.mode).toBe('ask')
    expect(saved.settings.notifyDone).toBe(false)
    expect(saved.theme.theme).toBe('dark')
    await app.close()
    app = null

    app = await launch(profileDir)
    win = await app.firstWindow()
    await win.waitForTimeout(2600)
    const restored = await win.evaluate(async () => ({
      settings: window.jco.settings.getSync(),
      theme: await window.jco.sys.getTheme(),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    }))
    expect(restored.settings.mode).toBe('ask')
    expect(restored.settings.notifyDone).toBe(false)
    expect(restored.theme.theme).toBe('dark')
    expect(restored.bg).toBe('#1c1c1e')
  } finally {
    try {
      if (app) await app.close()
    } catch {}
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
