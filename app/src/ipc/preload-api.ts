import type { JcoResult } from './contracts.js'
import {
  IPC_CHANNELS,
  parseApprovalResolve,
  parseAutomationRunNow,
  parseAutomationSync,
  parseConversationCreate,
  parseConversationRename,
  parseConversationSend,
  parseIdPayload,
  parseTaskCreate,
  parseTaskListFilter,
} from './contracts.js'

export type Invoke = (channel: string, payload?: unknown) => Promise<JcoResult<unknown>>

export function createPreloadApi(invoke: Invoke) {
  return {
    conversations: {
      create: (input: unknown) => invoke(IPC_CHANNELS.conversation.create, parseConversationCreate(input)),
      list: () => invoke(IPC_CHANNELS.conversation.list),
      get: (input: unknown) => invoke(IPC_CHANNELS.conversation.get, parseIdPayload(input)),
      send: (input: unknown) => invoke(IPC_CHANNELS.conversation.send, parseConversationSend(input)),
      rename: (input: unknown) => invoke(IPC_CHANNELS.conversation.rename, parseConversationRename(input)),
      remove: (input: unknown) => invoke(IPC_CHANNELS.conversation.remove, parseIdPayload(input)),
      share: (input: unknown) => invoke(IPC_CHANNELS.conversation.share, parseIdPayload(input)),
    },
    tasks: {
      create: (input: unknown) => invoke(IPC_CHANNELS.task.create, parseTaskCreate(input)),
      list: (input?: unknown) => invoke(IPC_CHANNELS.task.list, parseTaskListFilter(input)),
      get: (input: unknown) => invoke(IPC_CHANNELS.task.get, parseIdPayload(input)),
      confirm: (input: unknown) => invoke(IPC_CHANNELS.task.confirm, parseIdPayload(input)),
      cancel: (input: unknown) => invoke(IPC_CHANNELS.task.cancel, parseIdPayload(input)),
      retry: (input: unknown) => invoke(IPC_CHANNELS.task.retry, parseIdPayload(input)),
      events: (input: unknown) => invoke(IPC_CHANNELS.task.events, parseIdPayload(input)),
    },
    approvals: {
      resolve: (input: unknown) => invoke(IPC_CHANNELS.approval.resolve, parseApprovalResolve(input)),
    },
    automations: {
      list: () => invoke(IPC_CHANNELS.automation.list),
      sync: (input: unknown) => invoke(IPC_CHANNELS.automation.sync, parseAutomationSync(input)),
      runNow: (input: unknown) => invoke(IPC_CHANNELS.automation.runNow, parseAutomationRunNow(input)),
    },
  }
}
