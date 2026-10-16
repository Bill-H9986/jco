/**
 * M6 自动任务 · 调度判定（纯函数，可单测）
 *
 * 时间语义抄内核 @deepseek-ai/dsh-schedule（官方文档）：
 * "宿主重启后任务仍然可用，每个重复任务只补发最近一次错过的发生时点"。
 * 我们用本机系统时区（v1 取舍；内核支持显式 IANA 时区，我们暂不引入）。
 *
 * 一把覆盖三种场景：
 *   - 到点跑：now 刚过计划时刻、该时刻没跑过；
 *   - 启动补跑：now 晚于计划时刻（应用刚开）、该时刻没跑过、还在补跑窗口内；
 *   - 去重：lastRunAt 已覆盖最近一次计划时刻 → 不跑。
 *
 * 以及一条防呆：due 早于任务创建时间（createdAt）→ 不补（新任务不追旧账，
 * 例如 20:00 新建"每天傍晚 18:30"的任务，不该马上补跑今天 18:30 那次）。
 *
 * 纪律：解析失败一律返回 null / 不抛错——它跑在每分钟的心跳上，绝不能被畸形数据打挂。
 */

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAILY_WINDOW_MS = 24 * HOUR_MS
const WEEKLY_WINDOW_MS = 72 * HOUR_MS

/** 'HH:mm' → { h, m }；畸形返回 null */
function parseTime(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return { h, m: mi }
}

/**
 * 最近一个 <= now 的计划时刻（毫秒）；规则不识别返回 null。
 * 注：以"天"为步长回退使用固定 24h——中国无夏令时，v1 适用。
 */
export function recentDueAt(schedule, now) {
  if (!schedule || typeof schedule !== 'object') return null
  const t = parseTime(schedule.time)
  if (!t) return null
  const d = new Date(now)

  if (schedule.kind === 'daily') {
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m, 0, 0).getTime()
    return today <= now ? today : today - DAY_MS
  }

  if (schedule.kind === 'weekly') {
    const weekday = Number(schedule.weekday)
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null
    const isoToday = ((d.getDay() + 6) % 7) + 1 // 周一=1 .. 周日=7
    const base = new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m, 0, 0).getTime()
    let cand = base - ((isoToday - weekday + 7) % 7) * DAY_MS // 本周（含今天）的匹配日
    if (cand > now) cand -= 7 * DAY_MS // 还没到 → 上周
    return cand
  }

  return null
}

/**
 * 该不该跑：返回应跑的计划时刻（ms）或 null。
 * @param task { schedule, createdAt? }
 */
export function shouldRun(task, now, lastRunAt) {
  if (!task || typeof task !== 'object') return null
  const due = recentDueAt(task.schedule, now)
  if (due === null) return null
  const created = Number(task.createdAt || 0)
  if (due < created) return null // 建任务之前的时刻不补（防呆）
  if (lastRunAt && due <= lastRunAt) return null // 这一次已经跑过
  const windowMs = task.schedule.kind === 'weekly' ? WEEKLY_WINDOW_MS : DAILY_WINDOW_MS
  if (now - due > windowMs) return null // 错过太久：跳过（只补最近一次，且不能无限远）
  return due
}
