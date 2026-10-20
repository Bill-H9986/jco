// 安装版 UI 与页面状态验收：对真实安装目录 exe 执行，不读取源码目录页面。
// 用法：node scripts/qa-installed-ui.mjs [exe路径]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { PAGES } from '../tests/pages.mjs'
import { inspectPage, validateInventory } from '../tests/support/ui-contract.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_EXE = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'J.Co', 'J.Co.exe')
const EXE = path.resolve(process.argv[2] || DEFAULT_EXE)

async function activeFrame(win) {
  const href = await win.evaluate(() => {
    const node = document.querySelector('#jcoFrame')
    return node ? new URL(node.getAttribute('src'), location.href).href : ''
  })
  return win.frames().find((frame) => frame.url() === href)
}

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  await win.waitForFunction(
    (target) => {
      const node = document.querySelector('#jcoFrame')
      const fade = document.querySelector('#frameFade')
      return (
        node &&
        node.getAttribute('src') === target &&
        fade &&
        !fade.classList.contains('on') &&
        node.contentDocument?.documentElement.getAttribute('data-jco-ready') === '1'
      )
    },
    page,
    { timeout: 15000 },
  )
  await win.waitForTimeout(450)
  return activeFrame(win)
}

const app = await electron.launch({
  executablePath: EXE,
  args: ['--jco-test'],
  env: { ...process.env, NODE_PATH: '' },
})

let failed = false
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
  await win.waitForTimeout(2400)

  const inventory = []
  const duplicateIds = []
  for (const page of PAGES) {
    const frame = await openPage(win, page)
    inventory.push(await inspectPage(frame, page))
    const ids = await frame.evaluate(() => {
      const values = [...document.querySelectorAll('[id]')].map((el) => el.id)
      return [...new Set(values.filter((id, index) => values.indexOf(id) !== index))]
    })
    if (ids.length) duplicateIds.push(`${page}: ${ids.join(',')}`)
  }

  const { violations } = validateInventory(inventory)
  if (violations.length) {
    failed = true
    console.error(`安装版 UI 契约违规 ${violations.length} 项`)
    for (const violation of violations.slice(0, 80)) console.error(`- ${violation}`)
  }
  if (duplicateIds.length) {
    failed = true
    console.error(`安装版重复 ID：${duplicateIds.join(' | ')}`)
  }
  if (errors.length) {
    failed = true
    console.error(`安装版页面 JS 错误：${errors.join(' | ')}`)
  }

  const topics = await openPage(win, 'J.Co工作台-选题.html')
  await topics.locator('#selfInp').fill('安装版草稿保留')
  await topics.evaluate(() => {
    window.__installedQaMarker = 'kept'
    const scroller = document.querySelector('.scroll')
    if (scroller) scroller.scrollTop = 0
  })
  await win.evaluate(() => window.__jcoGo('J.Co主界面-首页.html'))
  await win.waitForTimeout(200)
  const topicsAgain = await openPage(win, 'J.Co工作台-选题.html')
  const state = await topicsAgain.evaluate(() => ({
    value: document.querySelector('#selfInp')?.value || '',
    marker: window.__installedQaMarker || '',
  }))
  if (state.value !== '安装版草稿保留' || state.marker !== 'kept') {
    failed = true
    console.error(`安装版页面状态未保留：${JSON.stringify(state)}`)
  }

  const stats = await win.evaluate(() => window.__jcoFrameStats)
  if (!stats || stats.cacheHits < 1 || stats.lastSwitchMs > 400) {
    failed = true
    console.error(`安装版页面缓存异常：${JSON.stringify(stats)}`)
  }

  console.log(`安装版 UI：${PAGES.length} 页检查完成`)
  console.log(`页面状态：${JSON.stringify(state)}`)
  console.log(`缓存统计：${JSON.stringify(stats)}`)
  if (!failed) console.log('✅ 安装版 UI、状态与缓存验收通过')
} catch (error) {
  failed = true
  console.error(`❌ 安装版 UI 验收失败：${error.message}`)
} finally {
  await app.close()
}

if (failed) process.exit(1)
