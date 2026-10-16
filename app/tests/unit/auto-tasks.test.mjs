// M6 任务数据模型（A2 迁移 / A3 新建映射）：老数据平滑升级、乱数据不炸、出厂数据刷新。
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..')
const require = createRequire(import.meta.url)
const AUTO = require(path.join(ROOT, '设计原型', 'assets', 'jco-auto-tasks.js'))

describe('出厂任务（结构）', () => {
  it('4 条、id 唯一、schedule 合法、含 createdAt 之外的必备字段', () => {
    expect(AUTO.DEFAULTS.length).toBe(4)
    expect(new Set(AUTO.DEFAULTS.map((t) => t.id)).size).toBe(4)
    for (const t of AUTO.DEFAULTS) {
      expect(t.name).toBeTruthy()
      expect(t.desc).toBeTruthy()
      expect(typeof t.on).toBe('boolean')
      expect(['daily', 'weekly']).toContain(t.schedule.kind)
      expect(t.schedule.time).toMatch(/^\d{2}:\d{2}$/)
      if (t.schedule.kind === 'weekly') expect(t.schedule.weekday).toBeGreaterThanOrEqual(1)
    }
  })

  it('不含做不了的活（旧"对标雷达"已替换为可执行任务）', () => {
    expect(AUTO.DEFAULTS.some((t) => t.name === '对标雷达')).toBe(false)
    expect(AUTO.DEFAULTS.some((t) => t.name === '今日战报')).toBe(true)
  })
})

describe('任务迁移（A2）', () => {
  it('无存储 → 默认 4 条；每条补 createdAt（盖章：升级/装机首启不立刻补跑）', () => {
    const out = AUTO.migrate(null)
    expect(out.length).toBe(4)
    for (const t of out) {
      expect(typeof t.createdAt).toBe('number')
      expect(t.createdAt).toBeGreaterThan(0)
      expect(t.when).toBe(AUTO.whenText(t.schedule))
    }
  })

  it('旧演示数据（对标雷达在）→ 换成"今日战报"，其它项保留', () => {
    const old = [
      {
        id: 't1',
        name: '对标雷达',
        desc: '盯 4 个对标账号，新爆款自动拆解入库',
        when: '每天 09:12',
        icon: 'ti-flame',
        on: true,
      },
      {
        id: 't3',
        name: '评论自动跟进',
        desc: '扫一遍评论，拟好回复等我放行',
        when: '每天 12:00',
        icon: 'ti-message-dots',
        on: false,
      },
    ]
    const out = AUTO.migrate(old)
    const t1 = out.find((t) => t.id === 't1')
    expect(t1.name).toBe('今日战报')
    expect(t1.on).toBe(true) // 用户的开关保留
    const t3 = out.find((t) => t.id === 't3')
    expect(t3.name).toBe('评论自动跟进')
    expect(t3.on).toBe(false) // 用户停过：保留
    expect(t3.schedule).toEqual({ kind: 'daily', time: '12:00' }) // 从 when 解析
  })

  it('用户自定义老任务 → 内容保留、when 解析成 schedule、when 重算', () => {
    const out = AUTO.migrate([
      { id: 'ta', name: '我的活', desc: '干点啥', when: '每周一 10:00', icon: 'ti-sparkles', on: true },
    ])
    expect(out[0].name).toBe('我的活')
    expect(out[0].schedule).toEqual({ kind: 'weekly', weekday: 1, time: '10:00' })
    expect(out[0].when).toBe('每周一 10:00')
  })

  it('when 乱格式 → 回退 每天 09:00（不丢任务）', () => {
    const out = AUTO.migrate([{ id: 'tb', name: '怪任务', desc: '', when: '看心情', icon: 'ti-x', on: true }])
    expect(out[0].schedule).toEqual({ kind: 'daily', time: '09:00' })
  })

  it('乱数据（字符串/空/坏项）→ 过滤或回退，不抛错', () => {
    expect(AUTO.migrate('坏了').length).toBe(4)
    expect(AUTO.migrate([null, 42, 'x']).length).toBeGreaterThanOrEqual(0)
    expect(AUTO.migrate([]).length).toBe(4)
  })

  it('幂等：迁一次的结果再迁 → 不变（createdAt 保留）', () => {
    const once = AUTO.migrate(null)
    const twice = AUTO.migrate(once)
    expect(twice).toEqual(once)
  })
})

describe('新建任务映射（A3 数据面）', () => {
  it('四档频率 → schedule 与展示文案', () => {
    expect(AUTO.makeSchedule('daily')).toEqual({ schedule: { kind: 'daily', time: '09:00' }, when: '每天 09:00' })
    expect(AUTO.makeSchedule('morning')).toEqual({ schedule: { kind: 'daily', time: '08:30' }, when: '每天 08:30' })
    expect(AUTO.makeSchedule('evening')).toEqual({ schedule: { kind: 'daily', time: '18:30' }, when: '每天 18:30' })
    expect(AUTO.makeSchedule('weekly')).toEqual({
      schedule: { kind: 'weekly', weekday: 1, time: '10:00' },
      when: '每周一 10:00',
    })
  })

  it('whenText 覆盖：每天 / 每周', () => {
    expect(AUTO.whenText({ kind: 'daily', time: '07:05' })).toBe('每天 07:05')
    expect(AUTO.whenText({ kind: 'weekly', weekday: 5, time: '20:00' })).toBe('每周五 20:00')
  })
})
