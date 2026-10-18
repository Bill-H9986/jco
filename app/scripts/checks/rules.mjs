/**
 * 全项目扫描规则（W0-06）。
 *
 * 规则只负责“找出违规”；是否放行存量由基线文件决定。
 * 基线只允许减少，不允许新增：新增违规会让 `npm run gate` 失败。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'test-results', 'playwright-report', '.git'])

function pageFile(rel) {
  return rel.startsWith('设计原型/') && rel.endsWith('.html')
}

function kernelFile(rel) {
  return (
    (rel.startsWith('app/kernel/') && (rel.endsWith('.mjs') || rel.endsWith('.js'))) ||
    (rel.startsWith('app/src/') && (rel.endsWith('.ts') || rel.endsWith('.mjs'))) ||
    rel === 'app/main.js'
  )
}

export const RULES = [
  {
    id: 'no-direct-business-localstorage',
    title: '业务页面不得直接读写旧 jco-* 业务 key',
    include: pageFile,
    patterns: [
      /localStorage\.(?:getItem|setItem|removeItem)\(\s*['"](jco-[^'"]+)['"]/g,
      /localStorage\[\s*['"](jco-[^'"]+)['"]\s*\]/g,
    ],
  },
  {
    id: 'no-hardcoded-industry',
    title: '系统提示词、页面示例、默认任务不得写死行业',
    include: (rel) => pageFile(rel) || kernelFile(rel),
    patterns: [/(成人学历|成人高考|自考|招生|学历提升|学历规划|学员|院校|报名|升本|教育|培训|课程)/g],
  },
  {
    id: 'no-chat-browser-tools',
    title: 'chat / writer profile 不得挂浏览器或编辑工具',
    custom: 'chat-profile',
  },
  {
    id: 'no-direct-tasks-dispatch',
    title: '页面不得直接派活，必须走 TaskService',
    include: pageFile,
    patterns: [/\btasks\.dispatch\s*\(/g, /tasks:dispatch/g],
  },
  {
    id: 'no-duplicate-sidebar',
    title: '页面不得再复制侧栏',
    include: pageFile,
    patterns: [/<aside\s+class=["']sidebar["']/g],
  },
  {
    id: 'no-message-truncation',
    title: '消息落盘 / 回读不得千字以上截断',
    include: (rel) => pageFile(rel) || rel === 'app/main.js' || (rel.startsWith('app/src/') && rel.endsWith('.ts')),
    patterns: [
      /\.slice\(\s*0\s*,\s*(\d{4,})\s*\)/g,
      /\.substring\(\s*0\s*,\s*(\d{4,})\s*\)/g,
      /\bclipSafe\([^,]+,\s*(\d{4,})\s*\)/g,
    ],
  },
]

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') line += 1
  return line
}

/** 在一段文本上执行规则；返回统一结构的违规项 */
export function scanText(rule, rel, text) {
  if (!rule || !Array.isArray(rule.patterns)) return []
  const found = []
  const seen = new Set()
  for (const pattern of rule.patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const re = new RegExp(pattern.source, flags)
    for (const match of text.matchAll(re)) {
      const line = lineOf(text, match.index || 0)
      const excerpt = String(match[0] || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
      const key = `${line}|${excerpt}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ ruleId: rule.id, file: rel, line, excerpt })
    }
  }
  return found
}

/** 从 `key: { ... }` 中取出完整对象文本（支持字符串里的花括号） */
function extractObject(source, key) {
  const keyIndex = source.search(new RegExp(`\\b${key}\\s*:`))
  if (keyIndex < 0) return null
  const open = source.indexOf('{', keyIndex)
  if (open < 0) return null
  let depth = 0
  let quote = ''
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (quote !== '') {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return null
}

/** chat / writer 的 profile 文本检查（W0-05 的核心契约） */
export function scanChatProfile(source, rel = 'app/src/kernel/profiles.ts') {
  const violations = []
  for (const profile of ['chat', 'writer']) {
    const block = extractObject(source, profile)
    if (!block) {
      violations.push({
        ruleId: 'no-chat-browser-tools',
        file: rel,
        line: 1,
        excerpt: `缺少 ${profile} profile`,
      })
      continue
    }
    const line = lineOf(source, source.indexOf(`${profile}:`))
    if (!/allowedTools:\s*\[\s*\]/.test(block)) {
      violations.push({
        ruleId: 'no-chat-browser-tools',
        file: rel,
        line,
        excerpt: `${profile}.allowedTools 必须为空`,
      })
    }
    if (!/toolPacks:\s*\[\s*\]/.test(block)) {
      violations.push({
        ruleId: 'no-chat-browser-tools',
        file: rel,
        line,
        excerpt: `${profile}.toolPacks 必须为空`,
      })
    }
  }
  return violations
}

function walk(dir, relBase, include, out) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const abs = path.join(dir, name)
    const rel = relBase ? `${relBase}/${name}` : name
    let info
    try {
      info = statSync(abs)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      if (SKIP_DIRS.has(name) || rel === '设计原型/assets') continue
      walk(abs, rel, include, out)
    } else if (include(rel)) {
      out.push({ abs, rel })
    }
  }
}

/** 扫描整个项目（页面 + 内核 + 主进程 + 领域层） */
export function scanProject(projectRoot, rules = RULES) {
  const files = []
  walk(projectRoot, '', (rel) => rules.some((rule) => rule.include?.(rel)), files)
  const violations = []
  for (const file of files) {
    const text = readFileSync(file.abs, 'utf8')
    for (const rule of rules) {
      if (rule.include?.(file.rel)) violations.push(...scanText(rule, file.rel, text))
    }
  }
  const profileRule = rules.find((rule) => rule.custom === 'chat-profile')
  if (profileRule) {
    try {
      const rel = 'app/src/kernel/profiles.ts'
      violations.push(...scanChatProfile(readFileSync(path.join(projectRoot, rel), 'utf8'), rel))
    } catch {
      violations.push({
        ruleId: 'no-chat-browser-tools',
        file: 'app/src/kernel/profiles.ts',
        line: 1,
        excerpt: '无法读取 profiles.ts',
      })
    }
  }
  violations.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.file.localeCompare(b.file) || a.line - b.line)
  // 同一文件/规则可能出现多条完全相同的文字（例如多个“招生”）；
  // 给它们按出现顺序编号，避免新增一条重复违规被误认为存量。
  const occurrences = new Map()
  for (const violation of violations) {
    const key = `${violation.ruleId}|${violation.file}|${normalizeExcerpt(violation.excerpt)}`
    const index = occurrences.get(key) || 0
    violation.occurrence = index
    occurrences.set(key, index + 1)
  }
  return violations
}

/** 基线指纹：规则 + 文件 + 违规文本；不含行号，移动代码不会让基线失效 */
export function fingerprint(violation) {
  const suffix = violation.occurrence === undefined ? '' : `|#${violation.occurrence}`
  return [violation.ruleId, violation.file, normalizeExcerpt(violation.excerpt)].join('|') + suffix
}

function normalizeExcerpt(excerpt) {
  return String(excerpt || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 把违规分成“存量（基线内）”和“新增（必须失败）” */
export function filterBaseline(violations, baseline) {
  const entries = Array.isArray(baseline?.entries) ? baseline.entries : []
  const knownKeys = new Set(entries.map((entry) => entry.fingerprint || fingerprint(entry)))
  const known = []
  const fresh = []
  for (const violation of violations) {
    if (knownKeys.has(fingerprint(violation))) known.push(violation)
    else fresh.push(violation)
  }
  const hit = new Set(known.map(fingerprint))
  const stale = entries.filter((entry) => !hit.has(entry.fingerprint || fingerprint(entry)))
  return { known, fresh, stale }
}

/** 解析《全站迁移矩阵》的页面状态总表 */
export function parsePageMatrix(text) {
  const sectionMatch = text.match(/###\s*2\.0\s*页面状态总表([\s\S]*?)(?=\n###|\n##|$)/)
  const body = sectionMatch ? sectionMatch[1] : text
  const statuses = { pending: 0, in_progress: 0, blocked: 0, compat: 0, verified: 0 }
  const pages = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cols = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
    if (cols.length < 3) continue
    const rawStatus = cols[cols.length - 1]
    const match = rawStatus.match(/^(pending|in_progress|blocked|compat|verified)/)
    if (!match) continue
    const status = match[1]
    pages.push({ page: cols[0], status })
    statuses[status] += 1
  }
  return { total: pages.length, verified: statuses.verified, statuses, pages }
}

/** 解析工作队列：按层统计单元状态 */
export function parseWorkQueue(text) {
  const statuses = { pending: 0, in_progress: 0, blocked: 0, verified: 0 }
  const byLayer = {}
  let total = 0
  for (const line of text.split(/\r?\n/)) {
    if (!/^\|\s*W\d-\d{2}\s*\|/.test(line)) continue
    const cols = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
    if (cols.length < 6) continue
    const layer = cols[1]
    const status = cols[cols.length - 1]
    if (!Object.hasOwn(statuses, status)) continue
    total += 1
    statuses[status] += 1
    byLayer[layer] = byLayer[layer] || { pending: 0, in_progress: 0, blocked: 0, verified: 0 }
    byLayer[layer][status] += 1
  }
  return { total, verified: statuses.verified, statuses, byLayer }
}
