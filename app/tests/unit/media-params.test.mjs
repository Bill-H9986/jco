import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const media = require(path.resolve(__dirname, '../../../设计原型/assets/jco-media.js'))

describe('媒体参数单一来源（做视频 / 做图）', () => {
  it('图片尺寸同时服从比例和清晰度', () => {
    expect(media.imageSizeFor('3:4', '1K')).toBe('1024x1365')
    expect(media.imageSizeFor('3:4', '2K')).toBe('1536x2048')
    expect(media.imageSizeFor('9:16', '1K')).toBe('1024x1820')
    expect(media.imageSizeFor('16:9', '2K')).toBe('2731x1536')
    expect(media.imageSizeFor('1:1', '4K')).toBe('3072x3072')
  })

  it('视频总时长换算为可执行的分镜数与单段秒数', () => {
    expect(media.targetShotCount('5 秒')).toBe(1)
    expect(media.targetShotCount('30 秒')).toBe(4)
    expect(media.targetShotCount('3 分钟')).toBe(23)
    expect(media.shotSecondsFor('30 秒', 5)).toBe(6)
    expect(media.shotSecondsFor('5 秒', 5)).toBe(4)
    expect(media.shotSecondsFor('3 分钟', 16)).toBe(11)
    expect(media.shotSecondsFor('5 分钟', 16)).toBe(12)
  })

  it('图片方案不足时补齐到用户选择的张数', () => {
    const rows = media.ensurePromptCount(['教室全景'], 3, '无人机培训')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toBe('教室全景')
    expect(rows[1]).toContain('无人机培训')
    expect(rows[2]).toContain('无人机培训')
  })

  it('空图片占位不会进入草稿计数和渲染', () => {
    expect(
      media.normalizeImages([{ src: '', prompt: '旧版大图未入草稿' }, { src: 'file:///a.png', prompt: 'a' }, null]),
    ).toEqual([{ src: 'file:///a.png', prompt: 'a' }])
  })
})
