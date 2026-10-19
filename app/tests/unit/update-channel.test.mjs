import { describe, expect, it } from 'vitest'
import { normalizeUpdateChannel, normalizeUpdateFeedUrl, withTimeout } from '../../src/application/update-channel.ts'

describe('自动更新通道', () => {
  it('只接受 HTTPS 更新源', () => {
    expect(normalizeUpdateFeedUrl('https://updates.example.com/jco/')).toBe('https://updates.example.com/jco')
    expect(() => normalizeUpdateFeedUrl('http://updates.example.com/jco')).toThrow('必须使用 HTTPS')
  })

  it('仅在本机联调显式允许时接受 localhost HTTP', () => {
    expect(normalizeUpdateFeedUrl('http://127.0.0.1:8787/updates', true)).toBe('http://127.0.0.1:8787/updates')
    expect(() => normalizeUpdateFeedUrl('http://127.0.0.1:8787/updates')).toThrow('必须使用 HTTPS')
    expect(() => normalizeUpdateFeedUrl('http://192.168.1.8/updates', true)).toThrow('必须使用 HTTPS')
  })

  it('拒绝带凭据的更新源并规范化检查间隔', () => {
    expect(() => normalizeUpdateFeedUrl('https://user:pass@updates.example.com')).toThrow('不能包含账号密码')
    expect(normalizeUpdateChannel({ checkIntervalHours: 0 }, { currentVersion: '0.6.0-beta.2' })).toEqual({
      feedUrl: '',
      checkIntervalHours: 1,
      allowPrerelease: true,
    })
    expect(normalizeUpdateChannel({ checkIntervalHours: 999 }, { currentVersion: '0.6.0' })).toEqual({
      feedUrl: '',
      checkIntervalHours: 168,
      allowPrerelease: false,
    })
  })

  it('更新检查超时不会永远卡在 checking', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, '检查超时')).rejects.toThrow('检查超时')
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok')
  })
})
