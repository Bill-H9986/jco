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
