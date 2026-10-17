import fs from 'node:fs'
import path from 'node:path'
import { createEmptyStoreFile, STORE_SCHEMA_VERSION, type StoreFile } from './store-schema.js'

export interface JsonStoreOptions {
  filePath: string
  backupPath?: string
  now?: () => number
}

export class StoreSchemaError extends Error {
  readonly code = 'STORE_SCHEMA_MISMATCH' as const

  constructor(
    readonly expected: number,
    readonly actual: unknown,
  ) {
    super(`store schemaVersion 不匹配：期望 ${expected}，实际 ${String(actual)}`)
    this.name = 'StoreSchemaError'
  }
}

export class StoreCorruptError extends Error {
  readonly code = 'STORE_CORRUPT' as const

  constructor(
    readonly filePath: string,
    readonly causeMessage: string,
  ) {
    super(`store 文件损坏且无法从 backup 恢复：${filePath}（${causeMessage}）`)
    this.name = 'StoreCorruptError'
  }
}

function defaultBackupPath(filePath: string): string {
  return filePath.replace(/\.json$/i, '.backup.json')
}

function validate(raw: unknown): StoreFile {
  if (!raw || typeof raw !== 'object') throw new Error('不是 JSON 对象')
  const file = raw as Partial<StoreFile>
  if (file.schemaVersion !== STORE_SCHEMA_VERSION) {
    throw new StoreSchemaError(STORE_SCHEMA_VERSION, file.schemaVersion)
  }
  if (!file.data || typeof file.data !== 'object') throw new Error('缺少 data')
  return file as StoreFile
}

function readStoreFile(filePath: string): StoreFile {
  return validate(JSON.parse(fs.readFileSync(filePath, 'utf8')))
}

function writeJsonAtomic(filePath: string, value: StoreFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {
      fs.renameSync(tempPath, filePath)
    } catch {
      // Windows 某些文件系统不允许 rename 覆盖；退回 copy + unlink，仍保证临时文件清理。
      fs.copyFileSync(tempPath, filePath)
      fs.unlinkSync(tempPath)
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath)
      } catch {
        /* 临时文件清理失败不掩盖主错误 */
      }
    }
  }
}

export function createJsonStore(options: JsonStoreOptions) {
  const filePath = path.resolve(options.filePath)
  const backupPath = path.resolve(options.backupPath || defaultBackupPath(filePath))
  const now = options.now || Date.now

  return {
    filePath,
    backupPath,

    exists(): boolean {
      return fs.existsSync(filePath)
    },

    load(): StoreFile {
      if (!fs.existsSync(filePath)) return createEmptyStoreFile(now())
      try {
        return readStoreFile(filePath)
      } catch (mainError) {
        if (mainError instanceof StoreSchemaError) throw mainError
        if (!fs.existsSync(backupPath)) {
          throw new StoreCorruptError(filePath, String((mainError as Error).message || mainError))
        }
        try {
          const backup = readStoreFile(backupPath)
          writeJsonAtomic(filePath, backup)
          return backup
        } catch (backupError) {
          if (backupError instanceof StoreSchemaError) throw backupError
          throw new StoreCorruptError(
            filePath,
            `main=${String((mainError as Error).message || mainError)}; backup=${String((backupError as Error).message || backupError)}`,
          )
        }
      }
    },

    save(file: StoreFile): void {
      validate(file)
      if (fs.existsSync(filePath)) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true })
        fs.copyFileSync(filePath, backupPath)
      }
      writeJsonAtomic(filePath, { ...file, updatedAt: now() })
    },

    backup(): void {
      if (!fs.existsSync(filePath)) return
      fs.mkdirSync(path.dirname(backupPath), { recursive: true })
      fs.copyFileSync(filePath, backupPath)
    },
  }
}
