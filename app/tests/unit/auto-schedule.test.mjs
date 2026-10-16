// M6 调度判定（对应 e2e 用例清单 A1）：到点 / 补跑 / 去重 / 窗口 / 周任务 / 边界 / 建任务防呆。
// 语义出处：dsh-schedule "每个重复任务只补发最近一次错过的发生时点"。
import { describe, expect, it } from 'vitest'
import { recentDueAt, shouldRun } from '../../kernel/auto-schedule.mjs'

const at = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s, 0).getTime()
const daily = (time) => ({ kind: 'daily', time })
const weekly = (weekday, time) => ({ kind: 'weekly', weekday, time })

describe('recentDueAt：最近一个计划时刻', () => {
  it('daily：今天过了取今天，没过取昨天', () => {
    expect(recentDueAt(daily('09:00'), at(2026, 10, 16, 10, 0))).toBe(at(2026, 10, 16, 9, 0))
    expect(recentDueAt(daily('09:00'), at(2026, 10, 16, 8, 0))).toBe(at(2026, 10, 15, 9, 0))
    expect(recentDueAt(daily('09:00'), at(2026, 10, 16, 9, 0))).toBe(at(2026, 10, 16, 9, 0)) // 恰好等于
  })

  it('weekly：最近的匹配星期（周一=1），没到就回上周', () => {
    // 2026-10-16 是周五；周一 = 2026-10-12
    expect(recentDueAt(weekly(1, '10:00'), at(2026, 10, 16, 12, 0))).toBe(at(2026, 10, 12, 10, 0))
    expect(recentDueAt(weekly(1, '10:00'), at(2026, 10, 12, 9, 0))).toBe(at(2026, 10, 5, 10, 0)) // 周一上午还没到 10 点
    expect(recentDueAt(weekly(5, '10:00'), at(2026, 10, 16, 12, 0))).toBe(at(2026, 10, 16, 10, 0)) // 今天就是周五
  })

  it('不认识的规则 → null（不抛错）', () => {
    expect(recentDueAt({ kind: 'nope' }, Date.now())).toBeNull()
    expect(recentDueAt(null, Date.now())).toBeNull()
  })
})

describe('shouldRun：该不该跑', () => {
  const task = (schedule, createdAt = 0) => ({ schedule, createdAt })

  it('到点跑（now 刚过计划时刻、没跑过）', () => {
    expect(shouldRun(task(daily('09:00')), at(2026, 10, 16, 9, 0, 1), at(2026, 10, 15, 9, 0))).toBe(
      at(2026, 10, 16, 9, 0),
    )
  })

  it('没到点不跑（今天还没到，且没有更近的未跑时刻）', () => {
    // 昨天 09:00 跑过了 → 今天 08:59 没有可跑的
    expect(shouldRun(task(daily('09:00')), at(2026, 10, 16, 8, 59), at(2026, 10, 15, 9, 0))).toBeNull()
  })

  it('已跑过不跑（同一天去重）', () => {
    expect(shouldRun(task(daily('09:00')), at(2026, 10, 16, 10, 0), at(2026, 10, 16, 9, 1))).toBeNull()
  })

  it('补跑：晚了一小时、没跑过 → 跑，due 是错过的那个时刻', () => {
    expect(shouldRun(task(daily('09:00')), at(2026, 10, 16, 10, 0), at(2026, 10, 15, 9, 1))).toBe(
      at(2026, 10, 16, 9, 0),
    )
  })

  it('补跑边界：daily 晚 23 小时 59 分（补昨天那次）仍在窗口内 → 跑', () => {
    // daily 每天都触发，due 与 now 的间隔恒 <24h（窗口是保险丝）；真正可达的超窗在 weekly
    expect(shouldRun(task(daily('09:00')), at(2026, 10, 17, 8, 59), at(2026, 10, 15, 8, 0))).toBe(
      at(2026, 10, 16, 9, 0),
    )
  })

  it('weekly 窗口 72 小时：周三补跑周一 → 跑；周日补跑周一 → 不跑', () => {
    expect(shouldRun(task(weekly(1, '10:00')), at(2026, 10, 14, 12, 0), at(2026, 10, 5, 10, 1))).toBe(
      at(2026, 10, 12, 10, 0),
    )
    expect(shouldRun(task(weekly(1, '10:00')), at(2026, 10, 18, 12, 0), at(2026, 10, 5, 10, 1))).toBeNull()
  })

  it('建任务防呆：due 早于 createdAt 不补跑（新任务不追旧账）', () => {
    // 20:00 建了"每天傍晚 18:30"，今天 18:30 不该立刻补
    expect(shouldRun(task(daily('18:30'), at(2026, 10, 16, 20, 0)), at(2026, 10, 16, 20, 0), null)).toBeNull()
    // 第二天 18:30 正常跑
    expect(shouldRun(task(daily('18:30'), at(2026, 10, 16, 20, 0)), at(2026, 10, 17, 18, 30, 5), null)).toBe(
      at(2026, 10, 17, 18, 30),
    )
  })

  it('00:00 边界：刚过零点算今天的时刻', () => {
    expect(shouldRun(task(daily('00:00')), at(2026, 10, 16, 0, 0, 1), at(2026, 10, 15, 0, 0, 1))).toBe(
      at(2026, 10, 16, 0, 0),
    )
  })

  it('畸形输入 → null（不抛错）', () => {
    expect(shouldRun(null, Date.now(), null)).toBeNull()
    expect(shouldRun({}, Date.now(), null)).toBeNull()
    expect(shouldRun({ schedule: { kind: 'daily', time: '乱写' } }, Date.now(), null)).toBeNull()
  })
})
