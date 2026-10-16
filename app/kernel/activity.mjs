/**
 * 活动事件解析（M5 员工实时状态）
 *
 * 从内核通知（session.event）里提取"干活痕迹"，归一化成界面层能用的活动事件：
 * - tool/call   → { kind:'tool', phase:'call', callId, tool }      模型点了哪个工具
 * - tool/result → { kind:'tool', phase:'result', callId, isError } 工具干完（成败）
 * - turn/start  → { kind:'turn', phase:'start' }                   一轮开始
 * - turn/end    → { kind:'turn', phase:'end' }                     一轮结束
 *
 * 纪律：不转发工具参数（arguments 可能含路径/文字等细节，界面层不需要）；
 * 无关事件与畸形输入一律返回 null（解析器必须永不抛错——它跑在每一条内核通知上）。
 *
 * 独立成模块（而不是塞进 bridge.mjs）：bridge 模块加载时会写补丁文件，
 * 不适合被单测直接 import；这里保持零副作用、纯函数。
 */
export function activityOf(notification) {
  if (!notification || typeof notification !== 'object') return null
  if (notification.method !== 'session.event') return null
  const event = notification.params && notification.params.event
  if (!event || typeof event !== 'object') return null
  const data = event.data && typeof event.data === 'object' ? event.data : {}

  if (event.type === 'tool/call') {
    return {
      kind: 'tool',
      phase: 'call',
      callId: String(data.callId || ''),
      tool: String(data.name || ''),
    }
  }
  if (event.type === 'tool/result') {
    const message = data.message && typeof data.message === 'object' ? data.message : {}
    return {
      kind: 'tool',
      phase: 'result',
      callId: String(message.toolCallId || ''),
      isError: Boolean(message.isError || data.error),
    }
  }
  if (event.type === 'turn/start') return { kind: 'turn', phase: 'start' }
  if (event.type === 'turn/end') return { kind: 'turn', phase: 'end' }
  return null
}

/**
 * 运行中任务的"过程行"文本（M7 批 1a–5 对抗审查 R1：任务视图实时反馈）。
 * 输入活动事件（activityOf 的产物），输出一句人话；不适用的事件返回 null。
 * 纪律：不携带任何工具参数；未知工具用工具名兜底（不假装知道它在干什么之外的细节）。
 */
const TOOL_TEXT = {
  jco_open_page: '打开页面',
  jco_snapshot: '看清页面上的元素',
  jco_click: '点按一处',
  jco_type_text: '输入文字',
  jco_upload_file: '上传文件',
  jco_scroll: '翻找位置',
  jco_screenshot: '截图确认效果',
  jco_wait: '等页面就绪',
  jco_save_report: '把战报存到本机',
  jco_save_comments: '把评论存到本机',
}
export function liveLineOf(activity) {
  if (!activity || typeof activity !== 'object') return null
  if (activity.kind === 'tool' && activity.phase === 'call') {
    const tool = String(activity.tool || '')
    const phrase = TOOL_TEXT[tool] || (tool ? '操作 ' + tool : '操作')
    return '正在' + phrase
  }
  if (activity.kind === 'turn' && activity.phase === 'start') return '开始干活'
  return null
}
