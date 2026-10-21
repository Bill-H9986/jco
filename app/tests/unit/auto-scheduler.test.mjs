// M6/M7 调度器核心（唯一执行管道）：到点执行 / 去重 / 立即执行 / 并发拒绝 / 记录与通知。
import { describe, expect, it } from 'vitest'
import { createAutoScheduler } from '../../kernel/auto-scheduler.mjs'

function makeDeps(overrides = {}) {
  const calls = { executed: [], saved: [], notified: [] }
  const deps = {
    getTasks: () => [],
    getRuns: () => ({}),
    saveRun: (id, record) => calls.saved.push({ id, record }),
    execute: async (task) => {
      calls.executed.push(task.id)
      return { ok: true, summary: '干完了' }
    },
    notify: (task, record) => calls.notified.push({ id: task.id, ok: record.ok }),
    ...overrides,
  }
  return { deps, calls }
}

const task = (id, extra = {}) => ({
  id,
  name: `任务${id}`,
  desc: '干点啥',
  on: true,
  createdAt: 0,
  schedule: { kind: 'daily', time: '09:00' },
  ...extra,
})

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('调度器核心（唯一执行管道）', () => {
  it('到点执行：跑完写记录 + 通知', async () => {
    const { deps, calls } = makeDeps({
      getTasks: () => [task('t1')],
      now: () => new Date(2026, 9, 16, 9, 0, 1).getTime(),
    })
    const s = createAutoScheduler(deps)
    await s.tick()
    await wait()
    expect(calls.executed).toEqual(['t1'])
    expect(calls.saved.length).toBe(1)
    expect(calls.saved[0].record.ok).toBe(true)
    expect(calls.saved[0].record.dueAt).toBe(new Date(2026, 9, 16, 9, 0).getTime())
    expect(calls.notified).toEqual([{ id: 't1', ok: true }])
  })

  it('去重：已跑过（lastRunAt 覆盖该时刻）不再跑；暂停的不跑', async () => {
    const now = new Date(2026, 9, 16, 10, 0).getTime()
    const { deps, calls } = makeDeps({
      getTasks: () => [task('t1'), task('t2', { on: false })],
      getRuns: () => ({ t1: { lastRunAt: new Date(2026, 9, 16, 9, 1).getTime() } }),
      now: () => now,
    })
    const s = createAutoScheduler(deps)
    await s.tick()
    await wait()
    expect(calls.executed).toEqual([])
  })

  it('立即执行（马上跑）：runNow 直接跑，与到点同一条路（记录 + 通知）', async () => {
    const { deps, calls } = makeDeps({ now: () => new Date(2026, 9, 16, 15, 0).getTime() })
    const s = createAutoScheduler(deps)
    const ok = s.runNow(task('t9'))
    expect(ok).toBe(true)
    await wait()
    expect(calls.executed).toEqual(['t9'])
    expect(calls.saved.length).toBe(1)
    expect(calls.notified.length).toBe(1)
  })

  it('并发保护：同一任务正在跑时，runNow 拒绝、tick 跳过', async () => {
    let release = null
    const { deps, calls } = makeDeps({
      execute: (t) =>
        new Promise((resolve) => {
          calls.executed.push(t.id)
          release = () => resolve({ ok: true, summary: 'done' })
        }),
      getTasks: () => [task('t1')],
      now: () => new Date(2026, 9, 16, 9, 0, 1).getTime(),
    })
    const s = createAutoScheduler(deps)
    expect(s.runNow(task('t1'))).toBe(true)
    expect(s.runNow(task('t1'))).toBe(false) // 正在跑 → 拒绝
    await s.tick() // tick 也应跳过
    await wait()
    expect(calls.executed).toEqual(['t1'])
    release()
    await wait()
  })

  it('执行失败：记录 ok=false 且通知照发；不抛错', async () => {
    const { deps, calls } = makeDeps({
      execute: async () => ({ ok: false, summary: '打不开页面' }),
      now: () => new Date(2026, 9, 16, 9, 0, 1).getTime(),
    })
    const s = createAutoScheduler(deps)
    s.runNow(task('t1'))
    await wait()
    expect(calls.saved[0].record.ok).toBe(false)
    expect(calls.saved[0].record.summary).toContain('打不开')
    expect(calls.notified[0].ok).toBe(false)
  })

  it('数据读取失败：tick 静默跳过（不打挂心跳）', async () => {
    const { deps } = makeDeps({
      getTasks: () => {
        throw new Error('文件坏了')
      },
    })
    const s = createAutoScheduler(deps)
    await expect(s.tick()).resolves.toBeUndefined()
  })
})
