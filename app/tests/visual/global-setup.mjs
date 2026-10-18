import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const TEST_DIR = path.join(os.tmpdir(), 'jco-test-kernel-data')
const SNAPSHOT = path.join(APP_DIR, 'node_modules', '.cache', 'jco-visual-kernel-snapshot')

export default async function globalSetup() {
  fs.rmSync(SNAPSHOT, { recursive: true, force: true })
  if (fs.existsSync(TEST_DIR)) {
    fs.cpSync(TEST_DIR, SNAPSHOT, { recursive: true })
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  }
}
