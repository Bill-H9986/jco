import type { Automation, AutomationSchedule } from '../../domain/automation.js'
import type { Conversation, Message } from '../../domain/conversation.js'
import type { ApprovalPolicy, Task, TaskEvent, TaskRun, TaskStatus } from '../../domain/task.js'
import { createEmptyStoreFile, type StoreFile } from './store-schema.js'

export interface LegacyMessage {
  role?: string
  text?: string
  t?: number
}

export interface LegacyChat {
  id?: string
  title?: string
  updatedAt?: number
  messages?: LegacyMessage[]
}

export interface LegacyChats {
  activeId?: string
  chats?: LegacyChat[]
}

export interface LegacySingleChat {
  items?: LegacyMessage[]
}

export interface LegacyTaskSession {
  id?: string
  name?: string
  staff?: string
  platform?: string
  state?: string
  startedAt?: number
  endedAt?: number
  summary?: string
  messages?: LegacyMessage[]
}

export interface LegacyAutoTask {
  id?: string
  name?: string
  desc?: string
  on?: boolean
  createdAt?: number
  schedule?: {
    kind?: string
    time?: string
    weekday?: number
  }
}

export interface LegacyAutoRuns {
  runs?: Record<
    string,
    {
      lastRunAt?: number
      dueAt?: number
      ok?: boolean
      summary?: string
    }
  >
}

export interface LegacyMigrationInput {
  chats?: LegacyChats | null
  singleChat?: LegacySingleChat | null
  taskSessions?: LegacyTaskSession[]
  autoTasks?: LegacyAutoTask[]
  autoRuns?: LegacyAutoRuns | null
  now?: number
}

export interface MigrationReport {
  conversations: number
  messages: number
  tasks: number
  taskRuns: number
  taskEvents: number
  automations: number
  skipped: string[]
  warnings: string[]
}

export interface LegacyMigrationResult {
  store: StoreFile
  report: MigrationReport
}

const APPROVALS: ApprovalPolicy = {
  requirePublishApproval: true,
  requireDeleteApproval: true,
  requirePaymentApproval: true,
  requireFinalApproval: true,
}

function safeId(value: unknown, fallback: string): string {
  const raw = String(value == null ? '' : value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return raw || fallback
}

function normalizeRole(role: unknown, warnings: string[]): Message['role'] {
  const value = String(role || '').toLowerCase()
  if (value === 'user') return 'user'
  if (value === 'assistant' || value === 'ai') return 'assistant'
  if (value === 'system') return 'system'
  warnings.push(`未知消息角色 ${String(role)}，按 user 迁移`)
  return 'user'
}

function normalizeTaskStatus(state: unknown, warnings: string[]): TaskStatus {
  const value = String(state || '').toLowerCase()
  if (value === 'done') return 'done'
  if (value === 'failed') return 'failed'
  if (value === 'cancelled' || value === 'canceled') return 'cancelled'
  if (value === 'running') {
    warnings.push('发现 running 旧任务，按应用中断迁移为 failed')
    return 'failed'
  }
  warnings.push(`未知旧任务状态 ${String(state)}，按 failed 迁移`)
  return 'failed'
}

function normalizeSchedule(schedule: LegacyAutoTask['schedule']): AutomationSchedule {
  const kind = schedule?.kind === 'weekly' ? 'weekly' : 'daily'
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(schedule?.time || '')) ? String(schedule?.time) : '09:00'
  const weekday = Math.min(7, Math.max(1, Number(schedule?.weekday) || 1))
  return kind === 'weekly' ? { kind, time, weekday } : { kind, time }
}

function messageFromLegacy(
  input: LegacyMessage,
  conversationId: string,
  index: number,
  fallbackAt: number,
  warnings: string[],
): Message {
  return {
    id: `legacy-msg-${conversationId}-${index}`,
    conversationId,
    role: normalizeRole(input.role, warnings),
    content: String(input.text == null ? '' : input.text),
    format:
      String(input.role || '').toLowerCase() === 'ai' || String(input.role || '').toLowerCase() === 'assistant'
        ? 'markdown'
        : 'plain',
    createdAt: Number(input.t) || fallbackAt,
    status: 'complete',
  }
}

function addConversation(
  store: StoreFile,
  chat: LegacyChat,
  index: number,
  now: number,
  report: MigrationReport,
): void {
  const legacyId = String(chat.id || `conv-${index}`)
  const conversationId = `legacy-conv-${safeId(legacyId, `conv-${index}`)}`
  if (store.data.conversations.some((item) => item.id === conversationId)) {
    report.skipped.push(`会话已存在：${conversationId}`)
    return
  }
  const messages: Message[] = []
  const sourceMessages = Array.isArray(chat.messages) ? chat.messages : []
  sourceMessages.forEach((message, messageIndex) => {
    const id = `legacy-msg-${conversationId}-${messageIndex}`
    if (store.data.messages.some((item) => item.id === id)) return
    messages.push(messageFromLegacy(message, conversationId, messageIndex, now, report.warnings))
  })
  const lastMessageAt = messages.reduce((max, message) => Math.max(max, message.createdAt), 0)
  const updatedAt = Number(chat.updatedAt) || lastMessageAt || now
  const conversation: Conversation = {
    id: conversationId,
    title: String(chat.title || '之前的对话').slice(0, 200),
    model: 'legacy',
    createdAt: messages.length > 0 ? messages[0].createdAt : updatedAt,
    updatedAt,
  }
  store.data.conversations.push(conversation)
  store.data.messages.push(...messages)
  report.conversations += 1
  report.messages += messages.length
}

function addTaskSession(
  store: StoreFile,
  session: LegacyTaskSession,
  index: number,
  now: number,
  report: MigrationReport,
): void {
  const legacyId = String(session.id || `task-${index}`)
  const taskId = `legacy-task-${safeId(legacyId, `task-${index}`)}`
  if (store.data.tasks.some((item) => item.id === taskId)) {
    report.skipped.push(`任务已存在：${taskId}`)
    return
  }
  const startedAt = Number(session.startedAt) || now
  const endedAt = Number(session.endedAt) || startedAt
  const status = normalizeTaskStatus(session.state, report.warnings)
  const firstUser = (session.messages || []).find((message) => String(message.role || '').toLowerCase() === 'user')
  const summary = String(session.summary || '')
  const note = summary || (status === 'failed' ? '应用重启，这轮没跑完' : '')
  const task: Task = {
    id: taskId,
    title: String(session.name || `迁移任务 ${index + 1}`).slice(0, 200),
    goal: String(firstUser?.text || session.name || '迁移自旧任务台账'),
    type: 'custom',
    ownerRole: String(session.staff || 'custom').slice(0, 60),
    status,
    inputs: session.platform ? [{ kind: 'platform', ref: String(session.platform) }] : [],
    constraints: ['迁移自旧任务台账'],
    deliverables: note ? [note] : [],
    approvalPolicy: { ...APPROVALS },
    createdAt: startedAt,
    updatedAt: endedAt,
  }
  const run: TaskRun = {
    id: `legacy-run-${safeId(legacyId, `task-${index}`)}`,
    taskId,
    status,
    startedAt,
    endedAt,
    attempt: 1,
    ...(status === 'failed'
      ? { error: { code: 'LEGACY_INTERRUPTED', message: note || '应用重启，这轮没跑完', retryable: true } }
      : {}),
  }
  const events: TaskEvent[] = [
    {
      id: `legacy-event-${taskId}-state`,
      taskId,
      runId: run.id,
      type: 'state_changed',
      at: startedAt,
      summary: `迁移旧任务：${String(session.state || 'unknown')} → ${status}`,
    },
  ]
  if (note) {
    events.push({
      id: `legacy-event-${taskId}-note`,
      taskId,
      runId: run.id,
      type: 'note',
      at: endedAt,
      summary: note,
    })
  }
  store.data.tasks.push(task)
  store.data.taskRuns.push(run)
  store.data.taskEvents.push(...events)
  report.tasks += 1
  report.taskRuns += 1
  report.taskEvents += events.length
}

function addAutomation(store: StoreFile, task: LegacyAutoTask, index: number, report: MigrationReport): void {
  const legacyId = String(task.id || `auto-${index}`)
  const id = `legacy-auto-${safeId(legacyId, `auto-${index}`)}`
  if (store.data.automations.some((item) => item.id === id)) {
    report.skipped.push(`自动任务已存在：${id}`)
    return
  }
  const automation: Automation = {
    id,
    name: String(task.name || `迁移自动任务 ${index + 1}`).slice(0, 200),
    enabled: task.on !== false,
    schedule: normalizeSchedule(task.schedule),
    taskTemplate: {
      title: String(task.name || `迁移自动任务 ${index + 1}`).slice(0, 200),
      goal: String(task.desc || '迁移自旧自动任务'),
      type: 'custom',
      ownerRole: 'custom',
      inputs: [],
      constraints: ['迁移自旧自动任务'],
      deliverables: ['按任务描述执行并汇报'],
      approvalPolicy: { ...APPROVALS },
    },
  }
  store.data.automations.push(automation)
  report.automations += 1
}

function addAutoRun(
  store: StoreFile,
  automationLegacyId: string,
  run: NonNullable<NonNullable<LegacyAutoRuns['runs']>[string]>,
  automationName: string,
  now: number,
  report: MigrationReport,
): void {
  const taskId = `legacy-auto-run-${safeId(automationLegacyId, 'run')}`
  if (store.data.tasks.some((item) => item.id === taskId)) {
    report.skipped.push(`自动任务运行记录已存在：${taskId}`)
    return
  }
  const at = Number(run.lastRunAt) || Number(run.dueAt) || now
  const status: TaskStatus = run.ok === false ? 'failed' : 'done'
  const summary = String(run.summary || '')
  const task: Task = {
    id: taskId,
    title: `自动任务执行记录：${automationName}`.slice(0, 200),
    goal: summary || automationName,
    type: 'custom',
    ownerRole: 'custom',
    status,
    inputs: [],
    constraints: ['迁移自旧自动任务运行记录'],
    deliverables: summary ? [summary] : [],
    approvalPolicy: { ...APPROVALS },
    sourceAutomationId: `legacy-auto-${safeId(automationLegacyId, 'run')}`,
    createdAt: at,
    updatedAt: at,
  }
  const taskRun: TaskRun = {
    id: `legacy-auto-run-exec-${safeId(automationLegacyId, 'run')}`,
    taskId,
    status,
    startedAt: at,
    endedAt: at,
    attempt: 1,
    ...(status === 'failed'
      ? { error: { code: 'LEGACY_AUTO_RUN_FAILED', message: summary || '旧自动任务运行失败', retryable: true } }
      : {}),
  }
  const events: TaskEvent[] = [
    {
      id: `legacy-auto-run-event-${safeId(automationLegacyId, 'run')}-state`,
      taskId,
      runId: taskRun.id,
      type: 'state_changed',
      at,
      summary: `迁移旧自动任务运行：${status}`,
    },
  ]
  if (summary) {
    events.push({
      id: `legacy-auto-run-event-${safeId(automationLegacyId, 'run')}-note`,
      taskId,
      runId: taskRun.id,
      type: 'note',
      at,
      summary,
    })
  }
  store.data.tasks.push(task)
  store.data.taskRuns.push(taskRun)
  store.data.taskEvents.push(...events)
  report.tasks += 1
  report.taskRuns += 1
  report.taskEvents += events.length
}

export function migrateLegacyData(input: LegacyMigrationInput, existing?: StoreFile): LegacyMigrationResult {
  const now = Number(input.now) || Date.now()
  const store = structuredClone(existing || createEmptyStoreFile(now))
  for (const key of [
    'conversations',
    'messages',
    'tasks',
    'taskRuns',
    'taskEvents',
    'automations',
    'artifacts',
    'approvals',
  ] as const) {
    if (!Array.isArray(store.data[key])) store.data[key] = []
  }
  store.updatedAt = now
  const report: MigrationReport = {
    conversations: 0,
    messages: 0,
    tasks: 0,
    taskRuns: 0,
    taskEvents: 0,
    automations: 0,
    skipped: [],
    warnings: [],
  }

  const chats = Array.isArray(input.chats?.chats) ? input.chats.chats : []
  for (const [index, chat] of chats.entries()) addConversation(store, chat, index, now, report)
  if (chats.length === 0 && Array.isArray(input.singleChat?.items) && input.singleChat.items.length > 0) {
    addConversation(
      store,
      { id: 'single', title: '之前的对话', messages: input.singleChat.items, updatedAt: now },
      0,
      now,
      report,
    )
  }

  for (const [index, session] of (input.taskSessions || []).entries())
    addTaskSession(store, session, index, now, report)

  const autoTasks = Array.isArray(input.autoTasks) ? input.autoTasks : []
  for (const [index, task] of autoTasks.entries()) addAutomation(store, task, index, report)
  const runs = input.autoRuns?.runs && typeof input.autoRuns.runs === 'object' ? input.autoRuns.runs : {}
  for (const [legacyId, run] of Object.entries(runs)) {
    const autoTask = autoTasks.find((item) => String(item.id || '') === legacyId)
    addAutoRun(store, legacyId, run, String(autoTask?.name || legacyId), now, report)
  }

  return { store, report }
}
