#!/usr/bin/env node
/**
 * AI 契约冒烟：真实调用文本 / 图片 / 视频三路模型。
 * 不进 npm run gate（免费额度有限），发版前或夜间单独跑：
 *   node scripts/ai-smoke.mjs
 * 证据写到 outputs/ai-smoke/。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(__dirname, '..')
const OUT = path.join(APP, '..', 'outputs', 'ai-smoke')
fs.mkdirSync(OUT, { recursive: true })

function configPath() {
  const installed = path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'J.Co',
    'resources',
    'app.asar.unpacked',
    'kernel',
    'model-config.json',
  )
  if (fs.existsSync(installed)) return installed
  return path.join(APP, 'kernel', 'model-config.json')
}

function loadConfig() {
  const file = configPath()
  if (!fs.existsSync(file)) throw new Error(`找不到模型配置：${file}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function request(url, options, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, options)
    if (res.status === 429 || res.status === 503) {
      console.log(`  ${res.status} 限流/队列满，等 60 秒重试`)
      await sleep(60000)
      continue
    }
    return res
  }
  throw new Error(`重试次数用尽：${url}`)
}

const cfg = loadConfig()
const results = []

// 1) 文本：生成 6 段分镜 JSON
{
  const c = cfg.chat
  const res = await request(`${c.url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({
      model: c.model,
      messages: [
        {
          role: 'user',
          content:
            '以「无人机装调检修操作工 人社局等级证 免费就业培训」为主题，输出 6 段竖屏短视频分镜，只输出 JSON 数组，每项包含 line（口播文案）和 pic（画面描述）。',
        },
      ],
      temperature: 0.7,
    }),
  })
  const data = await res.json()
  const text = data?.choices?.[0]?.message.content
  fs.writeFileSync(path.join(OUT, 'chat.json'), JSON.stringify(data, null, 2))
  const match = String(text || '').match(/\[[\s\S]*\]/)
  const shots = match ? JSON.parse(match[0]) : null
  results.push({ kind: 'chat', ok: Array.isArray(shots) && shots.length === 6, model: c.model })
  if (Array.isArray(shots)) fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(shots, null, 2))
}

// 2) 图片：1 张主视觉
{
  const c = cfg.image
  const res = await request(`${c.url.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({
      model: c.model,
      prompt:
        '竖版宣传海报主视觉：年轻中国女性讲师小雅，浅蓝西装，站在无人机装配实训台前，蓝白配色，专业可信，无文字。',
      n: 1,
      size: '1K',
      aspect_ratio: '3:4',
      response_format: 'b64_json',
    }),
  })
  const data = await res.json()
  const item = data?.data?.[0]
  const png = item?.b64_json ? Buffer.from(item.b64_json, 'base64') : null
  const width = png && png.length > 24 ? png.readUInt32BE(16) : 0
  const height = png && png.length > 24 ? png.readUInt32BE(20) : 0
  const ok = Boolean(png) && Math.abs(width / height - 3 / 4) < 0.01
  results.push({ kind: 'image', ok, model: c.model, width, height })
  if (png) fs.writeFileSync(path.join(OUT, 'poster.png'), png)
}

// 3) 视频：1 段 5 秒
{
  const c = cfg.video
  const base = c.url.replace(/\/+$/, '')
  const create = await request(`${base}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
    body: JSON.stringify({
      model: c.model,
      prompt: '竖屏9:16，年轻女讲师小雅在无人机实训台前微笑介绍课程，镜头缓慢推近，明亮培训教室。',
      mode: 'text',
      seconds: '5',
      size: '720P',
      aspect_ratio: '9:16',
    }),
  })
  const created = await create.json()
  const id = created && (created.video_id || created.task_id || created.id)
  let ok = false
  let url = ''
  if (id) {
    const host = new URL(base).origin
    const deadline = Date.now() + 10 * 60 * 1000
    while (Date.now() < deadline) {
      await sleep(5000)
      const q = await fetch(
        `${host}/agnesapi?video_id=${encodeURIComponent(id)}&model_name=${encodeURIComponent(c.model)}`,
        { headers: { Authorization: `Bearer ${c.key}` } },
      )
      const data = await q.json().catch(() => null)
      if (!data) continue
      const status = String(data.status || '').toLowerCase()
      if (status === 'completed' && data.url) {
        ok = true
        url = data.url
        break
      }
      if (status === 'failed') break
    }
  }
  results.push({ kind: 'video', ok, model: c.model, id })
  fs.writeFileSync(path.join(OUT, 'video.json'), JSON.stringify({ id, url }, null, 2))
}

const report = { at: new Date().toISOString(), results, allOk: results.every((r) => r.ok) }
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (!report.allOk) process.exit(1)
