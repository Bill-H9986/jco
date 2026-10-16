/**
 * M6 自动任务调度器（主进程侧核心）
 *
 * 依赖注入（主进程接线时提供文件读写与执行器；这里只做调度决策与记录编排）：
 * - getTasks()：读 auto-tasks.json → 任务数组
 * - getRuns()：读 auto-runs.json → { [taskId]: RunRecord }
 * - saveRun(taskId, record)：写执行记录
 * - execute(task, due)：真执行（起浏览器会话 → bridge.ask → 等完成）；返回 { ok, summary }
 * - notify(task, result)：系统通知
 *
 * 行为（与设计冻结包一致）：
 * - 每分钟 tick；到点/补跑由 shouldRun（纯函数，已单测）决定；同任务同一时刻只跑一次；
 * - 执行是长跑（几分钟）：fire-and-forget，不阻塞下一个 tick；running 集合防重入；
 * - lastRunAt 在执行**完成后**记录（中途崩了重启会重跑一次——任务幂等可接受，且记录更诚实）；
 * - 启动后立刻 tick 一次（"应用刚开"的补跑语义）。
 */
import { shouldRun } from './auto-schedule.mjs'

const DEFAULT_INTERVAL_MS = 60 * 1000
const SUMMARY_MAX = 140

export function createAutoScheduler(deps) {
  const getTasks = deps.getTasks
  const getRuns = deps.getRuns
  const saveRun = deps.saveRun
  const execute = deps.execute
  const notify = deps.notify
  const now = typeof deps.now === 'function' ? deps.now : Date.now
  const intervalMs = typeof deps.intervalMs === 'number' ? deps.intervalMs : DEFAULT_INTERVAL_MS

  const running = new Set()
  let timer = null

  function brief(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim()
    return s.length > SUMMARY_MAX ? s.slice(0, SUMMARY_MAX) + '…' : s
  }

  async function tick() {
    let tasks = []
    let runs = {}
    try {
      tasks = getTasks() || []
      runs = getRuns() || {}
    } catch (error) {
      return // 数据读不到：本轮跳过（下一分钟再试），绝不打挂心跳
    }
    for (const task of tasks) {
      if (!task || typeof task !== 'object' || task.on !== true) continue
      if (running.has(task.id)) continue
      const due = shouldRun(task, now(), runs[task.id] && runs[task.id].lastRunAt)
      if (due === null) continue
      running.add(task.id)
      // fire-and-forget：执行长跑不阻塞本 tick 的其它任务
      Promise.resolve()
        .then(() => execute(task, due))
        .then((result) => {
          const ok = Boolean(result && result.ok)
          const record = {
            lastRunAt: now(),
            dueAt: due,
            ok,
            summary: brief((result && result.summary) || (ok ? '跑完了' : '没跑成')),
          }
          saveRun(task.id, record)
          try {
            notify(task, record)
          } catch (error) {
            /* 通知失败不影响记录 */
          }
        })
        .catch((error) => {
          const message = String((error && error.message) || error)
          const record = { lastRunAt: now(), dueAt: due, ok: false, summary: brief('调度出错：' + message) }
          try {
            saveRun(task.id, record)
          } catch (saveError) {
            /* 记录失败也不影响心跳 */
          }
          try {
            notify(task, record)
          } catch (notifyError) {
            /* 忽略 */
          }
        })
        .finally(() => {
          running.delete(task.id)
        })
    }
  }

  function start() {
    if (timer) return
    timer = setInterval(() => {
      tick().catch(() => {})
    }, intervalMs)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { start, stop, tick }
}
