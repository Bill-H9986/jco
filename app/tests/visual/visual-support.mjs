import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const APP_DIR = path.resolve(__dirname, '..', '..')
export const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
export const BASELINE_DIR = path.join(__dirname, 'baseline')

async function captureWindow(app) {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((item) => item.isVisible()) || BrowserWindow.getAllWindows()[0]
    if (!win) return ''
    const image = await win.capturePage()
    return image.toPNG().toString('base64')
  })
  return Buffer.from(png, 'base64')
}

async function captureStableWindow(app) {
  let actual = await captureWindow(app)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 220))
    const next = await captureWindow(app)
    if (next.equals(actual)) return next
    actual = next
  }
  return actual
}

export async function settleWindow(win) {
  await win.waitForTimeout(700)
  for (const frame of win.frames()) {
    try {
      await frame.waitForFunction(
        () => document.readyState === 'complete' && Number(getComputedStyle(document.body).opacity || 1) >= 0.999,
        undefined,
        { timeout: 5000 },
      )
      await frame.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready
        if (document.activeElement) document.activeElement.blur()
        window.scrollTo(0, 0)
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
        if (!document.getElementById('__jco-visual-freeze')) {
          const style = document.createElement('style')
          style.id = '__jco-visual-freeze'
          style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'
          document.head.appendChild(style)
        }
      })
    } catch {
      // iframe 正在导航时忽略；外层会等待 ready 标记后再截图。
    }
  }
  await win.waitForTimeout(250)
}

export async function assertVisual(app, name) {
  const win = await app.firstWindow()
  // CDP viewport 不受 GitHub runner 的 1024×768 物理屏限制，截图固定为 CSS 1440×900。
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForTimeout(180)
  const actual = await captureStableWindow(app)
  const strict = process.env.JCO_VISUAL_STRICT === '1'
  const baselineDir = path.join(BASELINE_DIR, strict ? 'ci' : 'local')
  const file = path.join(baselineDir, name)
  if (process.env.JCO_UPDATE_VISUAL === '1') {
    fs.mkdirSync(baselineDir, { recursive: true })
    fs.writeFileSync(file, actual)
    return
  }
  expect(fs.existsSync(file), `缺少视觉基准：${file}`).toBe(true)
  const expected = fs.readFileSync(file)
  const [actualPixels, expectedPixels] = await Promise.all([
    sharp(actual).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(expected).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  expect(actualPixels.info.width, `${name} 宽度变化`).toBe(expectedPixels.info.width)
  expect(actualPixels.info.height, `${name} 高度变化`).toBe(expectedPixels.info.height)

  const channels = actualPixels.info.channels
  let changed = 0
  for (let offset = 0; offset < actualPixels.data.length; offset += channels) {
    if (
      Math.abs(actualPixels.data[offset] - expectedPixels.data[offset]) > 24 ||
      Math.abs(actualPixels.data[offset + 1] - expectedPixels.data[offset + 1]) > 24 ||
      Math.abs(actualPixels.data[offset + 2] - expectedPixels.data[offset + 2]) > 24 ||
      Math.abs(actualPixels.data[offset + 3] - expectedPixels.data[offset + 3]) > 24
    ) {
      changed += 1
    }
  }
  const ratio = changed / (actualPixels.info.width * actualPixels.info.height)
  if (ratio > 0.01) {
    const failureDir = path.join(os.tmpdir(), 'jco-visual-failures')
    fs.mkdirSync(failureDir, { recursive: true })
    fs.writeFileSync(path.join(failureDir, name), actual)
  }
  expect(ratio, `视觉基准不一致：${name}（差异 ${(ratio * 100).toFixed(3)}%）`).toBeLessThanOrEqual(0.01)
}
