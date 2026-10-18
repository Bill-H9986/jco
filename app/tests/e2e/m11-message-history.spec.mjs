// M11 W1-02：长消息完整回读、Markdown 排版、消息顺序与固定输入框。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

const LONG_MARKDOWN = [
  '**重点：这是一条超长回答。**',
  '',
  ...Array.from({ length: 260 }, (_, index) => `第 ${index + 1} 段：这段内容用来验证长消息不会被截断。`),
  '',
  '- 第一项：段落',
  '- 第二项：列表',
  '',
  '1. 第一步：读取',
  '2. 第二步：整理',
  '',
  '```js',
  'const answer = 42',
  '```',
  '',
  'LONG_MESSAGE_END',
].join('\n')

test('M11 W1-02：长消息完整落盘、Markdown 正确渲染、输入框固定底部', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(() => {
      window.location.href = 'J.Co总管.html'
    })
    await win.waitForTimeout(1200)
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-chats-v1',
        JSON.stringify({
          activeId: 'cmessage',
          chats: [{ id: 'cmessage', title: '长消息测试', updatedAt: Date.now(), messages: [] }],
        }),
      )
    })
    await win.reload()
    await win.waitForTimeout(1200)

    const storedLength = await win.evaluate((text) => {
      window.chatPush('ai', text)
      for (let index = 1; index <= 20; index += 1) {
        window.chatPush(index % 2 === 0 ? 'ai' : 'user', `消息 ${index}`)
      }
      const data = JSON.parse(localStorage.getItem('jco-chats-v1') || '{}')
      const chat = data.chats.find((item) => item.id === 'cmessage')
      return chat.messages[0].text.length
    }, LONG_MARKDOWN)
    expect(storedLength).toBe(LONG_MARKDOWN.length)

    await win.reload()
    await win.waitForTimeout(1200)
    const messages = win.locator('#stream .msg')
    await expect(messages).toHaveCount(21)
    await expect(win.locator('#stream .msg.ai .bubble').first()).toContainText('LONG_MESSAGE_END', {
      timeout: 10_000,
    })
    await expect(win.locator('#stream .msg').last()).toContainText('消息 20')
    await expect(win.locator('#stream .msg.ai .bubble ul li')).toHaveCount(2)
    await expect(win.locator('#stream .msg.ai .bubble ol li')).toHaveCount(2)
    await expect(win.locator('#stream .msg.ai .bubble pre code')).toContainText('const answer = 42')

    await win.setViewportSize({ width: 1280, height: 800 })
    await win.waitForTimeout(300)
    const inputBox = await win.locator('#inp').boundingBox()
    expect(inputBox).not.toBeNull()
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(801)
    expect(
      await win.evaluate(() => {
        const stream = document.getElementById('stream')
        return stream.scrollWidth <= stream.clientWidth + 1
      }),
    ).toBe(true)

    if (!(await win.evaluate(() => document.documentElement.classList.contains('side-pinned')))) {
      await win.locator('.side-toggle').click()
      await win.waitForTimeout(300)
    }
    await win.locator('.convo .convo-more').first().click()
    await win.locator('.convo-menu button', { hasText: '分享对话' }).click()
    await win.waitForTimeout(300)
    const toast = await win.locator('#toast').innerText()
    expect(toast.length).toBeGreaterThan(0)
    await win.screenshot({ path: path.join(APP_DIR, 'test-results', 'm11-w1-02-message.png') })
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
