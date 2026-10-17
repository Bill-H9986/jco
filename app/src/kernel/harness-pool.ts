/**
 * 按 profile 管理独立 Harness 实例。
 *
 * - 懒创建、同 profile 复用；
 * - 同一 profile 内严格串行（一个内核进程一次只服务一个回合）；
 * - 不同 profile 各自一条队列，可并行；
 * - close()/reset() 负责回收子进程。
 */
import type { KernelProfile } from './profiles.js'

export interface HarnessRunOptions {
  sessionId?: string
  onNotification?: (notification: unknown) => void
}

export interface PoolHarness<Result = unknown> {
  run(prompt: string, options?: HarnessRunOptions): Promise<Result>
  close(): Promise<void>
  start?(): Promise<void>
}

export interface HarnessFactory<Result = unknown> {
  create(profile: KernelProfile): Promise<PoolHarness<Result>> | PoolHarness<Result>
}

interface PoolEntry<Result> {
  harness: Promise<PoolHarness<Result>>
  queue: Promise<void>
}

/**
 * 关闭内核时不能无限等待：SDK 的关闭阶梯本身应有界，但实测某些环境
 * 会卡在等待子进程退出。超时后放弃等待，进程随父进程退出回收。
 */
async function closeWithTimeout(harness: PoolHarness<unknown>, timeoutMs = 3000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      harness.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
        if (timer && typeof timer === 'object' && 'unref' in timer) timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class HarnessPool<Result = unknown> {
  private readonly entries = new Map<KernelProfile, PoolEntry<Result>>()

  constructor(private readonly factory: HarnessFactory<Result>) {}

  has(profile: KernelProfile): boolean {
    return this.entries.has(profile)
  }

  private entry(profile: KernelProfile): PoolEntry<Result> {
    const existing = this.entries.get(profile)
    if (existing) return existing
    const harness = Promise.resolve(this.factory.create(profile))
    const created: PoolEntry<Result> = { harness, queue: Promise.resolve() }
    this.entries.set(profile, created)
    return created
  }

  async start(profile: KernelProfile): Promise<void> {
    const harness = await this.entry(profile).harness
    if (typeof harness.start === 'function') await harness.start()
  }

  run(profile: KernelProfile, prompt: string, options?: HarnessRunOptions): Promise<Result> {
    const entry = this.entry(profile)
    const run = entry.queue.then(async () => {
      const harness = await entry.harness
      return await harness.run(prompt, options)
    })
    entry.queue = run.then(
      () => {},
      () => {},
    )
    return run
  }

  /**
   * 关闭并移除一个 profile（超时、配置变更时用）。
   * force=true 时不等待正在进行的回合，直接回收子进程（用于回合超时）。
   */
  async reset(profile: KernelProfile, options: { force?: boolean } = {}): Promise<void> {
    const entry = this.entries.get(profile)
    if (!entry) return
    this.entries.delete(profile)
    if (!options.force) await entry.queue.catch(() => {})
    try {
      const harness = await entry.harness
      await closeWithTimeout(harness as PoolHarness<unknown>)
    } catch {
      /* 创建失败或关闭失败都不阻塞后续重建 */
    }
  }

  async close(): Promise<void> {
    const profiles = [...this.entries.keys()]
    for (const profile of profiles) {
      await this.reset(profile)
    }
  }
}
