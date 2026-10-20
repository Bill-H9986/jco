import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createMediaJobService } = require('../../media-jobs.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(fn, timeout = 4000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = fn()
    if (value) return value
    await delay(20)
  }
  throw new Error('等待超时')
}

function makeService(dir, draftsRef, onVideo) {
  let saved = 0
  return createMediaJobService({
    dir,
    readDrafts: () => JSON.parse(JSON.stringify(draftsRef.value)),
    writeDrafts: (data) => {
      draftsRef.value = JSON.parse(JSON.stringify(data))
    },
    getBridge: async () => ({
      drawImage: async () => {
        await delay(30)
        return { ok: true, dataUrl: 'data:image/png;base64,AA==' }
      },
      videoGenerate: async (payload) => {
        if (onVideo) onVideo(payload)
        await delay(60)
        return { ok: true, dataUrl: 'data:video/mp4;base64,AA==' }
      },
    }),
    saveAsset: async ({ kind }) => ({ ok: true, path: path.join(dir, `${kind}-${++saved}.bin`) }),
    onJob: () => {},
  })
}

describe('media jobs 后台任务', () => {
  it('图片任务逐张落盘并写回草稿', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-image-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [{ id: 11, idea: '图片', type: 'image', status: 'review', images: [], videos: {}, shots: [] }],
      },
    }
    const service = makeService(dir, draftsRef)
    const started = await service.start({
      kind: 'image',
      draftId: 11,
      prompts: ['画面一', '画面二'],
      ratio: '3:4',
      res: '2K',
      sizePx: '1536x2048',
    })
    expect(started.ok).toBe(true)
    const finished = await waitFor(() => {
      const job = service.get(started.job.id)
      return job && job.status === 'done' ? job : null
    })
    expect(finished.items).toHaveLength(2)
    expect(draftsRef.value.items[0].images).toHaveLength(2)
    expect(draftsRef.value.items[0].status).toBe('review')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('视频任务运行中可查询，完成后写回每段状态', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-video-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [
          {
            id: 22,
            idea: '视频',
            type: 'video',
            status: 'review',
            shots: [
              { line: '一', pic: 'A' },
              { line: '二', pic: 'B' },
            ],
            videos: {},
            images: [],
          },
        ],
      },
    }
    const service = makeService(dir, draftsRef)
    const started = await service.start({
      kind: 'video',
      draftId: 22,
      shots: [
        { index: 0, prompt: '第一段', seconds: 5 },
        { index: 1, prompt: '第二段', seconds: 5 },
      ],
      ratio: '9:16',
      res: '720P',
    })
    expect(started.ok).toBe(true)
    expect(service.list(22).some((job) => job.status === 'running')).toBe(true)
    const duplicate = await service.start({
      kind: 'video',
      draftId: 22,
      shots: [{ index: 0, prompt: '重复', seconds: 5 }],
      ratio: '9:16',
      res: '720P',
    })
    expect(duplicate.existing).toBe(true)
    await waitFor(() => {
      const job = service.get(started.job.id)
      return job && job.status === 'done' ? job : null
    })
    expect(draftsRef.value.items[0].videos['0'].status).toBe('done')
    expect(draftsRef.value.items[0].videos['1'].status).toBe('done')
    expect(draftsRef.value.items[0].status).toBe('review')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('视频分辨率按支持范围归一化后下发，旧 1080P 不会传给模型', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-video-res-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [
          {
            id: 44,
            idea: '旧草稿',
            type: 'video',
            status: 'review',
            shots: [{ line: '一', pic: 'A' }],
            videos: {},
            images: [],
          },
        ],
      },
    }
    const calls = []
    const service = makeService(dir, draftsRef, (payload) => calls.push(payload))
    const started = await service.start({
      kind: 'video',
      draftId: 44,
      shots: [{ index: 0, prompt: '第一段', seconds: 5 }],
      ratio: '9:16',
      res: '1080P',
    })
    expect(started.ok).toBe(true)
    expect(started.job.params.res).toBe('720P')
    await waitFor(() => {
      const job = service.get(started.job.id)
      return job && job.status === 'done' ? job : null
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].size).toBe('720P')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('取消视频任务后保留真实完成比例，不把草稿伪装成 100%', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-video-cancel-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [
          {
            id: 55,
            idea: '取消',
            type: 'video',
            status: 'review',
            shots: [
              { line: '一', pic: 'A' },
              { line: '二', pic: 'B' },
            ],
            videos: {},
            images: [],
          },
        ],
      },
    }
    let release = null
    const service = createMediaJobService({
      dir,
      readDrafts: () => JSON.parse(JSON.stringify(draftsRef.value)),
      writeDrafts: (data) => {
        draftsRef.value = JSON.parse(JSON.stringify(data))
      },
      getBridge: async () => ({
        drawImage: async () => ({ ok: false, error: '不适用' }),
        videoGenerate: async () => {
          await new Promise((resolve) => {
            release = resolve
          })
          return { ok: true, dataUrl: 'data:video/mp4;base64,AA==' }
        },
      }),
      saveAsset: async ({ kind }) => ({ ok: true, path: path.join(dir, `${kind}.bin`) }),
      onJob: () => {},
    })
    const started = await service.start({
      kind: 'video',
      draftId: 55,
      shots: [
        { index: 0, prompt: '第一段', seconds: 5 },
        { index: 1, prompt: '第二段', seconds: 5 },
      ],
      ratio: '9:16',
      res: '720P',
    })
    await waitFor(() => typeof release === 'function')
    expect(service.cancel(started.job.id).ok).toBe(true)
    release()
    await delay(120)
    expect(service.get(started.job.id).status).toBe('canceled')
    expect(draftsRef.value.items[0].status).toBe('review')
    expect(draftsRef.value.items[0].progress).toBe(50)
    expect(draftsRef.value.items[0].stepText).toBe('已停止')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('应用重启后的 running 任务标为已中断并保留结果', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-orphan-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [
          {
            id: 33,
            idea: '中断',
            type: 'video',
            status: 'generating',
            shots: [{ line: '一', pic: 'A' }],
            videos: { 0: { status: 'doing' } },
            images: [],
          },
        ],
      },
    }
    fs.writeFileSync(
      path.join(dir, 'media-orphan.json'),
      JSON.stringify({
        id: 'media-orphan',
        appPid: -1,
        kind: 'video',
        draftId: 33,
        status: 'running',
        progress: 20,
        stepText: '正在出第 1 段',
        total: 1,
        done: 0,
        items: [{ index: 0, status: 'doing' }],
        params: { ratio: '9:16', res: '720P', sizePx: '', model: '' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      'utf8',
    )
    const service = makeService(dir, draftsRef)
    const jobs = service.list(33)
    expect(jobs[0].status).toBe('interrupted')
    expect(draftsRef.value.items[0].status).toBe('interrupted')
    expect(draftsRef.value.items[0].videos['0'].status).toBe('failed')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('图片部分失败时保留成功项并标记为 partial', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-image-partial-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [{ id: 66, idea: '部分失败', type: 'image', status: 'review', images: [], videos: {}, shots: [] }],
      },
    }
    let calls = 0
    const service = createMediaJobService({
      dir,
      readDrafts: () => JSON.parse(JSON.stringify(draftsRef.value)),
      writeDrafts: (data) => {
        draftsRef.value = JSON.parse(JSON.stringify(data))
      },
      getBridge: async () => ({
        drawImage: async () => {
          calls += 1
          if (calls === 1) throw new Error('第一张失败')
          return { ok: true, dataUrl: 'data:image/png;base64,AA==' }
        },
        videoGenerate: async () => ({ ok: false }),
      }),
      saveAsset: async ({ kind }) => ({ ok: true, path: path.join(dir, `${kind}.png`) }),
      onJob: () => {},
    })
    const started = await service.start({
      kind: 'image',
      draftId: 66,
      prompts: ['失败的一张', '成功的一张'],
      ratio: '3:4',
      res: '2K',
      sizePx: '1536x2048',
    })
    const finished = await waitFor(() => {
      const job = service.get(started.job.id)
      return job && job.status !== 'running' ? job : null
    })
    expect(finished.status).toBe('partial')
    expect(finished.items.map((item) => item.ok)).toEqual([false, true])
    expect(draftsRef.value.items[0].images).toHaveLength(1)
    expect(draftsRef.value.items[0].status).toBe('review')
    expect(draftsRef.value.items[0].stepText).toContain('部分图片')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('生成结果落盘失败时不能把任务伪装成完成', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-save-fail-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [{ id: 77, idea: '落盘失败', type: 'image', status: 'review', images: [], videos: {}, shots: [] }],
      },
    }
    const service = createMediaJobService({
      dir,
      readDrafts: () => JSON.parse(JSON.stringify(draftsRef.value)),
      writeDrafts: (data) => {
        draftsRef.value = JSON.parse(JSON.stringify(data))
      },
      getBridge: async () => ({
        drawImage: async () => ({ ok: true, dataUrl: 'data:image/png;base64,AA==' }),
        videoGenerate: async () => ({ ok: false }),
      }),
      saveAsset: async () => ({ ok: false, error: '磁盘不可写' }),
      onJob: () => {},
    })
    const started = await service.start({
      kind: 'image',
      draftId: 77,
      prompts: ['一张保存失败的图'],
      ratio: '3:4',
      res: '1K',
      sizePx: '1024x1365',
    })
    const finished = await waitFor(() => {
      const job = service.get(started.job.id)
      return job && job.status !== 'running' ? job : null
    })
    expect(finished.status).toBe('failed')
    expect(finished.items[0]).toMatchObject({ ok: false, error: '磁盘不可写' })
    expect(draftsRef.value.items[0].images).toEqual([])
    expect(draftsRef.value.items[0].status).toBe('review')
    expect(draftsRef.value.items[0].stepText).toBe('磁盘不可写')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('视频遇到 429 会等待后重试并最终完成', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-retry-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [
          {
            id: 88,
            idea: '限流重试',
            type: 'video',
            status: 'review',
            shots: [{ line: '一段', pic: 'A' }],
            videos: {},
            images: [],
          },
        ],
      },
    }
    let calls = 0
    const service = createMediaJobService({
      dir,
      retryDelayMs: 10,
      readDrafts: () => JSON.parse(JSON.stringify(draftsRef.value)),
      writeDrafts: (data) => {
        draftsRef.value = JSON.parse(JSON.stringify(data))
      },
      getBridge: async () => ({
        drawImage: async () => ({ ok: false }),
        videoGenerate: async () => {
          calls += 1
          if (calls === 1) return { ok: false, error: '429 队列已满' }
          return { ok: true, dataUrl: 'data:video/mp4;base64,AA==' }
        },
      }),
      saveAsset: async ({ kind }) => ({ ok: true, path: path.join(dir, `${kind}.mp4`) }),
      onJob: () => {},
    })
    const started = await service.start({
      kind: 'video',
      draftId: 88,
      shots: [{ index: 0, prompt: '一段', seconds: 5 }],
      ratio: '9:16',
      res: '720P',
    })
    const finished = await waitFor(() => {
      const job = service.get(started.job.id)
      return job && job.status !== 'running' ? job : null
    })
    expect(calls).toBe(2)
    expect(finished.status).toBe('done')
    expect(draftsRef.value.items[0].videos['0'].status).toBe('done')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('重试等待期间取消后不再发起下一次模型调用', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-cancel-retry-'))
    const draftsRef = {
      value: {
        version: 1,
        items: [
          {
            id: 99,
            idea: '重试取消',
            type: 'video',
            status: 'review',
            shots: [{ line: '一段', pic: 'A' }],
            videos: {},
            images: [],
          },
        ],
      },
    }
    let calls = 0
    const service = createMediaJobService({
      dir,
      retryDelayMs: 40,
      readDrafts: () => JSON.parse(JSON.stringify(draftsRef.value)),
      writeDrafts: (data) => {
        draftsRef.value = JSON.parse(JSON.stringify(data))
      },
      getBridge: async () => ({
        drawImage: async () => ({ ok: false }),
        videoGenerate: async () => {
          calls += 1
          return { ok: false, error: '503 稍后重试' }
        },
      }),
      saveAsset: async ({ kind }) => ({ ok: true, path: path.join(dir, `${kind}.mp4`) }),
      onJob: () => {},
    })
    const started = await service.start({
      kind: 'video',
      draftId: 99,
      shots: [{ index: 0, prompt: '一段', seconds: 5 }],
      ratio: '9:16',
      res: '720P',
    })
    await waitFor(() => calls === 1)
    expect(service.cancel(started.job.id).ok).toBe(true)
    await delay(100)
    expect(calls).toBe(1)
    expect(service.get(started.job.id).status).toBe('canceled')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('空提示词与空分镜不能创建后台任务', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-media-empty-'))
    const draftsRef = { value: { version: 1, items: [] } }
    const service = makeService(dir, draftsRef)
    expect(await service.start({ kind: 'image', draftId: 1, prompts: [] })).toMatchObject({
      ok: false,
      error: '没有图片提示词',
    })
    expect(await service.start({ kind: 'video', draftId: 2, shots: [] })).toMatchObject({
      ok: false,
      error: '没有视频分镜',
    })
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
