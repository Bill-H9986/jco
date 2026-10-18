// M11 W2-02：素材索引迁移到统一 materials 数据层；导入后在创作链跨页可见。
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
const MATERIALS_FILE = path.join(TEST_KERNEL_DIR, 'materials.json')
const BRAND_FILE = path.join(TEST_KERNEL_DIR, 'brand-profile.json')
const FIXTURE_DIR = path.join(os.tmpdir(), 'jco-test-material-fixture')
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'sample.png')

test('M11 W2-02：旧素材迁移、真实导入落统一层、做视频页跨页可见', async () => {
  fs.mkdirSync(TEST_KERNEL_DIR, { recursive: true })
  fs.rmSync(MATERIALS_FILE, { force: true })
  fs.writeFileSync(BRAND_FILE, JSON.stringify({ industry: '健身', audience: '上班族', tone: '直接' }), 'utf8')
  fs.mkdirSync(FIXTURE_DIR, { recursive: true })
  fs.writeFileSync(
    FIXTURE_FILE,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  )

  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PICK_FILES: FIXTURE_FILE },
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)

    // 旧数据先渲染，再一次性迁入统一数据层。
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-materials-v1',
        JSON.stringify({
          items: [{ cat: 'idea', type: 'star', name: '旧画面方案', src: 'AI 找的 · 旧数据', badge: 'AI' }],
        }),
      )
      window.location.href = 'J.Co工作台-素材.html'
    })
    await win.waitForTimeout(1500)
    await expect(win.locator('#grid .mat')).toHaveCount(1)
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.materials.get()).data.items.length), {
        timeout: 5000,
      })
      .toBe(1)
    await expect
      .poll(async () => await win.evaluate(() => window.materialSystemPrompt()), { timeout: 5000 })
      .toContain('健身')

    // 真实走导入链路（测试模式用固定文件替代系统选择框）。
    await win.locator('button:has-text("导入素材")').click()
    await expect(win.locator('.tab.active')).toHaveAttribute('data-f', 'mine')
    await expect(win.locator('#grid .mat')).toHaveCount(1)
    await expect(win.locator('#grid .mat .nm', { hasText: 'sample.png' })).toBeVisible()
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.materials.get()).data.items[0].name), {
        timeout: 5000,
      })
      .toBe('sample.png')
    const imported = await win.evaluate(async () => (await window.jco.materials.get()).data.items[0])
    expect(imported.cat).toBe('mine')
    expect(imported.path).toBe(FIXTURE_FILE)

    // 桌面路径只写统一层，旧 localStorage 不再新增双写。
    const legacyCount = await win.evaluate(
      () => JSON.parse(localStorage.getItem('jco-materials-v1') || '{"items":[]}').items.length,
    )
    expect(legacyCount).toBe(1)

    // 刷新后仍由统一层恢复。
    await win.locator('.tab[data-f="all"]').click()
    await expect(win.locator('#grid .mat')).toHaveCount(2)
    await win.reload()
    await win.waitForTimeout(1400)
    await expect(win.locator('#grid .mat')).toHaveCount(2)

    // 创作链跨页读取同一份素材索引。
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-做视频.html'
    })
    await win.waitForTimeout(1600)
    await expect(win.locator('#handyLine')).toContainText('素材 2 件')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(MATERIALS_FILE, { force: true })
    fs.rmSync(BRAND_FILE, { force: true })
    fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
  }
})
