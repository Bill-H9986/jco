#!/usr/bin/env node
/**
 * J.Co Agent Eval runner（W0-07）
 *
 * - 默认执行 20 条自动化评测（按测试文件分组，一次 vitest 运行）；
 * - E2E 用例默认跳过，`--e2e` 才逐条跑；
 * - 安装/真实浏览器/真实 ffmpeg 用例明确标 skipped + 原因，不假装通过；
 * - 每条记录通过状态、耗时、工具调用、token、成本、人工介入、返工、失败分类。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SUITE_PATH = path.join(APP, 'evals', 'jco-agent-eval.json')
const OUT_DIR = path.join(APP, 'test-results', 'agent-eval')
const args = process.argv.slice(2)
const jsonOnly = args.includes('--json')
const runE2e = args.includes('--e2e')
const runLive = args.includes('--live')

let validateEvalSuite
let BudgetTracker
try {
  ;({ validateEvalSuite } = await import('../dist/agent/eval-suite.js'))
  ;({ BudgetTracker } = await import('../dist/agent/run-budget.js'))
} catch (error) {
  console.error('Agent Eval 需要先构建：npm run build')
  console.error(String(error?.message || error))
  process.exit(1)
}

let suite
try {
  suite = JSON.parse(readFileSync(SUITE_PATH, 'utf8'))
} catch (error) {
  console.error(`读不到评测套件：${SUITE_PATH}`)
  console.error(String(error?.message || error))
  process.exit(1)
}

const validationErrors = validateEvalSuite(suite)
if (validationErrors.length > 0) {
  console.error('评测套件不合法：')
  for (const error of validationErrors) console.error(`- ${error}`)
  process.exit(1)
}

const budgets = new Map()
function budgetFor(id) {
  if (!budgets.has(id)) {
    const tracker = new BudgetTracker({ maxWallMs: 180_000 })
    tracker.start()
    budgets.set(id, tracker)
  }
  return budgets.get(id)
}

function runCommand(command, commandArgs, timeout = 180_000) {
  const started = Date.now()
  const result = spawnSync(command, commandArgs, {
    cwd: APP,
    encoding: 'utf8',
    shell: true,
    timeout,
  })
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    durationMs: Date.now() - started,
    timedOut: Boolean(result.error && String(result.error.code || '').includes('ETIMEDOUT')),
  }
}

const vitestCases = suite.cases.filter((item) => item.runner === 'vitest')
const e2eCases = suite.cases.filter((item) => item.runner === 'e2e')
const _manualCases = suite.cases.filter((item) => item.runner === 'manual')
const vitestFiles = [...new Set(vitestCases.map((item) => item.file))]

const vitestResult = runCommand('npx', ['vitest', 'run', ...vitestFiles])
const failedFiles = new Set()
if (vitestResult.status !== 0) {
  const output = `${vitestResult.stdout}\n${vitestResult.stderr}`
  for (const match of output.matchAll(/FAIL\s+([^\s]+\.test\.mjs)/g)) {
    failedFiles.add(match[1].replaceAll('\\', '/'))
  }
  if (failedFiles.size === 0) for (const file of vitestFiles) failedFiles.add(file)
}

const e2eResults = new Map()
if (runE2e) {
  for (const item of e2eCases) {
    if (!e2eResults.has(item.file)) {
      e2eResults.set(item.file, runCommand('npx', ['playwright', 'test', item.file], 300_000))
    }
  }
}

let bridgeModule = null
async function liveBridge() {
  if (!bridgeModule) {
    process.argv.push('--jco-test')
    bridgeModule = await import('../kernel/bridge.mjs')
  }
  return bridgeModule
}

async function runLiveCase(item) {
  const bridge = await liveBridge()
  const started = Date.now()
  const activities = []
  const result = await bridge.ask(item.prompt, null, {
    profile: item.mode,
    sessionId: `task:eval-${item.id}-${Date.now()}`,
    onActivity: (activity) => activities.push(activity),
    ...(item.budget ? { budget: item.budget } : {}),
  })
  const toolCalls = activities.filter((activity) => activity.kind === 'tool' && activity.phase === 'call').length
  const passed = item.budget
    ? result.ok === false && result.code === 'BUDGET_EXCEEDED'
    : item.mode === 'chat'
      ? Boolean(result.ok) && toolCalls === 0
      : Boolean(result.ok) && toolCalls > 0
  return {
    status: passed ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    toolCalls,
    tokens: result.metrics?.tokens ? result.metrics.tokens.total : 0,
    costUsd: result.metrics ? result.metrics.costUsd : null,
    failureCategory: passed ? null : 'live_kernel_failed',
    detail: result.error || result.text || '',
  }
}

const liveResults = new Map()
if (runLive) {
  for (const item of suite.cases.filter((record) => record.runner === 'live')) {
    liveResults.set(item.id, await runLiveCase(item))
  }
}

const records = suite.cases.map((item) => {
  const budget = budgetFor(item.id).snapshot()
  if (item.runner === 'vitest') {
    const failed = failedFiles.has(item.file)
    return {
      id: item.id,
      category: item.category,
      title: item.title,
      status: failed ? 'failed' : 'passed',
      runner: item.runner,
      file: item.file,
      durationMs: vitestResult.durationMs,
      durationNote: '同文件组共享一次 vitest 运行耗时',
      toolCalls: 0,
      tokens: 0,
      costUsd: 0,
      humanInterventions: 0,
      rework: 0,
      failureCategory: failed ? 'test_failed' : null,
      budget,
    }
  }
  if (item.runner === 'e2e') {
    const result = e2eResults.get(item.file)
    if (!runE2e) {
      return {
        ...item,
        status: 'skipped',
        reason: '默认不跑 E2E；加 --e2e 执行',
        durationMs: 0,
        toolCalls: 0,
        tokens: 0,
        costUsd: 0,
        humanInterventions: 0,
        rework: 0,
        failureCategory: null,
        budget,
      }
    }
    return {
      ...item,
      status: result.status === 0 ? 'passed' : 'failed',
      durationMs: result.durationMs,
      toolCalls: 0,
      tokens: 0,
      costUsd: 0,
      humanInterventions: 0,
      rework: 0,
      failureCategory: result.status === 0 ? null : result.timedOut ? 'timeout' : 'e2e_failed',
      budget,
    }
  }
  if (item.runner === 'live') {
    const result = liveResults.get(item.id)
    if (!runLive) {
      return {
        ...item,
        status: 'skipped',
        reason: '默认不跑真实内核；加 --live 执行',
        durationMs: 0,
        toolCalls: 0,
        tokens: 0,
        costUsd: null,
        humanInterventions: 0,
        rework: 0,
        failureCategory: null,
        budget,
      }
    }
    return {
      ...item,
      status: result.status,
      durationMs: result.durationMs,
      toolCalls: result.toolCalls,
      tokens: result.tokens,
      costUsd: result.costUsd,
      humanInterventions: 0,
      rework: 0,
      failureCategory: result.failureCategory,
      detail: result.detail,
      budget,
    }
  }
  return {
    ...item,
    status: 'skipped',
    durationMs: 0,
    toolCalls: 0,
    tokens: 0,
    costUsd: 0,
    humanInterventions: 0,
    rework: 0,
    failureCategory: null,
    budget,
  }
})

const passed = records.filter((item) => item.status === 'passed').length
const failed = records.filter((item) => item.status === 'failed').length
const skipped = records.filter((item) => item.status === 'skipped').length
const summary = {
  ok: failed === 0,
  suite: SUITE_PATH,
  generatedAt: new Date().toISOString(),
  total: records.length,
  passed,
  failed,
  skipped,
  vitestExitCode: vitestResult.status,
  vitestDurationMs: vitestResult.durationMs,
  records,
}

mkdirSync(OUT_DIR, { recursive: true })
const jsonPath = path.join(OUT_DIR, 'latest.json')
const mdPath = path.join(OUT_DIR, 'latest.md')
writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
writeFileSync(
  mdPath,
  `${[
    '# J.Co Agent Eval 最新报告',
    '',
    `- 时间：${summary.generatedAt}`,
    `- 总数：${summary.total}；通过：${passed}；失败：${failed}；跳过：${skipped}`,
    `- Vitest：exit ${vitestResult.status}，${vitestResult.durationMs}ms`,
    '',
    '| ID | 分类 | 任务 | 状态 | 耗时 | 工具调用 | token | 成本 | 人工介入 | 返工 | 失败分类 |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...records.map(
      (item) =>
        `| ${item.id} | ${item.category} | ${item.title} | ${item.status} | ${item.durationMs} | ${item.toolCalls} | ${item.tokens} | ${item.costUsd} | ${item.humanInterventions} | ${item.rework} | ${item.failureCategory || ''} |`,
    ),
  ].join('\n')}\n`,
  'utf8',
)

if (bridgeModule) {
  try {
    await bridgeModule.close()
  } catch {
    /* 评测结束后回收失败不改变评测结论 */
  }
}

if (jsonOnly) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log('===== J.Co Agent Eval =====')
  console.log(`总数 ${records.length}｜通过 ${passed}｜失败 ${failed}｜跳过 ${skipped}`)
  console.log(`Vitest exit ${vitestResult.status}，${vitestResult.durationMs}ms`)
  if (failed > 0) {
    for (const item of records.filter((record) => record.status === 'failed')) {
      console.log(`❌ ${item.id} ${item.title}（${item.failureCategory}）`)
    }
  }
  if (skipped > 0) {
    for (const item of records.filter((record) => record.status === 'skipped')) {
      console.log(`➖ ${item.id} ${item.title}：${item.reason}`)
    }
  }
  console.log(`报告：${jsonPath}`)
  console.log(summary.ok ? '✅ Agent Eval 自动化部分通过' : '❌ Agent Eval 未通过')
}

process.exit(summary.ok ? 0 : 1)
