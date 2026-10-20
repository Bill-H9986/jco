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
})
