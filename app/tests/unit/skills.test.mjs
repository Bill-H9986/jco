// M5 技能表结构（A2）/ 合并迁移（A3）/ 注入段（A4）
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSkillsSection } from '../../kernel/skills-prompt.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..') // J.Co 工程根
const require = createRequire(import.meta.url)
const SKILLS = require(path.join(ROOT, '设计原型', 'assets', 'jco-skills.js'))

describe('技能表结构（A2）', () => {
  const { DEFAULTS } = SKILLS

  it('共 16 项、id 唯一', () => {
    expect(DEFAULTS.length).toBe(16)
    expect(new Set(DEFAULTS.map((s) => s.id)).size).toBe(16)
  })

  it('做视频页场景（make-video）恰 8 项', () => {
    const mv = DEFAULTS.filter((s) => s.scenes.includes('make-video'))
    expect(mv.length).toBe(8)
    expect(mv.map((s) => s.name).sort()).toEqual(
      ['一镜到底', '图片设计', '我自己出镜念', '数字人口播', '智能换背景', '爆款复刻', '照片会说话', '长视频'].sort(),
    )
  })

  it('每项字段齐备（id/name/desc/kind/icon/on/scenes/entry）', () => {
    for (const s of DEFAULTS) {
      expect(s.id, 'id').toMatch(/^s\d+$/)
      expect(s.name, `${s.id} name`).toBeTruthy()
      expect(s.desc, `${s.id} desc`).toBeTruthy()
      expect(['video', 'graphic', 'social', 'data']).toContain(s.kind)
      expect(s.icon).toMatch(/^ti-/)
      expect(typeof s.on).toBe('boolean')
      expect(Array.isArray(s.scenes)).toBe(true)
      expect(s.entry, `${s.id} entry`).toBeTruthy()
    }
  })

  it('action（做视频页点击行为）只在 make-video 场景出现，且字段与原实现同形', () => {
    for (const s of DEFAULTS) {
      const isMv = s.scenes.includes('make-video')
      if (isMv) {
        expect(s.action, `${s.id} action`).toBeTruthy()
        expect(typeof s.action.fill).toBe('string')
        expect(s.action.toast, `${s.id} toast`).toBeTruthy()
      } else {
        expect(s.action, `${s.id} 不该带 action`).toBeUndefined()
      }
    }
  })
})

describe('技能合并迁移（A3）', () => {
  it('老数据（用户改过开关）→ 16 项，用户开关保留、新项补默认', () => {
    const merged = SKILLS.merge([
      { id: 's4', on: false },
      { id: 's9', on: false },
    ])
    expect(merged.length).toBe(16)
    expect(merged.find((s) => s.id === 's4').on).toBe(false) // 用户停过：保留
    expect(merged.find((s) => s.id === 's9').on).toBe(false)
    expect(merged.find((s) => s.id === 's1').on).toBe(true) // 没动过：按默认
    expect(merged.find((s) => s.id === 's13').on).toBe(true) // 新项：默认补入
  })

  it('无存储 / 损坏数据 → 退回全默认（不抛错）', () => {
    expect(SKILLS.merge(null).length).toBe(16)
    expect(SKILLS.merge('坏').length).toBe(16)
    expect(SKILLS.merge([{ id: 42 }, null, 'x']).length).toBe(16)
  })

  it('本地多余 id → 丢弃（共享表是权威清单）', () => {
    const merged = SKILLS.merge([{ id: 'zzz', on: false }])
    expect(merged.find((s) => s.id === 'zzz')).toBeUndefined()
  })

  it('合并产物不污染默认表（改一项不影响 DEFAULTS）', () => {
    const merged = SKILLS.merge(null)
    const first = merged.find((s) => s.id === 's1')
    if (first.action) first.action.fill = '被改了'
    expect(SKILLS.DEFAULTS.find((s) => s.id === 's1').action.fill).toBe('帮我复刻这条爆款视频，链接：')
  })
})

describe('做视频页技能排过滤（A6 的数据面）', () => {
  it('默认（新机）→ 恰 8 项', () => {
    expect(SKILLS.makeVideoSkills(SKILLS.merge(null)).length).toBe(8)
  })

  it('停用「一镜到底」→ 7 项且不含它；启用回来 → 8 项', () => {
    const stopped = SKILLS.makeVideoSkills(SKILLS.merge([{ id: 's4', on: false }]))
    expect(stopped.length).toBe(7)
    expect(stopped.some((s) => s.name === '一镜到底')).toBe(false)
    const back = SKILLS.makeVideoSkills(SKILLS.merge([{ id: 's4', on: true }]))
    expect(back.length).toBe(8)
  })
})

describe('技能注入段（A4）', () => {
  it('只含启用项 + 固定尾注', () => {
    const items = SKILLS.merge([{ id: 's4', on: false }])
    const text = buildSkillsSection(items)
    expect(text).toContain('爆款复刻')
    expect(text).not.toContain('一镜到底')
    expect(text).toContain('你在聊天里不能直接替用户执行')
    expect(text).toContain('入口：做视频页 →「爆款复刻」')
  })

  it('全 off → 空串（整段省略）', () => {
    const off = SKILLS.merge(null).map((s) => ({ ...s, on: false }))
    expect(buildSkillsSection(off)).toBe('')
  })

  it('畸形输入 → 不抛错（空串或忽略坏项）', () => {
    expect(buildSkillsSection(null)).toBe('')
    expect(buildSkillsSection([{ name: 'X', on: true }])).toContain('X')
  })
})
