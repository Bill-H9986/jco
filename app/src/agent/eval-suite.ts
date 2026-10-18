/** J.Co Agent Eval 套件的结构与最低数量校验。 */

export const EVAL_CATEGORIES = ['会话', '任务', '数据', '内核', '工具', '安装', '安全', '质量'] as const
export type EvalCategory = (typeof EVAL_CATEGORIES)[number]
export type EvalRunner = 'vitest' | 'e2e' | 'manual' | 'live'

export interface EvalCase {
  id: string
  category: EvalCategory
  title: string
  runner: EvalRunner
  file?: string
  reason?: string
}

export interface EvalSuite {
  version: number
  cases: EvalCase[]
}

export function validateEvalSuite(input: unknown): string[] {
  const errors: string[] = []
  if (!input || typeof input !== 'object') return ['套件必须是对象']
  const suite = input as { version?: unknown; cases?: unknown }
  if (typeof suite.version !== 'number' || !Number.isInteger(suite.version) || suite.version < 1) {
    errors.push('version 必须是正整数')
  }
  if (!Array.isArray(suite.cases)) return [...errors, 'cases 必须是数组']
  if (suite.cases.length < 20 || suite.cases.length > 30) {
    errors.push(`评测任务数量必须在 20–30 之间，当前 ${suite.cases.length}`)
  }

  const ids = new Set<string>()
  for (const [index, raw] of suite.cases.entries()) {
    if (!raw || typeof raw !== 'object') {
      errors.push(`第 ${index + 1} 条不是对象`)
      continue
    }
    const item = raw as Partial<EvalCase>
    if (typeof item.id !== 'string' || item.id.trim() === '') errors.push(`第 ${index + 1} 条缺少 id`)
    else if (ids.has(item.id)) errors.push(`重复 id：${item.id}`)
    else ids.add(item.id)
    if (typeof item.title !== 'string' || item.title.trim() === '') errors.push(`${item.id || index + 1} 缺少 title`)
    if (!EVAL_CATEGORIES.includes(item.category as EvalCategory)) {
      errors.push(`${item.id || index + 1} 的分类不合法：${String(item.category)}`)
    }
    if (!['vitest', 'e2e', 'manual', 'live'].includes(String(item.runner))) {
      errors.push(`${item.id || index + 1} 的 runner 不合法`)
    }
    if ((item.runner === 'vitest' || item.runner === 'e2e') && (typeof item.file !== 'string' || item.file === '')) {
      errors.push(`${item.id || index + 1} 缺少 file`)
    }
    if (item.runner === 'manual' && (typeof item.reason !== 'string' || item.reason === '')) {
      errors.push(`${item.id || index + 1} 缺少 manual reason`)
    }
  }
  return errors
}
