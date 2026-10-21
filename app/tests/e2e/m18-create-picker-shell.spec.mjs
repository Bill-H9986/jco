// M18：创作页素材选择必须走真实应用壳；切页回来后不能把素材选择页当成创作页。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const FIXTURE = path.join(APP_DIR, 'tests', 'visual', 'baseline', 'local', 'materials-light-1440x900.png')

function frameByPage(win, page, searchPart = '') {
  return win.frames().find((frame) => {
    if (frame === win.mainFrame()) return false
    try {
      const url = new URL(frame.url())
      const pathname = decodeURIComponent(url.pathname)
      if (!pathname.endsWith(`/${page}`)) return false
      return searchPart ? decodeURIComponent(url.search).includes(searchPart) : true
    } catch {
      return false
    }
  })
}

async function waitForFrame(win, page, searchPart = '') {
  let found = null
  await expect
    .poll(
      async () => {
        const frame = frameByPage(win, page, searchPart)
        if (!frame) return false
        try {
          const ready = await frame.evaluate(() => document.documentElement.getAttribute('data-jco-ready'))
          if (ready === '1') found = frame
          return ready === '1'
        } catch {
          return false
        }
      },
      { timeout: 8000 },
    )
    .toBe(true)
  return found
}

test('M18：素材选择走真实应用壳，切页回来仍是创作页并保留工作态', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  let win = null
  try {
    win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)))
    await win.waitForTimeout(2400)

    const name = '壳内选择素材.png'
    await win.evaluate(
      async ({ file, label }) => {
        await window.jco.materials.save({
          items: [
            {
              cat: 'mine',
              type: 'photo',
              name: label,
              src: '导入 · 本机文件',
              imported: true,
              path: file,
            },
          ],
        })
      },
      { file: FIXTURE.replace(/\\/g, '/'), label: name },
    )

    await win.evaluate(() => window.__jcoGo('J.Co工作台-做视频.html'))
    let create = await waitForFrame(win, 'J.Co工作台-做视频.html')
    await expect(create.locator('#askInp')).toBeVisible()
    await create.locator('#askInp').fill('切页后要保留的创作想法')
    await win.waitForTimeout(400)

    // 真实点击创作页的「素材」按钮，进入选择模式。
    await create.locator('.ask-bar .tool', { hasText: '素材' }).click()
    let picker = await waitForFrame(win, 'J.Co工作台-素材.html', 'pick=1')
    await expect(picker.locator('body')).toHaveClass(/pick-mode/)
    await expect(picker.locator('#pickDone')).toBeVisible()

    // 选择页还开着时切走，再回到创作：壳不能复用仍在选择模式的旧 iframe。
    await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
    await win.waitForTimeout(500)
    await win.evaluate(() => window.__jcoGo('J.Co工作台-做视频.html'))
    create = await waitForFrame(win, 'J.Co工作台-做视频.html')
    await expect(create.locator('#agentHint')).toBeVisible()
    await expect(create.locator('body')).not.toHaveClass(/pick-mode/)
    await expect(create.locator('#askInp')).toHaveValue('切页后要保留的创作想法', { timeout: 5000 })

    // 再开一次选择页，选素材并带回创作页。
    await create.locator('.ask-bar .tool', { hasText: '素材' }).click()
    picker = await waitForFrame(win, 'J.Co工作台-素材.html', 'pick=1')
    const card = picker.locator('#grid .mat').first()
    await expect(card).toBeVisible()
    await card.click()
    await expect(picker.locator('#pickCount')).toContainText('已选 1 件')
    await picker.locator('#pickDone').click()

    create = await waitForFrame(win, 'J.Co工作台-做视频.html')
    await expect(create.locator('#pickedBar')).toBeVisible()
    await expect(create.locator('#pickedList')).toContainText(name)
    await expect(create.locator('#askInp')).toHaveValue('切页后要保留的创作想法', { timeout: 5000 })

    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    try {
      await win?.evaluate(async () => {
        await window.jco.materials.save({ items: [] })
      })
    } catch {}
    await app.close()
  }
})
