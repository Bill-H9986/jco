// M10 应用壳：启动即壳；切页只换内容视图（外壳不重载）；内嵌页隐藏自身侧栏；IPC 经外壳桥接
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const TEST_KERNEL_DIR = path.join(os.tmpdir(), 'jco-test-kernel-data')
const TEST_TASK = path.join(TEST_KERNEL_DIR, 'task-sessions', 'shelltask.json')

test('应用壳：侧栏常驻切页不重载 / 内嵌页隐藏自身侧栏 / IPC 桥接 / 高亮同步', async () => {
  fs.mkdirSync(path.dirname(TEST_TASK), { recursive: true })
  fs.writeFileSync(
    TEST_TASK,
    JSON.stringify({
      id: 'shelltask',
      name: '外壳刷新测试任务',
      staff: 'publish',
      state: 'done',
      startedAt: Date.now() - 60000,
      endedAt: Date.now() - 30000,
      summary: '完成',
      messages: [],
    }),
    'utf8',
  )
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(3200)
    // 启动页 = 应用壳
    expect(decodeURIComponent(win.url())).toContain('J.Co应用壳.html')
    await expect(win.locator('#jcoFrame')).toBeVisible()
    // 外壳打标记 → 切换 → 标记仍在（外壳没被重载）
    await win.evaluate(() => {
      window.__shellMark = 1
    })
    await win.locator('.nav .nav-item', { hasText: '发布' }).click()
    await win.waitForTimeout(1300)
    expect(await win.evaluate(() => window.__shellMark)).toBe(1)
    await expect(win.locator('#jcoFrame')).toHaveAttribute('src', 'J.Co工作台-发布.html')
    // 内嵌页隐藏自身侧栏 + IPC 经外壳桥接可用
    const frame = win.frameLocator('#jcoFrame')
    const sideDisplay = await frame.locator('.sidebar').evaluate((el) => getComputedStyle(el).display)
    expect(sideDisplay).toBe('none')
    const inner = win.frames().find((f) => f !== win.mainFrame())
    expect(await inner.evaluate(() => typeof window.jco)).toBe('object')
    // 高亮同步
    const active = (await win.locator('.nav .nav-item.active').allInnerTexts()).join('｜')
    expect(active).toContain('发布')

    // 首页入口：从发布切回首页，外壳标记仍在
    await win.locator('.nav .nav-item', { hasText: '首页' }).click()
    await win.waitForTimeout(700)
    expect(await win.evaluate(() => window.__shellMark)).toBe(1)
    await expect(win.locator('#jcoFrame')).toHaveAttribute('src', 'J.Co主界面-首页.html')
    await expect(win.locator('.nav .nav-item.active')).toHaveText('首页')

    // 任务/对话列表是可刷新的，不再只在初始化时拉一次
    await expect(win.locator('#taskList .convo', { hasText: '外壳刷新测试任务' })).toHaveCount(1)
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-chats-v1',
        JSON.stringify({
          activeId: 'shellchat',
          chats: [{ id: 'shellchat', title: '外壳刷新测试对话', messages: [{ role: 'user', text: 'hi' }] }],
        }),
      )
      window.__refreshJcoSidebar()
    })
    await expect(win.locator('.convos:not(#taskList) .convo', { hasText: '外壳刷新测试对话' })).toHaveCount(1)

    // 侧栏展开/收起两种状态都要测：默认展开，点固定按钮收起，再点恢复
    // 隐藏窗口会冻结 CSS 过渡，测试里先关闭过渡再断言几何值（产品窗口仍有正常动画）。
    await win.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'
      document.head.appendChild(style)
    })
    const sideWidth = () => win.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width))
    const expandedWidth = await sideWidth()
    expect(expandedWidth).toBeGreaterThan(180)
    await win.locator('.side-toggle').click()
    await win.waitForTimeout(350)
    const collapsedWidth = await sideWidth()
    expect(collapsedWidth).toBeLessThan(expandedWidth)
    expect(collapsedWidth).toBeLessThan(120)
    await win.locator('.side-toggle').click()
    await win.waitForTimeout(350)
    expect(await sideWidth()).toBe(expandedWidth)

    // 通知点击钩子：打开壳内独立任务视图，不导航掉外壳
    await win.evaluate(() => window.__jcoOpenTaskById('shelltask'))
    await expect(win.locator('#jcoTaskView')).toBeVisible()
    await expect(win.locator('#tvTitle')).toContainText('外壳刷新测试任务')
    expect(decodeURIComponent(win.url())).toContain('J.Co应用壳.html')
    await win.locator('#tvBack').click()
    expect(await win.evaluate(() => window.__shellMark)).toBe(1)

    // 深色主题必须同时进外壳和 iframe，不能只黑侧栏、内容区仍是浅色
    await win.evaluate(() => window.jco.sys.theme('dark'))
    await win.waitForTimeout(700)
    expect(await win.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(28, 28, 30)')
    const themedFrame = win.frames().find((f) => f !== win.mainFrame())
    expect(await themedFrame.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(28, 28, 30)')
    await win.evaluate(() => window.jco.sys.theme('system'))
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    try {
      fs.rmSync(TEST_TASK, { force: true })
    } catch {}
  }
})
