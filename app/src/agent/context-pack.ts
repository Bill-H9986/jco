/**
 * Context Pack：把系统、品牌、任务、历史、技能、外部资料装进一个有预算的上下文。
 *
 * 纪律：
 * - 外部内容永远标记为资料，不冒充指令；
 * - 系统 / 任务优先，外部资料最后；
 * - 所有截断都带明确标记，且只影响模型上下文，不回写消息存储；
 * - API Key、Bearer、password 等敏感值在进入上下文前脱敏。
 */

export type ContextKind = 'system' | 'brand' | 'task' | 'history' | 'skill' | 'external' | 'tool-result'

export interface ContextSource {
  id: string
  kind: ContextKind
  content: string
  /** 越大越先进入上下文；不填按 kind 默认优先级 */
  priority?: number
  /** 单段最多保留多少字；超出时显式截断 */
  maxChars?: number
  /** 外部内容默认不可信；只有明确 trusted=true 才不包 external_content */
  trusted?: boolean
}

export interface ContextPackOptions {
  /** 整包最多多少字；默认 12000 */
  maxChars?: number
  /** 是否给不可信内容包标签；默认 true */
  wrapExternal?: boolean
}

export interface ContextSection {
  id: string
  kind: ContextKind
  chars: number
  truncated: boolean
  redactions: number
}

export interface ContextPack {
  text: string
  sections: ContextSection[]
  dropped: string[]
  redactions: number
}

const DEFAULT_PRIORITY: Record<ContextKind, number> = {
  system: 100,
  task: 90,
  brand: 80,
  history: 50,
  skill: 40,
  external: 30,
  'tool-result': 20,
}

const SECRET_PATTERNS: Array<RegExp> = [
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi,
]

/** 脱敏常见凭据形态；返回替换次数，便于审计。 */
export function redactSecrets(text: string): { text: string; count: number } {
  let output = String(text || '')
  let count = 0
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, () => {
      count += 1
      return '[已脱敏]'
    })
  }
  return { text: output, count }
}

function truncateWithMarker(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const marker = `\n[已截断：原文 ${text.length} 字，仅保留前 ${Math.max(0, maxChars)} 字]`
  const keep = Math.max(0, maxChars - marker.length)
  return { text: text.slice(0, keep) + marker, truncated: true }
}

function isTrusted(source: ContextSource): boolean {
  if (typeof source.trusted === 'boolean') return source.trusted
  return source.kind !== 'external' && source.kind !== 'tool-result'
}

function escapeAttr(value: string): string {
  return String(value || '').replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;'
    if (char === '<') return '&lt;'
    if (char === '>') return '&gt;'
    if (char === '"') return '&quot;'
    return '&#39;'
  })
}

export function buildContextPack(sources: ContextSource[], options: ContextPackOptions = {}): ContextPack {
  const maxChars = Math.max(0, options.maxChars ?? 12_000)
  const wrapExternal = options.wrapExternal !== false
  const ordered = sources
    .map((source, index) => ({
      source,
      index,
      priority: source.priority ?? DEFAULT_PRIORITY[source.kind] ?? 0,
    }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)

  const sections: ContextSection[] = []
  const dropped: string[] = []
  const chunks: string[] = []
  let used = 0
  let redactions = 0

  for (const { source } of ordered) {
    const redacted = redactSecrets(source.content)
    redactions += redacted.count
    const perSource =
      source.maxChars == null
        ? { text: redacted.text, truncated: false }
        : truncateWithMarker(redacted.text, source.maxChars)
    let text = perSource.text.trim()
    if (text === '') continue

    if (wrapExternal && !isTrusted(source)) {
      text = `<external_content source="${escapeAttr(source.id)}">\n${text}\n</external_content>`
    }

    const remaining = maxChars - used
    if (remaining <= 0) {
      dropped.push(source.id)
      continue
    }

    let finalText = text
    let truncated = perSource.truncated
    if (finalText.length > remaining) {
      if (remaining <= 80) {
        dropped.push(source.id)
        continue
      }
      const clipped = truncateWithMarker(finalText, remaining)
      finalText = clipped.text
      truncated = true
    }

    chunks.push(finalText)
    used += finalText.length
    sections.push({
      id: source.id,
      kind: source.kind,
      chars: finalText.length,
      truncated,
      redactions: redacted.count,
    })
  }

  return {
    text: chunks.join('\n\n'),
    sections,
    dropped,
    redactions,
  }
}
