// E2E 全局数据护栏 · 恢复端（见 global-setup.mjs 说明）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const KERNEL = path.join(APP_DIR, 'kernel')
const SNAPSHOT = path.join(APP_DIR, 'node_modules', '.cache', 'jco-e2e-kernel-snapshot')
const FILES = [
  'auto-tasks.json',
  'auto-runs.json',
  'skills.json',
  'topics.json',
  'brand-profile.json',
  'materials.json',
  'scripts.json',
  'drafts.json',
  'ops.json',
  'accounts.json',
]
const DIRS = ['task-sessions', 'work-tasks']

export default async function globalTeardown() {
  for (const f of FILES) {
    const snap = path.join(SNAPSHOT, f)
    const dst = path.join(KERNEL, f)
    if (fs.existsSync(snap)) fs.copyFileSync(snap, dst)
    else fs.rmSync(dst, { force: true })
  }
  for (const d of DIRS) {
    const snap = path.join(SNAPSHOT, d)
    const dst = path.join(KERNEL, d)
    fs.rmSync(dst, { recursive: true, force: true })
    if (fs.existsSync(snap)) fs.cpSync(snap, dst, { recursive: true })
  }
  fs.rmSync(SNAPSHOT, { recursive: true, force: true })
  // 顺带清空隔离的测试数据目录（--jco-test 的 kernel 数据；残留兜底）
  fs.rmSync(path.join(os.tmpdir(), 'jco-test-kernel-data'), { recursive: true, force: true })
  console.log('[e2e-guard] kernel 运行数据已恢复')
}
