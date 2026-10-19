import { join } from 'node:path'

export interface NewEditArtifact {
  id: string
  name: string
  path: string
  kind: 'video'
  createdAt: number
}

/** 只登记本次任务新产生的成片，避免把已有素材冒充成任务产物。 */
export function collectNewEditArtifacts(
  before: readonly string[],
  after: readonly string[],
  assetsDir: string,
  now = Date.now(),
): NewEditArtifact[] {
  const known = new Set(before)
  return after
    .filter((name) => !known.has(name))
    .map((name, index) => ({
      id: `art-${now.toString(36)}-${index}`,
      name,
      path: join(assetsDir, name),
      kind: 'video' as const,
      createdAt: now,
    }))
}
