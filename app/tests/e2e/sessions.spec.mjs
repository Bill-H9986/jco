// 总管页会话列表动线（M0 冒烟网 · 动线 3）
// 防回归：连点「新会话」必须复用、不堆积（曾出现越点越多的问题）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('总管页：连点「新会话」不堆积（空会话 ≤ 1）', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co总管.html'
    })
    await win.waitForTimeout(1200)

    // 侧栏默认收起（图标条），先点「固定展开」让会话列表可操作
    await win.locator('.side-toggle').click()
    await win.waitForTimeout(400)

    const newBtn = win.locator('.convos .convo.new-btn')
    await newBtn.waitFor()
    await newBtn.click()
    await win.waitForTimeout(120)
    await newBtn.click()
    await win.waitForTimeout(120)
    await newBtn.click()
    await win.waitForTimeout(600)

    const names = await win.locator('.convos .convo .name').allInnerTexts()
    const empties = names.filter((t) => t.trim() === '新会话').length
    expect(empties, `空会话数量（应 ≤1）：${JSON.stringify(names)}`).toBeLessThanOrEqual(1)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
