// J.Co 发布引擎子进程（平台无关）——由主进程 spawn（ELECTRON_RUN_AS_NODE=1）
// 契约：stdout 行 JSON 事件（state / error / log）；stdin 行 JSON 命令（stop）。
// 红线：本文件与一切适配包绝不点击"发布"。
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const arg = (name, fallback = '') => {
  const index = argv.indexOf(name)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback
}

const platform = arg('--platform')
const videoPath = arg('--video')
const title = arg('--title')
let topics = []
try {
  topics = JSON.parse(arg('--topics', '[]'))
} catch {
  topics = []
}
const profileDir = arg('--profile')
const platformsDir = arg('--platforms-dir')

// 各步骤的最终期限（稳定约束：一切外部交互必须有上限）
const OPEN_TIMEOUT_MS = 60 * 1000
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000
const FILL_TIMEOUT_MS = 2 * 60 * 1000

let stopped = false
let context = null
let exiting = false

const emit = (obj) => {
  try {
    process.stdout.write(`${JSON.stringify(obj)}\n`)
  } catch {
    /* 输出失败不扩散 */
  }
}
const state = (s, detail) => emit(detail ? { type: 'state', state: s, detail } : { type: 'state', state: s })
const log = (message) => emit({ type: 'log', message })

async function shutdown(code = 'stopped') {
  if (exiting) return
  exiting = true
  try {
    state(code)
  } catch {
    /* 忽略 */
  }
  try {
    if (context) await context.close()
  } catch {
    /* 忽略 */
  }
  context = null
  process.exit(0)
}

async function fail(code, message) {
  if (exiting) return
  exiting = true
  emit({ type: 'error', code, message: message || '' })
  try {
    if (context) await context.close()
  } catch {
    /* 忽略 */
  }
  context = null
  process.exit(0)
}

// stdin：只认 stop 命令
process.stdin.setEncoding('utf8')
let stdinBuffer = ''
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk
  let index = stdinBuffer.indexOf('\n')
  while (index >= 0) {
    const line = stdinBuffer.slice(0, index).trim()
    stdinBuffer = stdinBuffer.slice(index + 1)
    if (line !== '') {
      try {
        const cmd = JSON.parse(line)
        if (cmd && cmd.cmd === 'stop') {
          stopped = true
          void shutdown('stopped')
        }
      } catch {
        /* 忽略非 JSON 行 */
      }
    }
    index = stdinBuffer.indexOf('\n')
  }
})

function withTimeout(promise, ms, code) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(code)
        error.code = code
        reject(error)
      }, ms)
    }),
  ])
}

async function loadAdapter() {
  const file = pathToFileURL(join(platformsDir, platform, 'adapter.mjs')).href
  const mod = await import(file)
  for (const key of ['open', 'detectLogin', 'uploadVideo', 'fillMeta', 'waitForReady']) {
    if (typeof mod[key] !== 'function') {
      throw new Error(`适配包缺少 ${key}`)
    }
  }
  return mod
}

async function main() {
  if (!platform || !platformsDir) return fail('INTERNAL', '参数缺失：platform/platforms-dir')
  const adapter = await loadAdapter()
  log(`engine start: ${platform}`)

  state('opening')

  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch (error) {
    return fail('INTERNAL', `浏览器驱动不可用：${error?.message}`)
  }

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'msedge',
      headless: false,
      viewport: null,
      // 降低自动化特征（减少平台风控对工具环境的误判；社区标准做法）。
      // 注意：这不是"绕过风控"——真遇到验证码/风控仍然如实暂停并提示，绝不硬闯。
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    })
  } catch (error) {
    const message = String(error?.message || error)
    if (/channel|Executable doesn't exist|is not found/i.test(message)) {
      return fail('BROWSER_MISSING', message)
    }
    return fail('INTERNAL', message)
  }
  if (stopped) return shutdown('stopped')

  const pages = context.pages()
  const page = pages.length > 0 ? pages[0] : await context.newPage()

  // 打开平台发布页（带上限）
  try {
    await withTimeout(adapter.open(page), OPEN_TIMEOUT_MS, 'TIMEOUT')
  } catch (error) {
    if (stopped) return
    return fail(error?.code ? error.code : 'INTERNAL', String(error?.message || error))
  }
  if (stopped) return

  // 登录等待（每 2 秒探测一次；上限 10 分钟）
  let loginAnnounced = false
  const loginDeadline = Date.now() + LOGIN_TIMEOUT_MS
  for (;;) {
    if (stopped) return
    let status = 'need_login'
    try {
      status = await adapter.detectLogin(page)
    } catch {
      status = 'need_login'
    }
    if (status === 'logged_in') break
    if (!loginAnnounced) {
      state('awaiting_login')
      loginAnnounced = true
    }
    if (Date.now() > loginDeadline) return fail('LOGIN_TIMEOUT')
    await page.waitForTimeout(2000)
  }
  if (stopped) return

  // 上传视频
  state('uploading')
  try {
    await withTimeout(
      adapter.uploadVideo(page, videoPath, (detail) => state('uploading', detail)),
      UPLOAD_TIMEOUT_MS,
      'UPLOAD_FAILED',
    )
  } catch (error) {
    if (stopped) return
    return fail(error?.code ? error.code : 'UPLOAD_FAILED', String(error?.message || error))
  }
  if (stopped) return

  // 填写标题与话题
  state('filling')
  try {
    await withTimeout(adapter.fillMeta(page, { title, topics }), FILL_TIMEOUT_MS, 'TIMEOUT')
    await withTimeout(adapter.waitForReady(page), FILL_TIMEOUT_MS, 'TIMEOUT')
  } catch (error) {
    if (stopped) return
    return fail(error?.code ? error.code : 'PAGE_CHANGED', String(error?.message || error))
  }
  if (stopped) return

  state('ready')

  // ready 后保持运行：浏览器交给用户确认；用户关掉浏览器 = 自然收尾
  context.once('close', () => process.exit(0))
}

main().catch((error) => {
  if (stopped) {
    void shutdown('stopped')
    return
  }
  void fail('INTERNAL', String(error?.message || error))
})
