#!/usr/bin/env node
/**
 * 把已安装的 J.Co 指向新的 OTA 更新源，不需要重新安装。
 * 只写 %APPDATA%/J.Co/update-channel.json，旧文件先备份。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const feedUrl = String(process.argv[2] || process.env.JCO_UPDATE_FEED_URL || '')
  .trim()
  .replace(/\/+$/, '')
if (!feedUrl) {
  console.error('用法：node scripts/point-installed-updater.mjs <https://...>')
  process.exit(1)
}
let parsed
try {
  parsed = new URL(feedUrl)
} catch {
  console.error('更新源不是合法 URL。')
  process.exit(1)
}
if (parsed.protocol !== 'https:') {
  console.error('已安装版 OTA 更新源必须是 HTTPS。')
  process.exit(1)
}

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const dir = path.join(appData, 'J.Co')
const file = path.join(dir, 'update-channel.json')
fs.mkdirSync(dir, { recursive: true })
if (fs.existsSync(file)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(file, `${file}.bak-${stamp}`)
}
const temp = `${file}.tmp-${process.pid}`
fs.writeFileSync(temp, JSON.stringify({ feedUrl, checkIntervalHours: 4, allowPrerelease: true }, null, 2), 'utf8')
fs.renameSync(temp, file)
console.log(`已把已安装 J.Co 的更新源切换为：${feedUrl}`)
console.log(`配置文件：${file}`)
