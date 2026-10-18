// W3-04：平台注册表契约——每个平台必须有域名、https 发布页，且发布页落在自己的域名下。
import { describe, expect, it } from 'vitest'
import { PLATFORMS } from '../../publish/platforms.mjs'

describe('发布平台注册表（W3-04）', () => {
  it('五个平台配置齐全且发布页域名匹配白名单', () => {
    expect(Object.keys(PLATFORMS).sort()).toEqual(['bilibili', 'douyin', 'kuaishou', 'shipinhao', 'xiaohongshu'])
    for (const [id, platform] of Object.entries(PLATFORMS)) {
      expect(Array.isArray(platform.domains) && platform.domains.length > 0, id).toBe(true)
      const url = new URL(platform.publishUrl)
      expect(url.protocol, id).toBe('https:')
      expect(
        platform.domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)),
        `${id} 发布页不在平台白名单内`,
      ).toBe(true)
    }
  })
})
