// M14：创作后台任务跨页面切换/刷新不丢工作态。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

const VIDEO_DRAFT = {
  id: 9401,
  idea: '切页后继续跑的视频',
  status: 'review',
  type: 'video',
  ratio: '9:16',
  duration: '10 秒',
  res: '720P',
  voice: '标准女声',
  method: 'assemble',
  shots: [
    { line: '第一段', pic: '蓝色背景' },
    { line: '第二段', pic: '白色圆点' },
  ],
  videos: {},
  images: [],
}

async function contentFrame(win) {
  const href = await win.evaluate(() => {
    const node = document.querySelector('#jcoFrame')
    return node ? new URL(node.getAttribute('src'), location.href).href : ''
  })
  return win.frames().find((frame) => frame.url() === href)
}

test('创作后台任务：切页继续、返回自动恢复、刷新后仍能收口', async () => {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_MEDIA_FAKE: '1' },
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(async (draft) => {
      await window.jco.drafts.save({ items: [draft] })
    }, VIDEO_DRAFT)

    await win.evaluate(() => window.__jcoGo('J.Co工作台-做视频.html'))
    await win.waitForTimeout(1800)
    let frame = await contentFrame(win)
    await expect(frame.locator('#done.show')).toBeVisible()

    await frame.locator('.shot-bar .go-btn').click()
    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.media.list(9401)
            return (data.jobs || [])[0]?.status || ''
          }),
        { timeout: 5000 },
      )
      .toBe('running')

    // 切到首页再回来：复用已加载页面，任务与视图状态都必须继续。
    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await win.waitForTimeout(1000)
    await win.evaluate(() => window.__jcoGo('J.Co工作台-做视频.html'))
    await win.waitForTimeout(1800)
    frame = await contentFrame(win)
    await expect(frame.locator('#done.show')).toBeVisible()
    await expect(frame.locator('#dStatus')).toContainText(/生成中|待检查/)

    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.drafts.get()
            const item = (data.data.items || []).find((draft) => draft.id === 9401)
            const videos = Object.values(item?.videos || {})
            return videos.filter((video) => video && video.status === 'done').length
          }),
        { timeout: 15000 },
      )
      .toBe(2)
    await expect(frame.locator('.shot .make', { hasText: '看这段' })).toHaveCount(2)

    // 再跑一次后立刻刷新外壳：主进程任务仍应继续，返回时收口。
    await win.evaluate(async () => {
      const data = await window.jco.drafts.get()
      const item = data.data.items.find((draft) => draft.id === 9401)
      item.videos = {}
      await window.jco.drafts.save({ items: [item] })
    })
    await win.reload()
    await win.waitForTimeout(1800)
    frame = await contentFrame(win)
    await frame.locator('.shot-bar .go-btn').click()
    await win.waitForTimeout(400)
    await win.reload()
    await win.waitForTimeout(1800)
    frame = await contentFrame(win)
    await expect(frame.locator('#done.show')).toBeVisible()
    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.drafts.get()
            const item = (data.data.items || []).find((draft) => draft.id === 9401)
            return Object.values(item?.videos || {}).filter((video) => video && video.status === 'done').length
          }),
        { timeout: 15000 },
      )
      .toBe(2)

    // 图片后台任务同样不能被页面保存覆盖。
    await win.evaluate(async () => {
      await window.jco.drafts.save({
        items: [
          {
            id: 9402,
            idea: '图片后台任务',
            status: 'review',
            type: 'image',
            ratio: '3:4',
            duration: '1 张',
            res: '1K',
            shots: [],
            videos: {},
            images: [],
          },
        ],
      })
      await window.jco.media.start({
        kind: 'image',
        draftId: 9402,
        prompts: ['一张测试图片'],
        ratio: '3:4',
        res: '1K',
        sizePx: '1024x1365',
      })
    })
    await win.evaluate(() => window.__jcoGo('J.Co工作台-做视频.html'))
    await win.waitForTimeout(1800)
    frame = await contentFrame(win)
    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.drafts.get()
            const item = (data.data.items || []).find((draft) => draft.id === 9402)
            return Array.isArray(item?.images) ? item.images.length : 0
          }),
        { timeout: 10000 },
      )
      .toBe(1)
    await frame.locator('.dcard', { hasText: '图片后台任务' }).click()
    await expect(frame.locator('#ibCount')).toContainText('1 / 1')

    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
