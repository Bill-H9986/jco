import { describe, expect, it } from 'vitest'
import { pickInstallerPath } from '../../src/application/update-installer.ts'

describe('更新包定位', () => {
  it('优先使用 electron-updater 记录的包', () => {
    expect(
      pickInstallerPath([
        { path: 'C:/cache/pending/download', exists: true },
        { path: 'C:/cache/installer.exe', exists: true },
      ]),
    ).toBe('C:/cache/pending/download')
  })

  it('记录的包不存在时优先用最新下载包，而不是可能过期的 installer.exe', () => {
    expect(
      pickInstallerPath([
        { path: '', exists: false },
        { path: 'C:/cache/pending/download', exists: true },
        { path: 'C:/cache/installer.exe', exists: true },
      ]),
    ).toBe('C:/cache/pending/download')
  })

  it('全部不存在时返回 null，避免拿旧包安装', () => {
    expect(
      pickInstallerPath([
        { path: 'C:/cache/a.exe', exists: false },
        { path: 'C:/cache/b.exe', exists: false },
      ]),
    ).toBeNull()
  })
})
