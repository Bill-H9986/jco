import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  filterBaseline,
  fingerprint,
  parsePageMatrix,
  parseWorkQueue,
  RULES,
  scanChatProfile,
  scanText,
} from '../../scripts/checks/rules.mjs'

const rule = (id) => RULES.find((item) => item.id === id)
const fixture = (name) => readFileSync(new URL(`../fixtures/quality/${name}`, import.meta.url), 'utf8')

it('质量夹具可被扫描：合规页零违规，违规页逐条命中', () => {
  expect(scanText(rule('no-hardcoded-industry'), '设计原型/clean.html', fixture('clean-page.html'))).toHaveLength(0)
  expect(
    scanText(rule('no-direct-business-localstorage'), '设计原型/bad.html', fixture('bad-localstorage.html')),
  ).toHaveLength(1)
  expect(
    scanText(rule('no-hardcoded-industry'), '设计原型/bad.html', fixture('bad-industry.html')).length,
  ).toBeGreaterThan(0)
  expect(scanText(rule('no-direct-tasks-dispatch'), '设计原型/bad.html', fixture('bad-dispatch.html'))).toHaveLength(1)
  expect(scanText(rule('no-duplicate-sidebar'), '设计原型/bad.html', fixture('bad-sidebar.html'))).toHaveLength(1)
  expect(scanText(rule('no-message-truncation'), '设计原型/bad.html', fixture('bad-truncation.html'))).toHaveLength(1)
  expect(scanChatProfile(fixture('bad-chat-profile.ts'))).not.toHaveLength(0)
})

describe('全项目扫描规则', () => {
  it('业务页面直接读写 jco-* localStorage 会被抓到，普通 UI 状态不会', () => {
    const target = rule('no-direct-business-localstorage')
    expect(scanText(target, '设计原型/页.html', "localStorage.setItem('jco-script-v1', 'x')")).toHaveLength(1)
    expect(scanText(target, '设计原型/页.html', "localStorage.setItem('jco-theme', 'dark')")).toHaveLength(1)
    expect(scanText(target, '设计原型/页.html', "localStorage.setItem('theme', 'dark')")).toHaveLength(0)
  })

  it('行业写死会被抓到，通用描述不会', () => {
    const target = rule('no-hardcoded-industry')
    expect(scanText(target, '设计原型/页.html', '服务做成人学历提升招生')).not.toHaveLength(0)
    expect(scanText(target, '设计原型/页.html', '服务通用自媒体创作者')).toHaveLength(0)
  })

  it('页面直接派活会被抓到，读任务列表不会', () => {
    const target = rule('no-direct-tasks-dispatch')
    expect(scanText(target, '设计原型/页.html', 'engine.tasks.dispatch({ name: "x" })')).toHaveLength(1)
    expect(scanText(target, '设计原型/页.html', 'await engine.tasks.sessions()')).toHaveLength(0)
  })

  it('复制侧栏会被抓到', () => {
    const target = rule('no-duplicate-sidebar')
    expect(scanText(target, '设计原型/页.html', '<aside class="sidebar">')).toHaveLength(1)
    expect(scanText(target, '设计原型/页.html', '<nav class="nav-item">')).toHaveLength(0)
  })

  it('消息千字以上截断会被抓到，300 字摘要不会', () => {
    const target = rule('no-message-truncation')
    expect(scanText(target, '设计原型/页.html', 'rec.text = text.slice(0, 2000)')).toHaveLength(1)
    expect(scanText(target, '设计原型/页.html', 'rec.summary = text.slice(0, 300)')).toHaveLength(0)
  })

  it('chat / writer profile 挂工具会被抓到，空白名单通过', () => {
    const clean = `
      export const PROFILES = {
        chat: { id: 'chat', allowedTools: [], toolPacks: [] },
        writer: { id: 'writer', allowedTools: [], toolPacks: [] },
      }
    `
    expect(scanChatProfile(clean)).toHaveLength(0)

    const dirty = `
      export const PROFILES = {
        chat: { id: 'chat', allowedTools: ['jco_open_page'], toolPacks: ['browser'] },
        writer: { id: 'writer', allowedTools: [], toolPacks: [] },
      }
    `
    const violations = scanChatProfile(dirty)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((item) => item.ruleId === 'no-chat-browser-tools')).toBe(true)
  })
})

describe('基线只放行存量，新增违规仍然失败', () => {
  it('指纹不含行号，移动代码不会让基线失效', () => {
    const a = { ruleId: 'r', file: 'a.html', line: 10, excerpt: "localStorage.setItem('jco-a', '1')" }
    const b = { ...a, line: 99 }
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('基线命中的只算存量，未命中的算新增', () => {
    const known = {
      ruleId: 'no-duplicate-sidebar',
      file: '设计原型/a.html',
      line: 10,
      excerpt: '<aside class="sidebar">',
    }
    const fresh = {
      ruleId: 'no-duplicate-sidebar',
      file: '设计原型/b.html',
      line: 20,
      excerpt: '<aside class="sidebar">',
    }
    const baseline = { version: 1, entries: [{ ...known, fingerprint: fingerprint(known) }] }
    const result = filterBaseline([known, fresh], baseline)
    expect(result.known).toHaveLength(1)
    expect(result.fresh).toHaveLength(1)
    expect(result.fresh[0].file).toBe('设计原型/b.html')
  })
})

describe('迁移矩阵和工作队列可机器读取', () => {
  it('页面矩阵统计 verified / total', () => {
    const text = [
      '| 页面 | 波次 | 当前状态 |',
      '|---|---|---|',
      '| `A.html` | Wave 1 | pending |',
      '| `B.html` | Wave 1 | verified |',
      '| 任务详情（新） | Wave 1 | in_progress |',
    ].join('\n')
    const result = parsePageMatrix(text)
    expect(result.total).toBe(3)
    expect(result.verified).toBe(1)
    expect(result.statuses.pending).toBe(1)
    expect(result.statuses.in_progress).toBe(1)
  })

  it('工作队列按层统计单元状态', () => {
    const text = [
      '| W0-01 | Domain | x | 无 | y | verified |',
      '| W0-02 | Data | x | W0-01 | y | verified |',
      '| W1-01 | UI/主进程 | x | W0-04 | y | pending |',
    ].join('\n')
    const result = parseWorkQueue(text)
    expect(result.total).toBe(3)
    expect(result.verified).toBe(2)
    expect(result.byLayer.Domain.verified).toBe(1)
    expect(result.byLayer['UI/主进程'].pending).toBe(1)
  })
})
