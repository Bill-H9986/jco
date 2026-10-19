import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectNewEditArtifacts } from '../../src/application/artifacts.ts'

describe('后期任务产物登记', () => {
  it('只登记任务执行期间新出现的成片', () => {
    const artifacts = collectNewEditArtifacts(
      ['source.mp4', 'old.mp4'],
      ['source.mp4', 'old.mp4', 'source-trim-new.mp4'],
      'C:/J.Co/assets',
      123,
    )
    expect(artifacts).toEqual([
      {
        id: 'art-3f-0',
        name: 'source-trim-new.mp4',
        path: path.join('C:/J.Co/assets', 'source-trim-new.mp4'),
        kind: 'video',
        createdAt: 123,
      },
    ])
  })

  it('没有新文件时不会伪造产物', () => {
    expect(collectNewEditArtifacts(['a.mp4'], ['a.mp4'], 'C:/assets')).toEqual([])
  })
})
