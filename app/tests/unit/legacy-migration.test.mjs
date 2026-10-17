import { describe, expect, it } from 'vitest'
import { migrateLegacyData } from '../../src/infrastructure/store/migrate-legacy.ts'
import { createEmptyStoreFile } from '../../src/infrastructure/store/store-schema.ts'

const NOW = 1_792_220_000_000

describe('旧数据迁移器', () => {
  it('迁移多会话：保留标题、角色、时间、长消息完整内容', () => {
    const longText = '很长的旧消息'.repeat(800)
    const result = migrateLegacyData({
      now: NOW,
      chats: {
        activeId: 'c1',
        chats: [
          {
            id: 'c1',
            title: '旧会话',
            updatedAt: 100,
            messages: [
              { role: 'user', text: '你好', t: 90 },
              { role: 'ai', text: longText, t: 100 },
            ],
          },
          {
            id: 'c2',
            title: '第二个会话',
            updatedAt: 200,
            messages: [{ role: 'user', text: '第二段', t: 200 }],
          },
        ],
      },
    })
    expect(result.store.data.conversations).toHaveLength(2)
    expect(result.store.data.messages).toHaveLength(3)
    expect(result.store.data.conversations[0].id).toBe('legacy-conv-c1')
    expect(result.store.data.messages[1].role).toBe('assistant')
    expect(result.store.data.messages[1].content).toBe(longText)
    expect(result.store.data.messages[1].content.length).toBeGreaterThan(4000)
    expect(result.report.conversations).toBe(2)
    expect(result.report.messages).toBe(3)
  })

  it('没有多会话时迁移旧单会话 jco-chat-v1', () => {
    const result = migrateLegacyData({
      now: NOW,
      singleChat: {
        items: [
          { role: 'user', text: '旧单会话问题', t: 10 },
          { role: 'ai', text: '旧单会话回答', t: 20 },
        ],
      },
    })
    expect(result.store.data.conversations).toHaveLength(1)
    expect(result.store.data.conversations[0].id).toBe('legacy-conv-single')
    expect(result.store.data.messages).toHaveLength(2)
  })

  it('迁移任务台账：done / running 状态归一，running 标记中断', () => {
    const result = migrateLegacyData({
      now: NOW,
      taskSessions: [
        {
          id: 't-done',
          name: '已完成旧任务',
          staff: 'publish',
          state: 'done',
          startedAt: 100,
          endedAt: 200,
          summary: '已经完成',
          messages: [{ role: 'user', text: '发一条视频', t: 100 }],
        },
        {
          id: 't-running',
          name: '中断旧任务',
          staff: 'post',
          state: 'running',
          startedAt: 300,
          summary: '',
        },
      ],
    })
    expect(result.store.data.tasks).toHaveLength(2)
    expect(result.store.data.taskRuns).toHaveLength(2)
    expect(result.store.data.taskEvents.length).toBeGreaterThanOrEqual(4)
    const done = result.store.data.tasks.find((x) => x.title === '已完成旧任务')
    const running = result.store.data.tasks.find((x) => x.title === '中断旧任务')
    expect(done.status).toBe('done')
    expect(done.ownerRole).toBe('publish')
    expect(running.status).toBe('failed')
    expect(running.ownerRole).toBe('post')
    expect(result.report.warnings.some((x) => x.includes('running'))).toBe(true)
  })

  it('迁移自动任务与运行历史，并关联 sourceAutomationId', () => {
    const result = migrateLegacyData({
      now: NOW,
      autoTasks: [
        {
          id: 'a1',
          name: '今日战报',
          desc: '取数据',
          on: true,
          createdAt: 50,
          schedule: { kind: 'daily', time: '09:00' },
        },
      ],
      autoRuns: {
        runs: {
          a1: { lastRunAt: 150, dueAt: 100, ok: true, summary: '跑完了' },
        },
      },
    })
    expect(result.store.data.automations).toHaveLength(1)
    expect(result.store.data.automations[0].id).toBe('legacy-auto-a1')
    expect(result.store.data.automations[0].schedule.time).toBe('09:00')
    expect(result.store.data.tasks).toHaveLength(1)
    expect(result.store.data.tasks[0].sourceAutomationId).toBe('legacy-auto-a1')
    expect(result.store.data.tasks[0].status).toBe('done')
    expect(result.store.data.tasks[0].deliverables).toContain('跑完了')
  })

  it('幂等：同一批数据迁移两次不重复', () => {
    const input = {
      now: NOW,
      chats: { chats: [{ id: 'c1', title: '会', updatedAt: 1, messages: [{ role: 'user', text: 'hi', t: 1 }] }] },
      taskSessions: [{ id: 't1', name: '任务', state: 'done', startedAt: 1, endedAt: 2 }],
      autoTasks: [{ id: 'a1', name: '自动', on: true, schedule: { kind: 'daily', time: '09:00' } }],
    }
    const first = migrateLegacyData(input)
    const second = migrateLegacyData(input, first.store)
    expect(second.store.data.conversations).toHaveLength(1)
    expect(second.store.data.tasks).toHaveLength(1)
    expect(second.store.data.automations).toHaveLength(1)
    expect(second.report.conversations).toBe(0)
    expect(second.report.tasks).toBe(0)
    expect(second.report.automations).toBe(0)
    expect(second.report.skipped.length).toBeGreaterThan(0)
  })

  it('未知角色给出警告但不丢消息', () => {
    const result = migrateLegacyData({
      now: NOW,
      singleChat: { items: [{ role: 'weird', text: '未知角色消息', t: 1 }] },
    })
    expect(result.store.data.messages).toHaveLength(1)
    expect(result.store.data.messages[0].content).toBe('未知角色消息')
    expect(result.report.warnings.some((x) => x.includes('weird'))).toBe(true)
  })

  it('不覆盖已有同 ID 数据，并记录 skipped', () => {
    const existing = createEmptyStoreFile(NOW)
    existing.data.conversations.push({
      id: 'legacy-conv-c1',
      title: '已有标题',
      model: 'existing',
      createdAt: 1,
      updatedAt: 1,
    })
    const result = migrateLegacyData(
      {
        now: NOW,
        chats: { chats: [{ id: 'c1', title: '新标题', updatedAt: 2, messages: [{ role: 'user', text: 'hi', t: 2 }] }] },
      },
      existing,
    )
    expect(result.store.data.conversations).toHaveLength(1)
    expect(result.store.data.conversations[0].title).toBe('已有标题')
    expect(result.store.data.messages).toHaveLength(0)
    expect(result.report.skipped.some((x) => x.includes('legacy-conv-c1'))).toBe(true)
  })
})
