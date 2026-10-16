// 打包版冒烟检查（M0 验收用；不属于 gate，手动/封版时运行）
// 用法：node scripts/qa-packaged.mjs
// 前置：先 npx electron-builder --win --dir 产出 release\win-unpacked
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(__dirname, '..')
const EXE = path.join(APP, 'release', 'win-unpacked', 'J.Co.exe')
const SHOT = path.join(APP, 'release', 'smoke-packaged.png')

if (!existsSync(EXE)) {
  console.error(`找不到打包产物：${EXE}\n请先运行：npx electron-builder --win --dir`)
  process.exit(1)
}

let failed = false
const app = await electron.launch({ executablePath: EXE, args: ['--jco-test'] })
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
  await win.waitForTimeout(3000)

  const title = await win.title()
  const url = decodeURIComponent(win.url())
  const hasEntry = url.includes('J.Co主界面-首页.html')
  console.log(`窗口标题 : ${title}`)
  console.log(`当前页面 : ${url}`)
  console.log(`首页命中 : ${hasEntry ? 'OK' : 'FAIL'}`)
  if (errors.length > 0) console.log(`JS 错误  :\n${errors.join('\n')}`)

  await win.screenshot({ path: SHOT })
  console.log(`截图已存 : ${SHOT}`)

  if (!hasEntry || errors.length > 0) failed = true
} finally {
  await app.close()
}

if (failed) {
  console.log('❌ 打包版冒烟未通过')
  process.exit(1)
}
console.log('✅ 打包版冒烟通过（安装版可打开主界面）')
