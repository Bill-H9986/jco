// 适配层契约完整性（e2e 用例清单 A8）：抖音适配包必须实现统一接口
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(__dirname, '..', '..')
const PACK = path.join(APP, 'publish', 'platforms', 'douyin')

describe('抖音适配包（platforms/douyin）', () => {
  it('三个文件齐备：adapter / selectors / rules', () => {
    expect(existsSync(path.join(PACK, 'adapter.mjs')), '缺少 adapter.mjs').toBe(true)
    expect(existsSync(path.join(PACK, 'selectors.mjs')), '缺少 selectors.mjs').toBe(true)
    expect(existsSync(path.join(PACK, 'rules.json')), '缺少 rules.json').toBe(true)
  })

  it('适配接口恰好是契约规定的 5 个方法（多一个 = 越界，少一个 = 不完整）', async () => {
    const mod = await import(pathToFileURL(path.join(PACK, 'adapter.mjs')).href)
    const fns = Object.keys(mod)
      .filter((k) => typeof mod[k] === 'function')
      .sort()
    expect(fns).toEqual(['detectLogin', 'fillMeta', 'open', 'uploadVideo', 'waitForReady'])
  })

  it('规则卡结构合法（硬规则可被文案环节读取）', () => {
    const rules = JSON.parse(readFileSync(path.join(PACK, 'rules.json'), 'utf8'))
    expect(typeof rules.titleMax).toBe('number')
    expect(typeof rules.topicsMax).toBe('number')
    expect(rules.video && typeof rules.video.maxGB).toBe('number')
    expect(Array.isArray(rules.video.formats)).toBe(true)
  })
})
