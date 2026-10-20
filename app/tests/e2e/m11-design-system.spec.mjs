// M11 W4-05：设计系统页必须展示产品页实际使用的共享组件。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ROOT = path.resolve(APP_DIR, '..')
const UI = path.join(ROOT, '设计原型')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('M11 W4-05：设计系统展示消息、任务卡、任务状态和员工状态', async () => {
  const css = fs.readFileSync(path.join(UI, 'assets', 'jco-ui.css'), 'utf8')
  const master = fs.readFileSync(path.join(UI, 'J.Co总管.html'), 'utf8')
  const shell = fs.readFileSync(path.join(UI, 'J.Co应用壳.html'), 'utf8')
  const team = fs.readFileSync(path.join(UI, 'J.Co管家团队.html'), 'utf8')

  expect(css).toContain('.msg.user .bubble')
  expect(css).toContain('.msg.ai .bubble')
  expect(css).toContain('.tv-status.waiting')
  expect(css).toContain('.s-badge.busy')
  expect(master).not.toMatch(/\n\.msg\.user\s*\{/)
  expect(shell).not.toMatch(/\n\s*\.tv-status\s*\{/)
  expect(team).not.toMatch(/\n\.s-badge\s*\{/)

  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(1800)
    await win.evaluate(() => {
      window.location.href = 'J.Co设计系统.html'
    })
    await win.waitForTimeout(800)

    await expect(win.locator('#dsMessages')).toBeVisible()
    await expect(win.locator('#dsMessages .msg.user .bubble')).toHaveText('把这条内容整理成发布任务')
    await expect(win.locator('#dsMessages .msg.ai .bubble')).toContainText('我先整理任务卡')
    await expect(win.locator('#dsMessages .msg-actions button')).toHaveCount(5)
    await expect(win.locator('#dsTaskCard .task-card')).toBeVisible()
    await expect(win.locator('#dsTaskCard .task-card-note')).toContainText('确认前不会创建 Task')
    await expect(win.locator('#dsTaskStates .tv-status.waiting')).toHaveText('等你确认')
    await expect(win.locator('#dsTaskStates .tv-status.done')).toHaveText('已完成')
    await expect(win.locator('#dsStaffStates .s-badge.busy')).toHaveText('在忙')
    await expect(win.locator('#dsStaffStates .s-badge.wait')).toHaveText('在等你')
    const stateRow = await win.locator('#dsTaskStates').boundingBox()
    const cancelledState = await win.locator('#dsTaskStates .tv-status.cancelled').boundingBox()
    expect(stateRow).not.toBeNull()
    expect(cancelledState).not.toBeNull()
    expect(cancelledState.x + cancelledState.width).toBeLessThanOrEqual(stateRow.x + stateRow.width + 0.5)

    const computed = await win.locator('#dsTaskCard .task-card').evaluate((el) => {
      const style = getComputedStyle(el)
      return { background: style.backgroundColor, radius: style.borderRadius, border: style.borderTopWidth }
    })
    expect(computed.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(computed.radius).toBe('16px')
    expect(parseFloat(computed.border)).toBeGreaterThan(0)
    expect(parseFloat(computed.border)).toBeLessThanOrEqual(0.67)
    const disabledOpacity = await win
      .locator('#dsTaskDisabled')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity))
    expect(disabledOpacity).toBeLessThan(1)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
