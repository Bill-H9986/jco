// 功能质量矩阵校验：每个页面/关键能力必须有可追溯的自动化证据。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES } from '../tests/pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const MATRIX_PATH = path.join(APP_DIR, 'quality', 'feature-matrix.json')
const OUTPUT_PATH = path.join(APP_DIR, 'quality', 'generated', 'quality-report.json')
const check = process.argv.includes('--check')

const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'))
const violations = []
const ids = new Set()
const coveredPages = new Set()
const interactionSignals = [
  '.click(',
  '.fill(',
  '.press(',
  '.dragTo(',
  'inspectPage(',
  'capturePage(',
  'assertVisual(',
  'getComputedStyle(',
]

for (const feature of matrix.features) {
  if (ids.has(feature.id)) violations.push(`重复功能 ID：${feature.id}`)
  ids.add(feature.id)
  if (!['P0', 'P1', 'P2'].includes(feature.priority)) violations.push(`${feature.id}: 优先级无效`)
  if (!['covered', 'partial'].includes(feature.status)) violations.push(`${feature.id}: 状态必须是 covered 或 partial`)
  if (feature.status === 'partial' && !feature.reason) violations.push(`${feature.id}: partial 必须写清楚人工边界`)
  if (!Array.isArray(feature.automated) || feature.automated.length === 0) {
    violations.push(`${feature.id}: 没有自动化证据`)
  } else {
    let hasInteractionEvidence = false
    for (const evidence of feature.automated) {
      const evidencePath = path.join(APP_DIR, evidence)
      if (!fs.existsSync(evidencePath)) {
        violations.push(`${feature.id}: 证据文件不存在 ${evidence}`)
        continue
      }
      if (evidence.startsWith('tests/e2e/')) {
        const source = fs.readFileSync(evidencePath, 'utf8')
        if (interactionSignals.some((signal) => source.includes(signal))) hasInteractionEvidence = true
      }
    }
    if (
      feature.priority === 'P0' &&
      feature.automated.some((evidence) => evidence.startsWith('tests/e2e/')) &&
      !hasInteractionEvidence
    ) {
      violations.push(`${feature.id}: P0 没有任何带真实交互或视觉断言的 E2E 证据`)
    }
  }
  if (feature.surface !== '全站' && feature.surface !== '安装包' && feature.surface !== '发布链路') {
    coveredPages.add(feature.surface)
  }
}

for (const page of PAGES) {
  if (!coveredPages.has(page)) violations.push(`页面未进入功能矩阵：${page}`)
}

const summary = {
  generatedAt: new Date().toISOString(),
  total: matrix.features.length,
  byStatus: {
    covered: matrix.features.filter((feature) => feature.status === 'covered').length,
    partial: matrix.features.filter((feature) => feature.status === 'partial').length,
  },
  byPriority: {
    P0: matrix.features.filter((feature) => feature.priority === 'P0').length,
    P1: matrix.features.filter((feature) => feature.priority === 'P1').length,
    P2: matrix.features.filter((feature) => feature.priority === 'P2').length,
  },
  pages: PAGES.length,
  violations,
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ ...summary, matrix }, null, 2))

console.log(
  `质量矩阵：${summary.total} 项功能 / ${summary.pages} 页 / covered ${summary.byStatus.covered} / partial ${summary.byStatus.partial}`,
)
console.log(`优先级：P0=${summary.byPriority.P0} P1=${summary.byPriority.P1} P2=${summary.byPriority.P2}`)
console.log(`报告：${OUTPUT_PATH}`)

if (violations.length) {
  console.error(`质量矩阵违规 ${violations.length} 项：`)
  for (const violation of violations) console.error(`- ${violation}`)
  if (check) process.exit(1)
} else {
  console.log('✅ 功能质量矩阵通过')
}
