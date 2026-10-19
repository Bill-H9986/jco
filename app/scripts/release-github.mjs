#!/usr/bin/env node
/**
 * 打包并发布到 GitHub Releases。
 *
 * 用法：
 *   $env:JCO_GITHUB_REPO = 'owner/repo'
 *   npm run release:github
 *
 * 可选：
 *   JCO_UPDATE_FEED_URL 显式覆盖更新源；默认使用
 *   https://github.com/<owner/repo>/releases/latest/download
 *
 * 当前更新器使用 generic provider，因此 GitHub Release 必须标记为 latest，
 * 且资产里同时有 beta.yml、安装包和 blockmap。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(__dirname, '..')
const RELEASE = path.join(APP, 'release')
const PACKAGE = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'))
const repo = String(process.env.JCO_GITHUB_REPO || '').trim()
const version = String(PACKAGE.version || '')
const tag = `v${version}`

if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  console.error('缺少 JCO_GITHUB_REPO，格式应为 owner/repo。')
  process.exit(1)
}

const feedUrl = String(
  process.env.JCO_UPDATE_FEED_URL || `https://github.com/${repo}/releases/latest/download`,
).replace(/\/+$/, '')
let parsed
try {
  parsed = new URL(feedUrl)
} catch {
  console.error(`更新源不是合法 URL：${feedUrl}`)
  process.exit(1)
}
if (parsed.protocol !== 'https:') {
  console.error('GitHub OTA 更新源必须是 HTTPS。')
  process.exit(1)
}

function run(command, args, extraEnv = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: APP,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: APP,
    encoding: 'utf8',
    shell: false,
  })
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  }
}

const auth = capture('gh', ['auth', 'status'])
if (!auth.ok) {
  console.error('GitHub CLI 还没有登录。请先运行：gh auth login')
  console.error('登录完成后再运行本脚本；不要在脚本里粘贴长期 token。')
  process.exit(1)
}

run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--win', 'nsis', '--config', 'electron-builder.release.yml', '--publish', 'never'], {
  JCO_UPDATE_FEED_URL: feedUrl,
})
run('node', ['scripts/qa-packaged.mjs'])

const channelFile = [
  'beta.yml',
  'beta.yaml',
  'latest.yml',
  'latest.yaml',
  'rc.yml',
  'rc.yaml',
  'alpha.yml',
  'alpha.yaml',
]
  .map((name) => path.join(RELEASE, name))
  .find((file) => fs.existsSync(file))
if (!channelFile) {
  console.error('没有找到更新通道 yml。')
  process.exit(1)
}

// GitHub 会把资产名中的空格替换成点；generic provider 仍按 yml 里的 path 拼 URL。
// 在发布前把通道文件里的安装包名改成 GitHub 实际资产名，避免 404。
const channelText = fs.readFileSync(channelFile, 'utf8')
const pathLine = channelText.match(/^path:\s*(.+?)\s*$/m)
const originalInstallerName = pathLine ? pathLine[1] : ''
const installerName = originalInstallerName.replace(/ /g, '.')
if (installerName && installerName !== originalInstallerName) {
  fs.writeFileSync(channelFile, channelText.split(originalInstallerName).join(installerName), 'utf8')
}
const installerPath = path.join(RELEASE, installerName)
if (!fs.existsSync(installerPath)) {
  console.error(`通道 yml 指向的安装包不存在：${installerPath}`)
  process.exit(1)
}
const assets = [channelFile, installerPath, `${installerPath}.blockmap`].filter((file) => fs.existsSync(file))

if (assets.length < 3) {
  console.error('没有找到足够的发布资产（通道 yml / exe / blockmap）。')
  process.exit(1)
}

const view = capture('gh', ['release', 'view', tag, '--repo', repo])
if (view.ok) {
  console.log(`\n发布 ${tag} 已存在，追加并覆盖资产。`)
  run('gh', ['release', 'upload', tag, ...assets, '--repo', repo, '--clobber'])
} else {
  run('gh', [
    'release',
    'create',
    tag,
    ...assets,
    '--repo',
    repo,
    '--title',
    `J.Co ${version}`,
    '--notes',
    `J.Co ${version}：业务档案 + AI 总管自动记忆，支持 GitHub Releases OTA。`,
    '--latest',
  ])
}

console.log(`\nGitHub Release：https://github.com/${repo}/releases/tag/${tag}`)
console.log(`OTA 更新源：${feedUrl}`)
console.log('已安装的旧版本如果仍指向本地测试源，请运行 update:point-installed 切换后再重启应用。')
