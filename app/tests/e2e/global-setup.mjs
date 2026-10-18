// E2E 全局数据护栏（2026-10-17 卫生修复）：
// 测试会经 tasks:sync / skills:sync 写开发目录的 kernel 运行数据文件（auto-tasks.json /
// auto-runs.json / skills.json / task-sessions/）。曾出现：E2E 的种子任务留在 auto-tasks.json，
// 开发模式启动会被调度器误跑。此护栏在跑测前备份、跑测后恢复——一次覆盖全部测试。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
export const KERNEL = path.join(APP_DIR, 'kernel')
export const SNAPSHOT = path.join(APP_DIR, 'node_modules', '.cache', 'jco-e2e-kernel-snapshot')
export const FILES = [
  'auto-tasks.json',
  'auto-runs.json',
  'skills.json',
  'topics.json',
  'brand-profile.json',
  'materials.json',
  'scripts.json',
  'drafts.json',
  'ops.json',
]
export const DIRS = ['task-sessions', 'work-tasks']

export default async function globalSetup() {
  fs.rmSync(SNAPSHOT, { recursive: true, force: true })
  fs.mkdirSync(SNAPSHOT, { recursive: true })
  for (const f of FILES) {
    const src = path.join(KERNEL, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(SNAPSHOT, f))
  }
  for (const d of DIRS) {
    const src = path.join(KERNEL, d)
    if (fs.existsSync(src)) fs.cpSync(src, path.join(SNAPSHOT, d), { recursive: true })
  }
  console.log('[e2e-guard] kernel 运行数据已备份')
}
