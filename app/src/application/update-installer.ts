export interface InstallerCandidate {
  path: string
  exists: boolean
}

/**
 * 选择可用于安装的更新包。
 *
 * 应用重启后 electron-updater 的内存状态会丢失，下载完成的包只剩磁盘文件，
 * 因此按“helper 记录的包 → installer.exe → pending/download”的顺序回退。
 */
export function pickInstallerPath(candidates: InstallerCandidate[]): string | null {
  for (const candidate of candidates) {
    if (candidate.path && candidate.exists) return candidate.path
  }
  return null
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  tag: string
  num: number
}

function parseVersion(value: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/i.exec(String(value || '').trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    tag: match[4] ? match[4].toLowerCase() : '',
    num: match[5] ? Number(match[5]) : 0,
  }
}

/**
 * 判断候选版本是否严格高于当前版本。
 * 旧缓存、旧 feed 不能触发“可更新”，否则会把已升级的用户退回旧版。
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const now = parseVersion(current)
  if (!next || !now) return false
  if (next.major !== now.major) return next.major > now.major
  if (next.minor !== now.minor) return next.minor > now.minor
  if (next.patch !== now.patch) return next.patch > now.patch
  if (!next.tag && now.tag) return true
  if (next.tag && !now.tag) return false
  if (next.tag !== now.tag) return next.tag > now.tag
  return next.num > now.num
}
