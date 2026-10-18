// M11 W2-03：稿件迁移到统一数据层；手工改稿落盘；写稿 → 做视频跨页可见。
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
const SCRIPTS_FILE = path.join(TEST_KERNEL_DIR, 'scripts.json')
const BRAND_FILE = path.join(TEST_KERNEL_DIR, 'brand-profile.json')

test('M11 W2-03：旧稿迁移、手工改稿落统一层、写稿到做视频跨页可见', async () => {
  fs.mkdirSync(TEST_KERNEL_DIR, { recursive: true })
  fs.rmSync(SCRIPTS_FILE, { force: true })
  fs.writeFileSync(
    BRAND_FILE,
    JSON.stringify({ industry: '健身', audience: '上班族', tone: '直接', forbidden: ['包过'] }),
    'utf8',
  )
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)

    // 旧稿先渲染，再一次性迁入统一数据层。
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-script-v1',
        JSON.stringify({
          topic: '通勤 20 分钟怎么练',
          lines: ['第一步，先热身。', '第二步，做三组动作。'],
          xhs: false,
          t: Date.now(),
        }),
      )
      window.location.href = 'J.Co工作台-创作.html'
    })
    await win.waitForTimeout(1500)
    await expect(win.locator('#script p')).toHaveCount(2)
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.scripts.get()).data.current.lines.length), {
        timeout: 5000,
      })
      .toBe(2)

    // 品牌档案进入写稿提示词。
    await expect
      .poll(async () => await win.evaluate(() => window.writerSystemPrompt()), { timeout: 5000 })
      .toContain('健身')

    // 手工改稿：DOM 输入事件后应落到统一层。
    await win.evaluate(() => {
      const p = document.querySelector('#script p')
      p.textContent = `${p.textContent}（改）`
      document.querySelector('#script').dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.scripts.get()).data.current.lines[0]), {
        timeout: 6000,
      })
      .toContain('（改）')

    // 旧 key 只做迁移来源，不再被新写入覆盖成同一份数据。
    const legacy = await win.evaluate(() => JSON.parse(localStorage.getItem('jco-script-v1') || 'null'))
    expect(legacy.lines[0]).toBe('第一步，先热身。')
    const store = await win.evaluate(async () => await window.jco.scripts.get())
    expect(store.data.current.topic).toBe('通勤 20 分钟怎么练')
    expect(store.data.artifacts.length).toBeGreaterThan(0)

    // 写稿 → 做视频：主题交接 + 做视频页读到同一份稿件。
    await win.locator('button:has-text("开始做视频")').click()
    await win.waitForTimeout(1800)
    expect(decodeURIComponent(win.url())).toContain('做视频')
    await expect(win.locator('#handyLine')).toContainText('稿子 2 句')
    await expect(win.locator('#askInp')).toHaveValue(/通勤 20 分钟怎么练/)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(SCRIPTS_FILE, { force: true })
    fs.rmSync(BRAND_FILE, { force: true })
  }
})
