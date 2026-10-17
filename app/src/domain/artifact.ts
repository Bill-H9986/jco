export type ArtifactKind = 'text' | 'image' | 'video' | 'audio' | 'file' | 'report'

export interface Artifact {
  id: string
  taskId?: string
  conversationId?: string
  kind: ArtifactKind
  path?: string
  content?: string
  mime?: string
  createdAt: number
}
