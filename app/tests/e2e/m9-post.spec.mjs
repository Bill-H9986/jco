// M9 后期（AI 代劳）：页面结构 / 空态 / 快捷指令 / 无选中拦截 / 派活管道就位
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('后期页（AI 剪辑间）：空态 / 快捷指令填充 / 未选片拦截 / 派活走唯一管道', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-后期.html'
    })
    await win.waitForTimeout(1500)

    // 结构就位
    await expect(win.locator('#assetList')).toBeVisible()
    await expect(win.locator('#askInp')).toBeVisible()
    await expect(win.locator('#askGo')).toBeVisible()
    await expect(win.locator('#recent')).toBeVisible()
    // 测试 profile 成片目录为空 → 空态文案
    await expect(win.locator('#assetList')).toContainText('成片目录还是空的')

    // 快捷指令填充输入框
    await win.locator('.chip', { hasText: '加字幕' }).click()
    const filled = await win.locator('#askInp').inputValue()
    expect(filled).toContain('字幕')

    // 未选片就点「让 AI 动手」→ 拦截并提示
    await win.locator('#askGo').click()
    await win.waitForTimeout(300)
    await expect(win.locator('#toast')).toContainText('先在左边选一条成片')

    // 派活管道就位（源码级：走 TaskService propose/confirm；无旧 dispatch 残留）
    const pageSrc = await win.evaluate(() => [...document.scripts].map((s) => s.textContent || '').join('\n'))
    expect(pageSrc).toContain('tasks.propose')
    expect(pageSrc).toContain('tasks.confirm')
    expect(pageSrc).not.toContain('tasks.dispatch')
    expect(pageSrc).not.toContain('renderTracks') // 旧手动剪辑台逻辑已退休
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
