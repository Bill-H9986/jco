// 规则文件同步检查：AGENTS.md 与 CLAUDE.md 必须内容一致（防规则分叉）
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..') // J.Co 工程根

describe('开发准则文件', () => {
  it('AGENTS.md 与 CLAUDE.md 内容完全一致（防分叉）', () => {
    const agents = path.join(ROOT, 'AGENTS.md')
    const claude = path.join(ROOT, 'CLAUDE.md')
    expect(existsSync(agents), '缺少 AGENTS.md').toBe(true)
    expect(existsSync(claude), '缺少 CLAUDE.md').toBe(true)
    const normalize = (s) => s.replace(/\r\n/g, '\n')
    expect(normalize(readFileSync(agents, 'utf8'))).toBe(normalize(readFileSync(claude, 'utf8')))
  })
})
