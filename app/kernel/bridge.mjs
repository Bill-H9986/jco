/**
 * J.Co 内核桥（Electron 主进程专用）
 *
 * 通过官方 @deepseek-ai/dsh-sdk-client 驱动 DeepSeek Harness 内核子进程：
 * - warmUp()：应用启动后台预热，首句不冷启动
 * - ask()：一轮对话，逐段回调文本增量；串行执行，一次只有一个回合
 * - close()：退出时回收内核进程
 *
 * 模型路由（按设置页「说话写稿」的配置实时生效）：
 * - 未配置时：`sdk` profile + `deepseek-official`（本机 ~/.dsh 凭据兜底）
 * - 配了「Agnes 内置」：动态 patch 注册 `jco-custom` provider 指向 https://api.agnes-ai.cn/v1
 * - 配了「OpenAI 兼容接口」：动态 patch 注册 `jco-custom` provider 指向自填地址
 * 配置存在 kernel/model-config.json（由设置页经 IPC 写入，saveModel 后自动重建内核）。
 */
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, sep } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 打包适配：内核子进程读不到 asar 内文件——把 kernel 内路径映射到 app.asar.unpacked */
function toUnpacked(p) {
  const marker = `app.asar${sep}`
  return p.includes(marker) ? p.replace(marker, `app.asar.unpacked${sep}`) : p
}
/** 设置页保存的模型配置（说话写稿） */
const CONFIG_PATH = toUnpacked(join(HERE, 'model-config.json'))
/** 由配置动态生成的内核 patch（注册 jco-custom provider） */
const PATCH_PATH = toUnpacked(join(HERE, 'dynamic-model.patch.yml'))
/** 固定携带：对话链路的工具面收口（禁掉 shell/文件/网页等干活工具） */
const CHAT_PATCH_PATH = toUnpacked(join(HERE, 'jco-chat.patch.yml'))
const PUBLISH_TOOLS_PATCH_PATH = toUnpacked(join(HERE, 'publish-tools.patch.yml'))

/** 生成发布工具 patch：内核侧"瘦代理"插件（8 个浏览器工具；sessionFile 动态取址，不随会话启停重启内核） */
function writePublishToolsPatch() {
  const pluginUrl = pathToFileURL(toUnpacked(join(HERE, 'publish-tools', 'index.mjs'))).href
  const sessionFile = toUnpacked(join(HERE, 'publish-session.json')).replace(/\\/g, '/')
  writeFileSync(
    PUBLISH_TOOLS_PATCH_PATH,
    [
      '# J.Co 发布工具（内核侧瘦代理）——由 J.Co 自动生成，勿手改',
      '- insert:',
      '    - id: jco-publish-tools',
      `      name: '${pluginUrl}'`,
      '      config:',
      `        sessionFile: '${sessionFile}'`,
      '',
    ].join('\n'),
    'utf8',
  )
}
writePublishToolsPatch()

/** 内置 Agnes（全模态平台）的固定端点与默认模型 */
export const AGNES_BUILTIN = {
  baseUrl: 'https://api.agnes-ai.cn/v1',
  model: 'agnes-2.5-flash',
}
/** 未配置任何自接接口时的兜底路由（本机 DSH 凭据） */
const FALLBACK = { provider: 'deepseek-official', model: 'deepseek-v4-flash', label: 'DeepSeek 官方（默认）' }

/**
 * 聊天链路的统一角色设定（说话写稿/总管/右下角助手共用）。
 * 关键一条：业务数据（播放量、评论、待办、发布状态）目前没有接入上下文——
 * 要求模型如实说"还没接上"，绝不编造数字或进度（产品红线：不许盲盒）。
 */
const CHAT_SYSTEM = [
  '你是「J.Co」自媒体工作台里的总管助手，服务做成人学历提升（成人高考/自考）招生的内容创作者。',
  '说话干脆、口语化、简体中文；不端着，不写官话。',
  '回复要短：日常对话一两句话说完（尽量 100 字以内），不要小标题、不要分点列表、不要客套铺垫；只有用户明确要"详细""展开"时才多写。',
  '重要约束：本机平台数据（播放量、粉丝、评论、今日待办、发布状态、素材清单）目前还没有接入你的上下文。被问到这类具体数据时，如实说「这块数据还没接上，接上我马上报给你」，绝对不要编造数字、进度或完成状态。',
  '【浏览器发布操作要点】（执行"发布 / 打开页面 / 操作网页"这类任务时遵守）：',
  '① 浏览器位置权限已自动处理（不会再弹）；如果仍看到挡路的提示气泡（如"视频预览功能·我知道了"）就先点掉再继续。',
  '② 封面设置（两条路任选）：A. 页面上"设置封面"区的横 / 竖两个上传位，各传一张封面图（jco_upload_file 直接传，传完即设置）；B. 点"选择封面"开弹窗 → 默认帧或上传图 → 点「完成」→「设置竖封面」→ 再点「完成」→ 弹窗右上 ×（或按 ESC）关闭。',
  '③ 每次动作前先 jco_snapshot 拿最新编号；页面变化（跳转 / 弹窗出现 / 上传完成）后必须重新快照。',
  '④ 看不明白的内容（比如截图里有什么）就如实说看不清，绝不瞎猜。',
  '⑤ 全部就绪后做收尾汇报（确保这是本回合的最后一句话）：填了什么、封面设了没、最后一步留给用户点。',
  '⑥ 运营任务（战报 / 评论）：读完平台数据或评论页后，用 jco_save_report / jco_save_comments 把结果存到本机（运营页会展示）；评论回复只在用户点头之后执行，点头前绝不发送。',
  '⑦ 工具调用如果失败或没有真正执行：不要假装做过——改用正确的工具名重新调用一次；仍不行就如实告诉用户。',
].join('\n')

let harness = null
let queue = Promise.resolve() // 串行化：内核一次只服务一个回合
let sessionSeq = 0
let sessionId = 'jco-0'
let currentRoute = null // 当前 harness 实际使用的路由描述

function makeSessionId() {
  sessionSeq += 1
  return 'jco-' + Date.now().toString(36) + '-' + sessionSeq
}

function loadUserConfig() {
  try {
    const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return data && typeof data === 'object' ? data : null
  } catch (error) {
    return null
  }
}

/** 由设置页配置解析出本次内核启动的路由 */
function resolveRoute() {
  const cfg = loadUserConfig()
  const chat = cfg && cfg.chat
  if (chat && typeof chat === 'object') {
    if (chat.src === 'agnes' && chat.key) {
      const model = String(chat.model || AGNES_BUILTIN.model)
      return {
        provider: 'jco-custom',
        model,
        env: { JCO_CUSTOM_KEY: String(chat.key) },
        patch: { baseURL: AGNES_BUILTIN.baseUrl, model },
        label: 'Agnes 内置',
      }
    }
    if (chat.src === 'compat' && chat.url && chat.key && chat.model) {
      return {
        provider: 'jco-custom',
        model: String(chat.model),
        env: { JCO_CUSTOM_KEY: String(chat.key) },
        patch: { baseURL: String(chat.url), model: String(chat.model) },
        label: '自接接口',
      }
    }
  }
  return { ...FALLBACK, env: {}, patch: null }
}

/** 把路由写成内核 patch（llm-pi-ai 的 jco-custom provider） */
function writePatch(patch) {
  const q = (value) => "'" + String(value).replace(/'/g, "''") + "'"
  const yml = [
    '# J.Co 自动生成：由设置页保存的模型配置写到这里（手工改动会被下次保存覆盖）',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      jco-custom:',
    '        apiKeyEnv: JCO_CUSTOM_KEY',
    '        api: openai-completions',
    '        baseURL: ' + q(patch.baseURL),
    '        models:',
    '          - id: ' + q(patch.model),
    '',
  ].join('\n')
  writeFileSync(PATCH_PATH, yml, 'utf8')
}

/** 当前桥状态（供前端/诊断显示） */
export function status() {
  const route = currentRoute || resolveRoute()
  return {
    ready: harness !== null,
    session: sessionId,
    route: { label: route.label, provider: route.provider, model: route.model, effective: currentRoute !== null },
  }
}

/**
 * 真探测一个 OpenAI 兼容接口：GET {url}/models。
 * 用于设置页的「测试连接」与「搜索可用模型」：地址 + Key 都会真发出去验一遍。
 * 返回 { ok, models } 或 { ok:false, error }；15 秒超时。
 */
export async function probeModels(input) {
  try {
    const base = String((input && input.url) || '').trim().replace(/\/+$/, '')
    const key = String((input && input.key) || '').trim()
    if (!/^https?:\/\//i.test(base)) return { ok: false, error: '接口地址要以 http:// 或 https:// 开头' }
    if (!key) return { ok: false, error: 'API Key 还没填' }
    const res = await fetch(base + '/models', {
      headers: { Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + (res.status === 401 ? '（Key 没通过）' : '') }
    const data = await res.json().catch(() => null)
    const models = Array.isArray(data && data.data)
      ? data.data.map((m) => m && m.id).filter((id) => typeof id === 'string' && id !== '')
      : []
    return { ok: true, models }
  } catch (error) {
    const msg = String((error && error.message) || error)
    if (/timeout|abort/i.test(msg)) return { ok: false, error: '等太久了，地址可能不通' }
    return { ok: false, error: msg }
  }
}

/**
 * 真画图：用设置页「画图修图」的配置调 OpenAI 兼容的图像接口
 * （POST {url}/images/generations，b64_json 或 url 返回都认）。
 * 返回 { ok, dataUrl|url } 或 { ok:false, error }；单张最长等 3 分钟。
 */
export async function drawImage(payload) {
  try {
    const cfg = loadUserConfig()
    const img = cfg && cfg.image
    let baseUrl = ''
    let key = ''
    let model = ''
    if (img && img.src === 'compat' && img.url && img.key) {
      baseUrl = String(img.url)
      key = String(img.key)
      model = String(img.model || '')
    } else if (img && img.src === 'agnes' && img.key) {
      baseUrl = AGNES_BUILTIN.baseUrl
      key = String(img.key)
      model = String(img.model || 'agnes-image-2.5-flash')
    }
    if (!baseUrl || !key) {
      return { ok: false, error: '还没配「画图修图」的 Key：去「设置 → AI 大脑 → 画图修图」填一次。' }
    }
    const prompt = String((payload && payload.prompt) || '').trim()
    if (!prompt) return { ok: false, error: '没给画面描述' }
    if (!model) model = 'agnes-image-2.5-flash'
    const res = await fetch(baseUrl.replace(/\/+$/, '') + '/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, prompt, n: 1, response_format: 'b64_json' }),
      signal: AbortSignal.timeout(180000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, error: 'HTTP ' + res.status + (res.status === 401 ? '（Key 没通过）' : (detail ? '：' + detail.slice(0, 120) : '')) }
    }
    const data = await res.json().catch(() => null)
    const item = data && data.data && data.data[0]
    if (!item) return { ok: false, error: '接口没返回图片数据' }
    if (typeof item.b64_json === 'string' && item.b64_json !== '') {
      return { ok: true, dataUrl: 'data:image/png;base64,' + item.b64_json }
    }
    if (typeof item.url === 'string' && item.url !== '') return { ok: true, url: item.url }
    return { ok: false, error: '不认识的返回格式' }
  } catch (error) {
    const msg = String((error && error.message) || error)
    if (/timeout|abort/i.test(msg)) return { ok: false, error: '画太久了（超过 3 分钟），再试一次或者换张少的。' }
    return { ok: false, error: msg }
  }
}

/**
 * 真出视频（Agnes 异步任务）：POST {apiBase}/videos 建任务 → 每 5 秒 GET {host}/agnesapi 轮询，
 * 直到 completed / failed，最长等 10 分钟。返回 { ok, url, videoId, seconds } 或 { ok:false, error }。
 * 参数面向 agnes-video-2.5 家族（mode=text 文生视频；seconds 4~12；size 仅 720P；aspect_ratio 白名单）。
 */
export async function videoGenerate(payload) {
  try {
    const cfg = loadUserConfig()
    const vid = cfg && cfg.video
    let baseUrl = ''
    let key = ''
    let model = ''
    if (vid && vid.src === 'compat' && vid.url && vid.key) {
      baseUrl = String(vid.url)
      key = String(vid.key)
      model = String(vid.model || '')
    } else if (vid && vid.src === 'agnes' && vid.key) {
      baseUrl = AGNES_BUILTIN.baseUrl
      key = String(vid.key)
      model = String(vid.model || 'agnes-video-2.5-flash')
    }
    if (!baseUrl || !key) return { ok: false, error: '还没配「出片成视频」的 Key：去「设置 → AI 大脑 → 出片成视频」填一次。' }
    const prompt = String((payload && payload.prompt) || '').trim()
    if (!prompt) return { ok: false, error: '没给画面描述' }
    if (!model) model = 'agnes-video-2.5-flash'
    const seconds = String(Math.max(4, Math.min(12, parseInt(payload && payload.seconds, 10) || 5)))
    const aspect = String((payload && payload.aspect) || '9:16')
    const base = baseUrl.replace(/\/+$/, '')

    // 1) 建任务
    const createRes = await fetch(base + '/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, prompt, mode: 'text', seconds, size: '720P', aspect_ratio: aspect }),
      signal: AbortSignal.timeout(120000),
    })
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => '')
      // 平台排队/限流：把 JSON 里的 message 提出来给人看（如「视频队列已满，请稍后重试」）
      let friendly = ''
      try {
        const j = JSON.parse(detail)
        if (j && typeof j.message === 'string') friendly = j.message
      } catch (error) {}
      return {
        ok: false,
        error: createRes.status === 401
          ? 'Key 没通过：去「设置 → AI 大脑 → 出片成视频」检查一下。'
          : (friendly || ('建任务被拒：HTTP ' + createRes.status)),
      }
    }
    const created = await createRes.json().catch(() => null)
    const videoId = created && (created.video_id || created.task_id || created.id)
    if (!videoId) return { ok: false, error: '平台没返回任务号：' + JSON.stringify(created || {}).slice(0, 160) }

    // 2) 轮询
    let host = base
    try { host = new URL(base).origin } catch (error) { host = base.replace(/\/v1.*$/, '') }
    const query = host + '/agnesapi'
    const deadline = Date.now() + 600000
    for (;;) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 5000))
      if (Date.now() > deadline) {
        return { ok: false, error: '视频生成超过 10 分钟还在跑：任务留在平台上（任务号 ' + String(videoId) + '），稍后再出这段。', videoId: String(videoId) }
      }
      let data = null
      try {
        const q = await fetch(query + '?video_id=' + encodeURIComponent(String(videoId)) + '&model_name=' + encodeURIComponent(model), {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(30000),
        })
        if (!q.ok) continue
        data = await q.json().catch(() => null)
      } catch (error) {
        continue // 查询抖动：跳过本轮，靠 deadline 兜底
      }
      if (!data) continue
      const status = String(data.status || '').toLowerCase()
      if (status === 'completed') {
        const url = String(data.url || (data.metadata && data.metadata.url) || '')
        if (!url) return { ok: false, error: '生成完成但平台没给视频地址', videoId: String(videoId) }
        return { ok: true, url, videoId: String(videoId), seconds: String(data.seconds || seconds) }
      }
      if (status === 'failed') {
        const err = data.error || (data.metadata && data.metadata.error)
        return {
          ok: false,
          error: '生成失败：' + (typeof err === 'string' ? err : JSON.stringify(err || '无详情')).slice(0, 160),
          videoId: String(videoId),
        }
      }
    }
  } catch (error) {
    const msg = String((error && error.message) || error)
    if (/timeout|abort/i.test(msg)) return { ok: false, error: '等平台响应太久，稍后再试。' }
    return { ok: false, error: msg }
  }
}

async function ensure() {
  if (!harness) {
    const route = resolveRoute()
    if (route.patch) writePatch(route.patch)
    currentRoute = route
    sessionId = makeSessionId()
    harness = new DeepSeekHarness({
      profile: 'sdk',
      provider: route.provider,
      model: route.model,
      // 低思考等级只对 DeepSeek 默认路由设置（Agnes/自定义接口的模型不一定声明该参数，
      // 传了会被拒绝：实测 "does not support reasoning effort"）
      ...(route.provider === 'deepseek-official' ? { reasoningEffort: 'low' } : {}),
      patches: route.patch
        ? [CHAT_PATCH_PATH, PUBLISH_TOOLS_PATCH_PATH, PATCH_PATH]
        : [CHAT_PATCH_PATH, PUBLISH_TOOLS_PATCH_PATH],
      initializeTimeoutMs: 60000,
      env: {
        ...process.env,
        // Electron 主进程的 process.execPath 是 electron.exe：让内核子进程以纯 Node 模式运行
        ELECTRON_RUN_AS_NODE: '1',
        ...route.env,
      },
    })
  }
  return harness
}

/** 预热：初始化握手提前做掉；失败不抛（首次对话走冷启动，照常报错） */
export async function warmUp() {
  try {
    const h = await ensure()
    await h.start()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

/** 关闭内核进程 */
export async function close() {
  const h = harness
  harness = null
  currentRoute = null
  if (h) {
    try {
      await h.close()
    } catch (error) {
      /* 关闭失败不阻塞应用退出：子进程在 stdin EOF 后自行退出 */
    }
  }
}

/**
 * 保存设置页「说话写稿」配置并重建内核：下一条消息按新路由走。
 * 重建会丢当前会话的多轮上下文（换模型=新会话，可接受）。
 */
export async function setModel(config) {
  try {
    const norm = (c) => ({
      src: c && c.src === 'compat' ? 'compat' : 'agnes',
      url: String((c && c.url) || ''),
      key: String((c && c.key) || ''),
      model: String((c && c.model) || ''),
    })
    const safe = {
      chat: norm(config && config.chat),
      image: norm(config && config.image),
      video: norm(config && config.video),
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(safe, null, 2), 'utf8')
    const old = harness
    harness = null
    currentRoute = null
    if (old) {
      try {
        await old.close()
      } catch (error) {
        /* 旧内核回收失败不阻塞新配置生效 */
      }
    }
    const route = resolveRoute()
    // 后台预热新内核：用户说完这句马上就能聊，不用等冷启动（失败不阻塞保存）
    void warmUp().catch(() => {})
    return { ok: true, route: { label: route.label, provider: route.provider, model: route.model } }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
}

/**
 * 从一条 SDK 通知里提取正文增量。
 * 形状以官方协议为准：method=session.event，event.type=assistant/chunk，chunk.type=text-delta。
 * 注：部分厂商网关（如 Agnes，openai-completions）不发 text-delta，
 * 此时增量全程为空，由 run() 的 finalResponse 在回合结束时一次性给出整段。
 */
function assistantDeltaOf(notification) {
  if (!notification || typeof notification !== 'object') return ''
  if (notification.method !== 'session.event') return ''
  const event = notification.params && notification.params.event
  if (!event || event.type !== 'assistant/chunk') return ''
  const chunk = event.data && event.data.chunk
  if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') return chunk.text
  if (chunk && typeof chunk.delta === 'string') return chunk.delta
  return ''
}

/** 从一条 SDK 通知里提取「回合以错误结束」的原始错误信息（turn/end 的 reason.error）。 */
function turnErrorOf(notification) {
  if (!notification || typeof notification !== 'object') return ''
  if (notification.method !== 'session.event') return ''
  const event = notification.params && notification.params.event
  if (!event || event.type !== 'turn/end') return ''
  const reason = event.data && event.data.reason
  if (reason && reason.kind === 'error' && reason.error && typeof reason.error.message === 'string') {
    return reason.error.message
  }
  return ''
}

/**
 * 从 assistant/message 通知里提取「带时间戳的正文增量」（Session v2 的 stream 字段）。
 * 厂商网关（Agnes，openai-completions）不发实时 text-delta，但把模型真实的出字节奏
 * 打包在这一条事件里；按它回放就是模型自己的语速，不是编造的打字机。
 */
function assistantStreamPartsOf(notification) {
  if (!notification || notification.method !== 'session.event') return []
  const event = notification.params && notification.params.event
  if (!event || event.type !== 'assistant/message') return []
  const stream = event.data && event.data.stream
  if (!Array.isArray(stream)) return []
  const parts = []
  let cursor
  for (const item of stream) {
    if (!item) continue
    if (item.type === 'text-chunks' && Array.isArray(item.texts)) {
      let at = typeof item.time0 === 'number' ? item.time0 : cursor ?? 0
      item.texts.forEach((text, index) => {
        if (typeof text !== 'string' || text === '') return
        const gap = Array.isArray(item.dt) && typeof item.dt[index] === 'number' ? item.dt[index] : 0
        at += gap
        parts.push({ text, afterMs: cursor === undefined ? 0 : Math.max(0, at - cursor) })
        cursor = at
      })
    } else if (item.type === 'chunk' && item.chunk && item.chunk.type === 'text-delta' && typeof item.chunk.text === 'string') {
      const at = typeof item.time === 'number' ? item.time : cursor ?? 0
      parts.push({ text: item.chunk.text, afterMs: cursor === undefined ? 0 : Math.max(0, at - cursor) })
      cursor = at
    }
  }
  return parts
}

/** 回放预算：用户已经等过模型一次，不按原速等第二遍（总 2.5s、单帧 ≤120ms、≤120 帧） */
const REPLAY_TOTAL_BUDGET_MS = 2500
const REPLAY_MAX_GAP_MS = 120
const REPLAY_MAX_FRAMES = 120

/** 把真实增量压成回放节拍（文本与顺序一字不动，只压缩等待时间） */
function replayFrames(parts) {
  const usable = parts.filter((p) => p && p.text !== '')
  if (usable.length === 0) return []
  const groupSize = Math.ceil(usable.length / REPLAY_MAX_FRAMES)
  const groups = []
  for (let i = 0; i < usable.length; i += groupSize) {
    const slice = usable.slice(i, i + groupSize)
    groups.push({ text: slice.map((p) => p.text).join(''), afterMs: slice.reduce((t, p) => t + p.afterMs, 0) })
  }
  const totalWait = groups.reduce((t, g) => t + g.afterMs, 0)
  const scale = totalWait > REPLAY_TOTAL_BUDGET_MS ? REPLAY_TOTAL_BUDGET_MS / totalWait : 1
  return groups.map((g, i) => ({
    text: g.text,
    // 首帧不等待：模型已经出完了，第一帧立刻显示
    waitMs: i === 0 ? 0 : Math.max(8, Math.min(REPLAY_MAX_GAP_MS, Math.round(g.afterMs * scale))),
  }))
}

/** 把内核/厂商的技术错误翻成用户能懂的一句话（保留可读的原文备查）。 */
function friendlyError(raw) {
  const text = String(raw || '')
  if (/40[13]|无效的令牌|unauthorized|invalid[^]*?(key|token)|authentication/i.test(text)) {
    return '接口拒绝了这次请求：Key 无效或已过期。到「设置 → AI 大脑」检查一下。'
  }
  if (/402|insufficient|balance|quota|欠费|额度|余额/i.test(text)) {
    return '额度不够了：检查这个账号的余额或套餐。'
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|fetch failed|network|ENOTFOUND/i.test(text)) {
    return '连不上这个接口：检查地址、网络，或服务商是否在维护。'
  }
  return '出错了：' + text.slice(0, 160)
}

/**
 * 把一段用户输入送进内核；返回 { ok, text, streamed } 或 { ok:false, error }。
 * onDelta(text) 在收到增量时逐段回调（可能一次都不调，见 assistantDeltaOf 注释）。
 */
export function ask(text, onDelta, options) {
  const run = queue.then(async () => {
    try {
      const h = await ensure()
      // 多会话：前端传它自己的会话 id（同一内核进程内可复用，上下文各自保留）；
      // copilot 等不传时用默认会话。
      const session = (options && typeof options.sessionId === 'string' && options.sessionId !== '') ? options.sessionId : sessionId
      let streamed = false
      let turnError = ''
      let streamParts = []
      const runner = h.run(CHAT_SYSTEM + '\n\n' + String(text), {
        sessionId: session,
        onNotification: (notification) => {
          const delta = assistantDeltaOf(notification)
          if (delta !== '') {
            streamed = true
            try {
              if (typeof onDelta === 'function') onDelta(delta)
            } catch (error) {
              /* 单个增量回调失败不影响整轮 */
            }
          }
          const parts = assistantStreamPartsOf(notification)
          if (parts.length > 0) streamParts = parts
          const error = turnErrorOf(notification)
          if (error !== '') turnError = error
        },
      })
      // 回合总超时保护（3 分钟；发布等多步任务需要更长的回合）：内核若卡住，不能让聊天永远转圈
      // （用户体感=整个前端没反应）；超时后重置内核，下一轮自动重建。
      const result = await Promise.race([
        runner.catch((error) => ({ __askError: error })),
        new Promise((resolveTimeout) => setTimeout(() => resolveTimeout({ __askTimeout: true }), 180000)),
      ])
      if (result && result.__askTimeout) {
        // 重置也带超时：close 本身若挂住，不能连带把这轮请求永久拖住
        try { await Promise.race([h.close(), new Promise((r) => setTimeout(r, 3000))]) } catch (error) { /* 重置失败也不抛 */ }
        if (harness === h) harness = null
        return { ok: false, error: '内核这次没响应（等超过 3 分钟），我已经把它重启了，再发一次就好。' }
      }
      if (result && result.__askError) throw result.__askError
      const finalText = (result && result.finalResponse) || ''
      // 工具调用泄漏防护：模型偶发把工具调用写成文本（如 DeepSeek 原生 ｜｜DSML｜｜ 标记）——
      // 剥离泄漏段并附明确下一步（诚实提示，绝不装成功）
      let toolLeak = false
      let cleanedText = finalText
      if (/｜｜DSML｜｜|<tool_calls>|<tool▁calls>/.test(finalText)) {
        toolLeak = true
        cleanedText = finalText
          .replace(/<｜｜DSML｜｜[\s\S]*$/, '')
          .replace(/<tool_calls>[\s\S]*$/, '')
          .trim()
      }
      // 回合以错误结束且没有产出正文：如实报错，而不是留一段空白
      if (cleanedText === '' && turnError !== '') {
        return { ok: false, error: friendlyError(turnError), raw: turnError }
      }
      // 厂商不发实时增量时：按模型真实时间戳把整段压成回放节拍（逐字出现，而不是一下蹦出）
      if (cleanedText !== '' && !toolLeak && !streamed && typeof onDelta === 'function') {
        const frames = replayFrames(streamParts)
        for (const frame of frames) {
          if (frame.waitMs > 0) await new Promise((resolveWait) => setTimeout(resolveWait, frame.waitMs))
          try {
            onDelta(frame.text)
          } catch (error) {
            /* 单帧失败不影响整段 */
          }
        }
        streamed = frames.length > 0
      }
      if (toolLeak) {
        const base = cleanedText === '' ? '刚才那步工具调用没有真正执行成功。' : `${cleanedText}\n\n`
        return { ok: true, text: `${base}（那步操作没有真正执行——请对我说「继续」，我重新做一次。）`, streamed }
      }
      return { ok: true, text: cleanedText, streamed }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })
  // 队尾推进：本轮无论成败都不阻塞下一轮
  queue = run.then(
    () => {},
    () => {},
  )
  return run
}

/**
 * 一次性生成任务（创作/选题/分镜等）：独立会话，不入对话上下文。
 * payload: { system?, input }；返回 { ok, text } 或 { ok:false, error }。
 */
export function task(payload) {
  const run = queue.then(async () => {
    try {
      const h = await ensure()
      const system = payload && typeof payload.system === 'string' ? payload.system : ''
      const input = payload && typeof payload.input === 'string' ? payload.input : ''
      if (input.trim() === '') return { ok: false, error: '没给任务内容' }
      const session = 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
      let turnError = ''
      const result = await h.run(system ? system + '\n\n' + input : input, {
        sessionId: session,
        onNotification: (notification) => {
          const error = turnErrorOf(notification)
          if (error !== '') turnError = error
        },
      })
      const text = (result && result.finalResponse) || ''
      if (text === '' && turnError !== '') return { ok: false, error: friendlyError(turnError) }
      return { ok: true, text }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })
  queue = run.then(
    () => {},
    () => {},
  )
  return run
}
