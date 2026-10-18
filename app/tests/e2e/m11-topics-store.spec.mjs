// M11 W2-01：选题旧 localStorage 迁移到统一 topics 数据层；BrandProfile 进入选题提示词。
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
const TOPICS_FILE = path.join(TEST_KERNEL_DIR, 'topics.json')
const BRAND_FILE = path.join(TEST_KERNEL_DIR, 'brand-profile.json')

test('M11 W2-01：选题数据迁移、收藏持久化、BrandProfile 注入', async () => {
  fs.mkdirSync(TEST_KERNEL_DIR, { recursive: true })
  fs.rmSync(TOPICS_FILE, { force: true })
  fs.writeFileSync(
    BRAND_FILE,
    JSON.stringify({ industry: '健身', audience: '上班族', platforms: ['抖音'], tone: '直接', forbidden: ['包过'] }),
    'utf8',
  )
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2600)
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-inspo-v1',
        JSON.stringify([
          {
            t: Date.now(),
            text: '测试爆款',
            why: '有反差',
            myTitle: '测试版本',
            structure: '先结果后过程',
            hook: '别急着划走',
            who: '上班族',
          },
        ]),
      )
      localStorage.setItem(
        'jco-radar-v1',
        JSON.stringify([{ kind: 'ai', kindName: 'AI 现想的', heat: '刚出炉', title: '通勤 20 分钟怎么练' }]),
      )
      localStorage.setItem('jco-favs-v1', JSON.stringify([]))
      window.location.href = 'J.Co工作台-选题.html'
    })
    await win.waitForTimeout(1500)

    await expect(win.locator('.hit .mt-line')).toContainText('测试版本')
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.topics.get()).data.inspos.length), {
        timeout: 5000,
      })
      .toBe(1)
    const store = await win.evaluate(async () => await window.jco.topics.get())
    expect(store.data.radar[0].title).toContain('通勤')
    expect(store.brand.industry).toBe('健身')
    const prompt = await win.evaluate(() => window.topicSystemPrompt())
    expect(prompt).toContain('健身')
    expect(prompt).toContain('上班族')

    await win.locator('.tab[data-f="ai"]').click()
    await win.locator('#radar .r-card .star').click()
    await expect
      .poll(async () => await win.evaluate(async () => (await window.jco.topics.get()).data.favs.length), {
        timeout: 5000,
      })
      .toBe(1)
    await win.reload()
    await win.waitForTimeout(1200)
    await win.locator('.tab[data-f="fav"]').click()
    await expect(win.locator('#radar .r-card .t')).toContainText('通勤')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
    fs.rmSync(TOPICS_FILE, { force: true })
    fs.rmSync(BRAND_FILE, { force: true })
  }
})
