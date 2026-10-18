/** 从 DSH 通知里提取可核对的运行指标，不猜测、不伪造。 */
import type { TokenUsage } from './run-budget.js'

function finite(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export function usageOf(notification: unknown): TokenUsage | null {
  if (!notification || typeof notification !== 'object') return null
  const record = notification as {
    method?: unknown
    params?: { event?: { type?: unknown; data?: { usage?: unknown } } }
  }
  if (record.method !== 'session.event') return null
  const event = record.params?.event
  if (event?.type !== 'assistant/message') return null
  const raw = event.data?.usage
  if (!raw || typeof raw !== 'object') return null
  const usage = raw as Record<string, unknown>
  const inputTokens = finite(usage.inputTokens)
  const outputTokens = finite(usage.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) return null

  const result: TokenUsage = { inputTokens, outputTokens }
  const totalTokens = finite(usage.totalTokens)
  const cacheReadTokens = finite(usage.cacheReadTokens)
  const cacheWriteTokens = finite(usage.cacheWriteTokens)
  const reasoningTokens = finite(usage.reasoningTokens)
  if (totalTokens !== undefined) result.totalTokens = totalTokens
  if (cacheReadTokens !== undefined) result.cacheReadTokens = cacheReadTokens
  if (cacheWriteTokens !== undefined) result.cacheWriteTokens = cacheWriteTokens
  if (reasoningTokens !== undefined) result.reasoningTokens = reasoningTokens
  return result
}

export interface RunMetrics {
  wallMs: number
  modelCalls: number
  toolCalls: number
  toolErrors: number
  tokens: {
    input: number
    output: number
    total: number
  }
  costUsd: number | null
}

export function emptyRunMetrics(): RunMetrics {
  return {
    wallMs: 0,
    modelCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    tokens: { input: 0, output: 0, total: 0 },
    costUsd: null,
  }
}

export function addUsage(metrics: RunMetrics, usage: TokenUsage): void {
  metrics.tokens.input += usage.inputTokens
  metrics.tokens.output += usage.outputTokens
  metrics.tokens.total += usage.totalTokens ?? usage.inputTokens + usage.outputTokens
}
