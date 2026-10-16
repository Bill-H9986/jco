// 缺陷回归（2026-10-16 会话续聊）：应用重启后，同会话再发消息不报 already exists。
// 修复机制：bridge 层会话别名（撞上持久化冲突→换本进程专属 id 重试并记忆）。
// 依赖：--jco-test 模式走官方兜底路由（bridge.resolveRoute），不烧 Agnes 配额。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

const askIn = async (app, sessionId, text) => {
  const win = await app.firstWindow()
  await win.waitForTimeout(2500)
  return await win.evaluate(
    async (args) => {
      try {
        const r = await window.jco.kernel.ask(args.text, args.id)
        return { ok: !!r?.ok, text: String((r && (r.text || r.error)) || '').slice(0, 120) }
      } catch (e) {
        return { ok: false, text: `THROW ${String(e).slice(0, 120)}` }
      }
    },
    { id: sessionId, text },
  )
}

test('会话续聊：重启后同会话再发消息不报 already exists（自动恢复）', async () => {
  const id = `e2e-recover-${Date.now().toString(36)}`

  // 实例 1：新会话第一轮
  let app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  let first
  try {
    first = await askIn(app, id, '只回两个字：收到')
  } finally {
    await app.close()
  }
  expect(first.ok, `第一轮失败：${first.text}`).toBe(true)

  // 实例 2（模拟应用重启）：同一会话第二轮——修复前这里会报 session "..." already exists
  app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  let second
  try {
    second = await askIn(app, id, '只回两个字：在的')
  } finally {
    await app.close()
  }
  expect(second.text).not.toContain('already exists')
  expect(second.ok, `重启后第二轮失败：${second.text}`).toBe(true)
})
