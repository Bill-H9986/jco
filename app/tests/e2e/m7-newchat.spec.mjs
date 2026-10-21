// M7 全站统一回归：「新会话」按钮在非总管页也位于搜索框正下方（常驻、收起态可用、点击跳总管开新会话）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('「新会话」按钮：非总管页也在搜索框下方（零数据环境常驻；点击=跳总管开新会话）', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    // 抽查 3 页（新环境：localStorage 无会话数据 → 验证"按钮常驻"）
    for (const page of ['J.Co工作台-发布.html', 'J.Co主界面-首页.html', 'J.Co设置.html']) {
      await win.evaluate((p) => {
        window.location.href = p
      }, page)
      const btn = win.locator('#newChatSlot .convo.new-btn')
      await expect(btn, page + ' 的按钮应在顶部容器里').toBeVisible()
      const afterSearch = await win.evaluate(() => {
        const slot = document.getElementById('newChatSlot')
        const search = document.querySelector('.search')
        return !!(slot && search && search.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING)
      })
      expect(afterSearch, page + ' 的按钮应在搜索框之后').toBe(true)
      expect(await win.locator('.convos .convo.new-btn').count(), page + ' 列表内不应再有按钮').toBe(0)
    }
    // 收起态：图标方块（宽度明显小于展开态）
    const box = await win.locator('#newChatSlot .convo.new-btn').boundingBox()
    expect(box.width, '收起态应为图标方块').toBeLessThan(100)
    const collapsedTextWidth = await win.locator('#newChatSlot .convo.new-btn').evaluate((button) => {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
      let textWidth = 0
      let node = walker.nextNode()
      while (node) {
        if (!node.parentElement?.closest('.ti')) {
          const range = document.createRange()
          range.selectNodeContents(node)
          textWidth += range.getBoundingClientRect().width
        }
        node = walker.nextNode()
      }
      return textWidth
    })
    expect(collapsedTextWidth, '收起态图标方块内不能透出“新会话”文字').toBe(0)
    const sidebarOverflow = await win.locator('.side-scroll').evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        overflowX: style.overflowX,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      }
    })
    expect(sidebarOverflow.overflowX, '收起态侧栏不能显示横向滚动条').toBe('hidden')
    expect(sidebarOverflow.scrollWidth, '收起态侧栏内容不能横向溢出').toBeLessThanOrEqual(
      sidebarOverflow.clientWidth + 1,
    )

    // 点击（发布页）→ 跳总管并开新会话
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-发布.html'
    })
    await win.waitForTimeout(1100)
    await win.locator('#newChatSlot .convo.new-btn').click()
    await win.waitForTimeout(1600)
    expect(decodeURIComponent(win.url()), '点击后应跳总管').toContain('总管')
    // 总管页应已就绪（新会话上下文 = 聊天输入区可用；新环境首个空会话会被复用，不重复落盘属正确行为）
    await expect(win.locator('#inp')).toBeVisible()
    await expect(win.locator('#newChatSlot .convo.new-btn')).toBeVisible()
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
