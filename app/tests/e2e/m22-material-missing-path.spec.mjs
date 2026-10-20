// M22：导入素材文件被移动/删除后，卡片和预览必须降级，不显示坏图。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

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
      { timeout: 8000 },
    )
    .toBe(true)
  return found
}

test('M22：失效素材卡降级显示，预览不出现坏图', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    await win.evaluate(async () => {
      await window.jco.materials.save({
        items: [
          {
            cat: 'mine',
            type: 'photo',
            name: '已经被删除的素材.png',
            src: '导入 · 本机文件',
            imported: true,
            path: 'C:/definitely-missing-jco/已经被删除的素材.png',
          },
        ],
      })
    })

    const materials = await openPage(win, 'J.Co工作台-素材.html')
    const card = materials.locator('.mat', { hasText: '已经被删除的素材.png' })
    await expect(card).toBeVisible()
    await expect(card.locator('.ph')).toHaveClass(/missing/, { timeout: 5000 })
    await expect(card.locator('.src')).toContainText('文件不可用')
    await expect(card.locator('.ph-img')).toHaveCount(0)

    await card.click()
    await expect(materials.locator('#matPreview')).toBeVisible()
    await expect(materials.locator('#mpBody')).toContainText('文件不可用')
    await expect(materials.locator('#mpBody img')).toHaveCount(0)
  } finally {
    try {
      const win = await app.firstWindow()
      await win.evaluate(async () => {
        await window.jco.materials.save({ items: [] })
      })
    } catch {}
    await app.close()
  }
})
