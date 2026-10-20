// 全站 UI 操作控件盘点与契约校验。
// 用法：node scripts/ui-inventory.mjs [--check] [--json 输出路径]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { PAGES } from '../tests/pages.mjs'
import { inspectPage, validateInventory } from '../tests/support/ui-contract.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const args = process.argv.slice(2)
const check = args.includes('--check')
const jsonIndex = args.indexOf('--json')
const output =
  jsonIndex === -1 ? path.join(APP_DIR, 'quality', 'generated', 'ui-inventory.json') : path.resolve(args[jsonIndex + 1])

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
  await win.waitForTimeout(200)
  return activeFrame(win)
}

const app = await electron.launch({
  executablePath: ELECTRON_BIN,
  args: [APP_DIR, '--jco-test'],
})

let failed = false
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
  await win.waitForTimeout(2400)

  const inventory = []
  for (const page of PAGES) {
    const frame = await openPage(win, page)
    inventory.push(await inspectPage(frame, page))
  }

  const { violations } = validateInventory(inventory)
  const controls = inventory.flatMap((item) => item.controls)
  const switches = inventory.flatMap((item) => item.switches)
  const badges = inventory.flatMap((item) => item.badges)
  const forms = inventory.flatMap((item) => item.forms)
  const roles = Object.fromEntries(
    [...new Set(controls.map((item) => item.role))].map((role) => [
      role,
      controls.filter((item) => item.role === role).length,
    ]),
  )

  const report = {
    generatedAt: new Date().toISOString(),
    pages: PAGES.length,
    controls: controls.length,
    roles,
    switches: switches.length,
    badges: badges.length,
    forms: forms.length,
    violations,
    pageErrors: errors,
    inventory,
  }

  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2))

  console.log(`UI 盘点：${PAGES.length} 页 / ${controls.length} 个操作控件 / ${switches.length} 个开关`)
  console.log(`控件角色：${JSON.stringify(roles)}`)
  console.log(`其他控件：badge=${badges.length} input=${forms.length}`)
  console.log(`报告：${output}`)

  if (errors.length) {
    failed = true
    console.error(`页面 JS 错误：${errors.join(' | ')}`)
  }
  if (violations.length) {
    failed = true
    console.error(`UI 契约违规 ${violations.length} 项：`)
    for (const violation of violations.slice(0, 80)) console.error(`- ${violation}`)
    if (violations.length > 80) console.error(`...另有 ${violations.length - 80} 项`)
  }
  if (check && failed) process.exitCode = 1
  if (!failed) console.log('✅ UI 操作控件契约通过')
} finally {
  await app.close()
}
