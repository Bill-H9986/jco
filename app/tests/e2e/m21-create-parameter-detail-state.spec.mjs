// M21：创作参数选择和图片详情索引要跨页面重载恢复。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const FIXTURE = path.join(APP_DIR, 'tests', 'visual', 'baseline', 'local', 'materials-light-1440x900.png')

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

async function chooseParam(frame, key, value) {
  const param = frame.locator(`.ask-params .param[data-param="${key}"]`)
  await param.locator('.param-chip').click()
  await param.locator('.param-menu .seg button', { hasText: value }).click()
}

test('M21：视频/图片参数选择跨页面重载恢复', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)

    const video = await openPage(win, 'J.Co工作台-做视频.html')
    await chooseParam(video, 'ratio', '1:1')
    await chooseParam(video, 'dur', '1 分钟')
    await chooseParam(video, 'voice', '沉稳男声')
    await expect(video.locator('.param[data-param="ratio"] .pv')).toHaveText('1:1')
    await expect(video.locator('.param[data-param="dur"] .pv')).toHaveText('1 分钟')
    await expect(video.locator('.param[data-param="voice"] .pv')).toHaveText('沉稳男声')

    await win.reload()
    await win.waitForTimeout(1800)
    const videoAgain = await openPage(win, 'J.Co工作台-做视频.html')
    await expect(videoAgain.locator('.param[data-param="ratio"] .pv')).toHaveText('1:1')
    await expect(videoAgain.locator('.param[data-param="dur"] .pv')).toHaveText('1 分钟')
    await expect(videoAgain.locator('.param[data-param="voice"] .pv')).toHaveText('沉稳男声')

    await videoAgain.locator('#agentTabs button[data-t="image"]').click()
    await chooseParam(videoAgain, 'dur', '5 张')
    await chooseParam(videoAgain, 'res', '4K')
    await win.reload()
    await win.waitForTimeout(1800)
    const imageAgain = await openPage(win, 'J.Co工作台-做视频.html')
    await expect(imageAgain.locator('#agentTabs button[data-t="image"]')).toHaveClass(/on/)
    await expect(imageAgain.locator('.param[data-param="ratio"] .pv')).toHaveText('3:4')
    await expect(imageAgain.locator('.param[data-param="dur"] .pv')).toHaveText('5 张')
    await expect(imageAgain.locator('.param[data-param="res"] .pv')).toHaveText('4K')
  } finally {
    try {
      const win = await app.firstWindow()
      await win.evaluate(() => localStorage.removeItem('jco-make-params-v1'))
    } catch {}
    await app.close()
  }
})

test('M21：图片详情当前索引跨页面重载恢复', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    const file = FIXTURE.replace(/\\/g, '/')
    const draft = {
      id: 9951,
      idea: '图片详情索引',
      status: 'review',
      type: 'image',
      ratio: '3:4',
      duration: '3 张',
      res: '1K',
      voice: '标准女声',
      method: 'assemble',
      shots: [],
      videos: {},
      images: [1, 2, 3].map((index) => ({
        src: `file:///${file}`,
        path: FIXTURE,
        prompt: `第 ${index} 张`,
      })),
    }
    await win.evaluate(async (item) => {
      await window.jco.drafts.save({ items: [item] })
    }, draft)

    const create = await openPage(win, 'J.Co工作台-做视频.html')
    await create.locator('.dcard', { hasText: '图片详情索引' }).click()
    await expect(create.locator('#ibCount')).toHaveText('1 / 3')
    await create.locator('.ib-nav.next').click()
    await expect(create.locator('#ibCount')).toHaveText('2 / 3')

    await win.reload()
    await win.waitForTimeout(1800)
    const createAgain = await openPage(win, 'J.Co工作台-做视频.html')
    await expect(createAgain.locator('#ibCount')).toHaveText('2 / 3')
  } finally {
    try {
      const win = await app.firstWindow()
      await win.evaluate(async () => {
        await window.jco.drafts.save({ items: [] })
        localStorage.removeItem('jco-make-image-index-v1')
      })
    } catch {}
    await app.close()
  }
})
