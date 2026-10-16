// M9 单元②：做视频页补全回归——成片连播 / 「按我说的改」真闭环 / 重出按钮 / 手头素材行真数据。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('做视频页：成片连播 / 按我说的改（fixNote）/ 重出按钮 / 手头素材行', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-script-v1',
        JSON.stringify({ topic: '测试主题', lines: ['一', '二', '三'], xhs: false, t: Date.now() }),
      )
      localStorage.setItem(
        'jco-drafts-v1',
        JSON.stringify({
          items: [
            {
              id: 91,
              idea: '测试草稿',
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
          ],
        }),
      )
    })
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-做视频.html'
    })
    await win.waitForTimeout(1500)

    // 手头素材行：真数据
    await expect(win.locator('#handyLine')).toContainText('稿子 3 句')

    // 打开草稿 → 播放整片 → 分段连播弹层
    await win.locator('.dcard').first().click()
    await expect(win.locator('#done.show')).toBeVisible()
    await win.locator('#donePhone').click()
    await expect(win.locator('#videoPop')).toBeVisible()
    await expect(win.locator('#vpTitle')).toContainText('整片 · 分段连播（1/2')
    await win.locator('#vpClose').click()
    await expect(win.locator('#videoPop')).toBeHidden()

    // 「重出」按钮出现在已出片的段上
    await expect(win.locator('.shot .make', { hasText: '重出' }).first()).toBeVisible()

    // 「按我说的改」：记入 fixNote 并持久化
    await win.locator('#fixInp').fill('配音换男声')
    await win.locator('button:has-text("按我说的改")').click()
    await win.waitForTimeout(300)
    const toast = await win.locator('#toast').textContent()
    expect(toast).toContain('记下了')
    const saved = await win.evaluate(() => JSON.parse(localStorage.getItem('jco-drafts-v1') || '{}'))
    expect(saved.items[0].fixNote).toBe('配音换男声')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
