// M17：无人干预的 UI 探索与状态随机游走。
// 只操作本地、安全、可逆的 tab / 分段选择器；不触发模型、发布、删除、支付或外部登录。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { PAGES } from '../pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const CONTENT_PAGES = PAGES.filter((page) => page !== 'J.Co设计系统.html')

function randomSource(seed) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0x100000000
  }
}

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
    .poll(async () => decodeURIComponent((await activeFrame(win))?.url() || ''), {
      message: `页面未打开：${page}`,
      timeout: 15000,
    })
    .toContain(page)
  const frame = await activeFrame(win)
  await expect(frame.locator('html')).toHaveAttribute('data-jco-ready', '1')
  return frame
}

async function auditActivePage(frame, pageName, errors) {
  const audit = await frame.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(visible)
    const unnamed = buttons.filter((el) => {
      const name = String(el.getAttribute('aria-label') || el.innerText || '').trim()
      return !name
    }).length
    const tooSmall = buttons.filter((el) => {
      if (el.matches('.tab, .linkbtn, .notice, .convo-more')) return false
      const rect = el.getBoundingClientRect()
      return rect.width < 24 || rect.height < 24
    }).length
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
    const scroller = document.querySelector('.scroll') || document.querySelector('main')
    const overflow = scroller ? scroller.scrollWidth > scroller.clientWidth + 2 : false
    return { buttons: buttons.length, unnamed, tooSmall, duplicateIds, overflow }
  })

  expect(audit.unnamed, `${pageName}: 存在无可访问名称的按钮`).toBe(0)
  expect(audit.tooSmall, `${pageName}: 存在小于 24px 的操作控件`).toBe(0)
  expect(audit.duplicateIds, `${pageName}: 存在重复 ID`).toEqual([])
  expect(audit.overflow, `${pageName}: 出现横向溢出`).toBe(false)
  expect(errors, `${pageName}: 页面 JS 错误\n${errors.join('\n')}`).toEqual([])
}

test('M17：安全控件自动探索，15 页无 JS 错误、无重复 ID、无溢出', async () => {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_MEDIA_FAKE: '1' },
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
    await win.waitForTimeout(2400)

    for (const pageName of PAGES) {
      const frame = await openPage(win, pageName)
      if (pageName !== 'J.Co设计系统.html') {
        const tabs = frame.locator('.tab:not([disabled])')
        const tabCount = Math.min(await tabs.count(), 8)
        for (let index = 0; index < tabCount; index += 1) {
          await tabs.nth(index).click()
          await win.waitForTimeout(40)
        }

        const segments = frame.locator('.seg button:not([disabled])')
        const segmentCount = Math.min(await segments.count(), 8)
        for (let index = 0; index < segmentCount; index += 1) {
          if (await segments.nth(index).isVisible()) {
            await segments.nth(index).click()
            await win.waitForTimeout(40)
          }
        }
      }
      await auditActivePage(frame, pageName, errors)
    }
  } finally {
    await app.close()
  }
})

test('M17：固定种子随机导航 48 次，页面缓存不泄漏、状态不崩溃', async () => {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_MEDIA_FAKE: '1' },
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error).slice(0, 240)))
    await win.waitForTimeout(2400)
    const random = randomSource(0x4a434f26)

    for (let index = 0; index < 48; index += 1) {
      const pageName = CONTENT_PAGES[Math.floor(random() * CONTENT_PAGES.length)]
      const frame = await openPage(win, pageName)
      await expect(frame.locator('html')).toHaveAttribute('data-jco-ready', '1')
      const state = await frame.evaluate(() => ({
        bodyText: document.body.innerText.trim().length,
        title: document.title,
      }))
      expect(state.bodyText, `第 ${index + 1} 次导航后正文为空：${pageName}`).toBeGreaterThan(0)
      expect(state.title, `第 ${index + 1} 次导航后标题为空：${pageName}`).not.toBe('')
      expect(errors, `第 ${index + 1} 次导航后出现 JS 错误\n${errors.join('\n')}`).toEqual([])
    }

    const stats = await win.evaluate(() => ({
      frames: document.querySelectorAll('.jco-frame').length,
      cache: window.__jcoFrameStats,
    }))
    expect(stats.frames).toBeLessThanOrEqual(16)
    expect(stats.cache.loads).toBeLessThanOrEqual(16)
  } finally {
    await app.close()
  }
})

test('M17：损坏的页面草稿不会阻止应用启动或页面恢复', async () => {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_MEDIA_FAKE: '1' },
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
    await win.waitForTimeout(2400)

    await win.evaluate(() => {
      localStorage.setItem('jco-page-state-v1:J.Co工作台-选题.html', '{"broken":')
      localStorage.setItem('jco-page-state-v1:J.Co工作台-素材.html', 'null')
    })
    await win.reload()
    await win.waitForTimeout(1800)

    const frame = await openPage(win, 'J.Co工作台-选题.html')
    await expect(frame.locator('#selfInp')).toBeVisible()
    const state = await frame.evaluate(() => ({
      bodyText: document.body.innerText.trim().length,
      title: document.title,
      value: document.querySelector('#selfInp')?.value || '',
    }))
    expect(state.bodyText).toBeGreaterThan(0)
    expect(state.title).toContain('选题')
    expect(state.value).toBe('')
    expect(errors, `损坏草稿触发 JS 错误\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
