// M5 活动事件解析（对应 e2e 用例清单 A1）：
// 内核通知 → 归一化活动事件（tool/call、tool/result、turn/start、turn/end）。
// 红线：不转发工具参数（arguments 绝不进产物）。
import { describe, expect, it } from 'vitest'
import { activityOf, liveLineOf } from '../../kernel/activity.mjs'

const evt = (type, data) => ({
  method: 'session.event',
  params: { sessionId: 's1', event: { type, seq: 1, time: 0, data } },
})

describe('活动事件解析（M5 员工实时状态）', () => {
  it('tool/call → 工具调用活动（含 callId 与工具名）', () => {
    const a = activityOf(
      evt('tool/call', {
        turn: 1,
        step: 1,
        callId: 'c1',
        name: 'jco_open_page',
        arguments: '{"url":"https://creator.douyin.com"}',
      }),
    )
    expect(a).toEqual({ kind: 'tool', phase: 'call', callId: 'c1', tool: 'jco_open_page' })
  })

  it('不转发工具参数（arguments 内容绝不进产物）', () => {
    const a = activityOf(evt('tool/call', { callId: 'c1', name: 'jco_type_text', arguments: '{"text":"机密内容"}' }))
    expect(JSON.stringify(a)).not.toContain('机密')
    expect(a).not.toHaveProperty('arguments')
  })

  it('tool/result → 结果活动（callId 来自 message；失败标记两种来源都认）', () => {
    const ok = activityOf(
      evt('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c1', isError: false } }),
    )
    expect(ok).toEqual({ kind: 'tool', phase: 'result', callId: 'c1', isError: false })

    const viaMessage = activityOf(
      evt('tool/result', { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'c2', isError: true } }),
    )
    expect(viaMessage.isError).toBe(true)

    const viaError = activityOf(
      evt('tool/result', {
        turn: 1,
        step: 1,
        message: { role: 'tool', toolCallId: 'c3' },
        error: { name: 'x', code: 'y' },
      }),
    )
    expect(viaError.isError).toBe(true)
  })

  it('turn/start、turn/end → 回合边界活动', () => {
    expect(activityOf(evt('turn/start', { turn: 2 }))).toEqual({ kind: 'turn', phase: 'start' })
    expect(activityOf(evt('turn/end', { turn: 2, reason: { kind: 'done' } }))).toEqual({ kind: 'turn', phase: 'end' })
  })

  it('无关事件与畸形输入 → null（不抛错）', () => {
    expect(activityOf(evt('assistant/chunk', { chunk: { type: 'text-delta', text: 'hi' } }))).toBeNull()
    expect(activityOf(evt('assistant/message', {}))).toBeNull()
    expect(activityOf(null)).toBeNull()
    expect(activityOf({})).toBeNull()
    expect(activityOf({ method: 'other' })).toBeNull()
    expect(activityOf({ method: 'session.event', params: {} })).toBeNull()
    expect(activityOf({ method: 'session.event', params: { event: { type: 'tool/call' } } })).toEqual({
      kind: 'tool',
      phase: 'call',
      callId: '',
      tool: '',
    })
  })
})

describe('过程行文本 liveLineOf（M7 对抗审查 R1：任务视图实时反馈）', () => {
  it('已知工具 → 人话短语', () => {
    expect(liveLineOf({ kind: 'tool', phase: 'call', callId: 'c1', tool: 'jco_open_page' })).toBe('正在打开页面')
    expect(liveLineOf({ kind: 'tool', phase: 'call', callId: 'c1', tool: 'jco_save_comments' })).toBe(
      '正在把评论存到本机',
    )
  })
  it('未知工具 → 工具名兜底（不假装知道更多）', () => {
    expect(liveLineOf({ kind: 'tool', phase: 'call', callId: 'c1', tool: 'other_tool' })).toBe('正在操作 other_tool')
  })
  it('turn/start → 开始干活；其它事件 → null（不产生噪音行）', () => {
    expect(liveLineOf({ kind: 'turn', phase: 'start' })).toBe('开始干活')
    expect(liveLineOf({ kind: 'turn', phase: 'end' })).toBeNull()
    expect(liveLineOf({ kind: 'tool', phase: 'result', callId: 'c1', isError: false })).toBeNull()
    expect(liveLineOf(null)).toBeNull()
    expect(liveLineOf({})).toBeNull()
  })
})
