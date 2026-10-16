// 资产完整性测试（防跑偏：页面资产不允许悄无声息地丢失、改名或清零）
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PAGES } from '../pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..') // J.Co 工程根
const UI = path.join(ROOT, '设计原型')

describe('设计原型资产完整性', () => {
  it.each(PAGES)('页面存在且非空：%s', (page) => {
    const file = path.join(UI, page)
    expect(existsSync(file), `缺少页面：${page}`).toBe(true)
    expect(statSync(file).size, `页面疑似为空：${page}`).toBeGreaterThan(1000)
  })

  it('UI Kit 单一来源存在（assets/jco-ui.css）', () => {
    const css = path.join(UI, 'assets', 'jco-ui.css')
    expect(existsSync(css)).toBe(true)
    expect(statSync(css).size).toBeGreaterThan(1000)
  })
})
