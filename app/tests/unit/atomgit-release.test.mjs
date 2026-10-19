import { describe, expect, it } from 'vitest'
import {
  buildAssetDownloadUrl,
  buildAtomGitChannelYaml,
  buildFeedUrl,
  parseRepoSlug,
} from '../../scripts/lib/atomgit-release.mjs'

describe('AtomGit 发布地址', () => {
  it('解析 owner/repo 并拒绝不完整写法', () => {
    expect(parseRepoSlug('Bill-H9986/jco')).toEqual({ owner: 'Bill-H9986', repo: 'jco' })
    expect(parseRepoSlug('  gca_u9986/jco  ')).toEqual({ owner: 'gca_u9986', repo: 'jco' })
    expect(() => parseRepoSlug('')).toThrow('owner/repo')
    expect(() => parseRepoSlug('jco')).toThrow('owner/repo')
    expect(() => parseRepoSlug('a/b/c')).toThrow('owner/repo')
  })

  it('附件下载地址对空格和中文文件名做编码', () => {
    expect(
      buildAssetDownloadUrl({
        owner: 'Bill-H9986',
        repo: 'jco',
        tag: 'v0.6.0-beta.7',
        fileName: 'J.Co-0.6.0-beta.7.exe',
      }),
    ).toBe(
      'https://api.gitcode.com/api/v5/repos/Bill-H9986/jco/releases/v0.6.0-beta.7/attach_files/J.Co-0.6.0-beta.7.exe/download',
    )
    expect(
      buildAssetDownloadUrl({
        owner: 'a',
        repo: 'b',
        tag: 'v1',
        fileName: '安装 包.exe',
      }),
    ).toBe(
      'https://api.gitcode.com/api/v5/repos/a/b/releases/v1/attach_files/%E5%AE%89%E8%A3%85%20%E5%8C%85.exe/download',
    )
  })

  it('feed 地址固定指向仓库内的 release-feed 目录', () => {
    expect(buildFeedUrl({ owner: 'Bill-H9986', repo: 'jco', branch: 'main' })).toBe(
      'https://api.gitcode.com/api/v5/repos/Bill-H9986/jco/raw/release-feed?ref=main',
    )
  })

  it('通道 yml 使用绝对下载地址，避免依赖附件目录结构', () => {
    const yaml = buildAtomGitChannelYaml({
      version: '0.6.0-beta.7',
      fileName: 'J.Co-0.6.0-beta.7.exe',
      sha512: 'G5Cpl5fhadVMCQhPdNT/Z5juNK7NXB1EZwwfApCA3htPmwIU8AGHNlTrg3sp5CNM0BD+cULPG4TowCYujWUZ/g==',
      size: 221629374,
      assetUrl:
        'https://api.gitcode.com/api/v5/repos/Bill-H9986/jco/releases/v0.6.0-beta.7/attach_files/J.Co-0.6.0-beta.7.exe/download',
      releaseDate: '2026-10-19T10:03:40.263Z',
    })
    expect(yaml).toContain('version: 0.6.0-beta.7')
    expect(yaml).toContain(
      'url: https://api.gitcode.com/api/v5/repos/Bill-H9986/jco/releases/v0.6.0-beta.7/attach_files/J.Co-0.6.0-beta.7.exe/download',
    )
    expect(yaml).toContain('size: 221629374')
    expect(yaml).toContain(
      'sha512: G5Cpl5fhadVMCQhPdNT/Z5juNK7NXB1EZwwfApCA3htPmwIU8AGHNlTrg3sp5CNM0BD+cULPG4TowCYujWUZ/g==',
    )
    expect(yaml).toContain("releaseDate: '2026-10-19T10:03:40.263Z'")
    expect(yaml).not.toContain('blockMapSize')
  })
})
