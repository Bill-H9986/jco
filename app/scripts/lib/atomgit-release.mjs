/**
 * AtomGit（GitCode）Release 发布的纯函数。
 *
 * 更新器使用 electron-updater 的 generic provider：
 * - 通道文件固定为 `<feedUrl>/beta.yml`；
 * - `files[].url` 允许绝对地址，因此安装包可以放在 AtomGit Release 附件里，
 *   feed 本身只需托管一个几 KB 的 yml；
 * - 通道文件放在仓库固定的 `release-feed/` 目录，通过 raw 地址读取。
 */

const API_BASE = 'https://api.gitcode.com/api/v5'
const WEB_BASE = 'https://atomgit.com'

export function parseRepoSlug(value) {
  const text = String(value ?? '').trim()
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(text)
  if (!match) {
    throw new Error('仓库地址必须是 owner/repo 形式')
  }
  return { owner: match[1], repo: match[2] }
}

export function buildAssetDownloadUrl({ owner, repo, tag, fileName }) {
  const encodedName = encodeURIComponent(fileName)
  return `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${encodeURIComponent(tag)}/attach_files/${encodedName}/download`
}

export function buildFeedUrl({ owner, repo, branch }) {
  return `${WEB_BASE}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${encodeURIComponent(branch)}/release-feed`
}

export function buildAtomGitChannelYaml({ version, fileName, sha512, size, assetUrl, releaseDate }) {
  const lines = [
    `version: ${version}`,
    'files:',
    `  - url: ${assetUrl}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${fileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ]
  return lines.join('\n')
}
