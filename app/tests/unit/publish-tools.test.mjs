// AI 操作工具集的安全断言（对应 e2e 用例清单 A6"红线检查"）
// 核心：工具白名单"不多不少"——未来任何人想加工具，必须先过测试与安全评审。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  click,
  clickGuardReason,
  DATA_TOOLS,
  IMPLEMENTATIONS,
  isAllowedUploadPath,
  isAllowedUrl,
  TOOLS,
  uploadFile,
  uploadGuardReason,
} from '../../publish/tools.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

  it('危险点击目标被目标级拦截：发布 / 删除 / 支付', () => {
    expect(clickGuardReason('发布')).toContain('不能点击')
    expect(clickGuardReason('立即发布')).toContain('不能点击')
    expect(clickGuardReason('删除这条作品')).toContain('不能点击')
    expect(clickGuardReason('确认支付')).toContain('不能点击')
    expect(clickGuardReason('设置封面')).toBe('')
    expect(clickGuardReason('下一步')).toBe('')
  })

  it('危险点击目标不能靠零宽字符绕过', () => {
    expect(clickGuardReason('发\u200b布')).toContain('不能点击')
    expect(clickGuardReason('支\u200d付')).toContain('不能点击')
    expect(clickGuardReason('删\u2060除')).toContain('不能点击')
  })

  it('上传只允许媒体文件，拒绝配置 / 密钥 / 可执行文件', () => {
    expect(isAllowedUploadPath('C:/media/demo.mp4')).toBe(true)
    expect(isAllowedUploadPath('C:/media/cover.PNG')).toBe(true)
    expect(isAllowedUploadPath('C:/media/music.mp3')).toBe(true)
    expect(isAllowedUploadPath('C:/secret/.env')).toBe(false)
    expect(isAllowedUploadPath('C:/secret/key.pem')).toBe(false)
    expect(isAllowedUploadPath('C:/tools/aoci.exe')).toBe(false)
    expect(isAllowedUploadPath('C:/data/notes.txt')).toBe(false)
  })

  it('click 在触发真实点击前拦截“发布”目标', async () => {
    let clicked = false
    const page = {
      locator: () => ({
        evaluate: async () => '发布',
        click: async () => {
          clicked = true
        },
      }),
    }
    await expect(click(page, 1)).rejects.toThrow('不能点击')
    expect(clicked).toBe(false)
  })

  it('uploadFile 对非媒体文件在接触页面前就拒绝', async () => {
    const page = { locator: () => ({ evaluate: async () => true }) }
    await expect(uploadFile(page, 1, 'C:/secret/.env')).rejects.toThrow('只允许上传')
  })

  it('媒体文件也必须位于允许的素材/成片目录内', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-upload-root-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-upload-outside-'))
    try {
      const inside = path.join(root, 'clip.mp4')
      const escaped = path.join(outside, 'secret.mp4')
      fs.writeFileSync(inside, 'x')
      fs.writeFileSync(escaped, 'x')
      expect(uploadGuardReason(inside, [root])).toBe('')
      expect(uploadGuardReason(escaped, [root])).toContain('只允许上传')
      expect(uploadGuardReason(inside, [])).toContain('没有配置')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
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
