// M9 后期工具（AI 代劳）：纯函数单测——SRT 生成 / ffmpeg 信息解析 / 路径守卫
import { describe, expect, it } from 'vitest'
import { buildSrt, insideDir, parseProbe, srtTime } from '../../kernel/edit-tools/index.mjs'

describe('后期工具纯函数（M9 后期·AI 代劳）', () => {
  it('srtTime 格式化（毫秒 / 分 / 时）', () => {
    expect(srtTime(0)).toBe('00:00:00,000')
    expect(srtTime(61250)).toBe('00:01:01,250')
    expect(srtTime(3661001)).toBe('01:01:01,001')
    expect(srtTime(-5)).toBe('00:00:00,000')
  })

  it('buildSrt：按片长均分、过滤空句、结束时间不越界', () => {
    const srt = buildSrt(['第一句', '  ', '第二句', '第三句'], 9)
    const blocks = srt.trim().split('\n\n')
    expect(blocks.length).toBe(3)
    expect(blocks[0]).toContain('00:00:00,000 --> ')
    expect(blocks[0]).toContain('第一句')
    expect(blocks[2]).toContain('第三句')
    // 最后一句的结束时间应小于等于片长（9s = 9000ms）
    const m = /--> (\d+):(\d+):(\d+),(\d+)/.exec(blocks[2])
    const endMs = Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4])
    expect(endMs).toBeLessThanOrEqual(9000)
  })

  it('buildSrt：空输入 / 零时长 → 空串', () => {
    expect(buildSrt([], 10)).toBe('')
    expect(buildSrt(['a'], 0)).toBe('')
    expect(buildSrt(null, 5)).toBe('')
  })

  it('parseProbe 解析时长 / 分辨率 / 音视频轨', () => {
    const err =
      'Duration: 00:01:02.50, start: 0.000000, bitrate: 1000 kb/s\n' +
      '  Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps\n' +
      '  Stream #0:1: Audio: aac, 44100 Hz, stereo'
    const info = parseProbe(err)
    expect(info.durationSec).toBe(62.5)
    expect(info.width).toBe(1080)
    expect(info.height).toBe(1920)
    expect(info.hasAudio).toBe(true)
    expect(info.hasVideo).toBe(true)
    // 只有音频流
    const onlyAudio = parseProbe('Duration: 00:00:10.00\n  Stream #0:0: Audio: mp3')
    expect(onlyAudio.hasAudio).toBe(true)
    expect(onlyAudio.hasVideo).toBe(false)
  })

  it('insideDir 路径守卫：目录内放行、逃逸拒绝', () => {
    expect(insideDir('C:/a', 'C:/a/b.mp4')).toBe(true)
    expect(insideDir('C:/a', 'C:/a/x/y.mp4')).toBe(true)
    expect(insideDir('C:/a', 'C:/a/../x.mp4')).toBe(false)
    expect(insideDir('C:/a', 'C:/b/x.mp4')).toBe(false)
  })
})
