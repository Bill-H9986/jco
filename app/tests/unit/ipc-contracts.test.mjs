import { describe, expect, it } from 'vitest'
import {
  fail,
  IPC_CHANNELS,
  JcoContractError,
  ok,
  parseApprovalResolve,
  parseAutomationSync,
  parseConversationCreate,
  parseConversationSend,
  parseTaskCreate,
} from '../../src/ipc/contracts.ts'
import { createPreloadApi } from '../../src/ipc/preload-api.ts'

const taskInput = {
  title: '写一条视频文案',
  goal: '写三版标题',
  type: 'content',
  ownerRole: 'writer',
  inputs: [{ kind: 'text', ref: '主题：暑期招生' }],
  constraints: ['不夸大承诺'],
  deliverables: ['三版标题', '话题'],
  approvalPolicy: {
    requirePublishApproval: true,
    requireDeleteApproval: true,
    requirePaymentApproval: true,
    requireFinalApproval: true,
  },
}

describe('IPC 契约', () => {
  it('频道名称稳定', () => {
    expect(IPC_CHANNELS.conversation.create).toBe('conversation:create')
    expect(IPC_CHANNELS.conversation.send).toBe('conversation:send')
    expect(IPC_CHANNELS.task.create).toBe('task:create')
    expect(IPC_CHANNELS.task.confirm).toBe('task:confirm')
    expect(IPC_CHANNELS.approval.resolve).toBe('approval:resolve')
    expect(IPC_CHANNELS.automation.runNow).toBe('automation:runNow')
  })

  it('统一成功/失败结果', () => {
    expect(ok({ id: 'c1' })).toEqual({ ok: true, data: { id: 'c1' } })
    expect(fail('INVALID_INPUT', '参数不对')).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: '参数不对', retryable: false },
    })
  })

  it('会话创建：标题去空格，来源归一', () => {
    expect(parseConversationCreate({ title: '  旧会话  ', source: 'home' })).toEqual({
      title: '旧会话',
      source: 'home',
    })
    expect(parseConversationCreate({ source: 'unknown' }).source).toBe('other')
  })

  it('会话发送：拒绝空会话/空文本', () => {
    expect(() => parseConversationSend({ conversationId: '', text: 'hi' })).toThrow(JcoContractError)
    expect(() => parseConversationSend({ conversationId: 'c1', text: '  ' })).toThrow(JcoContractError)
    expect(parseConversationSend({ conversationId: ' c1 ', text: ' 你好 ' })).toEqual({
      conversationId: 'c1',
      text: '你好',
    })
  })

  it('任务创建：强制危险动作审批', () => {
    expect(() =>
      parseTaskCreate({
        ...taskInput,
        approvalPolicy: { ...taskInput.approvalPolicy, requirePublishApproval: false },
      }),
    ).toThrow(JcoContractError)
    expect(() => parseTaskCreate({ ...taskInput, deliverables: [] })).toThrow(JcoContractError)
    const parsed = parseTaskCreate({ ...taskInput, title: '  任务  ' })
    expect(parsed.title).toBe('任务')
    expect(parsed.deliverables).toEqual(['三版标题', '话题'])
  })

  it('审批：只接受 approved / rejected', () => {
    expect(parseApprovalResolve({ approvalId: 'a1', decision: 'approved' })).toEqual({
      approvalId: 'a1',
      decision: 'approved',
    })
    expect(() => parseApprovalResolve({ approvalId: 'a1', decision: 'maybe' })).toThrow(JcoContractError)
  })

  it('自动任务同步：保留 schedule 并拒绝空 id', () => {
    const parsed = parseAutomationSync({
      items: [
        {
          id: 'a1',
          name: '今日战报',
          enabled: true,
          schedule: { kind: 'daily', time: '09:00' },
          taskTemplate: {
            title: '今日战报',
            goal: '取数据',
            type: 'custom',
            ownerRole: 'custom',
            inputs: [],
            constraints: [],
            deliverables: ['战报'],
            approvalPolicy: taskInput.approvalPolicy,
          },
        },
      ],
    })
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0].schedule.time).toBe('09:00')
    expect(() => parseAutomationSync({ items: [{ name: '没有 id' }] })).toThrow(JcoContractError)
  })

  it('preload 工厂：路由到正确频道并传入已解析参数', async () => {
    const calls = []
    const api = createPreloadApi(async (channel, payload) => {
      calls.push({ channel, payload })
      return ok({ received: true })
    })
    await api.conversations.create({ title: '  会话  ', source: 'home' })
    await api.conversations.send({ conversationId: 'c1', text: '你好' })
    await api.tasks.create(taskInput)
    await api.approvals.resolve({ approvalId: 'a1', decision: 'approved' })
    expect(calls.map((call) => call.channel)).toEqual([
      'conversation:create',
      'conversation:send',
      'task:create',
      'approval:resolve',
    ])
    expect(calls[0].payload.title).toBe('会话')
    expect(calls[1].payload.text).toBe('你好')
  })
})
