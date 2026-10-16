// J.Co 发布引擎 · 主进程核心逻辑（平台无关）
// 设计依据：docs/plans/M1-发布工作流/（已冻结）——技术方案 / 接口契约
// 红线：本模块不含任何"点击发布"能力；一切平台差异由适配包（publish/platforms/<平台>/）承担。
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'

// ---------- 状态机（契约 §1） ----------

export type PublishState =
  | 'idle'
  | 'launching'
  | 'opening'
  | 'awaiting_login'
  | 'uploading'
  | 'filling'
  | 'ready'
  | 'stopped'
  | 'error'

export const PUBLISH_STATES: PublishState[] = [
  'idle',
  'launching',
  'opening',
  'awaiting_login',
  'uploading',
  'filling',
  'ready',
  'stopped',
  'error',
]

export const VALID_TRANSITIONS: Record<PublishState, PublishState[]> = {
  idle: ['launching'],
  launching: ['opening', 'stopped', 'error'],
  opening: ['awaiting_login', 'uploading', 'stopped', 'error'],
  awaiting_login: ['uploading', 'stopped', 'error'],
  uploading: ['filling', 'stopped', 'error'],
  filling: ['ready', 'stopped', 'error'],
  ready: ['stopped'],
  stopped: [],
  error: [],
}

export function canTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from as PublishState]
  return Array.isArray(allowed) && allowed.includes(to as PublishState)
}

// ---------- 错误码 → 用户文案（契约 §5） ----------

export const FRIENDLY_ERRORS: Record<string, string> = {
  BROWSER_MISSING: '没找到 Microsoft Edge 浏览器，请先安装',
  LOGIN_TIMEOUT: '等扫码等太久了，先收工；要继续再点一次',
  PAGE_CHANGED: '抖音页面改版了，需要我更新一下适配',
  UPLOAD_FAILED: '视频上传没成功，可以再试一次',
  TIMEOUT: '这一步等太久了，已停止；可重试',
  BUSY: '上一个发布还没结束，先等它完成',
  PLATFORM_UNSUPPORTED: '这个平台还没有做适配',
  INTERNAL: '出了点问题',
}

export function friendlyPublishError(code: string, raw?: string): string {
  const base = FRIENDLY_ERRORS[code]
  if (code in FRIENDLY_ERRORS && code !== 'INTERNAL') return String(base)
  const detail = raw && raw !== '' ? `：${raw}` : ''
  return `${FRIENDLY_ERRORS.INTERNAL}${detail}（请把这段话发给产品负责人）`
}

// ---------- 引擎事件行解析（契约 §3） ----------

export type EngineEvent =
  | { type: 'state'; state: PublishState; detail?: string }
  | { type: 'error'; code: string; message?: string }
  | { type: 'log'; message: string }

export function parseEngineLine(line: string): EngineEvent | null {
  const text = String(line || '').trim()
  if (text === '') return null
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.type === 'state' && PUBLISH_STATES.includes(obj.state as PublishState)) {
    const detail = typeof obj.detail === 'string' ? obj.detail : undefined
    return detail === undefined
      ? { type: 'state', state: obj.state as PublishState }
      : { type: 'state', state: obj.state as PublishState, detail }
  }
  if (obj.type === 'error' && typeof obj.code === 'string') {
    const message = typeof obj.message === 'string' ? obj.message : undefined
    return message === undefined ? { type: 'error', code: obj.code } : { type: 'error', code: obj.code, message }
  }
  if (obj.type === 'log' && typeof obj.message === 'string') {
    return { type: 'log', message: obj.message }
  }
  return null
}

// ---------- 平台与载荷校验（契约 §2） ----------

export function normalizePlatform(name: unknown): string {
  const value = String(name || '')
    .trim()
    .toLowerCase()
  return /^[a-z][a-z0-9-]{0,31}$/.test(value) ? value : ''
}

export interface StartPayload {
  platform: string
  videoPath: string
  title: string
  topics: string[]
}

export type ValidateResult = { ok: true; value: StartPayload } | { ok: false; error: string }

export function validateStartPayload(payload: unknown): ValidateResult {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const platform = normalizePlatform(p.platform)
  if (platform === '') return { ok: false, error: '平台参数不合法' }
  const videoPath = String(p.videoPath || '')
  if (videoPath === '') return { ok: false, error: '缺少视频文件' }
  const title = String(p.title || '')
  const topics = Array.isArray(p.topics) ? p.topics.map(String).filter((t) => t !== '') : []
  return { ok: true, value: { platform, videoPath, title, topics } }
}

// ---------- 打包路径映射（asar → asar.unpacked；吸取 M0 打包经验） ----------

export function unpackedPath(filePath: string): string {
  const marker = `app.asar${sep}`
  const unpacked = `app.asar.unpacked${sep}`
  return filePath.includes(marker) ? filePath.replace(marker, unpacked) : filePath
}

// ---------- 任务管理（单例 + 子进程 + 状态机守卫） ----------

export interface EngineHostConfig {
  /** 引擎子进程脚本绝对路径（打包版需经 unpackedPath 映射） */
  enginePath: string
  /** 适配包根目录（publish/platforms） */
  platformsDir: string
  /** node/electron 可执行文件（内核同款：execPath + ELECTRON_RUN_AS_NODE） */
  execPath: string
  /** 各平台登录态目录的父目录（本机持久，不上云） */
  profileRoot: string
}

export interface TaskEvent {
  platform: string
  state: PublishState
  detail?: string
  error?: string
}

export type StartResult = { ok: true; taskId: string } | { ok: false; error: string }

interface TaskRecord {
  taskId: string
  platform: string
  child: ChildProcessWithoutNullStreams
  state: PublishState
}

export class PublishTaskManager {
  private current: TaskRecord | null = null

  constructor(
    private readonly host: EngineHostConfig,
    private readonly emit: (event: TaskEvent) => void,
  ) {}

  status(): { state: PublishState; taskId?: string; platform?: string } {
    if (!this.current) return { state: 'idle' }
    return { state: this.current.state, taskId: this.current.taskId, platform: this.current.platform }
  }

  start(payload: unknown): StartResult {
    if (this.current) return { ok: false, error: friendlyPublishError('BUSY') }
    const validated = validateStartPayload(payload)
    if (!validated.ok) return validated
    const { platform, videoPath, title, topics } = validated.value

    if (!existsSync(join(this.host.platformsDir, platform, 'adapter.mjs'))) {
      return { ok: false, error: friendlyPublishError('PLATFORM_UNSUPPORTED') }
    }
    if (!existsSync(videoPath)) {
      return { ok: false, error: '找不到视频文件，先检查素材是否还在' }
    }
    if (!existsSync(this.host.enginePath)) {
      return { ok: false, error: friendlyPublishError('INTERNAL', '发布引擎脚本缺失，请重新构建（npm run build）') }
    }

    const taskId = `pub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const profileDir = join(this.host.profileRoot, platform, 'profile')
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(
        this.host.execPath,
        [
          this.host.enginePath,
          '--platform',
          platform,
          '--video',
          videoPath,
          '--title',
          title,
          '--topics',
          JSON.stringify(topics),
          '--profile',
          profileDir,
          '--platforms-dir',
          this.host.platformsDir,
        ],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: friendlyPublishError('INTERNAL', message) }
    }

    const record: TaskRecord = { taskId, platform, child, state: 'launching' }
    this.current = record
    this.emit({ platform, state: 'launching' })
    this.wireChild(record)
    return { ok: true, taskId }
  }

  stop(taskId?: string): { ok: boolean; error?: string } {
    const record = this.current
    if (!record) return { ok: true }
    if (taskId && taskId !== record.taskId) {
      return { ok: false, error: '任务不匹配（可能已完成或已停止）' }
    }
    try {
      record.child.stdin.write(`${JSON.stringify({ cmd: 'stop' })}\n`)
    } catch {
      /* 写入失败则交给强杀兜底 */
    }
    // 3 秒兜底强杀：清理动作同样必须有最终期限（内核桥同款经验）
    setTimeout(() => {
      if (this.current === record) {
        try {
          record.child.kill()
        } catch {
          /* 已退出则无操作 */
        }
      }
    }, 3000)
    return { ok: true }
  }

  private wireChild(record: TaskRecord): void {
    let buffer = ''
    record.child.stdout.setEncoding('utf8')
    record.child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        this.handleLine(record, line)
        index = buffer.indexOf('\n')
      }
    })
    record.child.stderr.setEncoding('utf8')
    record.child.stderr.on('data', () => {
      /* 诊断日志：按契约不进状态机（暂不转发） */
    })
    record.child.on('close', () => {
      if (this.current !== record) return
      this.current = null
      if (record.state === 'ready') {
        // 浏览器被用户关掉 = 流程自然收尾
        this.emit({ platform: record.platform, state: 'stopped' })
      } else if (record.state !== 'stopped' && record.state !== 'error') {
        this.emit({
          platform: record.platform,
          state: 'error',
          error: friendlyPublishError('INTERNAL', '发布助手意外退出'),
        })
      }
    })
  }

  private handleLine(record: TaskRecord, line: string): void {
    const event = parseEngineLine(line)
    if (!event || event.type === 'log') return
    if (event.type === 'error') {
      record.state = 'error'
      this.emit({
        platform: record.platform,
        state: 'error',
        error: friendlyPublishError(event.code, event.message),
      })
      return
    }
    if (!canTransition(record.state, event.state)) return // 非法转移：状态机守卫，不转发
    record.state = event.state
    this.emit({ platform: record.platform, state: event.state, detail: event.detail })
  }
}

// ---------- 发布会话管理（M2：AI 的"手"的宿主——浏览器 + 本机工具端点） ----------

export interface SessionHostConfig {
  /** 会话服务脚本绝对路径（打包版需经 unpackedPath 映射） */
  serverPath: string
  /** node/electron 可执行文件 */
  execPath: string
  /** 各平台登录态目录的父目录（本机持久，按平台隔离：<profileRoot>/<平台>/profile） */
  profileRoot: string
  /** 会话端点文件（插件按此文件动态取址） */
  sessionFile: string
  /** 诊断截图目录 */
  shotsDir: string
}

export interface SessionEvent {
  type: string
  detail?: string
}

export class PublishSessionManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private currentPlatform: string | null = null

  constructor(
    private readonly host: SessionHostConfig,
    private readonly emit: (event: SessionEvent) => void,
  ) {}

  status(): { active: boolean; ready: boolean; platform: string | null } {
    let ready = false
    if (this.child) {
      try {
        // 就绪 = 会话文件属于"当前这个进程与这个平台"（防止切平台竞态误判）
        const data = JSON.parse(readFileSync(this.host.sessionFile, 'utf8')) as { pid?: number; platform?: string }
        ready = data.pid === this.child.pid && data.platform === this.currentPlatform
      } catch {
        ready = false
      }
    }
    return { active: this.child !== null, ready, platform: this.currentPlatform }
  }

  start(platform?: string): { ok: boolean; already?: boolean; error?: string } {
    const platformId = typeof platform === 'string' && platform !== '' ? platform : 'douyin'
    if (this.child) {
      if (this.currentPlatform === platformId) return { ok: true, already: true }
      // 平台切换：歇旧、起新（不同平台 = 不同登录态目录，互不锁；旧会话异步收尾）
      this.stop()
      this.child = null
      this.currentPlatform = null
    }
    try {
      const profileDir = join(this.host.profileRoot, platformId, 'profile')
      const child = spawn(
        this.host.execPath,
        [
          this.host.serverPath,
          '--platform',
          platformId,
          '--profile-dir',
          profileDir,
          '--session-file',
          this.host.sessionFile,
          '--shots-dir',
          this.host.shotsDir,
        ],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
      this.child = child
      this.currentPlatform = platformId
      let buffer = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          try {
            const parsed = JSON.parse(line) as { event?: string; message?: string; endpoint?: string }
            if (parsed && typeof parsed.event === 'string') {
              this.emit({ type: parsed.event, detail: parsed.message || parsed.endpoint })
            }
          } catch {
            /* 非 JSON 行忽略 */
          }
          index = buffer.indexOf('\n')
        }
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', () => {
        /* 诊断日志暂不转发 */
      })
      child.on('close', () => {
        if (this.child === child) {
          this.child = null
          this.currentPlatform = null
        }
        this.emit({ type: 'closed' })
      })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }

  stop(): { ok: boolean } {
    const child = this.child
    if (!child) return { ok: true }
    try {
      child.stdin.write('stop\n')
    } catch {
      /* 写入失败则走强杀兜底 */
    }
    // 3 秒兜底强杀（清理动作同样有最终期限）
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 已退出则无操作 */
      }
    }, 3000)
    return { ok: true }
  }
}
