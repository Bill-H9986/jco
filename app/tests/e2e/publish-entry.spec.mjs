// 发布页 AI 入口（M7 批 1b：派活走任务管道）：入口按钮与状态文案就位
// （不点击——点击会真派活、真调模型；点击链路的消费端见 m9e-taskbridge，真机链路由 qa 脚本验证）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('发布页：让 AI 发到抖音入口就位（存在性与文案）', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-发布.html'
    })
    await win.waitForTimeout(1000)

    const btn = win.locator('#aiDyBtn')
    await expect(btn).toBeVisible()
    await expect(btn).toContainText('让 AI 发到「抖音」')
    await expect(win.locator('#aiDyState')).toHaveText(/待命|桌面应用内可用/)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('运营页：AI 运营入口就位（马上跑 / 取评论走唯一管道）', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-运营.html'
    })
    await win.waitForTimeout(1000)
    await expect(win.locator('#opsReportBtn')).toBeVisible()
    await expect(win.locator('#opsCommentsBtn')).toBeVisible()
    // 批 2：派活已走唯一管道（无 handoff 残留、走 tasks.dispatch）
    const opsSrc = await win.evaluate(() => [...document.scripts].map((s) => s.textContent || '').join('\n'))
    expect(opsSrc.includes('jco-handoff')).toBe(false)
    expect(opsSrc.includes('tasks.dispatch')).toBe(true)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('首页：卡片文案真化（无假数）+「说一句话」走唯一管道', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(3000)
    const text = await win.evaluate(() => document.body.innerText)
    expect(text.includes('2 条视频已就绪')).toBe(false)
    expect(text.includes('抖音和视频号')).toBe(false) // 入口区文案统一：不再有多平台旧承诺
    expect(text.includes('大约 2 分钟')).toBe(false) // 不再有时长承诺
    expect(text).toContain('把做好的视频发出去')
    // 批 3：派活已走唯一管道（无 handoff 残留、走 tasks.dispatch）
    const homeSrc = await win.evaluate(() => [...document.scripts].map((s) => s.textContent || '').join('\n'))
    expect(homeSrc.includes('jco-handoff')).toBe(false)
    expect(homeSrc.includes('tasks.dispatch')).toBe(true)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
