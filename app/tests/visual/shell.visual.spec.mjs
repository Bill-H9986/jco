// 视觉基准骨架：先证明 Electron 截图链路可运行；W1-02 再接入 toHaveScreenshot。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const OUT_DIR = path.join(APP_DIR, 'test-results', 'visual')

test('应用壳截图链路（浅色 1440×900）', async () => {
  test.skip(process.env.JCO_VISUAL !== '1', '设置 JCO_VISUAL=1 后运行视觉基准骨架')

  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    console.log('[visual] 已启动 Electron')
    const win = await app.firstWindow()
    await win.waitForTimeout(3200)
    expect(decodeURIComponent(win.url())).toContain('J.Co应用壳.html')
    await expect(win.locator('#jcoFrame')).toBeVisible()
    console.log('[visual] 应用壳已就绪')

    fs.mkdirSync(OUT_DIR, { recursive: true })
    const file = path.join(OUT_DIR, 'shell-light-1440x900.png')
    // 应用壳内是 iframe，Playwright 的 page.screenshot 会一直等 iframe 字体；
    // 用 Electron 自己的 capturePage 截图，避免把“字体等待”误判成测试失败。
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows()
      const target = wins.find((item) => item.isVisible()) || wins[0]
      if (!target) return ''
      const image = await target.capturePage()
      return image.toPNG().toString('base64')
    })
    if (!png) throw new Error('没有可截图的窗口')
    fs.writeFileSync(file, Buffer.from(png, 'base64'))
    console.log(`[visual] 截图：${file}`)

    // W1-02 接入基准后改为：
    // await expect(win).toHaveScreenshot('shell-light-1440x900.png', {
    //   animations: 'disabled',
    //   caret: 'hide',
    //   maxDiffPixelRatio: 0.01,
    // })
  } finally {
    await app.close()
  }
})
