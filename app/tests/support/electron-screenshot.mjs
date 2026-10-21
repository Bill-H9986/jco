import fs from 'node:fs'
import path from 'node:path'

/** Electron E2E 诊断截图：走 BrowserWindow.capturePage，避免 page.screenshot 等待嵌套 iframe 字体。 */
export async function saveElectronScreenshot(app, outputPath) {
  const pngBase64 = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((item) => item.isVisible()) || BrowserWindow.getAllWindows()[0]
    if (!win) return ''
    return (await win.capturePage()).toPNG().toString('base64')
  })
  if (!pngBase64) throw new Error('没有可截图的 Electron 窗口')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, Buffer.from(pngBase64, 'base64'))
}
