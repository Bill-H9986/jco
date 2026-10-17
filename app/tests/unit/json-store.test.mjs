import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createJsonStore, StoreCorruptError, StoreSchemaError } from '../../src/infrastructure/store/json-store.ts'
import { createEmptyStoreFile, STORE_SCHEMA_VERSION } from '../../src/infrastructure/store/store-schema.ts'

const tempDirs = []

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-store-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, 'store.json')
  const backupPath = path.join(dir, 'store.backup.json')
  return { dir, filePath, backupPath, store: createJsonStore({ filePath, backupPath }) }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('JsonStore', () => {
  it('空 store 返回正确 schema 和空数据', () => {
    const file = createEmptyStoreFile(123)
    expect(file.schemaVersion).toBe(STORE_SCHEMA_VERSION)
    expect(file.updatedAt).toBe(123)
    expect(file.data.tasks).toEqual([])
    expect(file.data.conversations).toEqual([])
  })

  it('保存后可完整回读', () => {
    const { filePath, store } = tempStore()
    const file = createEmptyStoreFile(100)
    file.data.tasks.push({
      id: 't1',
      title: '测试任务',
      goal: '验证存储',
      type: 'custom',
      ownerRole: 'writer',
      status: 'draft',
      inputs: [],
      constraints: [],
      deliverables: ['一份结果'],
      approvalPolicy: {
        requirePublishApproval: true,
        requireDeleteApproval: true,
        requirePaymentApproval: true,
        requireFinalApproval: true,
      },
      createdAt: 100,
      updatedAt: 100,
    })
    file.data.messages.push({
      id: 'm1',
      conversationId: 'c1',
      role: 'assistant',
      content: '一段很长的消息'.repeat(400),
      format: 'markdown',
      createdAt: 100,
      status: 'complete',
    })
    store.save(file)
    const loaded = store.load()
    expect(loaded.data.tasks).toHaveLength(1)
    expect(loaded.data.messages[0].content.length).toBeGreaterThan(2000)
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('第二次保存前生成 backup，backup 保留上一版', () => {
    const { backupPath, store } = tempStore()
    const first = createEmptyStoreFile(100)
    first.data.conversations.push({
      id: 'c1',
      title: '第一版',
      messages: [],
      model: 'test',
      createdAt: 100,
      updatedAt: 100,
    })
    store.save(first)
    const second = createEmptyStoreFile(200)
    second.data.conversations.push({
      id: 'c2',
      title: '第二版',
      messages: [],
      model: 'test',
      createdAt: 200,
      updatedAt: 200,
    })
    store.save(second)
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
    expect(backup.data.conversations[0].id).toBe('c1')
    expect(store.load().data.conversations[0].id).toBe('c2')
  })

  it('主文件损坏时从 backup 恢复并重建主文件', () => {
    const { filePath, store } = tempStore()
    const first = createEmptyStoreFile(100)
    first.data.conversations.push({
      id: 'c1',
      title: '可恢复',
      messages: [],
      model: 'test',
      createdAt: 100,
      updatedAt: 100,
    })
    store.save(first)
    store.save(createEmptyStoreFile(200))
    fs.writeFileSync(filePath, '{broken json', 'utf8')
    const recovered = store.load()
    expect(recovered.data.conversations[0].id).toBe('c1')
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).data.conversations[0].id).toBe('c1')
  })

  it('schemaVersion 不匹配抛 StoreSchemaError', () => {
    const { filePath, store } = tempStore()
    fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 99, updatedAt: 1, data: {} }), 'utf8')
    expect(() => store.load()).toThrow(StoreSchemaError)
    try {
      store.load()
    } catch (error) {
      expect(error.code).toBe('STORE_SCHEMA_MISMATCH')
      expect(error.message).toContain('99')
    }
  })

  it('主文件和 backup 都损坏时抛 StoreCorruptError', () => {
    const { filePath, backupPath, store } = tempStore()
    fs.writeFileSync(filePath, '{broken', 'utf8')
    fs.writeFileSync(backupPath, '{also broken', 'utf8')
    expect(() => store.load()).toThrow(StoreCorruptError)
  })

  it('保存后不残留临时文件', () => {
    const { dir, store } = tempStore()
    store.save(createEmptyStoreFile(100))
    const files = fs.readdirSync(dir)
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false)
  })
})
