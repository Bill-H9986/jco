// 发布页 AI 入口（W3-01：Task + Approval）：入口按钮与状态文案就位
// （不点击——点击会真派活、真调模型；点击链路的消费端见 m9e-taskbridge，真机链路由 qa 脚本验证）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('发布页：让 AI 准备抖音发布入口就位（存在性与文案）', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    // 发布页只认账号中心的真实登记；测试先登记抖音，避免旧硬编码假登录态。
    await win.evaluate(() => {
      localStorage.setItem('jco-login-v1', JSON.stringify({ dy: { ok: true, at: Date.now() } }))
    })
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-发布.html'
    })
    await win.waitForTimeout(1000)

    const btn = win.locator('#aiDyBtn')
    await expect(btn).toBeVisible()
    await expect(btn).toContainText('让 AI 准备「抖音」发布')
    await expect(win.locator('#aiDyState')).toHaveText(/待命|桌面应用内可用/)
    await expect(win.locator('#platforms .pf', { hasText: '抖音' })).toContainText('已登记')
    await expect(win.locator('#platforms .pf', { hasText: 'B站' })).toContainText('未登录')
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

test('首页：卡片文案真化（无假数）+ 发送改为新会话', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(3000)
    // 启动页现在是应用壳：显式跳到首页（直开模式）再断言
    await win.evaluate(() => {
      window.location.href = 'J.Co主界面-首页.html'
    })
    await win.waitForTimeout(1800)
    const text = await win.evaluate(() => document.body.innerText)
    expect(text.includes('2 条视频已就绪')).toBe(false)
    expect(text.includes('抖音和视频号')).toBe(false) // 入口区文案统一：不再有多平台旧承诺
    expect(text.includes('大约 2 分钟')).toBe(false) // 不再有时长承诺
    expect(text).toContain('把做好的视频发出去')
    // W1-01：首页发送改为新会话，不再直接派活
    const homeSrc = await win.evaluate(() => [...document.scripts].map((s) => s.textContent || '').join('\n'))
    expect(homeSrc.includes('jco-handoff')).toBe(false)
    expect(homeSrc.includes('tasks.dispatch')).toBe(false)
    expect(homeSrc.includes('__jcoStartChat') || homeSrc.includes('new=1&seed=')).toBe(true)
    // 空态时：通知条点击 → 填入输入框（fillAndFocus 动线；有记录后会变为"跳总管"）
    await win.locator('.notice').click()
    await win.waitForTimeout(300)
    const inpVal = await win.locator('#inp').inputValue()
    expect(inpVal.length).toBeGreaterThan(0)
    // 批 5 收编：「件活」统计可见（预置一条今天完成的"任务"动态 + 一条写稿动态）
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-log-v1',
        JSON.stringify({
          items: [
            { t: Date.now(), kind: 'task', title: '任务「测试」跑完了', detail: '好' },
            { t: Date.now(), kind: 'create', title: '口播稿', detail: '' },
          ],
        }),
      )
    })
    await win.reload()
    await win.waitForTimeout(1600)
    const text2 = await win.evaluate(() => document.body.innerText)
    expect(text2).toContain('今天已经干了')
    expect(text2).toContain('件活')
    expect(text2).toContain('篇稿')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
