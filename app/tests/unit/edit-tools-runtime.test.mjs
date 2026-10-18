// W2-05：ffmpeg 子进程超时/取消，以及真实 ffmpeg 生成、探测、裁剪冒烟。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { afterAll, describe, expect, it } from 'vitest'
import { parseProbe, runFfmpeg } from '../../kernel/edit-tools/index.mjs'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-ffmpeg-runtime-'))

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('后期工具运行时（W2-05）', () => {
  it('超时：到点杀掉长进程并返回 TIMEOUT', async () => {
    const started = Date.now()
    const result = await runFfmpeg(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], TMP, {
      timeoutMs: 150,
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('TIMEOUT')
    expect(Date.now() - started).toBeLessThan(3000)
  }, 10_000)

  it('取消：取消标记出现后杀掉进程并清理标记', async () => {
    const cancelFile = path.join(TMP, 'cancel.flag')
    fs.rmSync(cancelFile, { force: true })
    setTimeout(() => fs.writeFileSync(cancelFile, 'cancel', 'utf8'), 150)
    const result = await runFfmpeg(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], TMP, {
      cancelFile,
      cancelPollMs: 25,
      timeoutMs: 5000,
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('CANCELLED')
    expect(fs.existsSync(cancelFile)).toBe(false)
  }, 10_000)

  it('真实 ffmpeg：生成 1 秒样片，探测时长/分辨率/音轨，再裁剪成新文件', async () => {
    const sample = path.join(TMP, 'sample.mp4')
    const generated = await runFfmpeg(
      ffmpeg.path,
      [
        '-hide_banner',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=320x240:rate=10',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        sample,
      ],
      TMP,
      { timeoutMs: 60_000 },
    )
    expect(generated.ok, generated.err.slice(-500)).toBe(true)
    expect(fs.statSync(sample).size).toBeGreaterThan(1000)

    const probed = await runFfmpeg(ffmpeg.path, ['-hide_banner', '-i', 'sample.mp4'], TMP, { timeoutMs: 30_000 })
    const info = parseProbe(probed.err)
    expect(info.durationSec).toBeGreaterThan(0)
    expect(info.width).toBe(320)
    expect(info.height).toBe(240)
    expect(info.hasAudio).toBe(true)

    const cut = path.join(TMP, 'cut.mp4')
    const trimmed = await runFfmpeg(
      ffmpeg.path,
      [
        '-hide_banner',
        '-y',
        '-ss',
        '0',
        '-i',
        'sample.mp4',
        '-t',
        '0.5',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-c:a',
        'aac',
        cut,
      ],
      TMP,
      { timeoutMs: 60_000 },
    )
    expect(trimmed.ok, trimmed.err.slice(-500)).toBe(true)
    expect(fs.statSync(cut).size).toBeGreaterThan(1000)
  }, 120_000)
})
