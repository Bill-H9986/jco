// M24：创作页生成的图片/视频文件失效时，详情和预览必须降级，不显示坏媒体。
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

test('M24：创作页失效图片与成片路径降级显示', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    const imageDraft = {
      id: 9961,
      idea: '失效图片草稿',
      status: 'review',
      type: 'image',
      ratio: '3:4',
      duration: '1 张',
      res: '1K',
      voice: '标准女声',
      method: 'assemble',
      shots: [],
      videos: {},
      images: [{ src: 'file:///C:/definitely-missing-jco/missing.png', path: 'C:/definitely-missing-jco/missing.png' }],
    }
    const videoDraft = {
      id: 9962,
      idea: '失效视频草稿',
      status: 'review',
      type: 'video',
      ratio: '9:16',
      duration: '10 秒',
      res: '720P',
      voice: '标准女声',
      method: 'assemble',
      shots: [{ line: '第一段', pic: '蓝色背景' }],
      videos: {
        0: {
          status: 'done',
          url: 'file:///C:/definitely-missing-jco/missing.mp4',
          path: 'C:/definitely-missing-jco/missing.mp4',
        },
      },
      images: [],
    }
    await win.evaluate(
      async (items) => {
        await window.jco.drafts.save({ items })
      },
      [imageDraft, videoDraft],
    )

    const create = await openPage(win, 'J.Co工作台-做视频.html')
    await create.locator('.dcard', { hasText: '失效图片草稿' }).click()
    await expect(create.locator('#ibTip')).toContainText('图片文件不可用', { timeout: 5000 })
    await expect(create.locator('#ibBig .ib-img')).toHaveCount(0)

    await create.locator('.dcard', { hasText: '失效视频草稿' }).click()
    await create.locator('.shot .make', { hasText: '看这段' }).click()
    await expect(create.locator('#vpError')).toBeVisible({ timeout: 5000 })
    await expect(create.locator('#vpError')).toContainText('视频文件不可用')
    await expect(create.locator('#vpVideo')).toBeHidden()
  } finally {
    try {
      const win = await app.firstWindow()
      await win.evaluate(async () => {
        await window.jco.drafts.save({ items: [] })
      })
    } catch {}
    await app.close()
  }
})
