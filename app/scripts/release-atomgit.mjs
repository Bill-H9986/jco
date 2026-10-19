#!/usr/bin/env node
/**
 * 把现有安装包发布到 AtomGit（GitCode）Release，并生成固定 feed。
 *
 * 用法：
 *   $env:JCO_ATOMGIT_REPO = 'owner/repo'
 *   $env:JCO_ATOMGIT_TOKEN = '<仅对该仓库有写权限的 access token>'
 *   npm run release:atomgit
 *
 * 可选：
 *   JCO_ATOMGIT_BRANCH  feed 所在分支，默认 main
 *   JCO_ATOMGIT_API     自定义 API 根地址，默认 https://api.gitcode.com/api/v5
 *
 * 脚本不会打印 token；发布完成后把 release-feed/beta.yml 提交到仓库即可。
 */
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAssetDownloadUrl, buildAtomGitChannelYaml, buildFeedUrl, parseRepoSlug } from './lib/atomgit-release.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(__dirname, '..')
const RELEASE = path.join(APP, 'release')
const API = String(process.env.JCO_ATOMGIT_API || 'https://api.gitcode.com/api/v5').replace(/\/+$/, '')
const TOKEN = String(process.env.JCO_ATOMGIT_TOKEN || '').trim()
const BRANCH = String(process.env.JCO_ATOMGIT_BRANCH || 'main').trim()
const PACKAGE = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'))
const version = String(PACKAGE.version || '')
const tag = `v${version}`

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!TOKEN) fail('缺少 JCO_ATOMGIT_TOKEN。请生成仅对该仓库有写权限的 AtomGit access token。')

let repo
try {
  repo = parseRepoSlug(process.env.JCO_ATOMGIT_REPO)
} catch (error) {
  fail(`${error.message}。请设置 JCO_ATOMGIT_REPO=owner/repo。`)
}

const channelFile = ['beta.yml', 'latest.yml', 'rc.yml', 'alpha.yml']
  .map((name) => path.join(RELEASE, name))
  .find((file) => fs.existsSync(file))
if (!channelFile) fail('没有找到 release/ 下的通道 yml，请先运行 npm run release:package。')

const channelText = fs.readFileSync(channelFile, 'utf8')
const versionLine = channelText.match(/^version:\s*(.+?)\s*$/m)
const pathLine = channelText.match(/^path:\s*(.+?)\s*$/m)
const shaLine = channelText.match(/^sha512:\s*(.+?)\s*$/m)
if (!pathLine || !shaLine) fail('通道 yml 缺少 path 或 sha512。')
if (versionLine && versionLine[1] !== version) {
  fail(`通道 yml 版本 ${versionLine[1]} 与 package.json 版本 ${version} 不一致，请重新打包。`)
}

const installerName = pathLine[1]
const installerPath = path.join(RELEASE, installerName)
const blockMapPath = `${installerPath}.blockmap`
if (!fs.existsSync(installerPath)) fail(`安装包不存在：${installerPath}`)

const stat = fs.statSync(installerPath)
const assets = [{ file: installerPath, name: installerName }]
if (fs.existsSync(blockMapPath)) {
  assets.push({ file: blockMapPath, name: path.basename(blockMapPath) })
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = https.request(
      {
        method: options.method || 'GET',
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        headers: options.headers || {},
        timeout: options.timeout || 60_000,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function api(pathname, options = {}) {
  const url = new URL(`${API}${pathname}`)
  url.searchParams.set('access_token', TOKEN)
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const res = await request(url.toString(), { ...options, headers })
  return res
}

function upload(url, headers, file, onProgress) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const size = fs.statSync(file).size
    const req = https.request(
      {
        method: 'PUT',
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        headers: { ...headers, 'Content-Length': size },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve()
          else
            reject(
              new Error(`上传失败：HTTP ${res.statusCode} ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`),
            )
        })
      },
    )
    req.on('error', reject)
    const stream = fs.createReadStream(file)
    let sent = 0
    let lastLog = 0
    stream.on('data', (chunk) => {
      sent += chunk.length
      const now = Date.now()
      if (onProgress && now - lastLog > 5000) {
        lastLog = now
        onProgress(sent, size)
      }
    })
    stream.on('error', reject)
    stream.pipe(req)
  })
}

const repoCheck = await api(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`)
if (repoCheck.status === 404) fail(`仓库不存在：${repo.owner}/${repo.repo}`)
if (repoCheck.status === 401 || repoCheck.status === 403) fail('token 无效或没有该仓库权限。')
if (repoCheck.status >= 400) fail(`读取仓库失败：HTTP ${repoCheck.status}`)

const existing = await api(
  `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/${encodeURIComponent(tag)}`,
)
const body = JSON.stringify({
  tag_name: tag,
  name: `J.Co ${version}`,
  body: `J.Co ${version}：业务档案 + AI 总管自动记忆，支持 AtomGit OTA。`,
  target_commitish: BRANCH,
  release_status: 'latest',
})

if (existing.status === 200) {
  console.log(`Release ${tag} 已存在，更新说明。`)
  const patched = await api(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/${encodeURIComponent(tag)}`,
    { method: 'PATCH', body },
  )
  if (patched.status >= 400) fail(`更新 Release 失败：HTTP ${patched.status} ${patched.text.slice(0, 300)}`)
} else {
  console.log(`创建 Release ${tag}。`)
  const created = await api(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases`, {
    method: 'POST',
    body,
  })
  if (created.status >= 400) fail(`创建 Release 失败：HTTP ${created.status} ${created.text.slice(0, 300)}`)
}

for (const asset of assets) {
  const meta = await api(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(asset.name)}`,
  )
  if (meta.status >= 400) fail(`获取上传地址失败：HTTP ${meta.status} ${meta.text.slice(0, 300)}`)
  const info = JSON.parse(meta.text)
  if (!info.url) fail('上传地址响应缺少 url。')
  console.log(`上传 ${asset.name}（${(fs.statSync(asset.file).size / 1024 / 1024).toFixed(1)} MB）…`)
  await upload(info.url, info.headers || {}, asset.file, (sent, total) => {
    console.log(`  ${Math.floor((sent / total) * 100)}%`)
  })
  console.log(`  完成 ${asset.name}`)
}

const assetUrl = buildAssetDownloadUrl({ owner: repo.owner, repo: repo.repo, tag, fileName: installerName })
const feedUrl = buildFeedUrl({ owner: repo.owner, repo: repo.repo, branch: BRANCH })
const feedDir = path.join(APP, 'release-feed')
fs.mkdirSync(feedDir, { recursive: true })
const feedFile = path.join(feedDir, 'beta.yml')
fs.writeFileSync(
  feedFile,
  buildAtomGitChannelYaml({
    version,
    fileName: installerName,
    sha512: shaLine[1],
    size: stat.size,
    assetUrl,
    releaseDate: new Date().toISOString(),
  }),
  'utf8',
)

console.log(`\n安装包下载地址：${assetUrl}`)
console.log(`OTA 更新源：${feedUrl}`)
console.log(`已写入 ${feedFile}`)
console.log(`下一步：把 release-feed/beta.yml 提交并推送到 ${BRANCH} 分支，再执行 update:point-installed。`)
