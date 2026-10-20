// M16：全站同类操作控件规格统一；UI 盘点报告见 quality/generated/ui-inventory.json。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { PAGES } from '../pages.mjs'
import { inspectPage, validateInventory } from '../support/ui-contract.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

async function activeFrame(win) {
  const href = await win.evaluate(() => {
    const node = document.querySelector('#jcoFrame')
    return node ? new URL(node.getAttribute('src'), location.href).href : ''
  })
  return win.frames().find((frame) => frame.url() === href)
}

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  await expect
    .poll(
      async () => {
        const frame = await activeFrame(win)
        return frame ? decodeURIComponent(frame.url()) : ''
      },
      { message: `页面未打开：${page}`, timeout: 15000 },
    )
    .toContain(page)
  await win.waitForTimeout(180)
  return activeFrame(win)
}

test('M16：全站操作控件尺寸、圆角、内边距统一', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
    await win.waitForTimeout(2400)

    await win.evaluate(
      async (draft) => {
        await window.jco.drafts.save({ items: [draft] })
      },
      {
        id: 990001,
        idea: 'UI 契约图片',
        status: 'review',
        type: 'image',
        ratio: '3:4',
        duration: '2 张',
        res: '1K',
        shots: [],
        videos: {},
        images: [
          {
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            prompt: '画面一',
          },
          {
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            prompt: '画面二',
          },
        ],
      },
    )

    const inventory = []
    for (const page of PAGES) {
      const frame = await openPage(win, page)
      inventory.push(await inspectPage(frame, page))
    }

    const video = await openPage(win, 'J.Co工作台-做视频.html')
    await video.locator('.dcard', { hasText: 'UI 契约图片' }).click()
    await expect(video.locator('#done.show')).toBeVisible()
    inventory.push(await inspectPage(video, 'J.Co工作台-做视频.html#图片详情'))

    const { violations } = validateInventory(inventory)
    expect(violations, `UI 契约违规：\n${violations.join('\n')}`).toEqual([])
    expect(errors, `页面 JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
