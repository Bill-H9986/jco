import { describe, expect, it } from 'vitest'
import {
  assertTransition,
  canTransition,
  InvalidTaskTransitionError,
  isTerminal,
  TASK_STATUSES,
  transition,
} from '../../src/domain/task-state-machine.ts'

describe('TaskStateMachine', () => {
  it('定义完整状态集合', () => {
    expect(TASK_STATUSES).toEqual([
      'draft',
      'pending_confirm',
      'queued',
      'running',
      'waiting_user',
      'done',
      'failed',
      'cancelled',
    ])
  })

  it('合法路径：draft → pending_confirm → queued → running → waiting_user → running → done', () => {
    const path = ['pending_confirm', 'queued', 'running', 'waiting_user', 'running', 'done']
    let current = 'draft'
    for (const next of path) {
      expect(canTransition(current, next)).toBe(true)
      current = transition(current, next)
    }
    expect(current).toBe('done')
  })

  it('失败后可回到 queued 重试', () => {
    expect(canTransition('running', 'failed')).toBe(true)
    expect(canTransition('failed', 'queued')).toBe(true)
    expect(transition('failed', 'queued')).toBe('queued')
  })

  it('未确认不能直接运行', () => {
    expect(canTransition('draft', 'running')).toBe(false)
    expect(() => transition('draft', 'running')).toThrow(InvalidTaskTransitionError)
  })

  it('等待用户不能直接完成', () => {
    expect(canTransition('waiting_user', 'done')).toBe(false)
    expect(() => transition('waiting_user', 'done')).toThrow(InvalidTaskTransitionError)
  })

  it('终态不能再迁移', () => {
    expect(isTerminal('done')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(canTransition('done', 'running')).toBe(false)
    expect(canTransition('cancelled', 'queued')).toBe(false)
  })

  it('非法迁移带 INVALID_STATE 错误码和可读信息', () => {
    try {
      assertTransition('queued', 'waiting_user')
      throw new Error('应当抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTaskTransitionError)
      expect(error.code).toBe('INVALID_STATE')
      expect(error.message).toContain('queued')
      expect(error.message).toContain('waiting_user')
    }
  })

  it('允许取消的路径都能到 cancelled，终态不能取消', () => {
    for (const status of ['draft', 'pending_confirm', 'queued', 'running', 'waiting_user']) {
      expect(canTransition(status, 'cancelled')).toBe(true)
    }
    expect(canTransition('done', 'cancelled')).toBe(false)
    expect(canTransition('cancelled', 'cancelled')).toBe(false)
  })
})
