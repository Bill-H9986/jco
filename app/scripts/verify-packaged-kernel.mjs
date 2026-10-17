import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXE = process.argv[2] || path.join(__dirname, '..', 'release', 'win-unpacked', 'J.Co.exe')

const app = await electron.launch({
  executablePath: path.resolve(EXE),
  args: ['--jco-test'],
  // 模拟干净机器：不允许借用开发目录的 NODE_PATH。
  env: { ...process.env, NODE_PATH: '' },
})

let failed = false
try {
  const win = await app.firstWindow()
  await win.waitForTimeout(3000)
  const status = await win.evaluate(async () => {
    const started = Date.now()
    let current = await window.jco.kernel.status()
    while (!current?.ready && Date.now() - started < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      current = await window.jco.kernel.status()
    }
    return current
  })
  console.log(`URL       : ${decodeURIComponent(win.url())}`)
  console.log(`ready     : ${status?.ready}`)
  console.log(`status    : ${JSON.stringify(status)}`)
  if (!status?.ready) throw new Error('内核未就绪')

  const reply = await win.evaluate(() => window.jco.kernel.ask('只回复四个字：外壳正常'))
  console.log(`模型回复   : ${typeof reply === 'string' ? reply : JSON.stringify(reply)}`)
  const text = typeof reply === 'string' ? reply : JSON.stringify(reply)
  if (!text.includes('外壳正常')) throw new Error('模型回复未命中')
} catch (error) {
  failed = true
  console.error(`❌ 安装版内核验证失败：${error.message}`)
} finally {
  await app.close()
}

if (failed) process.exit(1)
console.log('✅ 安装版真实内核通过（无 NODE_PATH 依赖）')
