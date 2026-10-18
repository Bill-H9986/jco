// M11 W2-04：草稿迁移到统一数据层；分镜、成片、图片草稿与 BrandProfile 回归。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const TEST_KERNEL_DIR = path.join(os.tmpdir(), 'jco-test-kernel-data')
const DRAFTS_FILE = path.join(TEST_KERNEL_DIR, 'drafts.json')
const BRAND_FILE = path.join(TEST_KERNEL_DIR, 'brand-profile.json')

test('M11 W2-04：旧草稿迁移、分镜/成片/图片可见、修改要求落统一层', async () => {
  fs.mkdirSync(TEST_KERNEL_DIR, { recursive: true })
  fs.rmSync(DRAFTS_FILE, { force: true })
  fs.writeFileSync(BRAND_FILE, JSON.stringify({ industry: '健身', audience: '上班族', tone: '直接' }), 'utf8')
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)

    await win.evaluate(() => {
      localStorage.setItem(
        'jco-drafts-v1',
        JSON.stringify({
          items: [
            {
              id: 91,
              idea: '测试分镜草稿',
              status: 'review',
              type: 'video',
              ratio: '9:16',
              duration: '30 秒',
              res: '1080P',
              voice: '标准女声',
              method: 'assemble',
              shots: [
                { line: '第一段', pic: '画面A' },
                { line: '第二段', pic: '画面B' },
                { line: '第三段', pic: '画面C' },
              ],
              videos: {
                0: { status: 'done', url: 'file:///nonexistent-a.mp4' },
                1: { status: 'done', url: 'file:///nonexistent-b.mp4' },
              },
              images: [],
            },
            {
              id: 92,
              idea: '测试配图草稿',
              status: 'review',
              type: 'image',
              ratio: '3:4',
              duration: '3 张',
              res: '2K',
              voice: '标准女声',
              method: 'assemble',
              shots: [],
              videos: {},
              images: [{ src: 'file:///C:/nonexistent/img.png', path: 'C:/nonexistent/img.png', prompt: '场景' }],
            },
          ],
        }),
      )
      window.location.href = 'J.Co工作台-做视频.html'
    })
    await win.waitForTimeout(1800)

    await expect(win.locator('.dcard')).toHaveCount(2)
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.drafts.get()).data.items.length), {
        timeout: 5000,
      })
      .toBe(2)
    await expect
      .poll(async () => await win.evaluate(() => window.shotSystemPrompt()), { timeout: 5000 })
      .toContain('健身')
    await expect
      .poll(async () => await win.evaluate(() => window.imageSystemPrompt()), { timeout: 5000 })
      .toContain('健身')

    // 分镜 → 成片：打开草稿看 3 段，播放已出好的分段。
    await win.locator('.dcard', { hasText: '测试分镜草稿' }).click()
    await expect(win.locator('#done.show')).toBeVisible()
    await expect(win.locator('#shots .shot')).toHaveCount(3)
    await win.locator('#donePhone').click()
    await expect(win.locator('#videoPop')).toBeVisible()
    await expect(win.locator('#vpTitle')).toContainText('分段连播（1/2')
    await win.locator('#vpClose').click()

    // 修改要求落统一层，旧 key 不再被新写入覆盖。
    await win.locator('#fixInp').fill('配音换男声')
    await win.locator('button:has-text("按我说的改")').click()
    await expect
      .poll(
        async () =>
          await win.evaluate(async () => {
            const data = await window.jco.drafts.get()
            return data.data.items.find((item) => item.id === 91)?.fixNote || ''
          }),
        { timeout: 5000 },
      )
      .toBe('配音换男声')
    const legacyFix = await win.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('jco-drafts-v1') || '{"items":[]}')
      return data.items.find((item) => item.id === 91)?.fixNote || ''
    })
    expect(legacyFix).toBe('')

    // 图片草稿：真实图片板能打开。
    await win.locator('.dcard', { hasText: '测试配图草稿' }).click()
    await expect(win.locator('#imgBoard')).toBeVisible()
    await expect(win.locator('#ibCount')).toContainText('1 / 1')

    // 刷新后仍由统一层恢复。
    await win.reload()
    await win.waitForTimeout(1500)
    await expect(win.locator('.dcard')).toHaveCount(2)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(DRAFTS_FILE, { force: true })
    fs.rmSync(BRAND_FILE, { force: true })
  }
})
