/**
 * 单次 Agent 运行预算：模型调用、工具调用、token、墙钟、重试。
 *
 * 预算不是“建议”，是可检查的硬约束；超限抛 BUDGET_EXCEEDED，
 * 调用方必须停下来如实报告，不能悄悄继续烧钱。
 */

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface BudgetLimits {
  maxModelCalls?: number
  maxToolCalls?: number
  maxTokens?: number
  maxWallMs?: number
  maxRetries?: number
  /** 每 1K input token 的单价；未配置时成本保持 null，不编造 */
  inputPricePer1k?: number
  outputPricePer1k?: number
}

export interface BudgetUsed {
  modelCalls: number
  toolCalls: number
  tokens: number
  retries: number
}

export interface BudgetSnapshot {
  limits: BudgetLimits
  used: BudgetUsed
  elapsedMs: number
  costUsd: number | null
  exceeded: string[]
}

export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED'
  readonly retryable = false

  constructor(
    readonly metric: keyof BudgetUsed | 'wallMs',
    readonly limit: number,
    readonly actual: number,
  ) {
    super(`运行预算超限：${metric} ${actual} > ${limit}`)
    this.name = 'BudgetExceededError'
  }
}

export class BudgetTracker {
  private readonly limits: BudgetLimits
  private readonly clock: () => number
  private startedAt = 0
  private used: BudgetUsed = { modelCalls: 0, toolCalls: 0, tokens: 0, retries: 0 }
  private costUsd: number | null = null

  constructor(limits: BudgetLimits = {}, clock: () => number = Date.now) {
    this.limits = { ...limits }
    this.clock = clock
  }

  start(): void {
    this.startedAt = this.clock()
    this.used = { modelCalls: 0, toolCalls: 0, tokens: 0, retries: 0 }
    this.costUsd = null
  }

  recordModelCall(usage?: TokenUsage): void {
    this.used.modelCalls += 1
    if (!usage) return
    const input = Math.max(0, Number(usage.inputTokens) || 0)
    const output = Math.max(0, Number(usage.outputTokens) || 0)
    const total = Math.max(0, Number(usage.totalTokens ?? input + output) || 0)
    this.used.tokens += total

    const inputPrice = this.limits.inputPricePer1k
    const outputPrice = this.limits.outputPricePer1k
    if (typeof inputPrice === 'number' && typeof outputPrice === 'number') {
      const previous = this.costUsd ?? 0
      this.costUsd = previous + (input / 1000) * Math.max(0, inputPrice) + (output / 1000) * Math.max(0, outputPrice)
    }
  }

  recordToolCall(): void {
    this.used.toolCalls += 1
  }

  recordRetry(): void {
    this.used.retries += 1
  }

  elapsedMs(): number {
    return Math.max(0, this.clock() - this.startedAt)
  }

  private violations(): Array<{ metric: keyof BudgetUsed | 'wallMs'; limit: number; actual: number }> {
    const checks: Array<{ metric: keyof BudgetUsed | 'wallMs'; limit?: number; actual: number }> = [
      { metric: 'modelCalls', limit: this.limits.maxModelCalls, actual: this.used.modelCalls },
      { metric: 'toolCalls', limit: this.limits.maxToolCalls, actual: this.used.toolCalls },
      { metric: 'tokens', limit: this.limits.maxTokens, actual: this.used.tokens },
      { metric: 'retries', limit: this.limits.maxRetries, actual: this.used.retries },
      { metric: 'wallMs', limit: this.limits.maxWallMs, actual: this.elapsedMs() },
    ]
    return checks
      .filter(
        (item): item is { metric: keyof BudgetUsed | 'wallMs'; limit: number; actual: number } =>
          typeof item.limit === 'number' && item.actual > item.limit,
      )
      .map((item) => ({ metric: item.metric, limit: item.limit, actual: item.actual }))
  }

  check(): void {
    const first = this.violations()[0]
    if (first) throw new BudgetExceededError(first.metric, first.limit, first.actual)
  }

  snapshot(): BudgetSnapshot {
    return {
      limits: { ...this.limits },
      used: { ...this.used },
      elapsedMs: this.elapsedMs(),
      costUsd: this.costUsd,
      exceeded: this.violations().map((item) => item.metric),
    }
  }
}
