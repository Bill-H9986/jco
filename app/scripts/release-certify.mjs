// 发布候选认证：对同一个安装包执行哈希、打包冒烟、安装版 UI 和真实内核验证。
// 用法：node scripts/release-certify.mjs [安装包或安装目录 exe]
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const input = process.argv[2]
if (!input) {
  console.error('用法：node scripts/release-certify.mjs <安装包 exe 或已安装 J.Co.exe>')
  process.exit(1)
}

const target = path.resolve(input)
if (!fs.existsSync(target)) {
  console.error(`目标不存在：${target}`)
  process.exit(1)
}

const isInstaller =
  path.basename(target).toLowerCase().endsWith('.exe') && path.basename(target).toLowerCase().includes('j.co-')
const installedExe = isInstaller ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'J.Co', 'J.Co.exe') : target
const packagePath = isInstaller ? target : null

if (!fs.existsSync(installedExe)) {
  console.error(`已安装版不存在：${installedExe}`)
  process.exit(1)
}

const sha256 = packagePath
  ? crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex').toUpperCase()
  : ''

const steps = []
function run(name, command, args) {
  console.log(`\n===== ${name} =====`)
  const result = spawnSync([command, ...args].join(' '), {
    cwd: APP_DIR,
    stdio: 'inherit',
    shell: true,
  })
  steps.push({ name, status: result.status })
  if (result.status !== 0) {
    const report = {
      generatedAt: new Date().toISOString(),
      target,
      installedExe,
      sha256,
      steps,
      passed: false,
    }
    fs.mkdirSync(path.join(APP_DIR, 'quality', 'generated'), { recursive: true })
    fs.writeFileSync(
      path.join(APP_DIR, 'quality', 'generated', 'release-certification.json'),
      JSON.stringify(report, null, 2),
    )
    process.exit(1)
  }
}

run('打包版启动冒烟', 'node', ['scripts/qa-packaged.mjs', installedExe])
run('安装版 UI 契约', 'node', ['scripts/qa-installed-ui.mjs', installedExe])
run('安装版真实内核', 'node', ['scripts/verify-packaged-kernel.mjs', installedExe])

const report = {
  generatedAt: new Date().toISOString(),
  target,
  installedExe,
  sha256,
  steps,
  passed: true,
}
fs.mkdirSync(path.join(APP_DIR, 'quality', 'generated'), { recursive: true })
fs.writeFileSync(
  path.join(APP_DIR, 'quality', 'generated', 'release-certification.json'),
  JSON.stringify(report, null, 2),
)
console.log('\n✅ 发布候选认证通过')
console.log(`认证报告：${path.join(APP_DIR, 'quality', 'generated', 'release-certification.json')}`)
