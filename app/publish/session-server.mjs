// J.Co 发布会话服务：常驻浏览器 + 本地工具端点（内核插件"瘦代理"的那只手）
// 启动（由主进程 spawn；ELECTRON_RUN_AS_NODE=1）：
//   session-server.mjs --profile-dir <路径> --session-file <路径> --shots-dir <路径> --allowed-domains douyin.com
// 协议：POST /tool { name, args }（Bearer token）；GET /health；stdin 收到 stop 则收工。
// 安全：仅绑定 127.0.0.1；token 随机；工具面复用 tools.mjs 白名单（无发布/删除类能力）。
import { randomBytes } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import * as tools from './tools.mjs'

const argv = process.argv.slice(2)
const arg = (flag, fallback = '') => {
  const index = argv.indexOf(flag)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback
}

const profileDir = arg('--profile-dir')
const sessionFile = arg('--session-file')
const shotsDir = arg('--shots-dir', join(process.cwd(), 'shots'))
const allowedDomains = arg('--allowed-domains', 'douyin.com')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean)

const TOOL_NAMES = Object.keys(tools.IMPLEMENTATIONS)
const token = randomBytes(24).toString('hex')

let context = null
let page = null
let state = 'starting'
let shuttingDown = false

const log = (message) => {
  try {
    process.stdout.write(`${JSON.stringify({ event: 'log', message, at: Date.now() })}\n`)
  } catch {
    /* 忽略输出失败 */
  }
  try {
    process.stderr.write(`[session] ${message}\n`)
  } catch {
    /* 忽略 */
  }
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  state = 'closed'
  try {
    unlinkSync(sessionFile)
  } catch {
    /* 文件可能已不存在 */
  }
  try {
    if (context) await context.close()
  } catch {
    /* 忽略关闭错误 */
  }
  process.exit(0)
}

async function startBrowser() {
  const { chromium } = await import('playwright')
  context = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge',
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const pages = context.pages()
  page = pages.length > 0 ? pages[0] : await context.newPage()
  context.on('close', () => {
    void shutdown()
  })
  state = 'ready'
  log('浏览器已就绪')
}

async function formatSnapshot() {
  const snap = await tools.snapshot(page)
  const lines = []
  lines.push('页面快照')
  lines.push(`URL：${snap.url}`)
  lines.push(`标题：${snap.title}`)
  lines.push(`滚动位置：${snap.scrollY} / 页面高 ${snap.pageHeight}`)
  if (snap.headings.length > 0) lines.push(`页面小标题：${snap.headings.join(' / ')}`)
  lines.push(`可交互元素（共 ${snap.elements.length} 个）：`)
  for (const el of snap.elements) {
    const parts = [`[${el.ref}]`]
    const kind = `${el.tag}${el.type ? `:${el.type}` : ''}${el.editable ? '·可输入' : ''}${el.checked ? '·已选' : ''}`
    parts.push(`<${kind}>`)
    if (el.text) parts.push(`「${el.text}」`)
    if (el.placeholder) parts.push(`占位「${el.placeholder}」`)
    if (el.aria) parts.push(`aria「${el.aria}」`)
    lines.push(`  ${parts.join(' ')}`)
  }
  lines.push('提示：click / type_text / upload_file 请使用上面的编号（ref）。')
  return lines.join('\n')
}

async function dispatch(toolName, args) {
  if (!TOOL_NAMES.includes(toolName)) throw new Error(`未知工具：${toolName}`)
  switch (toolName) {
    case 'open_page': {
      await tools.openPage(page, args.url, allowedDomains)
      return `已打开：${String(args.url)}`
    }
    case 'snapshot':
      return await formatSnapshot()
    case 'click': {
      await tools.click(page, args.ref)
      return `已点击 [${Number(args.ref)}]`
    }
    case 'type_text': {
      await tools.typeText(page, args.ref, args.text)
      return `已输入到 [${Number(args.ref)}]（${String(args.text).slice(0, 40)}）`
    }
    case 'upload_file': {
      await tools.uploadFile(page, args.ref, args.file_path)
      return `已向 [${Number(args.ref)}] 提交文件：${String(args.file_path)}`
    }
    case 'scroll': {
      const direction = String(args.direction || 'down')
      await tools.scroll(page, direction)
      return `已滚动：${direction}`
    }
    case 'screenshot': {
      mkdirSync(shotsDir, { recursive: true })
      const file = join(shotsDir, `shot-${Date.now().toString(36)}.png`)
      await tools.screenshot(page, file)
      return `截图已存：${file}`
    }
    case 'wait': {
      const ms = Math.min(Math.max(0, Number(args.ms) || 0), 10_000)
      await tools.wait(page, ms)
      return `已等待 ${ms} ms`
    }
    default:
      throw new Error(`未实现的工具：${toolName}`)
  }
}

const server = createServer(async (req, res) => {
  const respond = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  }
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return respond(200, { ok: true, state })
    }
    if (req.method !== 'POST' || req.url !== '/tool') {
      return respond(404, { ok: false, error: 'not found' })
    }
    if (String(req.headers.authorization || '') !== `Bearer ${token}`) {
      return respond(401, { ok: false, error: 'unauthorized' })
    }
    if (state !== 'ready') {
      return respond(409, { ok: false, error: `会话还没就绪（${state}）` })
    }
    const body = await new Promise((fulfill, reject) => {
      let buffer = ''
      req.on('data', (chunk) => {
        buffer += chunk
        if (buffer.length > 1_000_000) reject(new Error('请求过大'))
      })
      req.on('end', () => fulfill(buffer))
    })
    const payload = JSON.parse(body || '{}')
    const result = await dispatch(String(payload.name || ''), payload.args || {})
    log(`tool ${payload.name} ok`)
    respond(200, { ok: true, result })
  } catch (error) {
    const message = String((error && error.message) || error)
    log(`tool failed: ${message}`)
    respond(200, { ok: false, error: message })
  }
})

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  if (String(chunk).includes('stop')) void shutdown()
})

async function main() {
  await startBrowser()
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const endpoint = `http://127.0.0.1:${address.port}`
    writeFileSync(
      sessionFile,
      JSON.stringify({ endpoint, token, pid: process.pid, startedAt: Date.now() }, null, 2),
      'utf8',
    )
    log(`会话服务就绪：${endpoint}`)
    process.stdout.write(`${JSON.stringify({ event: 'ready', endpoint })}\n`)
  })
}

main().catch((error) => {
  log(`启动失败：${String((error && error.message) || error)}`)
  process.exit(1)
})
