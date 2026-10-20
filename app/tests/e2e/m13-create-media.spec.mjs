// M13：创作页素材选择回传、素材卡 3:4、空图片过滤、未出片审批门。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const FIXTURE = path.join(APP_DIR, 'tests', 'visual', 'baseline', 'materials-light-1440x900.png')

test('创作素材：3:4 选择回传 / 图片占位清理 / 未出片不能通过', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  let win = null
  try {
    win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2600)

    const name = '竖版人像素材.png'
    const saved = await win.evaluate(
      async ({ file, label }) => {
        return await window.jco.materials.save({
          items: [
            {
              cat: 'mine',
              type: 'photo',
              name: label,
              src: '导入 · 本机文件',
              imported: true,
              path: file,
            },
          ],
        })
      },
      { file: FIXTURE.replace(/\\/g, '/'), label: name },
    )
    expect(saved.ok).toBe(true)

    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-素材.html?pick=1&return=J.Co工作台-做视频.html'
    })
    await win.waitForTimeout(1400)

    const card = win.locator('#grid .mat').first()
    await expect(card).toBeVisible()
    const box = await card.locator('.ph').boundingBox()
    expect(box).not.toBeNull()
    expect(Math.abs(box.width / box.height - 3 / 4)).toBeLessThan(0.03)

    await card.click()
    await expect(card).toHaveClass(/picked/)
    await expect(win.locator('#pickCount')).toContainText('已选 1 件')
    await expect(win.locator('#pickDone')).toBeEnabled()
    await win.locator('#pickDone').click()
    await win.waitForTimeout(1500)

    expect(decodeURIComponent(win.url())).toContain('做视频')
    await expect(win.locator('#pickedBar')).toBeVisible()
    await expect(win.locator('#pickedList')).toContainText(name)

    const oneShot = await win.evaluate(() => window.parseShots('{"line":"只有一段","pic":"蓝色背景"}'))
    expect(oneShot).toEqual([{ line: '只有一段', pic: '蓝色背景' }])

    const videoDraft = {
      id: 8801,
      idea: '未出片的视频草稿',
      status: 'review',
      type: 'video',
      ratio: '9:16',
      duration: '30 秒',
      res: '720P',
      voice: '标准女声',
      method: 'assemble',
      shots: [
        { line: '第一段', pic: '画面A' },
        { line: '第二段', pic: '画面B' },
      ],
      videos: {},
      images: [],
    }
    const imageDraft = {
      id: 8802,
      idea: '含空占位的图片草稿',
      status: 'review',
      type: 'image',
      ratio: '3:4',
      duration: '3 张',
      res: '1K',
      voice: '标准女声',
      method: 'assemble',
      shots: [],
      videos: {},
      images: [
        { src: `file:///${FIXTURE.replace(/\\/g, '/')}`, path: FIXTURE, prompt: '有效图片' },
        { src: '', path: '', prompt: '旧版大图未入草稿' },
      ],
    }
    const draftsSaved = await win.evaluate(
      async ({ video, image }) => await window.jco.drafts.save({ items: [video, image] }),
      { video: videoDraft, image: imageDraft },
    )
    expect(draftsSaved.ok).toBe(true)

    await win.reload()
    await win.waitForTimeout(1600)
    await win.locator('.dcard', { hasText: '未出片的视频草稿' }).click()
    await win.locator('#approveBtn').click()
    await expect(win.locator('#toast')).toContainText('没出片')
    const status = await win.evaluate(async () => {
      const data = await window.jco.drafts.get()
      return data.data.items.find((item) => item.id === 8801)?.status || ''
    })
    expect(status).toBe('review')

    await win.locator('.dcard', { hasText: '含空占位的图片草稿' }).click()
    await expect(win.locator('#ibCount')).toContainText('1 / 1')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    if (win) {
      try {
        await win.evaluate(async () => {
          await window.jco.materials.save({ items: [] })
        })
      } catch {}
      try {
        await win.evaluate(async () => {
          await window.jco.drafts.save({ items: [] })
        })
      } catch {}
    }
    await app.close()
  }
})
