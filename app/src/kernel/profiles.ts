/**
 * 内核岗位 profile：每个 profile 对应一个独立的 Harness 进程与一套工具白名单。
 *
 * 设计依据：docs/adr/0004-提示词与工具权限分层.md
 * - 纯聊天 / 写作不挂任何有副作用的工具；
 * - 发布只拿浏览器工具；
 * - 运营拿浏览器 + 数据落盘工具；
 * - 后期只拿 ffmpeg 工具。
 */

export type KernelProfile = 'chat' | 'writer' | 'publisher' | 'operator' | 'editor'

/** 浏览器自动化工具（发布会话） */
export const BROWSER_TOOLS = [
  'jco_open_page',
  'jco_snapshot',
  'jco_click',
  'jco_type_text',
  'jco_upload_file',
  'jco_scroll',
  'jco_screenshot',
  'jco_wait',
] as const

/** 运营数据落盘工具（只存本机草稿，不发送） */
export const DATA_TOOLS = ['jco_save_report', 'jco_save_comments'] as const

/** 后期 ffmpeg 工具 */
export const EDITOR_TOOLS = [
  'jco_list_assets',
  'jco_probe_video',
  'jco_add_subtitles',
  'jco_add_music',
  'jco_trim',
  'jco_concat',
] as const

export type ProfileToolPack = 'browser' | 'data' | 'editor'

export interface ProfileDefinition {
  readonly id: KernelProfile
  readonly label: string
  /** 该 profile 允许模型调用的工具名；空数组表示纯文本生成，无任何副作用工具 */
  readonly allowedTools: readonly string[]
  /** 需要挂载的工具包；聊天 / 写作一个都不挂 */
  readonly toolPacks: readonly ProfileToolPack[]
}

export const PROFILES: Record<KernelProfile, ProfileDefinition> = {
  chat: {
    id: 'chat',
    label: '聊天管家',
    allowedTools: [],
    toolPacks: [],
  },
  writer: {
    id: 'writer',
    label: '内容创作',
    allowedTools: [],
    toolPacks: [],
  },
  publisher: {
    id: 'publisher',
    label: '发布专员',
    allowedTools: [...BROWSER_TOOLS],
    toolPacks: ['browser'],
  },
  operator: {
    id: 'operator',
    label: '运营专员',
    allowedTools: [...BROWSER_TOOLS, ...DATA_TOOLS],
    toolPacks: ['browser', 'data'],
  },
  editor: {
    id: 'editor',
    label: '后期专员',
    allowedTools: [...EDITOR_TOOLS],
    toolPacks: ['editor'],
  },
}

export class ProfileToolError extends Error {
  readonly code = 'TOOL_NOT_ALLOWED'
  readonly profile: string
  readonly tool: string

  constructor(profile: string, tool: string) {
    super(`profile「${profile}」不允许调用工具「${tool}」`)
    this.name = 'ProfileToolError'
    this.profile = profile
    this.tool = tool
  }
}

export function getProfile(profile: string): ProfileDefinition {
  if (Object.hasOwn(PROFILES, profile)) {
    return PROFILES[profile as KernelProfile]
  }
  throw new ProfileToolError(profile, '*')
}

export function isToolAllowed(profile: string, tool: string): boolean {
  const definition = getProfile(profile)
  return definition.allowedTools.includes(tool)
}

export function assertToolAllowed(profile: string, tool: string): void {
  if (!isToolAllowed(profile, tool)) throw new ProfileToolError(profile, tool)
}
