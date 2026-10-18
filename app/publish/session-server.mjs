// J.Co 发布会话服务：常驻浏览器 + 本地工具端点（内核插件"瘦代理"的那只手）
// 启动（由主进程 spawn；ELECTRON_RUN_AS_NODE=1）：
//   session-server.mjs --profile-dir <路径> --session-file <路径> --shots-dir <路径> --allowed-domains douyin.com
// 协议：POST /tool { name, args }（Bearer token）；GET /health；stdin 收到 stop 则收工。
// 安全：仅绑定 127.0.0.1；token 随机；工具面复用 tools.mjs 白名单（无发布/删除类能力）。
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { PLATFORMS } from './platforms.mjs'
import * as tools from './tools.mjs'

const argv = process.argv.slice(2)
const arg = (flag, fallback = '') => {
  const index = argv.indexOf(flag)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback
}

const profileDir = arg('--profile-dir')
const sessionFile = arg('--session-file')
const shotsDir = arg('--shots-dir', join(process.cwd(), 'shots'))
const dataDir = arg('--data-dir', join(process.cwd(), 'publish-data'))
const assetsDir = arg('--assets-dir', '')
const platformId = arg('--platform', 'douyin')
const headless = argv.includes('--headless')
const platformConf = PLATFORMS[platformId]
if (!platformConf) {
  process.stderr.write(`[session] 未知平台：${platformId}\n`)
  process.exit(1)
}
const allowedDomains = platformConf.domains

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
    // 只删"自己的"会话文件：切平台竞态下，旧会话退出不得误删新会话的登记
    const current = JSON.parse(readFileSync(sessionFile, 'utf8'))
    if (current && current.pid === process.pid) unlinkSync(sessionFile)
  } catch {
    /* 文件不存在或已被替换 */
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
    headless,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  })
  // 预设"拒绝定位"：避免浏览器位置权限弹窗挡住操作（发布不需要位置权限；效果等同于用户点"阻止"）
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        get: () => ({
          getCurrentPosition: (_ok, err) => err && err({ code: 1, message: 'denied' }),
          watchPosition: () => 0,
          clearWatch: () => {},
        }),
      })
    } catch {
      /* 注入失败不影响主流程 */
    }
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
    const kind = `${el.tag}${el.type ? `:${el.type}` : ''}${el.editable ? '·可输入' : ''}${el.checked ? '·已选' : ''}${
      el.hidden ? '·隐藏' : ''
    }`
    parts.push(`<${kind}>`)
    if (el.hidden) parts.push('（隐藏的文件选择控件，可直接用于上传文件）')
    if (el.text) parts.push(`「${el.text}」`)
    if (el.placeholder) parts.push(`占位「${el.placeholder}」`)
    if (el.aria) parts.push(`aria「${el.aria}」`)
    lines.push(`  ${parts.join(' ')}`)
  }
  lines.push(
    '提示：click / type_text / upload_file 请使用上面的编号（ref）；上传文件可优先用"隐藏的文件选择控件"，也可用"上传视频"按钮（工具会自动处理文件对话框）。',
  )
  return lines.join('\n')
}

/** 点击 / 重定向后重新校验域名；open_page 的白名单不能只保护第一次导航。 */
function assertAllowedPage(url) {
  if (!tools.isAllowedUrl(url, allowedDomains)) {
    throw new Error(`当前页面已离开平台白名单：${String(url)}`)
  }
}

function externalPages() {
  if (!context) return []
  return context.pages().filter((item) => {
    const url = item.url()
    return url !== '' && url !== 'about:blank' && !tools.isAllowedUrl(url, allowedDomains)
  })
}

async function dispatch(toolName, args) {
  if (!TOOL_NAMES.includes(toolName) && !tools.DATA_TOOLS.includes(toolName)) {
    throw new Error(`未知工具：${toolName}`)
  }
  switch (toolName) {
    case 'open_page': {
      await tools.openPage(page, args.url, allowedDomains)
      assertAllowedPage(page.url())
      return `已打开：${String(args.url)}`
    }
    case 'snapshot':
      return await formatSnapshot()
    case 'click': {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 1500 }).catch(() => null)
      try {
        await tools.click(page, args.ref)
      } catch (error) {
        const message = String((error && error.message) || error)
        // 被上层元素遮挡：从错误里找出"真正能点到的"那个编号，直接告诉 AI 改点谁（可行动的错误）
        if (message.includes('intercepts pointer events')) {
          const candidates = [...message.matchAll(/data-jco-ref="(\d+)"/g)]
            .map((match) => Number(match[1]))
            .filter((n) => n !== Number(args.ref))
          if (candidates.length > 0) {
            throw new Error(
              `点击 [${Number(args.ref)}] 没成功：它被上层元素 [${candidates[0]}] 挡住了（那个位置真正能点到的是 [${candidates[0]}]）。请重新调用 jco_snapshot 后，点击 [${candidates[0]}]。`,
            )
          }
        }
        if (/Timeout.*exceeded/i.test(message)) {
          throw new Error(
            `点击 [${Number(args.ref)}] 等不到可点击状态（可能被遮挡，或页面正在变化）。请重新 jco_snapshot 看最新页面，再决定点哪个编号。`,
          )
        }
        throw error
      }
      const chooser = await chooserPromise
      if (chooser) {
        // 点到了"文件选择"类按钮：取消对话框，并直接告诉 AI 正确的做法（可行动的错误）
        await chooser.setFiles([]).catch(() => {})
        throw new Error(
          `点击 [${Number(args.ref)}] 弹出的是"文件选择"对话框（这是个上传类按钮）。要传文件请改用 jco_upload_file(${Number(args.ref)}, "文件绝对路径")。`,
        )
      }
      // 点击可能触发跳转或新窗口；这里再校验一次，防止白名单被一次点击绕过。
      await page.waitForTimeout(350).catch(() => {})
      const escaped = externalPages()
      if (escaped.length > 0) {
        const urls = escaped
          .map((item) => item.url())
          .slice(0, 3)
          .join(' | ')
        for (const item of escaped) {
          await item.close().catch(() => {})
        }
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {})
        throw new Error(`点击后跳到了平台白名单以外：${urls}；已拦截并尝试返回。`)
      }
      assertAllowedPage(page.url())
      return `已点击 [${Number(args.ref)}]`
    }
    case 'type_text': {
      await tools.typeText(page, args.ref, args.text)
      return `已输入到 [${Number(args.ref)}]（${String(args.text).slice(0, 40)}）`
    }
    case 'upload_file': {
      await tools.uploadFile(page, args.ref, args.file_path, assetsDir ? [assetsDir] : [])
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
    case 'save_report': {
      mkdirSync(dataDir, { recursive: true })
      const metrics = args && typeof args.metrics === 'object' && args.metrics !== null ? args.metrics : {}
      const payload = { platform: platformId, at: Date.now(), metrics, note: String((args && args.note) || '') }
      writeFileSync(join(dataDir, 'report-latest.json'), JSON.stringify(payload, null, 2), 'utf8')
      log('report saved')
      return '战报数据已保存（运营页可读取）。'
    }
    case 'save_comments': {
      mkdirSync(dataDir, { recursive: true })
      const raw = args && Array.isArray(args.items) ? args.items : []
      const items = raw.slice(0, 50).map((x) => ({
        id: String((x && x.id) || ''),
        author: String((x && x.author) || ''),
        text: String((x && x.text) || '').slice(0, 500),
        draft: String((x && x.draft) || '').slice(0, 500),
      }))
      writeFileSync(
        join(dataDir, 'comments-latest.json'),
        JSON.stringify({ platform: platformId, at: Date.now(), items }, null, 2),
        'utf8',
      )
      log(`comments saved (${items.length})`)
      return `评论数据已保存（${items.length} 条，运营页供你过目）。`
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
// 父进程退出（stdin 断开）也要收工，避免留下孤儿浏览器窗口
process.stdin.on('end', () => {
  void shutdown()
})

async function main() {
  await startBrowser()
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const endpoint = `http://127.0.0.1:${address.port}`
    writeFileSync(
      sessionFile,
      JSON.stringify({ endpoint, token, pid: process.pid, platform: platformId, startedAt: Date.now() }, null, 2),
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
