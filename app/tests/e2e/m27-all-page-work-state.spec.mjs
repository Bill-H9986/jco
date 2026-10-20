// M27：15 个内容页的普通工作态在切页返回与外壳重载后都必须恢复。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { PAGES } from '../pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const AWAY_PAGE = 'J.Co工作台-选题.html'
const WORK_PAGES = PAGES.filter((page) => page !== 'J.Co设计系统.html')

async function activeFrame(win) {
  const handle = await win.locator('#jcoFrame').elementHandle()
  return handle ? await handle.contentFrame() : null
}

async function activeInstance(win) {
  return await win.evaluate(() => document.querySelector('#jcoFrame')?.getAttribute('data-jco-instance') || '')
}

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  let found = null
  await expect
    .poll(
      async () => {
        const frame = await activeFrame(win)
        if (!frame || !decodeURIComponent(frame.url()).endsWith(`/${page}`)) return false
        try {
          const ready = await frame.evaluate(() => document.documentElement.getAttribute('data-jco-ready'))
          if (ready === '1') found = frame
          return ready === '1'
        } catch {
          return false
        }
      },
      { message: `页面未打开：${page}`, timeout: 10_000 },
    )
    .toBe(true)
  return found
}

async function preparePageState(frame, page, index) {
  return await frame.evaluate(
    ({ pageName, serial }) => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      }
      const editable = (el) => {
        if (el.disabled || el.readOnly || el.closest('[data-jco-no-persist]')) return false
        if (el.tagName === 'TEXTAREA') return true
        if (el.tagName !== 'INPUT') return false
        return ['text', 'search', 'url', 'number', 'email', 'tel'].includes(
          String(el.getAttribute('type') || 'text').toLowerCase(),
        )
      }
      const main = document.querySelector('main')
      if (!main) return { field: false, tab: false, scrollTop: 0 }

      const allFields = [...main.querySelectorAll('input, textarea')]
      const field = allFields.find((el) => visible(el) && editable(el) && !el.value)
      let value = ''
      let fieldOrdinal = -1
      if (field) {
        fieldOrdinal = allFields.indexOf(field)
        field.setAttribute('data-jco-probe-field', String(serial))
        value = `M27-${pageName}-${serial}-工作态`
        field.value = value
        field.dispatchEvent(new Event('input', { bubbles: true }))
      }

      let tab = false
      let tabActiveClass = ''
      for (const group of main.querySelectorAll('.tabs, .seg')) {
        const buttons = [...group.querySelectorAll('button:not([disabled])')].filter(visible)
        if (buttons.length < 2) continue
        const target =
          buttons.find((button) => !button.classList.contains('on') && !button.classList.contains('active')) ||
          buttons[buttons.length - 1]
        if (!target) continue
        target.setAttribute('data-jco-probe-tab', String(serial))
        target.click()
        tab = true
        tabActiveClass = target.classList.contains('active') ? 'active' : 'on'
        break
      }

      const scroller = main.querySelector(':scope > .scroll') || main.querySelector('#chat') || main
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      if (maxScroll > 0) scroller.scrollTop = Math.min(520, maxScroll)

      return {
        field: Boolean(field),
        fieldOrdinal,
        value,
        tab,
        tabActiveClass,
        scrollTop: Math.round(scroller.scrollTop),
      }
    },
    { pageName: page, serial: index + 1 },
  )
}

async function waitForDraftSave(win) {
  await win.waitForTimeout(420)
}

async function scrollTopOf(frame) {
  return await frame.evaluate(() => {
    const main = document.querySelector('main')
    const node = main?.querySelector(':scope > .scroll') || main?.querySelector('#chat') || main
    return Math.round(node?.scrollTop || 0)
  })
}

test('M27：14 个业务页工作态切页保留，普通输入与滚动跨外壳重载恢复', async () => {
  test.setTimeout(240_000)
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-all-page-state-'))
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir },
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
    await win.waitForTimeout(2400)
    const expected = []

    for (const [index, page] of WORK_PAGES.entries()) {
      const frame = await openPage(win, page)
      const instance = await activeInstance(win)
      const state = await preparePageState(frame, page, index)
      await waitForDraftSave(win)

      const away = page === AWAY_PAGE ? 'J.Co主界面-首页.html' : AWAY_PAGE
      await openPage(win, away)
      const returned = await openPage(win, page)

      expect(await activeInstance(win), `${page}: 切页返回没有复用原页面实例`).toBe(instance)
      if (state.field) {
        await expect(returned.locator(`[data-jco-probe-field="${index + 1}"]`)).toHaveValue(state.value)
      }
      if (state.tab) {
        await expect(returned.locator(`[data-jco-probe-tab="${index + 1}"]`)).toHaveClass(
          new RegExp(`(^|\\s)${state.tabActiveClass}(\\s|$)`),
        )
      }
      if (state.scrollTop > 0) {
        await expect
          .poll(() => scrollTopOf(returned), { message: `${page}: 切页返回后滚动位置丢失` })
          .toBeGreaterThan(Math.max(0, state.scrollTop - 5))
      }
      expected.push({ page, ...state })
    }

    await win.reload()
    await win.waitForTimeout(1800)
    for (const item of expected) {
      if (!item.field && !item.scrollTop) continue
      const frame = await openPage(win, item.page)
      await win.waitForTimeout(320)
      if (item.field) {
        await expect(frame.locator('main input, main textarea').nth(item.fieldOrdinal)).toHaveValue(item.value)
      }
      if (item.scrollTop > 0) {
        await expect
          .poll(() => scrollTopOf(frame), { message: `${item.page}: 外壳重载后滚动位置丢失` })
          .toBeGreaterThan(Math.max(0, item.scrollTop - 8))
      }
    }

    expect(errors, `页面 JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    try {
      await app.close()
    } catch {}
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
