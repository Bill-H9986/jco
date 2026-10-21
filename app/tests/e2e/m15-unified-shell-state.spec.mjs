// M15：全站页头、开关、焦点规格统一；切页复用 iframe，工作态不丢。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

async function activeFrame(win) {
  const href = await win.evaluate(() => {
    const node = document.querySelector('#jcoFrame')
    return node ? new URL(node.getAttribute('src'), location.href).href : ''
  })
  return win.frames().find((frame) => frame.url() === href)
}

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  await expect
    .poll(
      async () => {
        const frame = await activeFrame(win)
        return frame ? decodeURIComponent(frame.url()) : ''
      },
      { timeout: 8000 },
    )
    .toContain(page)
  const frame = await activeFrame(win)
  await expect(frame.locator('html')).toHaveAttribute('data-jco-ready', '1', { timeout: 5000 })
  return frame
}

test('M15：页头固定、参数单行、开关同规格、焦点收敛', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1440, height: 900 })
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2400)

    const topics = await openPage(win, 'J.Co工作台-选题.html')
    const headBefore = await topics.locator('.wrap > .page-head').evaluate((head) => {
      const title = head.querySelector('h1')
      return {
        boxTop: Math.round(head.getBoundingClientRect().top),
        titleTop: Math.round(title.getBoundingClientRect().top),
        titleLeft: Math.round(title.getBoundingClientRect().left),
        titleSize: getComputedStyle(title).fontSize,
      }
    })
    expect(headBefore).toEqual({ boxTop: 0, titleTop: 36, titleLeft: 32, titleSize: '22px' })
    await topics.locator('.scroll').evaluate((node) => {
      node.scrollTop = 520
    })
    await win.waitForTimeout(120)
    const headAfter = await topics.locator('.wrap > .page-head').evaluate((head) => {
      const title = head.querySelector('h1')
      return {
        boxTop: Math.round(head.getBoundingClientRect().top),
        titleTop: Math.round(title.getBoundingClientRect().top),
      }
    })
    expect(headAfter).toEqual({ boxTop: 0, titleTop: 36 })

    const video = await openPage(win, 'J.Co工作台-做视频.html')
    await expect(video.locator('#askInp')).toBeVisible()
    const params = await video.locator('.ask-bar .ask-params').evaluate((node) => {
      const chips = [...node.querySelectorAll('.param-chip')].map((chip) => chip.getBoundingClientRect())
      const tools = node.parentElement.querySelector('.left').getBoundingClientRect()
      return {
        sameRow: chips.every((rect) => Math.abs(rect.top - chips[0].top) < 1),
        belowTools: chips[0].top >= tools.top,
        chipCount: chips.length,
      }
    })
    expect(params).toEqual({ sameRow: true, belowTools: true, chipCount: 5 })

    const switches = []
    for (const page of ['J.Co设置.html', 'J.Co自动任务.html', 'J.Co技能库.html']) {
      const frame = await openPage(win, page)
      await expect(frame.locator('.tg').first()).toBeVisible()
      switches.push(
        await frame
          .locator('.tg')
          .first()
          .evaluate((node) => {
            const box = node.getBoundingClientRect()
            const knob = getComputedStyle(node, '::after')
            return {
              width: Math.round(box.width),
              height: Math.round(box.height),
              knobWidth: knob.width,
              knobHeight: knob.height,
              role: node.getAttribute('role'),
            }
          }),
      )
    }
    for (const item of switches) {
      expect(item).toEqual({ width: 44, height: 26, knobWidth: '22px', knobHeight: '22px', role: 'switch' })
    }

    await win.evaluate(() => window.__jcoGo('J.Co工作台-选题.html'))
    const focusRing = await win.evaluate(() => {
      const item = document.querySelector('.nav-item')
      item.focus()
      const style = getComputedStyle(item)
      return { width: style.outlineWidth, offset: style.outlineOffset }
    })
    // 1.5 CSS px 在 1x 屏会被 Chromium 量化到 1 个物理像素；下限按可感知发丝焦点圈判断。
    expect(Number.parseFloat(focusRing.width)).toBeGreaterThanOrEqual(1)
    expect(Number.parseFloat(focusRing.width)).toBeLessThanOrEqual(1.5)
    expect(Number.parseFloat(focusRing.offset)).toBeGreaterThanOrEqual(-1.5)
    expect(Number.parseFloat(focusRing.offset)).toBeLessThan(0)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('M15：跨页复访复用页面，输入、滚动草稿与工作标记都保留', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)

    let frame = await openPage(win, 'J.Co工作台-选题.html')
    await frame.locator('#selfInp').fill('切换页面后还要在')
    await frame.evaluate(() => {
      window.__jcoCacheMarker = 'keep-me'
    })
    await win.waitForTimeout(350)

    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await expect
      .poll(async () => decodeURIComponent((await activeFrame(win))?.url() || ''))
      .toContain('J.Co主界面-首页.html')
    await win.evaluate(() => window.__jcoGo('J.Co工作台-选题.html'))
    frame = await activeFrame(win)
    await expect(frame.locator('#selfInp')).toHaveValue('切换页面后还要在')
    const preserved = await frame.evaluate(() => ({
      marker: window.__jcoCacheMarker,
    }))
    expect(preserved.marker).toBe('keep-me')

    const settings = await openPage(win, 'J.Co设置.html')
    await settings.locator('.scroll').evaluate((node) => {
      node.scrollTop = 420
    })
    await win.waitForTimeout(350)
    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await win.evaluate(() => window.__jcoGo('J.Co设置.html'))
    const settingsAgain = await activeFrame(win)
    await expect.poll(() => settingsAgain.locator('.scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(300)

    const stats = await win.evaluate(() => window.__jcoFrameStats)
    expect(stats.loads).toBe(2)
    expect(stats.cacheHits).toBeGreaterThan(0)
    expect(stats.lastSwitchMs).toBeLessThan(400)

    await win.reload()
    await win.waitForTimeout(1800)
    frame = await openPage(win, 'J.Co工作台-选题.html')
    await expect(frame.locator('#selfInp')).toHaveValue('切换页面后还要在', { timeout: 5000 })
  } finally {
    await app.close()
  }
})

test('M15：选题、素材、创作、总管的工作草稿在切换后都保留', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    const drafts = [
      ['J.Co工作台-选题.html', '#selfInp', '选题草稿不能丢'],
      ['J.Co工作台-素材.html', '#aiInp', '素材草稿不能丢'],
      ['J.Co工作台-做视频.html', '#askInp', '创作草稿不能丢'],
      ['J.Co总管.html', '#inp', '总管草稿不能丢'],
    ]

    for (const [page, selector, value] of drafts) {
      const frame = await openPage(win, page)
      await frame.locator(selector).fill(value)
    }
    for (const [page, selector, value] of drafts) {
      const frame = await openPage(win, page)
      await expect(frame.locator(selector)).toHaveValue(value)
    }
  } finally {
    await app.close()
  }
})
