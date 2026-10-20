'use strict'

const fs = require('node:fs')
const path = require('node:path')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createMediaJobService(deps) {
  const dir = deps.dir
  fs.mkdirSync(dir, { recursive: true })
  const jobs = new Map()

  function jobFile(id) {
    return path.join(dir, String(id) + '.json')
  }

  function emit(job) {
    try {
      deps.onJob(clone(job))
    } catch (error) {
      /* 事件推送失败不影响任务 */
    }
  }

  function persist(job) {
    job.updatedAt = Date.now()
    fs.mkdirSync(dir, { recursive: true })
    const file = jobFile(job.id)
    const temp = file + '.tmp-' + process.pid
    fs.writeFileSync(temp, JSON.stringify(job, null, 2), 'utf8')
    fs.renameSync(temp, file)
    emit(job)
  }

  function updateDraft(job, updater) {
    try {
      const data = deps.readDrafts()
      const draft = (data.items || []).find((item) => Number(item.id) === Number(job.draftId))
      if (!draft) return
      updater(draft)
      draft.updatedAt = Date.now()
      deps.writeDrafts(data)
    } catch (error) {
      /* 草稿写回失败不终止任务，任务 JSON 仍保留结果 */
    }
  }

  function markInterrupted(job) {
    const errorText =
      job.canceled === true ? '已停止' : '应用重启，任务已中断；已完成的结果保留，未完成项可重试。'
    job.status = job.canceled === true ? 'canceled' : 'interrupted'
    job.error = errorText
    job.updatedAt = Date.now()
    try {
      const file = jobFile(job.id)
      const temp = file + '.tmp-' + process.pid
      fs.writeFileSync(temp, JSON.stringify(job, null, 2), 'utf8')
      fs.renameSync(temp, file)
    } catch (error) {}
    updateDraft(job, (draft) => {
      draft.status = 'interrupted'
      draft.progress = Number(job.progress) || 0
      draft.stepText = errorText
      draft.jobId = job.id
      draft.jobKind = job.kind
      if (draft.videos && typeof draft.videos === 'object') {
        Object.keys(draft.videos).forEach((key) => {
          if (draft.videos[key] && draft.videos[key].status === 'doing') {
            draft.videos[key] = { status: 'failed', error: errorText }
          }
        })
      }
    })
    emit(job)
  }

  function loadAll() {
    let names = []
    try {
      names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
    } catch (error) {
      names = []
    }
    for (const name of names) {
      const id = name.slice(0, -5)
      if (jobs.has(id)) continue
      try {
        const job = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
        if (job && job.id) jobs.set(String(job.id), job)
      } catch (error) {}
    }
    for (const job of jobs.values()) {
      if (job.status === 'running' && job.appPid !== process.pid) markInterrupted(job)
    }
    return jobs
  }

  function get(id) {
    loadAll()
    const job = jobs.get(String(id))
    return job ? clone(job) : null
  }

  function list(draftId) {
    loadAll()
    const wanted = draftId === undefined || draftId === null ? null : Number(draftId)
    return [...jobs.values()]
      .filter((job) => wanted === null || Number(job.draftId) === wanted)
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
      .map(clone)
  }

  async function saveGenerated(kind, result) {
    if (result && result.dataUrl) return deps.saveAsset({ kind, dataUrl: result.dataUrl })
    if (result && result.url) return deps.saveAsset({ kind, url: result.url, ext: kind === 'video' ? 'mp4' : 'png' })
    return { ok: false, error: '平台没有返回可保存的内容' }
  }

  async function runImage(job) {
    try {
      const bridge = await deps.getBridge()
      if (!bridge) throw new Error('内核还没就绪')
      const prompts = Array.isArray(job.prompts) ? job.prompts : []
      job.total = prompts.length
      for (let i = 0; i < prompts.length; i += 1) {
        if (job.canceled === true) {
          job.status = 'canceled'
          job.error = '已停止'
          break
        }
        job.stepText = '正在画第 ' + (i + 1) + ' 张 / ' + prompts.length
        job.progress = Math.max(1, Math.round((i / prompts.length) * 100))
        persist(job)
        let result = null
        try {
          result = await bridge.drawImage({
            prompt: String(prompts[i] || ''),
            size: job.params.res,
            sizePx: job.params.sizePx,
            aspect: job.params.ratio,
            model: job.params.model,
          })
        } catch (error) {
          result = { ok: false, error: String((error && error.message) || error) }
        }
        const saved = result && result.ok ? await saveGenerated('image', result) : null
        const item = { index: i, ok: Boolean(saved && saved.ok), prompt: String(prompts[i] || '') }
        if (saved && saved.ok) {
          item.path = saved.path
          item.src = 'file:///' + String(saved.path).replace(/\\/g, '/')
          updateDraft(job, (draft) => {
            draft.images = Array.isArray(draft.images) ? draft.images : []
            if (!draft.images.some((image) => image && image.path === saved.path)) {
              draft.images.push({ src: item.src, path: saved.path, prompt: item.prompt })
            }
          })
        } else {
          item.error = String((saved && saved.error) || (result && result.error) || '出图失败')
        }
        job.items.push(item)
        job.done = job.items.filter((entry) => entry.ok).length
        persist(job)
      }
    } catch (error) {
      job.error = String((error && error.message) || error)
    }
    if (job.status === 'running') {
      const done = job.items.filter((entry) => entry.ok).length
      job.status = job.total > 0 && done === job.total ? 'done' : done > 0 ? 'partial' : 'failed'
      if (!job.error && job.status !== 'done') job.error = '部分图片没有生成成功'
      job.progress = 100
      job.stepText =
        job.status === 'done' ? '图片全部出好' : job.status === 'partial' ? '部分图片出好，失败项可重试' : '出图失败'
    }
    updateDraft(job, (draft) => {
      draft.status = 'review'
      draft.progress = 100
      draft.stepText = job.status === 'done' ? '' : job.error || ''
      draft.jobId = job.id
      draft.jobKind = 'image'
    })
    persist(job)
  }

  async function runVideo(job) {
    try {
      const bridge = await deps.getBridge()
      if (!bridge) throw new Error('内核还没就绪')
      const shots = Array.isArray(job.shots) ? job.shots : []
      job.total = shots.length
      for (const shot of shots) {
        if (job.canceled === true) {
          job.status = 'canceled'
          job.error = '已停止'
          break
        }
        const index = Number(shot.index) || 0
        job.stepText = '正在出第 ' + (index + 1) + ' 段 / ' + shots.length
        const finished = job.items.filter((entry) => entry.status === 'done' || entry.status === 'failed').length
        job.progress = Math.max(1, Math.round((finished / shots.length) * 100))
        const itemIndex = job.items.findIndex((entry) => entry.index === index)
        if (itemIndex >= 0) job.items[itemIndex] = { index, status: 'doing' }
        else job.items.push({ index, status: 'doing' })
        persist(job)
        updateDraft(job, (draft) => {
          draft.videos = draft.videos || {}
          draft.videos[index] = { status: 'doing' }
        })

        let result = null
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (job.canceled === true) break
          try {
            result = await bridge.videoGenerate({
              prompt: String(shot.prompt || ''),
              seconds: shot.seconds,
              aspect: job.params.ratio,
              size: '720P',
              model: job.params.model,
            })
          } catch (error) {
            result = { ok: false, error: String((error && error.message) || error) }
          }
          if (result && result.ok) break
          const message = String((result && result.error) || '')
          if (attempt < 3 && /队列已满|rate|429|503|稍后|重试/i.test(message)) {
            await new Promise((resolve) => setTimeout(resolve, 60000))
            continue
          }
          break
        }

        const saved = result && result.ok ? await saveGenerated('video', result) : null
        const itemAt = job.items.findIndex((entry) => entry.index === index)
        if (saved && saved.ok) {
          const next = {
            index,
            status: 'done',
            path: saved.path,
            url: 'file:///' + String(saved.path).replace(/\\/g, '/'),
            videoId: String((result && result.videoId) || ''),
          }
          if (itemAt >= 0) job.items[itemAt] = next
          else job.items.push(next)
          updateDraft(job, (draft) => {
            draft.videos = draft.videos || {}
            draft.videos[index] = {
              status: 'done',
              url: next.url,
              path: next.path,
              videoId: next.videoId,
            }
          })
        } else {
          const errorText = String((saved && saved.error) || (result && result.error) || '出片失败')
          const next = {
            index,
            status: 'failed',
            error: errorText,
            videoId: String((result && result.videoId) || ''),
          }
          if (itemAt >= 0) job.items[itemAt] = next
          else job.items.push(next)
          updateDraft(job, (draft) => {
            draft.videos = draft.videos || {}
            draft.videos[index] = { status: 'failed', error: errorText }
          })
        }
        job.done = job.items.filter((entry) => entry.status === 'done').length
        persist(job)
      }
    } catch (error) {
      job.error = String((error && error.message) || error)
    }
    if (job.status === 'running') {
      const done = job.items.filter((entry) => entry.status === 'done').length
      job.status = job.total > 0 && done === job.total ? 'done' : done > 0 ? 'partial' : 'failed'
      if (!job.error && job.status !== 'done') job.error = '部分分镜没有出片'
      job.progress = 100
      job.stepText =
        job.status === 'done' ? '视频全部出好' : job.status === 'partial' ? '部分视频出好，失败段可重试' : '出片失败'
    }
    updateDraft(job, (draft) => {
      draft.status = 'review'
      draft.progress = 100
      draft.stepText = job.status === 'done' ? '' : job.error || ''
      draft.jobId = job.id
      draft.jobKind = 'video'
    })
    persist(job)
  }

  async function start(payload) {
    loadAll()
    const kind = payload && payload.kind === 'image' ? 'image' : 'video'
    const draftId = Number(payload && payload.draftId)
    if (!Number.isFinite(draftId)) return { ok: false, error: '缺少草稿 id' }
    const existing = [...jobs.values()].find(
      (job) => job.status === 'running' && Number(job.draftId) === draftId && job.kind === kind,
    )
    if (existing) return { ok: true, job: clone(existing), existing: true }

    const id = 'media-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    const job = {
      id,
      appPid: process.pid,
      kind,
      draftId,
      status: 'running',
      progress: 0,
      stepText: '准备中',
      total: 0,
      done: 0,
      items: [],
      errors: [],
      params: {
        ratio: String((payload && payload.ratio) || '9:16'),
        res: String((payload && payload.res) || (kind === 'image' ? '1K' : '720P')),
        sizePx: String((payload && payload.sizePx) || ''),
        model: String((payload && payload.model) || ''),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (kind === 'image') {
      job.prompts = (Array.isArray(payload.prompts) ? payload.prompts : []).map(String).filter(Boolean).slice(0, 20)
      job.total = job.prompts.length
      if (!job.total) return { ok: false, error: '没有图片提示词' }
    } else {
      job.shots = (Array.isArray(payload.shots) ? payload.shots : [])
        .map((shot) => ({
          index: Number(shot && shot.index) || 0,
          prompt: String((shot && shot.prompt) || ''),
          seconds: Math.max(4, Math.min(12, Number(shot && shot.seconds) || 5)),
        }))
        .filter((shot) => shot.prompt)
        .slice(0, 50)
      job.total = job.shots.length
      if (!job.total) return { ok: false, error: '没有视频分镜' }
    }
    jobs.set(id, job)
    updateDraft(job, (draft) => {
      draft.status = 'generating'
      draft.jobId = id
      draft.jobKind = kind
      draft.progress = 0
      draft.stepText = '准备中'
      draft.updatedAt = Date.now()
    })
    persist(job)
    void (kind === 'image' ? runImage(job) : runVideo(job))
    return { ok: true, job: clone(job) }
  }

  function cancel(id) {
    loadAll()
    const job = jobs.get(String(id))
    if (!job) return { ok: false, error: '任务不存在' }
    if (job.status !== 'running') return { ok: true, job: clone(job) }
    job.canceled = true
    job.status = 'canceled'
    job.error = '已停止'
    job.stepText = '已停止'
    updateDraft(job, (draft) => {
      draft.status = 'review'
      draft.progress = Number(job.progress) || 0
      draft.stepText = '已停止'
    })
    persist(job)
    return { ok: true, job: clone(job) }
  }

  return {
    start,
    get,
    list,
    cancel,
    recoverOrphans: () => {
      loadAll()
    },
  }
}

module.exports = { createMediaJobService }
