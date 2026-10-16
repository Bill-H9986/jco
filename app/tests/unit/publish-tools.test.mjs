// AI 操作工具集的安全断言（对应 e2e 用例清单 A6"红线检查"）
// 核心：工具白名单"不多不少"——未来任何人想加工具，必须先过测试与安全评审。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DATA_TOOLS, IMPLEMENTATIONS, isAllowedUrl, TOOLS } from '../../publish/tools.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_FILE = path.resolve(__dirname, '..', '..', 'publish', 'tools.mjs')

describe('工具白名单（AI 的"手"）', () => {
  it('白名单恰好是契约中的 8 个工具', () => {
    expect([...TOOLS].sort()).toEqual(
      ['click', 'open_page', 'screenshot', 'scroll', 'snapshot', 'type_text', 'upload_file', 'wait'].sort(),
    )
  })

  it('实现与白名单一一对应（不多不少）', () => {
    expect(Object.keys(IMPLEMENTATIONS).sort()).toEqual([...TOOLS].sort())
  })

  it('工具全集（浏览器操作 + 数据提交）共 10 个，且无危险动作词汇', () => {
    const all = [...TOOLS, ...DATA_TOOLS]
    expect(all.length).toBe(10)
    for (const name of all) {
      expect(name, `工具名不应包含危险动作：${name}`).not.toMatch(/publish|delete|remove|pay|submit|exec|eval/i)
    }
  })

  it('源码级红线：工具文件不包含点击"发布"按钮的能力（无相关实现痕迹）', () => {
    const source = readFileSync(TOOLS_FILE, 'utf8')
    expect(source).not.toMatch(/(发布按钮|clickPublish|publishButton|点发布)/)
  })
})

describe('域名白名单（AI 只许在平台域名里活动）', () => {
  it('白名单域名与其子域放行', () => {
    expect(isAllowedUrl('https://creator.douyin.com/creator-micro/home', ['douyin.com'])).toBe(true)
    expect(isAllowedUrl('https://www.douyin.com/', ['douyin.com'])).toBe(true)
  })

  it('白名单以外的地址一律拒绝', () => {
    expect(isAllowedUrl('https://example.com/', ['douyin.com'])).toBe(false)
    expect(isAllowedUrl('https://evil-douyin.com/', ['douyin.com'])).toBe(false)
    expect(isAllowedUrl('http://127.0.0.1:8080/', ['douyin.com'])).toBe(false)
    expect(isAllowedUrl('file:///C:/secret.txt', ['douyin.com'])).toBe(false)
    expect(isAllowedUrl('javascript:alert(1)', ['douyin.com'])).toBe(false)
  })
})

describe('插件注册健康（防 schema 写法炸掉整个工具面）', () => {
  it('内核插件 apply 后恰好注册 10 个工具（含 2 个数据提交工具）', async () => {
    const pluginFile = path.resolve(__dirname, '..', '..', 'kernel', 'publish-tools', 'index.mjs')
    const mod = await import(pathToFileURL(pluginFile).href)
    const registered = []
    const ctx = { tools: { register: (t) => registered.push(t) } }
    mod.apply(ctx, { sessionFile: 'x' })
    expect(registered.length).toBe(10)
    expect(registered.map((t) => t.name).sort()).toEqual(
      [
        'jco_open_page',
        'jco_snapshot',
        'jco_click',
        'jco_type_text',
        'jco_upload_file',
        'jco_scroll',
        'jco_screenshot',
        'jco_wait',
        'jco_save_report',
        'jco_save_comments',
      ].sort(),
    )
  })
})
