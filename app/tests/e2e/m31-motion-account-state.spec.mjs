// M31：全站动效令牌、账户按钮形态和切页过渡必须符合统一运动契约。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const PROJECT_DIR = path.resolve(APP_DIR, '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

function seconds(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number.parseFloat(item))
}

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  let frame = null
  await expect
    .poll(
      async () => {
        const handle = await win.locator('#jcoFrame').elementHandle()
        frame = handle ? await handle.contentFrame() : null
        return frame && decodeURIComponent(frame.url()).endsWith(`/${page}`) ? 'ready' : ''
      },
      { timeout: 10_000 },
    )
    .toBe('ready')
  return frame
}

test('M31：动效令牌、账户按钮状态和切页过渡统一', async () => {
  test.setTimeout(120_000)
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-motion-account-'))
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir },
  })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    await expect(win.locator('.side-foot .me')).toHaveAttribute('aria-label', '账号 admin')
    await expect(win.locator('.side-foot .me')).toHaveAttribute('aria-controls', 'meMenu')
    await expect(win.locator('#meMenu')).toBeHidden()
    await win.locator('#meBtn').click()
    await expect(win.locator('#meMenu')).toBeVisible()
    await expect(win.locator('#meBtn')).toHaveAttribute('aria-expanded', 'true')
    expect(decodeURIComponent(await win.locator('#jcoFrame').getAttribute('src'))).toBe('J.Co主界面-首页.html')
    await win.keyboard.press('Escape')
    await expect(win.locator('#meMenu')).toBeHidden()
    await expect(win.locator('#meBtn')).toHaveAttribute('aria-expanded', 'false')

    const contract = await win.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const sidebar = getComputedStyle(document.querySelector('.sidebar-inner'))
      const me = getComputedStyle(document.querySelector('.side-foot .me'))
      const name = getComputedStyle(document.querySelector('.side-foot .me > span'))
      const bell = getComputedStyle(document.querySelector('.side-foot .icon-btn'))
      const frame = getComputedStyle(document.querySelector('.jco-frame.is-active'))
      return {
        tokens: {
          press: root.getPropertyValue('--jco-motion-press').trim(),
          fast: root.getPropertyValue('--jco-motion-fast').trim(),
          ui: root.getPropertyValue('--jco-motion-ui').trim(),
          enter: root.getPropertyValue('--jco-motion-enter').trim(),
          structural: root.getPropertyValue('--jco-motion-structural').trim(),
          easeOut: root.getPropertyValue('--jco-ease-out').trim(),
          easeInOut: root.getPropertyValue('--jco-ease-in-out').trim(),
          drawer: root.getPropertyValue('--jco-ease-drawer').trim(),
        },
        sidebar: {
          property: sidebar.transitionProperty,
          duration: sidebar.transitionDuration,
          timing: sidebar.transitionTimingFunction,
        },
        me: {
          property: me.transitionProperty,
          duration: me.transitionDuration,
        },
        name: {
          property: name.transitionProperty,
          duration: name.transitionDuration,
        },
        bell: {
          property: bell.transitionProperty,
          duration: bell.transitionDuration,
        },
        frame: {
          property: frame.transitionProperty,
          duration: frame.transitionDuration,
          timing: frame.transitionTimingFunction,
        },
      }
    })

    expect(contract.tokens).toEqual({
      press: '110ms',
      fast: '180ms',
      ui: '200ms',
      enter: '240ms',
      structural: '280ms',
      easeOut: 'cubic-bezier(0.23, 1, 0.32, 1)',
      easeInOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
      drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
    })
    expect(contract.sidebar.property).toContain('width')
    expect(contract.sidebar.duration).toContain('0.28s')
    expect(contract.sidebar.timing).toContain('cubic-bezier(0.77, 0, 0.175, 1)')
    expect(contract.me.property).toContain('width')
    expect(contract.me.property).toContain('padding')
    expect(contract.name.property).toContain('opacity')
    expect(contract.name.property).toContain('transform')
    expect(contract.bell.property).toContain('opacity')
    expect(contract.bell.property).toContain('transform')
    expect(contract.frame.property).toContain('opacity')
    expect(contract.frame.property).toContain('transform')
    expect(contract.frame.timing).toContain('cubic-bezier(0.23, 1, 0.32, 1)')

    await win.locator('.side-toggle').click()
    await expect
      .poll(() =>
        win.evaluate(() => {
          const me = document.querySelector('.side-foot .me')
          const avatar = me.querySelector('.ava')
          const name = me.querySelector('span')
          const bell = document.querySelector('.side-foot .icon-btn')
          const wordmark = document.querySelector('.wordmark')
          const search = document.querySelector('.search input')
          const navLabel = document.querySelector('.nav-item .jco-nav-label')
          const newLabel = document.querySelector('.new-btn .jco-new-label')
          const meRect = me.getBoundingClientRect()
          const avatarRect = avatar.getBoundingClientRect()
          return {
            meWidth: Math.round(meRect.width),
            meHeight: Math.round(meRect.height),
            avatarWidth: Math.round(avatarRect.width),
            avatarHeight: Math.round(avatarRect.height),
            centerDelta: Math.round(
              Math.abs(meRect.left + meRect.width / 2 - (avatarRect.left + avatarRect.width / 2)),
            ),
            nameVisibility: getComputedStyle(name).visibility,
            nameOpacity: getComputedStyle(name).opacity,
            bellVisibility: getComputedStyle(bell).visibility,
            bellOpacity: getComputedStyle(bell).opacity,
            wordmarkVisibility: getComputedStyle(wordmark).visibility,
            wordmarkOpacity: getComputedStyle(wordmark).opacity,
            searchOpacity: getComputedStyle(search).opacity,
            navLabelVisibility: getComputedStyle(navLabel).visibility,
            navLabelOpacity: getComputedStyle(navLabel).opacity,
            newLabelVisibility: getComputedStyle(newLabel).visibility,
            newLabelOpacity: getComputedStyle(newLabel).opacity,
          }
        }),
      )
      .toEqual({
        meWidth: 40,
        meHeight: 40,
        avatarWidth: 26,
        avatarHeight: 26,
        centerDelta: 0,
        nameVisibility: 'hidden',
        nameOpacity: '0',
        bellVisibility: 'hidden',
        bellOpacity: '0',
        wordmarkVisibility: 'hidden',
        wordmarkOpacity: '0',
        searchOpacity: '0',
        navLabelVisibility: 'hidden',
        navLabelOpacity: '0',
        newLabelVisibility: 'hidden',
        newLabelOpacity: '0',
      })

    await win.locator('.side-toggle').click()
    await expect
      .poll(() =>
        win.evaluate(() => {
          const me = document.querySelector('.side-foot .me')
          const name = me.querySelector('span')
          const bell = document.querySelector('.side-foot .icon-btn')
          const wordmark = document.querySelector('.wordmark')
          const search = document.querySelector('.search input')
          const navLabel = document.querySelector('.nav-item .jco-nav-label')
          const newLabel = document.querySelector('.new-btn .jco-new-label')
          return {
            meWidth: Math.round(me.getBoundingClientRect().width),
            nameVisibility: getComputedStyle(name).visibility,
            nameOpacity: getComputedStyle(name).opacity,
            bellVisibility: getComputedStyle(bell).visibility,
            bellOpacity: getComputedStyle(bell).opacity,
            wordmarkVisibility: getComputedStyle(wordmark).visibility,
            wordmarkOpacity: getComputedStyle(wordmark).opacity,
            searchOpacity: getComputedStyle(search).opacity,
            navLabelVisibility: getComputedStyle(navLabel).visibility,
            navLabelOpacity: getComputedStyle(navLabel).opacity,
            newLabelVisibility: getComputedStyle(newLabel).visibility,
            newLabelOpacity: getComputedStyle(newLabel).opacity,
          }
        }),
      )
      .toEqual({
        meWidth: expect.any(Number),
        nameVisibility: 'visible',
        nameOpacity: '1',
        bellVisibility: 'visible',
        bellOpacity: '1',
        wordmarkVisibility: 'visible',
        wordmarkOpacity: '1',
        searchOpacity: '1',
        navLabelVisibility: 'visible',
        navLabelOpacity: '1',
        newLabelVisibility: 'visible',
        newLabelOpacity: '1',
      })
    expect(await win.locator('.side-foot .me').evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(
      120,
    )

    await win.evaluate(() => window.__jcoGo('J.Co工作台-选题.html'))
    await expect
      .poll(() =>
        win.evaluate(() => {
          const node = document.querySelector('.jco-frame.is-active')
          const style = getComputedStyle(node)
          return Number(style.opacity)
        }),
      )
      .toBe(1)
    await expect
      .poll(() => win.locator('.jco-frame.is-active').evaluate((node) => getComputedStyle(node).transform))
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)

    const home = await openPage(win, 'J.Co主界面-首页.html')
    await home.locator('#modePill').click()
    await home.waitForTimeout(260)
    const popMotion = await home.locator('.mode-pop').evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        name: style.animationName,
        duration: style.animationDuration,
        origin: style.transformOrigin,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      }
    })
    expect(popMotion.name).toBe('jco-pop-in')
    expect(seconds(popMotion.duration).every((duration) => duration <= 0.2)).toBe(true)
    const [originX, originY] = popMotion.origin.split(/\s+/).map(Number.parseFloat)
    expect(originX).toBeGreaterThanOrEqual(popMotion.width * 0.95)
    expect(originY).toBeGreaterThanOrEqual(popMotion.height * 0.95)

    const topics = await openPage(win, 'J.Co工作台-选题.html')
    await topics.locator('button', { hasText: '贴一条爆款' }).click()
    const overlayMotion = await topics.evaluate(() => {
      const overlay = document.querySelector('.overlay.show')
      const sheet = overlay?.firstElementChild
      return {
        overlayName: overlay ? getComputedStyle(overlay).animationName : '',
        sheetName: sheet ? getComputedStyle(sheet).animationName : '',
      }
    })
    expect(overlayMotion).toEqual({
      overlayName: 'jco-overlay-in',
      sheetName: 'jco-sheet-in',
    })

    await win.emulateMedia({ reducedMotion: 'reduce' })
    const reducedDurations = await win.evaluate(() =>
      ['.sidebar-inner', '.side-foot .me', '.side-foot .me > span', '.jco-frame.is-active'].map(
        (selector) => getComputedStyle(document.querySelector(selector)).transitionDuration,
      ),
    )
    expect(reducedDurations.flatMap(seconds).every((duration) => duration === 0)).toBe(true)
  } finally {
    try {
      await app.close()
    } catch {}
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test('M31b：账户菜单在侧栏两态都从正确方向展开，并在动效中关闭', async () => {
  test.setTimeout(120_000)
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-account-menu-'))
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir },
  })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)

    const pageUrl = pathToFileURL(path.join(PROJECT_DIR, '设计原型', 'J.Co工作台-选题.html')).href
    await win.goto(pageUrl)
    await expect.poll(() => win.evaluate(() => document.documentElement.dataset.jcoReady)).toBe('1')

    await win.locator('.side-toggle').click()
    await expect
      .poll(() => win.locator('.sidebar').evaluate((node) => Math.round(node.getBoundingClientRect().width)))
      .toBe(74)

    await win.locator('#meBtn').click()
    await expect(win.locator('#meBtn')).toHaveAttribute('aria-expanded', 'true')
    await expect(win.locator('#meMenu')).toBeVisible()

    const bounds = await win.evaluate(() => {
      const menuRect = document.querySelector('#meMenu').getBoundingClientRect()
      const sidebarRect = document.querySelector('.sidebar').getBoundingClientRect()
      return {
        menuLeft: menuRect.left,
        menuRight: menuRect.right,
        menuTop: menuRect.top,
        menuBottom: menuRect.bottom,
        sidebarRight: sidebarRect.right,
        width: window.innerWidth,
        height: window.innerHeight,
      }
    })
    expect(bounds.menuLeft).toBeGreaterThanOrEqual(bounds.sidebarRight + 4)
    expect(bounds.menuRight).toBeLessThanOrEqual(bounds.width - 4)
    expect(bounds.menuTop).toBeGreaterThanOrEqual(4)
    expect(bounds.menuBottom).toBeLessThanOrEqual(bounds.height - 4)

    await win.locator('.side-toggle').click()
    await expect(win.locator('#meMenu')).toBeHidden()
    await expect(win.locator('#meBtn')).toHaveAttribute('aria-expanded', 'false')
  } finally {
    try {
      await app.close()
    } catch {}
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
