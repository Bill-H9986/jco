#!/usr/bin/env node
// 发布溯源：tag、package.json、HEAD、远端分支必须指向同一份源码。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..', '..')
const APP = path.join(REPO, 'app')

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback
}

function git(args, options = {}) {
  return execFileSync('git', ['-C', REPO, ...args], {
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function fail(message) {
  console.error(`❌ ${message}`)
  process.exit(1)
}

const tag = arg('--tag')
const branch = arg('--branch') || process.env.GITHUB_REF_NAME || git(['branch', '--show-current'])
const requireOrigin = process.argv.includes('--require-origin')
const allowDirty = process.argv.includes('--allow-dirty')
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'))
const version = String(pkg.version || '')

if (!version) fail('app/package.json 缺少 version')

const dirty = git(['status', '--porcelain'])
if (dirty && !allowDirty) {
  fail(`工作区不干净，禁止发布：\n${dirty}`)
}

const head = git(['rev-parse', 'HEAD'])
const result = {
  version,
  branch,
  head,
  tag: tag || null,
  tagCommit: null,
  originSynced: null,
}

if (tag) {
  const expectedTag = `v${version}`
  if (tag !== expectedTag) fail(`tag 与版本不一致：期望 ${expectedTag}，实际 ${tag}`)
  let tagCommit
  try {
    tagCommit = git(['rev-parse', `refs/tags/${tag}^{commit}`])
  } catch {
    fail(`tag 不存在：${tag}`)
  }
  if (tagCommit !== head) fail(`tag 没有指向 HEAD：tag=${tagCommit} HEAD=${head}`)
  const tagPackage = JSON.parse(git(['show', `${tag}:app/package.json`]))
  if (String(tagPackage.version || '') !== version) {
    fail(`tag 内版本不一致：${tagPackage.version} != ${version}`)
  }
  result.tagCommit = tagCommit
}

if (requireOrigin) {
  if (!branch) fail('无法确定远端分支；请传 --branch')
  let rows
  try {
    rows = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])
  } catch (error) {
    fail(`无法读取 origin/${branch}：${String(error.message || error)}`)
  }
  const remoteHead = rows.split(/\r?\n/).filter(Boolean)[0]?.split(/\s+/)[0] || ''
  if (!remoteHead) fail(`远端不存在分支：origin/${branch}`)
  try {
    git(['cat-file', '-e', `${remoteHead}^{commit}`])
  } catch {
    execFileSync('git', ['-C', REPO, 'fetch', 'origin', branch], { stdio: 'inherit' })
  }
  try {
    git(['merge-base', '--is-ancestor', head, remoteHead])
  } catch {
    fail(`HEAD 还没有推送到 origin/${branch}：HEAD=${head} remote=${remoteHead}`)
  }
  result.originSynced = {
    branch,
    remoteHead,
    headIsAncestor: true,
  }
}

console.log(JSON.stringify({ ok: true, ...result }, null, 2))
