// M5 技能库联动（A6/A7）：做视频页技能排跟随技能库启停；技能库 16 项合一。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

async function goto(win, page) {
  await win.evaluate((p) => {
    window.location.href = p
  }, page)
}

async function setSkills(win, items) {
  await win.evaluate((list) => {
    localStorage.setItem('jco-skills-v1', JSON.stringify({ items: list }))
  }, items)
  await win.reload()
}

test('做视频页：技能排默认 8 个；停用「一镜到底」变 7 个；启用回 8 个', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await goto(win, 'J.Co工作台-做视频.html')
    // 默认（新机）：恰 8 个，含一镜到底
    await expect(win.locator('#skills .skill')).toHaveCount(8)
    await expect(win.locator('#skills .skill', { hasText: '一镜到底' })).toHaveCount(1)

    // 技能库停用 s4（一镜到底）→ 回做视频页：少一个
    await setSkills(win, [{ id: 's4', on: false }])
    await expect(win.locator('#skills .skill')).toHaveCount(7)
    await expect(win.locator('#skills .skill', { hasText: '一镜到底' })).toHaveCount(0)

    // 重新启用 → 回来
    await setSkills(win, [{ id: 's4', on: true }])
    await expect(win.locator('#skills .skill')).toHaveCount(8)
    await expect(win.locator('#skills .skill', { hasText: '一镜到底' })).toHaveCount(1)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('技能库页：16 项合一（12 + 4）；启停真存回存储', async () => {
  // 先删内核侧副本，验证页面进页自动同步（skills:sync → kernel/skills.json）
  const skillsFile = path.join(APP_DIR, 'kernel', 'skills.json')
  try {
    fs.rmSync(skillsFile, { force: true })
  } catch {
    /* 忽略 */
  }
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    await goto(win, 'J.Co技能库.html')
    await expect(win.locator('#skillGrid .skl')).toHaveCount(16)
    await expect(win.locator('#skCount')).toContainText('共 16 个')

    // 点第一张卡的开关：状态真变、真存
    const firstToggle = win.locator('#skillGrid .skl').first().locator('.sk-toggle')
    const before = await firstToggle.textContent()
    await firstToggle.click()
    const after = await firstToggle.textContent()
    expect(after).not.toBe(before)
    const stored = await win.evaluate(() => JSON.parse(localStorage.getItem('jco-skills-v1') || '{}'))
    expect(Array.isArray(stored.items)).toBe(true)
    expect(stored.items.length).toBe(16)

    // 内核侧副本已自动写入（B2：skills:sync 落盘）
    await expect.poll(() => fs.existsSync(skillsFile), { timeout: 5000 }).toBe(true)
    const synced = JSON.parse(fs.readFileSync(skillsFile, 'utf8'))
    expect(Array.isArray(synced.items)).toBe(true)
    expect(synced.items.length).toBe(16)
    expect(synced.items[0]).toHaveProperty('on')
    expect(synced.items[0]).toHaveProperty('entry')

    // 切到「互动」页签：只剩评论回复官 / 私信引导 两个 social
    await win.locator('#skTabs .tab[data-v="social"]').click()
    await expect(win.locator('#skillGrid .skl')).toHaveCount(2)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
