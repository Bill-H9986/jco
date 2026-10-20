// M19：选题 → 文案/创作、创作 → 发布必须走应用壳；切页回来后交接状态仍在。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

function pageNameOf(urlText) {
  try {
    return decodeURIComponent(new URL(urlText).pathname).split('/').pop() || ''
  } catch {
    return ''
  }
}

async function activeFrame(win) {
  const handle = await win.locator('#jcoFrame').elementHandle()
  return handle ? await handle.contentFrame() : null
}

async function waitForPage(win, page) {
  let found = null
  await expect
    .poll(
      async () => {
        const frame = await activeFrame(win)
        if (!frame || pageNameOf(frame.url()) !== page) return false
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

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  return waitForPage(win, page)
}

test('M19：选题交接在切页回来后仍保留在缓存创作页', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2400)

    let video = await openPage(win, 'J.Co工作台-做视频.html')
    await video.locator('#askInp').fill('旧工作态')
    await win.waitForTimeout(400)

    let topics = await openPage(win, 'J.Co工作台-选题.html')
    await topics.evaluate(() => goMake('跨页交接主题'))
    video = await waitForPage(win, 'J.Co工作台-做视频.html')
    await expect(video.locator('#askInp')).toHaveValue(/跨页交接主题/, { timeout: 5000 })

    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await waitForPage(win, 'J.Co主界面-首页.html')
    video = await openPage(win, 'J.Co工作台-做视频.html')
    await expect(video.locator('#askInp')).toHaveValue(/跨页交接主题/, { timeout: 5000 })

    topics = await openPage(win, 'J.Co工作台-选题.html')
    await topics.evaluate(() => goWrite('跨页文案主题'))
    const script = await waitForPage(win, 'J.Co工作台-创作.html')
    await expect(script.locator('#topicName')).toContainText('跨页文案主题', { timeout: 5000 })

    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await waitForPage(win, 'J.Co主界面-首页.html')
    const scriptAgain = await openPage(win, 'J.Co工作台-创作.html')
    await expect(scriptAgain.locator('#topicName')).toContainText('跨页文案主题', { timeout: 5000 })

    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
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

test('M19：创作去发布的标题交接在切页回来后仍保留', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2400)

    const draft = {
      id: 9901,
      idea: '跨页发布标题',
      status: 'review',
      type: 'video',
      ratio: '9:16',
      duration: '10 秒',
      res: '720P',
      voice: '标准女声',
      method: 'assemble',
      shots: [{ line: '第一段', pic: '蓝色背景' }],
      videos: { 0: { status: 'done', url: 'file:///C:/nonexistent.mp4', path: 'C:/nonexistent.mp4' } },
      images: [],
    }
    await win.evaluate(async (item) => {
      await window.jco.drafts.save({ items: [item] })
    }, draft)

    const video = await openPage(win, 'J.Co工作台-做视频.html')
    await video.locator('.dcard', { hasText: '跨页发布标题' }).click()
    await expect(video.locator('#approveBtn')).toBeEnabled()
    await video.locator('#approveBtn').click()
    await expect(video.locator('#approveBtn')).toHaveText('去发布')
    await video.locator('#approveBtn').click()
    let publish = await waitForPage(win, 'J.Co工作台-发布.html')
    await expect(publish.locator('#titleInp')).toHaveValue('跨页发布标题', { timeout: 5000 })

    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await waitForPage(win, 'J.Co主界面-首页.html')
    publish = await openPage(win, 'J.Co工作台-发布.html')
    await expect(publish.locator('#titleInp')).toHaveValue('跨页发布标题', { timeout: 5000 })

    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
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
