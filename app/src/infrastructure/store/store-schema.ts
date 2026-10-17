import type { Artifact } from '../../domain/artifact.js'
import type { Automation } from '../../domain/automation.js'
import type { Conversation, Message } from '../../domain/conversation.js'
import type { Approval, Task, TaskEvent, TaskRun } from '../../domain/task.js'

export const STORE_SCHEMA_VERSION = 1

export interface StoreData {
  conversations: Conversation[]
  messages: Message[]
  tasks: Task[]
  taskRuns: TaskRun[]
  taskEvents: TaskEvent[]
  automations: Automation[]
  artifacts: Artifact[]
  approvals: Approval[]
}

export interface StoreFile {
  schemaVersion: number
  updatedAt: number
  data: StoreData
}

export function createEmptyStoreData(): StoreData {
  return {
    conversations: [],
    messages: [],
    tasks: [],
    taskRuns: [],
    taskEvents: [],
    automations: [],
    artifacts: [],
    approvals: [],
  }
}

export function createEmptyStoreFile(now = Date.now()): StoreFile {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    updatedAt: now,
    data: createEmptyStoreData(),
  }
}
