// M9 单元③：素材页真化回归——空库横幅 / 真数据渲染 / 分类过滤 / 预览 / AI 方案卡说明。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('素材页：空库真横幅 / 注入后渲染与过滤 / 预览 / 方案卡说明', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)

    // 空库用例自己准备空库，不依赖前序测试的清理顺序。
    await win.evaluate(async () => {
      await window.jco.materials.save({ items: [] })
      localStorage.removeItem('jco-materials-v1')
    })

    // 空库（新环境）：横幅与网格都如实
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-素材.html'
    })
    await win.waitForTimeout(1200)
    await expect(win.locator('#boxLine')).toContainText('素材箱还空着')
    await expect(win.locator('#grid .empty')).toBeVisible()

    // 注入真素材（1 导入 + 1 AI 方案）→ 渲染 / 横幅 / 过滤 / 交互
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-materials-v1',
        JSON.stringify({
          items: [
            { cat: 'idea', type: 'star', name: '教室上课画面方案', src: 'AI 找的 · 课间抓拍，正面机位', badge: 'AI' },
            {
              cat: 'mine',
              type: 'video',
              name: '导入样片.mp4',
              src: '导入 · 本机文件',
              imported: true,
              path: 'C:/nonexistent/导入样片.mp4',
            },
          ],
        }),
      )
    })
    await win.reload()
    await win.waitForTimeout(1300)
    await expect(win.locator('#grid .mat')).toHaveCount(2)
    await expect(win.locator('#boxLine')).toContainText('你导入的素材 1 件')
    await expect(win.locator('#boxLine')).toContainText('AI 找的画面方案 1 条')

    // 分类过滤
    await win.locator('.tab[data-f="mine"]').click()
    await expect(win.locator('#grid .mat')).toHaveCount(1)
    await expect(win.locator('#grid .mat .nm')).toContainText('导入样片')
    await win.locator('.tab[data-f="idea"]').click()
    await expect(win.locator('#grid .mat')).toHaveCount(1)
    await expect(win.locator('#grid .mat .nm')).toContainText('教室上课画面方案')

    // AI 方案卡点击：如实显示方案说明（不再假装"做视频时带上"）
    await win.locator('#grid .mat').first().click()
    await win.waitForTimeout(250)
    const toast = await win.locator('#toast').textContent()
    expect(toast).toContain('课间抓拍，正面机位')

    // 导入样片（带 path）：点击开预览（视频文件不存在也无妨，弹层与标题要出现）
    await win.locator('.tab[data-f="mine"]').click()
    await win.locator('#grid .mat').first().click()
    await expect(win.locator('#matPreview')).toBeVisible()
    await expect(win.locator('#mpName')).toContainText('导入样片')
    await win.locator('#mpClose').click()
    await expect(win.locator('#matPreview')).toBeHidden()
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    try {
      const win = await app.firstWindow()
      await win.evaluate(async () => {
        await window.jco.materials.save({ items: [] })
      })
    } catch {}
    await app.close()
  }
})
