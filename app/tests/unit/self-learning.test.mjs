import { describe, expect, it } from 'vitest'
import {
  buildLearnedKnowledge,
  mergeLearnedKnowledge,
  shouldLearnFromTask,
} from '../../src/application/self-learning.ts'

describe('AI 总管自进化记忆', () => {
  it('只从成功完成的运营/调研/内容任务学习', () => {
    expect(shouldLearnFromTask({ type: 'operate', status: 'done' })).toBe(true)
    expect(shouldLearnFromTask({ type: 'research', status: 'done' })).toBe(true)
    expect(shouldLearnFromTask({ type: 'content', status: 'done' })).toBe(true)
    expect(shouldLearnFromTask({ type: 'publish', status: 'done' })).toBe(false)
    expect(shouldLearnFromTask({ type: 'edit', status: 'done' })).toBe(false)
    expect(shouldLearnFromTask({ type: 'operate', status: 'failed' })).toBe(false)
  })

  it('把任务结果整理成可追溯的长期记忆', () => {
    const entry = buildLearnedKnowledge(
      {
        id: 'task-1',
        title: '昨日战报',
        type: 'operate',
        status: 'done',
      },
      '昨天 19:30 发布的视频播放 5.2 万，评论集中在“报名流程”。',
      123,
    )
    expect(entry).toMatchObject({
      id: 'learn-task-1',
      title: 'AI总管记录｜昨日战报',
      content: '昨天 19:30 发布的视频播放 5.2 万，评论集中在“报名流程”。',
      tags: ['AI自动记录', '运营'],
      source: 'ai',
      sourceTaskId: 'task-1',
      sourceTaskTitle: '昨日战报',
      enabled: true,
      updatedAt: 123,
    })
  })

  it('优先只保存 AI 标记的可复用记忆，并拒绝没有任务 id 的结果', () => {
    const entry = buildLearnedKnowledge(
      { id: 'task-2', title: '账号复盘', type: 'research', status: 'done' },
      '这次任务做了很多步骤。\n\n【可复用记忆】\n晚上 8 点发布的视频互动更高；评论区最关心价格和报名方式。',
      456,
    )
    expect(entry.content).toBe('晚上 8 点发布的视频互动更高；评论区最关心价格和报名方式。')
    expect(
      buildLearnedKnowledge(
        { id: '', title: '无 id', type: 'operate', status: 'done' },
        '这是一段足够长的记忆内容，用来验证没有任务 id 时不会写入。',
      ),
    ).toBeNull()
  })

  it('同一任务和重复内容不会反复写入', () => {
    const first = buildLearnedKnowledge(
      { id: 'task-1', title: '昨日战报', type: 'operate', status: 'done' },
      '同一份运营洞察：晚上八点发布的内容互动更高，评论区更关心报名流程。',
      100,
    )
    const repeated = buildLearnedKnowledge(
      { id: 'task-2', title: '今日战报', type: 'operate', status: 'done' },
      '  同一份运营洞察：晚上八点发布的内容互动更高，评论区更关心报名流程。  ',
      200,
    )
    const different = buildLearnedKnowledge(
      { id: 'task-3', title: '评论区观察', type: 'research', status: 'done' },
      '新的洞察：带价格说明的短视频完播率更高，评论区更愿意留下联系方式。',
      300,
    )
    const merged = mergeLearnedKnowledge([first], repeated, 20)
    expect(merged).toHaveLength(1)
    const second = mergeLearnedKnowledge(merged, different, 20)
    expect(second.map((entry) => entry.sourceTaskId)).toEqual(['task-3', 'task-2'])
  })
})
