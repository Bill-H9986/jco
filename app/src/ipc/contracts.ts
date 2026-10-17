import type { Automation, AutomationSchedule } from '../domain/automation.js'
import type { ApprovalPolicy, TaskInput, TaskInputKind, TaskType } from '../domain/task.js'

export const IPC_CHANNELS = {
  conversation: {
    create: 'conversation:create',
    list: 'conversation:list',
    get: 'conversation:get',
    send: 'conversation:send',
    rename: 'conversation:rename',
    remove: 'conversation:remove',
    share: 'conversation:share',
  },
  task: {
    create: 'task:create',
    list: 'task:list',
    get: 'task:get',
    confirm: 'task:confirm',
    cancel: 'task:cancel',
    retry: 'task:retry',
    events: 'task:events',
  },
  approval: {
    resolve: 'approval:resolve',
  },
  automation: {
    list: 'automation:list',
    sync: 'automation:sync',
    runNow: 'automation:runNow',
  },
} as const

export type JcoErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'APPROVAL_REQUIRED'
  | 'TOOL_NOT_ALLOWED'
  | 'BROWSER_UNAVAILABLE'
  | 'KERNEL_TIMEOUT'
  | 'KERNEL_ERROR'
  | 'STORE_WRITE_FAILED'
  | 'MIGRATION_FAILED'
  | 'INTERNAL_ERROR'

export interface JcoError {
  code: JcoErrorCode
  message: string
  retryable: boolean
  detail?: string
}

export type JcoResult<T> = { ok: true; data: T } | { ok: false; error: JcoError }

export function ok<T>(data: T): JcoResult<T> {
  return { ok: true, data }
}

export function fail(code: JcoErrorCode, message: string, retryable = false, detail?: string): JcoResult<never> {
  return {
    ok: false,
    error: { code, message: String(message || '操作失败'), retryable, ...(detail ? { detail } : {}) },
  }
}

export class JcoContractError extends Error {
  readonly code: JcoErrorCode
  readonly retryable = false

  constructor(
    code: JcoErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'JcoContractError'
    this.code = code
  }
}

function recordOf(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new JcoContractError('INVALID_INPUT', `${label}必须是对象`)
  }
  return input as Record<string, unknown>
}

function textOf(input: unknown, field: string, required = true, max = 10_000): string {
  const value = String(input == null ? '' : input).trim()
  if (required && value === '') throw new JcoContractError('INVALID_INPUT', `${field}不能为空`)
  if (value.length > max) throw new JcoContractError('INVALID_INPUT', `${field}过长`)
  return value
}

function stringsOf(input: unknown, field: string): string[] {
  if (input == null) return []
  if (!Array.isArray(input)) throw new JcoContractError('INVALID_INPUT', `${field}必须是数组`)
  return input.map((item) => textOf(item, field, false, 2_000)).filter(Boolean)
}

function booleanOf(input: unknown, field: string, fallback = false): boolean {
  if (input == null) return fallback
  if (typeof input !== 'boolean') throw new JcoContractError('INVALID_INPUT', `${field}必须是布尔值`)
  return input
}

export type ConversationSource = 'home' | 'sidebar' | 'task' | 'other'

export interface ConversationCreateInput {
  title?: string
  initialMessage?: string
  source: ConversationSource
}

export function parseConversationCreate(input: unknown): ConversationCreateInput {
  const raw = recordOf(input || {}, '会话创建参数')
  const title = textOf(raw.title, 'title', false, 200)
  const initialMessage = textOf(raw.initialMessage, 'initialMessage', false, 10_000)
  const sourceValue = String(raw.source || 'other')
  const source: ConversationSource =
    sourceValue === 'home' || sourceValue === 'sidebar' || sourceValue === 'task' ? sourceValue : 'other'
  return {
    ...(title ? { title } : {}),
    ...(initialMessage ? { initialMessage } : {}),
    source,
  }
}

export interface ConversationSendInput {
  conversationId: string
  text: string
  clientMessageId?: string
}

export function parseConversationSend(input: unknown): ConversationSendInput {
  const raw = recordOf(input, '发送参数')
  const conversationId = textOf(raw.conversationId, 'conversationId', true, 120)
  const text = textOf(raw.text, 'text', true, 100_000)
  const clientMessageId = textOf(raw.clientMessageId, 'clientMessageId', false, 120)
  return { conversationId, text, ...(clientMessageId ? { clientMessageId } : {}) }
}

export interface ConversationRenameInput {
  id: string
  title: string
}

export function parseConversationRename(input: unknown): ConversationRenameInput {
  const raw = recordOf(input, '重命名参数')
  return {
    id: textOf(raw.id, 'id', true, 120),
    title: textOf(raw.title, 'title', true, 200),
  }
}

export function parseIdPayload(input: unknown, field = 'id'): Record<string, string> {
  const raw = recordOf(input, '参数')
  return { [field]: textOf(raw[field], field, true, 120) }
}

const TASK_TYPES = new Set<TaskType>(['content', 'publish', 'operate', 'edit', 'research', 'custom'])
const INPUT_KINDS = new Set<TaskInputKind>(['conversation', 'file', 'link', 'platform', 'text', 'artifact'])

function parseInputs(input: unknown): TaskInput[] {
  if (input == null) return []
  if (!Array.isArray(input)) throw new JcoContractError('INVALID_INPUT', 'inputs 必须是数组')
  return input.map((item, index) => {
    const raw = recordOf(item, `inputs[${index}]`)
    const kind = String(raw.kind || '')
    if (!INPUT_KINDS.has(kind as TaskInputKind)) {
      throw new JcoContractError('INVALID_INPUT', `inputs[${index}].kind 不认识`)
    }
    return {
      kind: kind as TaskInputKind,
      ref: textOf(raw.ref, `inputs[${index}].ref`, true, 2_000),
      ...(textOf(raw.label, `inputs[${index}].label`, false, 200)
        ? { label: textOf(raw.label, `inputs[${index}].label`, false, 200) }
        : {}),
    }
  })
}

function parseApprovalPolicy(input: unknown): ApprovalPolicy {
  const raw = recordOf(input, 'approvalPolicy')
  const policy: ApprovalPolicy = {
    requirePublishApproval: booleanOf(raw.requirePublishApproval, 'requirePublishApproval'),
    requireDeleteApproval: booleanOf(raw.requireDeleteApproval, 'requireDeleteApproval'),
    requirePaymentApproval: booleanOf(raw.requirePaymentApproval, 'requirePaymentApproval'),
    requireFinalApproval: booleanOf(raw.requireFinalApproval, 'requireFinalApproval'),
  }
  if (!policy.requirePublishApproval || !policy.requireDeleteApproval || !policy.requirePaymentApproval) {
    throw new JcoContractError('APPROVAL_REQUIRED', '发布、删除、支付必须保留人工审批')
  }
  return policy
}

export interface TaskCreateInput {
  title: string
  goal: string
  type: TaskType
  ownerRole: string
  inputs: TaskInput[]
  constraints: string[]
  deliverables: string[]
  approvalPolicy: ApprovalPolicy
  sourceConversationId?: string
  sourceAutomationId?: string
  parentTaskId?: string
}

export function parseTaskCreate(input: unknown): TaskCreateInput {
  const raw = recordOf(input, '任务创建参数')
  const title = textOf(raw.title, 'title', true, 200)
  const goal = textOf(raw.goal, 'goal', true, 10_000)
  const typeValue = String(raw.type || '')
  if (!TASK_TYPES.has(typeValue as TaskType)) throw new JcoContractError('INVALID_INPUT', 'type 不认识')
  const ownerRole = textOf(raw.ownerRole, 'ownerRole', true, 80)
  const deliverables = stringsOf(raw.deliverables, 'deliverables')
  if (deliverables.length === 0) throw new JcoContractError('INVALID_INPUT', 'deliverables 不能为空')
  return {
    title,
    goal,
    type: typeValue as TaskType,
    ownerRole,
    inputs: parseInputs(raw.inputs),
    constraints: stringsOf(raw.constraints, 'constraints'),
    deliverables,
    approvalPolicy: parseApprovalPolicy(raw.approvalPolicy),
    ...(textOf(raw.sourceConversationId, 'sourceConversationId', false, 120)
      ? { sourceConversationId: textOf(raw.sourceConversationId, 'sourceConversationId', false, 120) }
      : {}),
    ...(textOf(raw.sourceAutomationId, 'sourceAutomationId', false, 120)
      ? { sourceAutomationId: textOf(raw.sourceAutomationId, 'sourceAutomationId', false, 120) }
      : {}),
    ...(textOf(raw.parentTaskId, 'parentTaskId', false, 120)
      ? { parentTaskId: textOf(raw.parentTaskId, 'parentTaskId', false, 120) }
      : {}),
  }
}

export interface TaskListFilter {
  status?: string
  type?: TaskType
  ownerRole?: string
}

export function parseTaskListFilter(input: unknown): TaskListFilter {
  if (input == null) return {}
  const raw = recordOf(input, '任务筛选参数')
  const status = textOf(raw.status, 'status', false, 40)
  const ownerRole = textOf(raw.ownerRole, 'ownerRole', false, 80)
  const typeValue = String(raw.type || '')
  if (typeValue && !TASK_TYPES.has(typeValue as TaskType)) throw new JcoContractError('INVALID_INPUT', 'type 不认识')
  return {
    ...(status ? { status } : {}),
    ...(typeValue ? { type: typeValue as TaskType } : {}),
    ...(ownerRole ? { ownerRole } : {}),
  }
}

export interface ApprovalResolveInput {
  approvalId: string
  decision: 'approved' | 'rejected'
  note?: string
}

export function parseApprovalResolve(input: unknown): ApprovalResolveInput {
  const raw = recordOf(input, '审批参数')
  const decision = String(raw.decision || '')
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new JcoContractError('INVALID_INPUT', 'decision 只能是 approved 或 rejected')
  }
  const note = textOf(raw.note, 'note', false, 2_000)
  return {
    approvalId: textOf(raw.approvalId, 'approvalId', true, 120),
    decision,
    ...(note ? { note } : {}),
  }
}

function parseSchedule(input: unknown): AutomationSchedule {
  const raw = recordOf(input, 'schedule')
  const kind = raw.kind === 'weekly' ? 'weekly' : 'daily'
  const time = textOf(raw.time, 'schedule.time', true, 5)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new JcoContractError('INVALID_INPUT', 'schedule.time 格式不对')
  if (kind === 'weekly') {
    const weekday = Number(raw.weekday)
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw new JcoContractError('INVALID_INPUT', 'schedule.weekday 必须是 1-7')
    }
    return { kind, time, weekday }
  }
  return { kind, time }
}

export interface AutomationSyncInput {
  items: Automation[]
}

export function parseAutomationSync(input: unknown): AutomationSyncInput {
  const raw = recordOf(input, '自动任务同步参数')
  if (!Array.isArray(raw.items)) throw new JcoContractError('INVALID_INPUT', 'items 必须是数组')
  const items = raw.items.map((item, index) => {
    const task = recordOf(item, `items[${index}]`)
    const id = textOf(task.id, `items[${index}].id`, true, 120)
    const name = textOf(task.name, `items[${index}].name`, true, 200)
    const taskTemplateRaw = recordOf(task.taskTemplate, `items[${index}].taskTemplate`)
    const taskTemplate = parseTaskCreate(taskTemplateRaw)
    return {
      id,
      name,
      enabled: booleanOf(task.enabled, `items[${index}].enabled`, true),
      schedule: parseSchedule(task.schedule),
      taskTemplate,
    } as Automation
  })
  return { items }
}

export function parseAutomationRunNow(input: unknown): { id: string } {
  return { id: textOf(recordOf(input, '马上跑参数').id, 'id', true, 120) }
}
