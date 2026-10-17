// M10 应用壳：启动即壳；切页只换内容视图（外壳不重载）；内嵌页隐藏自身侧栏；IPC 经外壳桥接
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('应用壳：侧栏常驻切页不重载 / 内嵌页隐藏自身侧栏 / IPC 桥接 / 高亮同步', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(3200)
    // 启动页 = 应用壳
    expect(decodeURIComponent(win.url())).toContain('J.Co应用壳.html')
    await expect(win.locator('#jcoFrame')).toBeVisible()
    // 外壳打标记 → 切换 → 标记仍在（外壳没被重载）
    await win.evaluate(() => {
      window.__shellMark = 1
    })
    await win.locator('.nav .nav-item', { hasText: '发布' }).click()
    await win.waitForTimeout(1300)
    expect(await win.evaluate(() => window.__shellMark)).toBe(1)
    await expect(win.locator('#jcoFrame')).toHaveAttribute('src', 'J.Co工作台-发布.html')
    // 内嵌页隐藏自身侧栏 + IPC 经外壳桥接可用
    const frame = win.frameLocator('#jcoFrame')
    const sideDisplay = await frame.locator('.sidebar').evaluate((el) => getComputedStyle(el).display)
    expect(sideDisplay).toBe('none')
    const inner = win.frames().find((f) => f !== win.mainFrame())
    expect(await inner.evaluate(() => typeof window.jco)).toBe('object')
    // 高亮同步
    const active = (await win.locator('.nav .nav-item.active').allInnerTexts()).join('｜')
    expect(active).toContain('发布')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
