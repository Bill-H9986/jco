#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(__dirname, '..')
const RELEASE = path.join(APP, 'release')
const FEED = path.join(RELEASE, 'feed')
const feedUrl = String(process.env.JCO_UPDATE_FEED_URL || '').trim()

if (!feedUrl) {
  console.error('缺少 JCO_UPDATE_FEED_URL。示例：https://download.example.com/jco/updates')
  process.exit(1)
}
const parsed = new URL(feedUrl)
const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)
if (
  parsed.protocol !== 'https:' &&
  !(parsed.protocol === 'http:' && local && process.env.JCO_UPDATE_ALLOW_INSECURE === '1')
) {
  console.error('更新源必须是 HTTPS；本机联调才允许显式设置 JCO_UPDATE_ALLOW_INSECURE=1 使用 localhost HTTP。')
  process.exit(1)
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: APP,
    env: { ...process.env, JCO_UPDATE_FEED_URL: feedUrl },
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--win', 'nsis', '--config', 'electron-builder.release.yml', '--publish', 'never'])
run('node', ['scripts/qa-packaged.mjs'])

const channelFiles = fs.readdirSync(RELEASE).filter((name) => /^(latest|alpha|beta|rc|next)\.ya?ml$/i.test(name))
if (channelFiles.length === 0) {
  console.error('打包完成但没有生成更新通道 yml；请检查 electron-builder.release.yml。')
  process.exit(1)
}
fs.mkdirSync(FEED, { recursive: true })
for (const file of fs.readdirSync(RELEASE)) {
  if (!/^(?:(?:latest|alpha|beta|rc|next)\.ya?ml|.*\.exe(?:\.blockmap)?)$/i.test(file)) continue
  fs.copyFileSync(path.join(RELEASE, file), path.join(FEED, file))
}

console.log(`\n更新源目录已生成：${FEED}`)
console.log(`通道文件：${channelFiles.join('、')}`)
console.log(`把该目录中的通道 yml、安装包和 blockmap 原样上传到：${feedUrl}`)
