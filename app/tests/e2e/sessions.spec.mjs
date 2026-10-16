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
    // 清场：确保收起态（防任何旧 profile 残留的"固定展开"偏好影响本用例）
    await win.evaluate(() => {
      try {
        localStorage.removeItem('jco-side-pinned')
      } catch {}
    })
    await win.evaluate(() => {
      window.location.href = 'J.Co总管.html'
    })
    await win.waitForTimeout(1200)

    // 侧栏默认收起（图标条），先点「固定展开」让会话列表可操作
    await win.locator('.side-toggle').click()
    await win.waitForTimeout(400)

    const newBtn = win.locator('#newChatSlot .convo.new-btn')
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

test('总管页：侧栏收起态也能开新会话（图标按钮可用，展开态不回归）', async () => {
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
    // 预置一条有内容的旧会话（避免"空对空"探测不到切换）
    await win.evaluate(() => {
      try {
        localStorage.removeItem('jco-side-pinned') // 确保收起态（防旧 profile 残留干扰）
      } catch {}
      localStorage.setItem(
        'jco-chats-v1',
        JSON.stringify({
          activeId: 'cbase',
          chats: [
            {
              id: 'cbase',
              title: '老会话',
              updatedAt: Date.now(),
              messages: [{ role: 'user', text: '你好', t: Date.now() }],
            },
          ],
        }),
      )
    })
    await win.reload()
    await win.waitForTimeout(1000)

    const btn = win.locator('#newChatSlot .convo.new-btn')
    await btn.waitFor()
    // 收起态（默认未固定）：按钮可见、图标形态、可点
    await expect(btn).toBeVisible()
    const box = await btn.boundingBox()
    expect(box.width, '收起态应为图标方块').toBeLessThan(100)
    await btn.click()
    await win.waitForTimeout(400)
    const st = await win.evaluate(() => JSON.parse(localStorage.getItem('jco-chats-v1') || '{}'))
    expect(st.activeId, '点击后应切到新会话').not.toBe('cbase')
    expect((st.chats || []).filter((c) => c.messages.length === 0).length).toBeLessThanOrEqual(1)

    // 点「固定展开」：按钮变回全宽蓝胶囊（不回归）
    await win.locator('.side-toggle').click()
    await win.waitForTimeout(500)
    const box2 = await btn.boundingBox()
    expect(box2.width, '展开态应为全宽胶囊').toBeGreaterThan(150)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
