// M25：页面被应用壳切走时，视频预览等瞬态弹层必须关闭，不能在隐藏 iframe 中继续存在。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

function frameByPage(win, page) {
  return win.frames().find((frame) => {
    if (frame === win.mainFrame()) return false
    try {
      return decodeURIComponent(new URL(frame.url()).pathname).endsWith(`/${page}`)
    } catch {
      return false
    }
  })
}

async function waitForPage(win, page) {
  let found = null
  await expect
    .poll(
      async () => {
        const frame = frameByPage(win, page)
        if (!frame) return false
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

test('M25：切页时关闭视频预览瞬态弹层', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    await win.evaluate(async () => {
      await window.jco.drafts.save({
        items: [
          {
            id: 9971,
            idea: '切页关闭预览',
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
                url: 'file:///C:/definitely-missing-jco/preview.mp4',
                path: 'C:/definitely-missing-jco/preview.mp4',
              },
            },
            images: [],
          },
        ],
      })
    })

    await win.evaluate(() => window.__jcoGo('J.Co工作台-做视频.html'))
    const create = await waitForPage(win, 'J.Co工作台-做视频.html')
    await create.locator('.dcard', { hasText: '切页关闭预览' }).click()
    await create.locator('.shot .make', { hasText: '看这段' }).click()
    await expect(create.locator('#videoPop')).toBeVisible()

    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await waitForPage(win, 'J.Co主界面-首页.html')
    const cached = frameByPage(win, 'J.Co工作台-做视频.html')
    expect(cached).toBeTruthy()
    await expect.poll(async () => await cached.evaluate(() => document.getElementById('videoPop')?.hidden)).toBe(true)

    await win.evaluate(() => window.__jcoGo('J.Co工作台-做视频.html'))
    const createAgain = await waitForPage(win, 'J.Co工作台-做视频.html')
    await expect(createAgain.locator('#videoPop')).toBeHidden()
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
