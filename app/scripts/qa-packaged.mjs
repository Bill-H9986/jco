// 打包版冒烟检查（M0 验收用；不属于 gate，手动/封版时运行）
// 用法：node scripts/qa-packaged.mjs [exe路径]
//   不传参数：检查 release\win-unpacked\J.Co.exe（--dir 产物）
//   传参数：检查指定 exe（如已安装版 %LOCALAPPDATA%\Programs\J.Co\J.Co.exe）
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(__dirname, '..')
const EXE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(APP, 'release', 'win-unpacked', 'J.Co.exe')
const SHOT_EXPANDED = path.join(APP, 'release', 'smoke-packaged-expanded.png')
const SHOT_COLLAPSED = path.join(APP, 'release', 'smoke-packaged-collapsed.png')

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
  const frameUrls = win.frames().map((f) => decodeURIComponent(f.url()))
  const hasShell = url.includes('J.Co应用壳.html')
  const hasHome = frameUrls.some((u) => u.includes('J.Co主界面-首页.html'))
  const shellState = await win.evaluate(() => {
    const side = document.querySelector('.sidebar-inner')
    const toggle = document.querySelector('.side-toggle')
    return {
      hasSidebar: !!side,
      hasToggle: !!toggle,
      iframe: document.querySelector('iframe')?.getAttribute('src') || '',
    }
  })
  console.log(`窗口标题 : ${title}`)
  console.log(`当前页面 : ${url}`)
  console.log(`应用壳命中 : ${hasShell ? 'OK' : 'FAIL'}`)
  console.log(`首页 iframe: ${hasHome ? 'OK' : 'FAIL'}`)
  console.log(`侧栏命中   : ${shellState.hasSidebar && shellState.hasToggle ? 'OK' : 'FAIL'}`)
  console.log(`iframe src : ${shellState.iframe}`)
  if (errors.length > 0) console.log(`JS 错误  :\n${errors.join('\n')}`)

  // 隐藏窗口用 page.screenshot 会等待合成器超时；webContents.capturePage 可稳定取证。
  const capture = async (target) => {
    const b64 = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const img = await w.webContents.capturePage()
      return img.toPNG().toString('base64')
    })
    const buf = Buffer.from(b64, 'base64')
    if (buf.length < 10000) throw new Error(`截图内容异常：${buf.length} bytes`)
    writeFileSync(target, buf)
    console.log(`截图已存 : ${target} (${buf.length} bytes)`)
  }

  // 隐藏窗口会冻结 CSS 过渡，先关闭过渡再量侧栏几何状态。
  await win.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' })
  const sideWidth = () =>
    win.evaluate(() => Math.round(document.querySelector('.sidebar-inner')?.getBoundingClientRect().width || 0))
  const widthExpanded = await sideWidth()
  await capture(SHOT_EXPANDED)
  await win.locator('.side-toggle').click()
  await win.waitForTimeout(200)
  const widthCollapsed = await sideWidth()
  await capture(SHOT_COLLAPSED)
  await win.locator('.side-toggle').click()
  await win.waitForTimeout(200)
  const widthReopened = await sideWidth()
  const sidePass = widthExpanded > 180 && widthCollapsed < 120 && widthReopened > 180
  console.log(
    `侧栏双态 : ${sidePass ? 'OK' : 'FAIL'}（${widthExpanded}px -> ${widthCollapsed}px -> ${widthReopened}px）`,
  )

  if (!hasShell || !hasHome || !shellState.hasSidebar || !shellState.hasToggle || !sidePass || errors.length > 0) {
    failed = true
  }
} finally {
  await app.close()
}

if (failed) {
  console.log('❌ 打包版冒烟未通过')
  process.exit(1)
}
console.log('✅ 打包版冒烟通过（安装版可打开主界面）')
