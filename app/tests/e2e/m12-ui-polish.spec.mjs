// W7-01：侧栏顶部固定、下方列表独立滚动；内容页左上角统一到同一坐标。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('W7-01：侧栏顶部固定，内容页左上角统一', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1440, height: 900 })
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)

    const layout = await win.evaluate(() => {
      const fixed = document.querySelector('.side-fixed')
      const scroll = document.querySelector('.side-scroll')
      const inner = document.querySelector('.sidebar-inner')
      const primary = [...document.querySelectorAll('.side-fixed .nav-item')].map((item) => item.textContent.trim())
      return {
        hasFixed: !!fixed,
        hasScroll: !!scroll,
        innerOverflow: inner ? getComputedStyle(inner).overflowY : '',
        scrollOverflow: scroll ? getComputedStyle(scroll).overflowY : '',
        primary,
        topicInScroll: !!scroll?.querySelector('[data-page="J.Co工作台-选题.html"]'),
      }
    })
    expect(layout).toMatchObject({
      hasFixed: true,
      hasScroll: true,
      innerOverflow: 'hidden',
      scrollOverflow: 'auto',
      primary: ['首页', '总管'],
      topicInScroll: true,
    })

    const fixedBefore = await win.evaluate(() => ({
      top: document.querySelector('.side-top')?.getBoundingClientRect().top,
      nav: document.querySelector('.side-fixed .nav')?.getBoundingClientRect().top,
      foot: document.querySelector('.side-foot')?.getBoundingClientRect().top,
    }))
    const scrollTop = await win.evaluate(() => {
      const scroll = document.querySelector('.side-scroll')
      const filler = document.createElement('div')
      filler.id = '__w7_scroll_filler'
      filler.style.height = '900px'
      scroll.appendChild(filler)
      scroll.scrollTop = 320
      return scroll.scrollTop
    })
    expect(scrollTop).toBeGreaterThan(0)
    const fixedAfter = await win.evaluate(() => ({
      top: document.querySelector('.side-top')?.getBoundingClientRect().top,
      nav: document.querySelector('.side-fixed .nav')?.getBoundingClientRect().top,
      foot: document.querySelector('.side-foot')?.getBoundingClientRect().top,
    }))
    expect(fixedAfter).toEqual(fixedBefore)
    await win.evaluate(() => document.getElementById('__w7_scroll_filler')?.remove())

    const contentFrame = (target) =>
      win.frames().find((item) => {
        try {
          return decodeURIComponent(new URL(item.url()).pathname).endsWith(`/${target}`)
        } catch {
          return false
        }
      })

    const contentOrigin = async (target, selector) => {
      await win.evaluate((page) => window.__jcoGo(page), target)
      await expect
        .poll(
          () => {
            return !!contentFrame(target)
          },
          { message: `内容页未打开：${target}`, timeout: 8000 },
        )
        .toBe(true)
      const frame = contentFrame(target)
      await expect(frame.locator('html')).toHaveAttribute('data-jco-ready', '1', { timeout: 5000 })
      await frame.waitForTimeout(800)
      await expect
        .poll(() => frame.evaluate((query) => !!document.querySelector(query), selector), {
          message: `页面元素未出现：${target} ${selector}`,
          timeout: 5000,
        })
        .toBe(true)
      return frame.evaluate((query) => {
        const node = document.querySelector(query)
        const rect = node.getBoundingClientRect()
        return { x: Math.round(rect.x), y: Math.round(rect.y) }
      }, selector)
    }

    const video = await contentOrigin('J.Co工作台-做视频.html', '.wrap > .page-head h1')
    const topics = await contentOrigin('J.Co工作台-选题.html', '.wrap > .page-head h1')
    expect(video).toEqual({ x: 32, y: 36 })
    expect(topics).toEqual(video)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
