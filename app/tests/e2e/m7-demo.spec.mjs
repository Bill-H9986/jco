// M7 演示标记（诚实声明）：M9 收口后全站零演示页——任何产品页都不许出现"演示版"标。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('演示标记：全站零演示页（后期真化后清零），任何页都不许出现', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    // M9 收口完成：15 个产品页全部真化，逐一确认无"演示版"标
    for (const p of [
      'J.Co总管.html',
      'J.Co主界面-首页.html',
      'J.Co工作台-发布.html',
      'J.Co工作台-运营.html',
      'J.Co工作台-选题.html',
      'J.Co工作台-创作.html',
      'J.Co工作台-做视频.html',
      'J.Co工作台-素材.html',
      'J.Co工作台-后期.html',
      'J.Co技能库.html',
      'J.Co自动任务.html',
      'J.Co管家团队.html',
      'J.Co设置.html',
      'J.Co账号中心.html',
    ]) {
      await win.evaluate((x) => {
        window.location.href = x
      }, p)
      await expect(win.locator('.demo-note')).toHaveCount(0)
    }
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
