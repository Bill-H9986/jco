#!/usr/bin/env node
/**
 * 全项目扫描门禁（W0-06）
 *
 * 用法：
 *   node scripts/check-all.mjs --baseline
 *   node scripts/check-all.mjs --only no-hardcoded-industry --baseline
 *   node scripts/check-all.mjs --strict
 *   node scripts/check-all.mjs --update-baseline
 *
 * 基线只放行存量；新增违规一律退出 1。`--strict` 连存量也不放行，
 * 用于 Wave 5 最终验收。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterBaseline, fingerprint, parsePageMatrix, parseWorkQueue, RULES, scanProject } from './checks/rules.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = path.resolve(APP, '..')
const BASELINE_PATH = path.join(APP, 'scripts', 'checks', 'baseline.json')
const QUEUE_PATH = path.join(PROJECT, 'docs', 'plans', 'M11-任务会话重构', '工作队列.md')
const MATRIX_PATH = path.join(PROJECT, 'docs', 'plans', 'M11-任务会话重构', '全站迁移矩阵.md')
const VISUAL_DIR = path.join(APP, 'tests', 'visual')
const VISUAL_BASELINE_DIR = path.join(VISUAL_DIR, 'baseline')

const args = process.argv.slice(2)
const json = args.includes('--json')
const strict = args.includes('--strict')
const useBaseline = args.includes('--baseline') && !strict
const updateBaseline = args.includes('--update-baseline')
const forceBaseline = args.includes('--force')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : ''

function loadBaseline() {
  if (!useBaseline || !existsSync(BASELINE_PATH)) return { version: 1, entries: [] }
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  } catch {
    return { version: 1, entries: [] }
  }
}

function printViolation(violation) {
  console.log(`   - ${violation.file}:${violation.line}  ${violation.excerpt}`)
}

function writeBaseline(violations) {
  const entries = violations
    .map((violation) => ({
      ruleId: violation.ruleId,
      file: violation.file,
      fingerprint: fingerprint(violation),
      excerpt: violation.excerpt,
    }))
    .sort(
      (a, b) => a.ruleId.localeCompare(b.ruleId) || a.file.localeCompare(b.file) || a.excerpt.localeCompare(b.excerpt),
    )
  mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        version: 1,
        note: 'W0-06 存量欠账。只允许删除，不允许新增；新增违规会让 npm run gate 失败。',
        generatedAt: new Date().toISOString(),
        entries,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return entries
}

function scanChecks() {
  const selected = RULES.filter((rule) => !only || rule.id === only)
  if (selected.length === 0) return []
  const violations = scanProject(PROJECT, selected)
  const baseline = loadBaseline()
  return selected.map((rule) => {
    const own = violations.filter((violation) => violation.ruleId === rule.id)
    const ruleBaseline = {
      ...baseline,
      entries: (baseline.entries || []).filter((entry) => entry.ruleId === rule.id),
    }
    const { known, fresh, stale } = filterBaseline(own, ruleBaseline)
    const failed = strict ? own.length > 0 : fresh.length > 0
    return {
      id: rule.id,
      title: rule.title,
      ok: !failed,
      known: known.length,
      fresh,
      stale: stale.length,
      total: own.length,
    }
  })
}

function parseFile(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function progressChecks() {
  const checks = []
  if (!only || only === 'all-pages-migrated') {
    const result = parsePageMatrix(parseFile(MATRIX_PATH))
    checks.push({
      id: 'all-pages-migrated',
      title: '16 个现有页面 + 新任务详情全部 verified',
      ok: strict ? result.total > 0 && result.verified === result.total : true,
      progress: result,
      detail: `${result.verified}/${result.total} verified`,
    })
  }
  if (!only || only === 'full-project-layers') {
    const result = parseWorkQueue(parseFile(QUEUE_PATH))
    checks.push({
      id: 'full-project-layers',
      title: '全项目迁移总表所有层 verified',
      ok: strict ? result.total > 0 && result.verified === result.total : true,
      progress: result,
      detail: `${result.verified}/${result.total} 工作单元 verified`,
    })
  }
  if (!only || only === 'cross-page-journeys') {
    const required = [
      ['选题 → 创作', 'tests/e2e/m8-topics.spec.mjs'],
      ['派活 → 任务详情', 'tests/e2e/m9e-taskbridge.spec.mjs'],
      ['发布 / 运营入口', 'tests/e2e/publish-entry.spec.mjs'],
      ['会话历史 / 新会话', 'tests/e2e/sessions.spec.mjs'],
    ]
    const missing = required.filter(([, rel]) => !existsSync(path.join(APP, rel)))
    checks.push({
      id: 'cross-page-journeys',
      title: '跨页旅程 E2E',
      ok: missing.length === 0,
      detail:
        missing.length === 0
          ? `${required.length} 条旅程用例已接入 gate 的 Playwright`
          : `缺少：${missing.map(([label]) => label).join('、')}`,
    })
  }
  if (!only || only === 'visual-regression-all') {
    const readme = path.join(VISUAL_DIR, 'README.md')
    const config = path.join(APP, 'playwright.visual.config.mjs')
    const pngs = existsSync(VISUAL_BASELINE_DIR)
      ? readdirSync(VISUAL_BASELINE_DIR).filter((name) => name.endsWith('.png'))
      : []
    const skeleton = existsSync(readme) && existsSync(config) && existsSync(VISUAL_BASELINE_DIR)
    checks.push({
      id: 'visual-regression-all',
      title: '全站关键状态视觉基准',
      ok: skeleton && pngs.length >= 17,
      detail: skeleton ? `已建立 ${pngs.length} 张基准（目标 17）` : '视觉基准骨架缺失',
    })
  }
  return checks
}

const scanResults = scanChecks()
const progress = progressChecks()
const all = [
  ...scanResults.map((item) => ({ ...item, kind: 'scan' })),
  ...progress.map((item) => ({ ...item, kind: 'progress' })),
]
const ok = all.every((item) => item.ok)

if (updateBaseline) {
  const violations = scanProject(PROJECT, RULES)
  let existingEntries = []
  try {
    existingEntries = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries || []
  } catch {
    existingEntries = []
  }
  const fresh = filterBaseline(violations, { version: 1, entries: existingEntries }).fresh
  if (fresh.length > 0 && !forceBaseline) {
    console.log(`拒绝更新基线：发现 ${fresh.length} 条新增违规。先修复，或显式加 --force。`)
    for (const violation of fresh.slice(0, 10)) printViolation(violation)
    process.exit(1)
  }
  const entries = writeBaseline(violations)
  if (json) console.log(JSON.stringify({ ok: true, updated: entries.length, baseline: BASELINE_PATH }, null, 2))
  else {
    console.log(`已写入基线：${entries.length} 条存量违规`)
    console.log(BASELINE_PATH)
  }
  process.exit(0)
}

if (json) {
  console.log(JSON.stringify({ ok, strict, baseline: useBaseline, checks: all }, null, 2))
} else {
  console.log('===== 全项目扫描门禁（W0-06）=====')
  for (const item of scanResults) {
    const state = item.ok ? '✅' : '❌'
    if (item.ok) {
      console.log(`${state} ${item.id}: 0 新增，${item.known} 存量（基线）`)
    } else if (strict) {
      console.log(`${state} ${item.id}: ${item.total} 条（strict 模式不允许基线豁免）`)
      for (const violation of item.fresh.slice(0, 10)) printViolation(violation)
    } else {
      console.log(`${state} ${item.id}: ${item.fresh.length} 条新增`)
      for (const violation of item.fresh.slice(0, 10)) printViolation(violation)
    }
    if (item.stale > 0) console.log(`   · 基线中有 ${item.stale} 条已修复，可运行 --update-baseline 收紧`)
  }
  for (const item of progress) {
    const state = item.ok ? '📊' : '❌'
    console.log(`${state} ${item.id}: ${item.detail}`)
  }
  console.log(ok ? '\n✅ 全项目扫描门禁通过' : '\n❌ 全项目扫描门禁未通过')
}

process.exit(ok ? 0 : 1)
