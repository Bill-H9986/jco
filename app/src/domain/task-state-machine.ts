import { TASK_STATUSES, type TaskStatus } from './task.js'

export { TASK_STATUSES }

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  draft: ['pending_confirm', 'cancelled'],
  pending_confirm: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['waiting_user', 'done', 'failed', 'cancelled'],
  waiting_user: ['running', 'cancelled'],
  done: [],
  failed: ['queued', 'cancelled'],
  cancelled: [],
}

const TERMINAL_STATUSES = new Set<TaskStatus>(['done', 'cancelled'])

export class InvalidTaskTransitionError extends Error {
  readonly code = 'INVALID_STATE' as const

  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`非法任务状态迁移：${from} → ${to}`)
    this.name = 'InvalidTaskTransitionError'
  }
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new InvalidTaskTransitionError(from, to)
}

export function transition(from: TaskStatus, to: TaskStatus): TaskStatus {
  assertTransition(from, to)
  return to
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}
