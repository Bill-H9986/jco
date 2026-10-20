#!/usr/bin/env node
/**
 * 真实模型 UI 冒烟：从创作页点按钮，验证图片比例与视频模型是否真的被调用。
 * 不进 gate（会消耗图片/视频额度），发版前或夜间手动跑：
 *   node scripts/live-media-smoke.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

function pngSize(file) {
  const data = fs.readFileSync(file)
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') return null
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function pollDraft(win, type, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await win.evaluate(async () => await window.jco.drafts.get())
    const items = (last && last.data && last.data.items) || []
    const item = items.find((draft) => {
      if (draft.type !== type) return false
      if (type === 'image') return Array.isArray(draft.images) && draft.images.some((image) => image.path)
      return Array.isArray(draft.shots) && draft.shots.length > 0
    })
    if (item) return item
    await sleep(1000)
  }
  throw new Error(`${type} 没有落盘：` + JSON.stringify(last || {}).slice(0, 1200))
}

const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
const errors = []
const videoOnly = process.argv.includes('--video-only')
const imageOnly = process.argv.includes('--image-only')
try {
  const win = await app.firstWindow()
  win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 300)))
  await win.waitForTimeout(2600)
  await win.evaluate(() => {
    window.location.href = 'J.Co工作台-做视频.html'
  })
  await win.waitForTimeout(1600)
  await win.evaluate(async () => {
    await window.jco.drafts.save({ items: [] })
    await window.jco.materials.save({ items: [] })
  })
  await win.reload()
  await win.waitForTimeout(1200)

  if (!videoOnly) {
    // 1) 做图：用户选 1 张、3:4、2K，保存后应仍是 3:4。
    await win.locator('#agentTabs button[data-t="image"]').click()
    await win.locator('.param[data-param="dur"] .param-chip').click()
    await win.locator('#segDur button', { hasText: '1 张' }).click()
    await win.locator('.param[data-param="ratio"] .param-chip').click()
    await win.locator('#segRatio button', { hasText: '3:4' }).click()
    await win.locator('.param[data-param="res"] .param-chip').click()
    await win.locator('#segRes button', { hasText: '2K' }).click()
    await win.locator('#askInp').fill('一张竖版人像测试图，浅灰背景，构图简洁，无文字')
    await win.locator('#goBtn').click()
    await sleep(1200)
    if ((await win.locator('.dcard').count()) === 0) await win.locator('#goBtn').click()

    const imageItem = await pollDraft(win, 'image', 180000)
    const image = imageItem.images.find((item) => item.path)
    const dims = pngSize(image.path)
    if (!dims || Math.abs(dims.width / dims.height - 3 / 4) >= 0.01 || dims.width < 1536) {
      throw new Error(`图片比例不对：${image.path} ${JSON.stringify(dims)}`)
    }
    console.log(JSON.stringify({ kind: 'image', path: image.path, ...dims, ratio: '3:4' }))

    await win.evaluate(async () => {
      await window.jco.drafts.save({ items: [] })
    })
    await win.reload()
    await win.waitForTimeout(1600)
  }

  if (!imageOnly) {
    // 2) 做视频：注入一条已过文本分镜阶段的 1 段草稿，只验证视频模型本身。
    // 文本分镜的 1 段解析由 E2E 覆盖，避免这里依赖文本模型波动。
    await win.evaluate(async () => {
      await window.jco.drafts.save({
        items: [
          {
            id: 9901,
            idea: '5 秒视频模型测试',
            status: 'review',
            type: 'video',
            ratio: '9:16',
            duration: '5 秒',
            res: '720P',
            voice: '标准女声',
            method: 'assemble',
            shots: [{ line: '蓝色背景上出现一个白色圆点，镜头缓慢推近', pic: '蓝色背景，白色圆点，镜头缓慢推近' }],
            videos: {},
            images: [],
          },
        ],
      })
    })
    await win.reload()
    await win.waitForTimeout(1600)
    const videoDraft = await pollDraft(win, 'video', 30000)

    await win.locator('.dcard').first().click()
    await win.locator('.shot-bar .go-btn').click()
    const deadline = Date.now() + 660000
    let videoItem = videoDraft
    while (Date.now() < deadline) {
      videoItem = await win.evaluate(async () => {
        const data = await window.jco.drafts.get()
        return (data.data.items || []).find((item) => item.type === 'video')
      })
      const videos = Object.values((videoItem && videoItem.videos) || {})
      if (videos.some((video) => video && (video.status === 'done' || video.status === 'failed'))) break
      await sleep(2000)
    }
    const video = Object.values(videoItem.videos || {}).find(
      (item) => item && (item.status === 'done' || item.status === 'failed'),
    )
    console.log(
      JSON.stringify({ kind: 'video', status: video?.status, path: video?.path || '', error: video?.error || '' }),
    )
    if (!video || video.status !== 'done' || !video.url) {
      throw new Error(`视频模型没有产出成片：${video?.error || '无详情'}`)
    }
  }
  if (errors.length > 0) throw new Error(`页面 JS 错误：${errors.join(' | ')}`)
} finally {
  await sleep(200)
  await app.close()
}
