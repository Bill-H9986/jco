export const TASK_STATUSES = [
  'draft',
  'pending_confirm',
  'queued',
  'running',
  'waiting_user',
  'done',
  'failed',
  'cancelled',
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export type TaskType = 'content' | 'publish' | 'operate' | 'edit' | 'research' | 'custom'

export type TaskInputKind = 'conversation' | 'file' | 'link' | 'platform' | 'text' | 'artifact'

export interface TaskInput {
  kind: TaskInputKind
  ref: string
  label?: string
}

export interface ApprovalPolicy {
  requirePublishApproval: boolean
  requireDeleteApproval: boolean
  requirePaymentApproval: boolean
  requireFinalApproval: boolean
}

export interface Task {
  id: string
  title: string
  goal: string
  type: TaskType
  ownerRole: string
  status: TaskStatus
  inputs: TaskInput[]
  constraints: string[]
  deliverables: string[]
  approvalPolicy: ApprovalPolicy
  sourceConversationId?: string
  sourceAutomationId?: string
  parentTaskId?: string
  createdAt: number
  updatedAt: number
}

export interface TaskRun {
  id: string
  taskId: string
  status: TaskStatus
  startedAt?: number
  endedAt?: number
  error?: TaskError
  attempt: number
}

export interface TaskError {
  code: string
  message: string
  retryable: boolean
  detail?: string
}

export type TaskEventType =
  | 'state_changed'
  | 'plan_ready'
  | 'tool_call'
  | 'tool_result'
  | 'approval_requested'
  | 'approval_resolved'
  | 'artifact_created'
  | 'note'
  | 'error'

export interface TaskEvent {
  id: string
  taskId: string
  runId: string
  type: TaskEventType
  at: number
  summary: string
  data?: Record<string, unknown>
}

export interface Approval {
  id: string
  taskId: string
  runId: string
  type: 'publish' | 'delete' | 'payment' | 'login' | 'choose' | 'confirm'
  reason: string
  options: Array<{ id: string; label: string; danger?: boolean }>
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  createdAt: number
  resolvedAt?: number
}
