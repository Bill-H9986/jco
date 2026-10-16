// J.Co 发布工具插件（内核侧"瘦代理"）
// 8 个工具 → POST 本机会话服务（endpoint/token 动态读 sessionFile，不重启内核）
// 设计依据：docs/plans/M1-发布工作流/先例调研与设计-工具接内核.md
// 安全：只连 127.0.0.1 回环；不接触任何凭据；无发布/删除类能力。
import { readFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'jco-publish-tools'
export const inject = ['tools']

function readSession(config) {
  try {
    const data = JSON.parse(readFileSync(config.sessionFile, 'utf8'))
    if (data && data.endpoint && data.token) return data
    return null
  } catch {
    return null
  }
}

async function callTool(config, tool, args) {
  const session = readSession(config)
  if (!session) {
    return '没有活跃的发布会话：请先在 J.Co 里启动「发布会话」，再使用发布工具。'
  }
  try {
    const response = await fetch(`${session.endpoint}/tool`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ name: tool, args }),
      signal: AbortSignal.timeout(60000),
    })
    const data = await response.json()
    if (!data.ok) return `工具执行失败：${data.error || '未知错误'}`
    return typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
  } catch (error) {
    return `无法连接发布会话服务：${String((error && error.message) || error)}`
  }
}

export function apply(ctx, config) {
  const host = { sessionFile: String((config && config.sessionFile) || '') }
  const define = (toolName, description, parameters, forwardName) => {
    ctx.tools.register(
      defineTool({
        name: toolName,
        description,
        parameters,
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute(args) {
          return await callTool(host, forwardName, args || {})
        },
      }),
    )
  }

  define(
    'jco_open_page',
    '在发布会话的浏览器里打开一个网址（仅限白名单域名，如 douyin.com 及其子域）。' +
      '用法：开始发布任务时用它打开平台发布页。例：jco_open_page("https://creator.douyin.com/creator-micro/content/upload")。' +
      '注意：会直接跳转，不保留当前页面历史。仅用于发布任务，不要用于其他聊天场景。',
    {
      url: { type: 'string', required: true, description: '要打开的完整网址（https:// 开头，白名单域名内）' },
    },
    'open_page',
  )

  define(
    'jco_snapshot',
    '抓取当前页面快照：所有可交互元素的编号清单（每项有 ref 编号、类型、文字）。' +
      '用法：每次点击/输入之前先调用它拿到最新编号；页面变化（跳转、弹窗出现、上传完成）之后必须重新调用。' +
      '返回的 ref 编号是 jco_click / jco_type_text / jco_upload_file 的参数。',
    {},
    'snapshot',
  )

  define(
    'jco_click',
    '点击快照里的一个元素（用 ref 编号指定）。' +
      '用法：先 jco_snapshot 拿编号，再传入。例：jco_click(12)。' +
      '如果点击没生效或元素不在视野里，先 jco_scroll 再重新 jco_snapshot。',
    {
      ref: { type: 'number', required: true, description: '快照编号（最近一次 jco_snapshot 返回的 ref 值）' },
    },
    'click',
  )

  define(
    'jco_type_text',
    '向快照里的一个输入元素输入文字（自动清空原有内容；对富文本框逐字键入，更像真人）。' +
      '用法：先 jco_snapshot 找到输入框编号。例：jco_type_text(5, "今天的主题")。',
    {
      ref: { type: 'number', required: true, description: '快照编号（指向 input / textarea / 可编辑区域）' },
      text: { type: 'string', required: true, description: '要输入的完整文字' },
    },
    'type_text',
  )

  define(
    'jco_upload_file',
    '上传本机文件（如视频、图片）。两种目标都支持：① 快照里带"隐藏的文件选择控件"标记的元素（首选，直路）；' +
      '② "上传视频"之类的按钮（工具会自动处理随之弹出的文件选择对话框，像真人一样）。' +
      '例：jco_upload_file(3, "C:/Users/me/video.mp4")。',
    {
      ref: { type: 'number', required: true, description: '快照编号（指向文件选择控件）' },
      file_path: {
        type: 'string',
        required: true,
        description: '本机文件的绝对路径（Windows 用正斜杠或双反斜杠均可）',
      },
    },
    'upload_file',
  )

  define(
    'jco_scroll',
    '滚动页面。用法：要找的元素不在快照清单里（在屏幕外）时，滚动后再 jco_snapshot。',
    {
      direction: {
        type: 'string',
        description: '滚动方向：down（向下，默认）/ up / top（回顶部）/ bottom（到底部）',
      },
    },
    'scroll',
  )

  define(
    'jco_screenshot',
    '给当前页面截图并存到本机（诊断用）。一般在排查"页面看起来不对"时使用，返回截图文件路径。',
    {},
    'screenshot',
  )

  define(
    'jco_wait',
    '等待若干毫秒（最多 10000）。用法：页面加载慢、等待上传进度变化时短暂等待，然后再 jco_snapshot 看新状态。',
    {
      ms: { type: 'number', required: true, description: '等待毫秒数（上限 10000）' },
    },
    'wait',
  )

  define(
    'jco_save_report',
    '把战报数据保存到本机（运营页展示用）。用法：打开平台创作者中心数据页、看清近 7 天数据后调用。' +
      '例：jco_save_report({"views": 5234, "fans": 41, "comments": 8}, "播放回升，主要是开头「3 步」留住了人")。',
    {
      metrics: {
        type: 'object',
        required: true,
        description: '指标对象（如 views 播放 / fans 新增粉丝 / comments 评论）',
      },
      note: { type: 'string', description: '一句话解读（可选）' },
    },
    'save_report',
  )

  define(
    'jco_save_comments',
    '把评论与拟稿保存到本机（运营页供用户过目）。每条：{id, author, text, draft}。' +
      '红线：用户点头之后才执行回复；本工具只负责"存草稿"。',
    {
      items: { type: 'array', required: true, description: '评论数组（最多 50 条）；draft 为拟好的回复稿' },
    },
    'save_comments',
  )
}
