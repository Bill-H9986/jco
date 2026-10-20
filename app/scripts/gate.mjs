#!/usr/bin/env node
// J.Co 门禁总入口（《J.Co软件开发工作流标准》第三章 · 质量门禁）
// 用法：npm run gate —— 一条命令跑全部机器检查，全绿才放行。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(__dirname, '..')

const steps = [
  { name: '类型检查 + 编译 (TypeScript)', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.json'] },
  {
    name: '代码规范 (Biome)',
    cmd: 'npx',
    args: ['biome', 'check', 'src', 'tests', 'scripts', 'publish', 'kernel/publish-tools'],
  },
  { name: 'UI 控件来源检查', cmd: 'node', args: ['scripts/check-ui-source.mjs'] },
  { name: '功能质量矩阵', cmd: 'node', args: ['scripts/quality-report.mjs', '--check'] },
  { name: '单元测试 (Vitest)', cmd: 'npx', args: ['vitest', 'run'] },
  { name: '全项目扫描门禁 (Project Checks)', cmd: 'node', args: ['scripts/check-all.mjs', '--baseline'] },
  { name: 'OWASP 安全门 (Security Gate)', cmd: 'node', args: ['scripts/security-gate.mjs'] },
  { name: 'Agent Eval', cmd: 'node', args: ['scripts/run-agent-eval.mjs', '--ci'] },
  { name: '全站一致性审计 (Frontend Audit)', cmd: 'node', args: ['scripts/audit-frontend.mjs'] },
  {
    name: 'Wave 1 视觉基准 (Visual Regression)',
    cmd: 'npx',
    args: ['playwright', 'test', '-c', 'playwright.visual.config.mjs'],
  },
  { name: '端到端回归 (Playwright)', cmd: 'npx', args: ['playwright', 'test'] },
]

const failed = []
for (const step of steps) {
  console.log(`\n===== ${step.name} =====`)
  const result = spawnSync([step.cmd, ...step.args].join(' '), { cwd: APP, stdio: 'inherit', shell: true })
  if (result.status !== 0) failed.push(step.name)
}

console.log('\n========================================')
if (failed.length > 0) {
  console.log(`❌ 门禁未通过：${failed.join('、')}`)
  process.exit(1)
}
console.log('✅ 全部门禁通过')
