/**
 * AI 总管的长期记忆：只从成功完成的内容/调研/运营任务提炼可复用经验。
 * 业务事实由用户在设置页填写；这里不把闲聊、外部网页和失败任务当事实。
 */
export interface LearnableTask {
  id: string
  title: string
  type: string
  status: string
}

export interface LearnedKnowledgeEntry {
  id: string
  title: string
  content: string
  tags: string[]
  source: 'ai'
  sourceTaskId: string
  sourceTaskTitle: string
  enabled: boolean
  updatedAt: number
}

const LEARNABLE_TYPES = new Set(['operate', 'research', 'content'])
const TYPE_LABELS: Record<string, string> = {
  operate: '运营',
  research: '调研',
  content: '内容',
}
const MAX_LEARNED_CONTENT = 1800
const MAX_DEDUPE_KEY = 2000
const MEMORY_MARKER = /(?:^|\n)\s*【(?:可复用记忆|长期记忆|记忆)】\s*([\s\S]*)$/

export function shouldLearnFromTask(task: Pick<LearnableTask, 'type' | 'status'>): boolean {
  return task.status === 'done' && LEARNABLE_TYPES.has(task.type)
}

function extractMemoryText(resultText: string): string {
  const cleaned = String(resultText || '')
    .replace(/\r\n/g, '\n')
    .trim()
  const marked = cleaned.match(MEMORY_MARKER)
  return (marked ? marked[1] : cleaned).trim()
}

export function buildLearnedKnowledge(
  task: LearnableTask,
  resultText: string,
  now = Date.now(),
): LearnedKnowledgeEntry | null {
  if (!shouldLearnFromTask(task)) return null
  if (!String(task.id || '').trim()) return null
  const content = extractMemoryText(resultText).slice(0, MAX_LEARNED_CONTENT)
  if (content.length < 20) return null
  return {
    id: `learn-${task.id}`,
    title: `AI总管记录｜${String(task.title || '任务结果').slice(0, 80)}`,
    content,
    tags: ['AI自动记录', TYPE_LABELS[task.type] || task.type],
    source: 'ai',
    sourceTaskId: task.id,
    sourceTaskTitle: String(task.title || '任务结果').slice(0, 100),
    enabled: true,
    updatedAt: now,
  }
}

function contentKey(value: string): string {
  return String(value || '')
    .replace(/\s+/g, '')
    .trim()
    .slice(0, MAX_DEDUPE_KEY)
}

export function mergeLearnedKnowledge<T extends { source?: string; sourceTaskId?: string; content: string }>(
  existing: readonly T[],
  learned: T,
  limit = 100,
): T[] {
  const duplicateContent = contentKey(learned.content)
  const merged = [
    learned,
    ...existing.filter(
      (entry) => entry.sourceTaskId !== learned.sourceTaskId && contentKey(entry.content) !== duplicateContent,
    ),
  ]
  const max = Math.max(1, Math.round(limit))
  while (merged.length > max) {
    let removeAt = -1
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      if (merged[i].source === 'ai') {
        removeAt = i
        break
      }
    }
    merged.splice(removeAt >= 0 ? removeAt : merged.length - 1, 1)
  }
  return merged
}
