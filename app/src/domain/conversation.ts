export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageFormat = 'plain' | 'markdown'
export type MessageStatus = 'complete' | 'streaming' | 'failed'

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  format: MessageFormat
  createdAt: number
  status: MessageStatus
  error?: string
  model?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

export interface Conversation {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export interface ConversationDetail extends Conversation {
  messages: Message[]
}
