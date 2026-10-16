// 发布引擎核心逻辑（平台无关）——先写断言，后写实现（先红后绿）
// 依据：docs/plans/M1-发布工作流/接口契约.md（已冻结）
import { describe, expect, it } from 'vitest'
import {
  canTransition,
  FRIENDLY_ERRORS,
  friendlyPublishError,
  normalizePlatform,
  PUBLISH_STATES,
  parseEngineLine,
  unpackedPath,
  validateStartPayload,
} from '../../src/publish-engine.ts'

describe('状态机', () => {
  it('状态枚举与契约一致', () => {
    expect(PUBLISH_STATES).toEqual([
      'idle',
      'launching',
      'opening',
      'awaiting_login',
      'uploading',
      'filling',
      'ready',
      'stopped',
      'error',
    ])
  })

  it('合法转移被接受', () => {
    expect(canTransition('idle', 'launching')).toBe(true)
    expect(canTransition('launching', 'opening')).toBe(true)
    expect(canTransition('opening', 'awaiting_login')).toBe(true)
    expect(canTransition('awaiting_login', 'uploading')).toBe(true)
    expect(canTransition('uploading', 'filling')).toBe(true)
    expect(canTransition('filling', 'ready')).toBe(true)
    expect(canTransition('ready', 'stopped')).toBe(true)
  })

  it('任何进行中状态都允许转 error / stopped', () => {
    for (const s of ['launching', 'opening', 'awaiting_login', 'uploading', 'filling']) {
      expect(canTransition(s, 'error'), `${s} -> error`).toBe(true)
      expect(canTransition(s, 'stopped'), `${s} -> stopped`).toBe(true)
    }
  })

  it('非法转移被拒绝（终态无出边、跳步禁止）', () => {
    expect(canTransition('ready', 'uploading')).toBe(false)
    expect(canTransition('stopped', 'launching')).toBe(false)
    expect(canTransition('error', 'opening')).toBe(false)
    expect(canTransition('idle', 'uploading')).toBe(false)
    expect(canTransition('launching', 'filling')).toBe(false)
  })
})

describe('错误码 → 用户文案（契约 §5）', () => {
  it('契约中每个错误码都有 friendly 文案', () => {
    for (const code of [
      'BROWSER_MISSING',
      'LOGIN_TIMEOUT',
      'PAGE_CHANGED',
      'UPLOAD_FAILED',
      'TIMEOUT',
      'BUSY',
      'PLATFORM_UNSUPPORTED',
      'INTERNAL',
    ]) {
      expect(FRIENDLY_ERRORS[code], code).toBeTruthy()
    }
  })

  it('未知错误码回退到 INTERNAL 文案并附带原始信息', () => {
    const msg = friendlyPublishError('SOMETHING_NEW', 'oops')
    expect(msg).toContain('oops')
    expect(msg).toContain('请把这段话发给产品负责人')
  })
})

describe('引擎事件行解析（契约 §3）', () => {
  it('state / error / log 三类事件可解析', () => {
    expect(parseEngineLine('{"type":"state","state":"opening"}')).toEqual({ type: 'state', state: 'opening' })
    expect(parseEngineLine('{"type":"state","state":"uploading","detail":"42%"}')).toEqual({
      type: 'state',
      state: 'uploading',
      detail: '42%',
    })
    expect(parseEngineLine('{"type":"error","code":"PAGE_CHANGED","message":"找不到输入框"}')).toEqual({
      type: 'error',
      code: 'PAGE_CHANGED',
      message: '找不到输入框',
    })
    expect(parseEngineLine('{"type":"log","message":"hi"}')).toEqual({ type: 'log', message: 'hi' })
  })

  it('非法输入被安全丢弃（不抛错）', () => {
    expect(parseEngineLine('')).toBeNull()
    expect(parseEngineLine('  ')).toBeNull()
    expect(parseEngineLine('not json')).toBeNull()
    expect(parseEngineLine('{"type":"state","state":"nonsense"}')).toBeNull()
    expect(parseEngineLine('{"type":"unknown"}')).toBeNull()
  })
})

describe('平台与载荷校验', () => {
  it('平台名规范化：小写字母开头、字母数字连字符', () => {
    expect(normalizePlatform('douyin')).toBe('douyin')
    expect(normalizePlatform('DouYin')).toBe('douyin')
    expect(normalizePlatform('  shipinhao ')).toBe('shipinhao')
    expect(normalizePlatform('')).toBe('')
    expect(normalizePlatform('../etc')).toBe('')
    expect(normalizePlatform('a b')).toBe('')
  })

  it('start 载荷：非法输入被拒绝', () => {
    expect(validateStartPayload(null).ok).toBe(false)
    expect(validateStartPayload({ platform: 'douyin' }).ok).toBe(false) // 缺视频
    expect(validateStartPayload({ platform: '', videoPath: 'x.mp4' }).ok).toBe(false)
  })

  it('start 载荷：合法输入规范化输出', () => {
    const r = validateStartPayload({
      platform: 'DouYin',
      videoPath: 'C:/v/a.mp4',
      title: '标题',
      topics: ['#话题1', '', '#话题2'],
    })
    expect(r.ok).toBe(true)
    expect(r.value.platform).toBe('douyin')
    expect(r.value.topics).toEqual(['#话题1', '#话题2'])
  })
})

describe('打包路径映射（asar → asar.unpacked）', () => {
  it('app.asar 路径被映射到 app.asar.unpacked', () => {
    const sep = '\\'
    const input = ['C:', 'x', 'resources', 'app.asar', 'publish', 'engine.mjs'].join(sep)
    const out = unpackedPath(input)
    expect(out).toBe(['C:', 'x', 'resources', 'app.asar.unpacked', 'publish', 'engine.mjs'].join(sep))
  })

  it('开发路径保持不变', () => {
    const input = 'C:\\Users\\x\\J.Co\\app\\publish\\engine.mjs'
    expect(unpackedPath(input)).toBe(input)
  })
})
