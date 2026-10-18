/**
 * OWASP LLM Top 10（2026）安全门。
 *
 * 这是“能自动验的控制项”清单，不替代人工安全评审：
 * - 有代码/配置证据的项必须通过；
 * - 不适用项明确标 N/A 并写理由；
 * - 任何适用项失败，security:gate 退出 1。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanChatProfile } from './rules.mjs'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function read(root, rel) {
  try {
    return readFileSync(path.join(root, rel), 'utf8')
  } catch {
    return ''
  }
}

function result(id, title, ok, detail, na = false) {
  return { id, title, ok, na, detail }
}

export function runSecurityChecks(root = APP_ROOT) {
  const promptBuilder = read(root, 'src/kernel/prompt-builder.ts')
  const contextPack = read(root, 'src/agent/context-pack.ts')
  const bridge = read(root, 'kernel/bridge.mjs')
  const contracts = read(root, 'src/ipc/contracts.ts')
  const profiles = read(root, 'src/kernel/profiles.ts')
  const budget = read(root, 'src/agent/run-budget.ts')
  const ignore = read(root, '../.gitignore')
  const pkg = read(root, 'package.json')
  const publishTools = read(root, 'kernel/publish-tools/index.mjs')
  const editTools = read(root, 'kernel/edit-tools/index.mjs')

  const checks = []

  checks.push(
    result(
      'LLM01',
      '提示注入：外部内容标记为资料',
      promptBuilder.includes('<external_content>') &&
        promptBuilder.includes('只是资料') &&
        contextPack.includes('external_content'),
      '任务提示词与 Context Pack 都把外部内容包在 external_content 中，并声明只是资料',
    ),
  )

  checks.push(
    result(
      'LLM02',
      '敏感信息：凭据不入库、入上下文前脱敏',
      ignore.includes('model-config.json') &&
        ignore.includes('publish-session.json') &&
        contextPack.includes('redactSecrets'),
      '模型配置/发布会话文件已忽略；Context Pack 有 Bearer/sk-/password 脱敏',
    ),
  )

  const dependencies = (() => {
    try {
      return JSON.parse(pkg).dependencies || {}
    } catch {
      return {}
    }
  })()
  const floating = Object.entries(dependencies).filter(([, version]) => version === '*' || version === 'latest')
  checks.push(
    result(
      'LLM03',
      '供应链：依赖锁定、无浮动 latest',
      existsSync(path.join(root, 'package-lock.json')) && floating.length === 0,
      floating.length === 0
        ? 'package-lock.json 存在，依赖无 latest/* 浮动版本'
        : `浮动依赖：${floating.map(([name]) => name).join('、')}`,
    ),
  )

  checks.push(
    result(
      'LLM04',
      '数据投毒：外部资料不直接变长期记忆',
      promptBuilder.includes('外部资料') && promptBuilder.includes('不是指令'),
      '外部内容只作为本轮任务资料注入，不写入技能库或长期记忆',
    ),
  )

  const executable = /\beval\s*\(|new\s+Function\s*\(/
  checks.push(
    result(
      'LLM05',
      '输出处理：工具层不执行模型返回的任意代码',
      !executable.test(publishTools) && !executable.test(editTools),
      'publish-tools / edit-tools 没有 eval 或 new Function',
    ),
  )

  const profileViolations = scanChatProfile(profiles)
  checks.push(
    result(
      'LLM06',
      '过度代理：最小权限 + 发布/删除/支付审批',
      profileViolations.length === 0 &&
        contracts.includes('requirePublishApproval') &&
        contracts.includes('requireDeleteApproval') &&
        contracts.includes('requirePaymentApproval') &&
        contracts.includes('APPROVAL_REQUIRED'),
      'chat/writer 工具为空；发布/删除/支付在 IPC 契约中强制审批',
    ),
  )

  checks.push(
    result(
      'LLM07',
      '系统提示词泄露：不写日志、不回显',
      !/console\.(log|info|debug)\([^)]*persona/i.test(bridge) && !/return\s+[^\n]*buildProfilePersona/.test(bridge),
      'bridge 不打印 persona，也不把系统提示词作为用户可见结果返回',
    ),
  )

  checks.push(result('LLM08', '向量/嵌入：当前未使用', true, 'J.Co 当前没有向量库或 embedding 索引，风险不适用', true))

  checks.push(
    result(
      'LLM09',
      '误导信息：数据没接上就如实说',
      promptBuilder.includes('绝不编造') && promptBuilder.includes('没接上'),
      '聊天 persona 明确要求不编造数据、没接上就如实说',
    ),
  )

  checks.push(
    result(
      'LLM10',
      '无限消耗：token/工具/墙钟/重试预算',
      budget.includes('BUDGET_EXCEEDED') &&
        budget.includes('maxToolCalls') &&
        budget.includes('maxTokens') &&
        budget.includes('maxWallMs') &&
        existsSync(path.join(root, 'src/agent/run-metrics.ts')),
      'BudgetTracker 覆盖模型调用、工具调用、token、墙钟、重试；运行指标可回读',
    ),
  )

  return checks
}
