// W3-04 真浏览器冒烟：BrowserSession 启动 → ready → 打开平台白名单页 → snapshot → 停止。
// 默认跳过；显式设置 JCO_BROWSER_SMOKE=1 才启动真实 Edge 持久化会话。
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { PublishSessionManager } = require('../../dist/publish-engine.js')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(process.env.JCO_BROWSER_SMOKE !== '1')('W3-04 BrowserSession 真浏览器冒烟', () => {
  it('启动/就绪/打开白名单页/快照/停止', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-publish-session-'))
    const sessionFile = path.join(root, 'session.json')
    const manager = new PublishSessionManager(
      {
        execPath: process.execPath,
        serverPath: path.join(APP_DIR, 'publish', 'session-server.mjs'),
        profileRoot: path.join(root, 'profiles'),
        sessionFile,
        shotsDir: path.join(root, 'shots'),
        dataDir: path.join(root, 'data'),
        headless: true,
      },
      () => {},
    )
    try {
      const started = manager.start('douyin')
      expect(started.ok, started.error).toBe(true)
      let status = manager.status()
      for (let i = 0; i < 100 && !status.ready; i += 1) {
        await sleep(500)
        status = manager.status()
      }
      expect(status, 'BrowserSession 未在 50 秒内就绪').toMatchObject({
        active: true,
        ready: true,
        platform: 'douyin',
      })

      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
      expect(session.platform).toBe('douyin')
      expect(session.pid).toBeGreaterThan(0)
      const call = async (name, args = {}) => {
        const response = await fetch(`${session.endpoint}/tool`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ name, args }),
        })
        const data = await response.json()
        expect(data.ok, data.error).toBe(true)
        return String(data.result || '')
      }
      const opened = await call('open_page', { url: 'https://creator.douyin.com/robots.txt' })
      expect(opened).toContain('已打开')
      const snapshot = await call('snapshot')
      expect(snapshot).toContain('页面快照')

      manager.stop()
      let stopped = manager.status()
      for (let i = 0; i < 30 && stopped.active; i += 1) {
        await sleep(500)
        stopped = manager.status()
      }
      expect(stopped.active).toBe(false)
    } finally {
      try {
        manager.stop()
      } catch {
        /* 已停止 */
      }
      await sleep(500)
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})
