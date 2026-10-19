export interface UpdateChannelInput {
  feedUrl?: unknown
  checkIntervalHours?: unknown
  allowPrerelease?: unknown
}

export interface UpdateChannelConfig {
  feedUrl: string
  checkIntervalHours: number
  allowPrerelease: boolean
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message = '操作超时'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), Math.max(1, timeoutMs))
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * 自动更新源只接受 HTTPS；本地联调必须显式允许 HTTP，避免生产环境误用明文源。
 */
export function normalizeUpdateFeedUrl(raw: unknown, allowInsecure = false): string {
  const value = String(raw || '').trim()
  if (!value) return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('更新地址不是合法 URL')
  }
  if (url.username || url.password) throw new Error('更新地址不能包含账号密码')
  if (url.protocol === 'https:') return url.toString().replace(/\/$/, '')
  if (url.protocol === 'http:' && allowInsecure && LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    return url.toString().replace(/\/$/, '')
  }
  throw new Error('自动更新地址必须使用 HTTPS；本机联调需显式允许 HTTP')
}

export function normalizeUpdateChannel(
  input: UpdateChannelInput = {},
  options: { allowInsecure?: boolean; currentVersion?: string } = {},
): UpdateChannelConfig {
  const rawInterval = Number(input.checkIntervalHours)
  const checkIntervalHours = Number.isFinite(rawInterval) ? Math.min(168, Math.max(1, Math.round(rawInterval))) : 4
  const isPrerelease = /-(?:alpha|beta|rc)\./i.test(String(options.currentVersion || ''))
  return {
    feedUrl: normalizeUpdateFeedUrl(input.feedUrl, options.allowInsecure === true),
    checkIntervalHours,
    allowPrerelease: input.allowPrerelease == null ? isPrerelease : input.allowPrerelease === true,
  }
}
