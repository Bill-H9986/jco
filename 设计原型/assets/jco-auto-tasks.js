/**
 * J.Co 自动任务表（M6 · 单一事实源：localStorage jco-tasks-v1 为准，本文件是其数据模型）
 *
 * - DEFAULTS：出厂 4 条"真能跑"的任务（旧演示数据"对标雷达"是做不到的活，已替换）；
 * - migrate()：老数据/乱数据 → 规范任务（解析旧 when 文案成结构化 schedule；乱格式回退；
 *   缺失 createdAt 盖章"此刻"：升级/装机首启不立刻补跑，从下一个计划时刻开始）；
 * - makeSchedule(label)：新建表单四档频率 → 结构化时间；
 * - whenText(schedule)：结构化时间 → 展示文案（迁移与渲染共用一个来源）。
 *
 * 时间语义出处：内核 dsh-schedule（"每个重复任务只补发最近一次错过的发生时点"）；
 * 调度判定在 app/kernel/auto-schedule.mjs（主进程侧）。
 * 本文件同时供浏览器（window.JCO_AUTO_TASKS）与单测（module.exports）使用。
 */
(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.JCO_AUTO_TASKS = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  var DEFAULTS = [
    { id: 't1', name: '今日战报', desc: '去抖音创作者中心取今天的战报，存好给我看', when: '每天 09:00', icon: 'ti-chart-bar', on: true,
      schedule: { kind: 'daily', time: '09:00' } },
    { id: 't2', name: '评论自动跟进', desc: '扫一遍抖音评论，拟好回复等我放行', when: '每天 12:00', icon: 'ti-message-dots', on: true,
      schedule: { kind: 'daily', time: '12:00' } },
    { id: 't3', name: '晚间发布检查', desc: '到点提醒我确认今晚的发布', when: '每天 19:20', icon: 'ti-bell', on: true,
      schedule: { kind: 'daily', time: '19:20' } },
    { id: 't4', name: '每周数据周报', desc: '汇总上周播放和涨粉，写成一页纸', when: '每周一 10:00', icon: 'ti-chart-bar', on: false,
      schedule: { kind: 'weekly', weekday: 1, time: '10:00' } },
  ]

  var CN_WEEKDAY = ['一', '二', '三', '四', '五', '六', '日'] // weekday: ISO 1..7

  function copyItem(def) {
    var item = {}
    for (var k in def) {
      if (!Object.prototype.hasOwnProperty.call(def, k)) continue
      var v = def[k]
      item[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v
    }
    return item
  }

  function validTime(time) {
    return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  }

  function validSchedule(s) {
    if (!s || typeof s !== 'object') return false
    if (s.kind === 'daily') return validTime(s.time)
    if (s.kind === 'weekly') return validTime(s.time) && Number.isInteger(s.weekday) && s.weekday >= 1 && s.weekday <= 7
    return false
  }

  /** 结构化时间 → 展示文案（"每天 09:00" / "每周五 20:00"） */
  function whenText(schedule) {
    if (!validSchedule(schedule)) return '每天 09:00'
    if (schedule.kind === 'weekly') return '每周' + CN_WEEKDAY[schedule.weekday - 1] + ' ' + schedule.time
    return '每天 ' + schedule.time
  }

  /** 旧 when 文案 → 结构化时间（解析不了返回 null） */
  function parseWhen(when) {
    var s = String(when || '').trim()
    var m = /^每天\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(s)
    if (m) return { kind: 'daily', time: m[1] + ':' + m[2] }
    m = /^每天早上\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(s)
    if (m) return { kind: 'daily', time: m[1] + ':' + m[2] }
    m = /^每天傍晚\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(s)
    if (m) return { kind: 'daily', time: m[1] + ':' + m[2] }
    m = /^每周([一二三四五六日])\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(s)
    if (m) return { kind: 'weekly', weekday: CN_WEEKDAY.indexOf(m[1]) + 1, time: m[2] + ':' + m[3] }
    return null
  }

  /** 新建表单四档频率 → { schedule, when } */
  function makeSchedule(label) {
    var map = {
      daily: { kind: 'daily', time: '09:00' },
      morning: { kind: 'daily', time: '08:30' },
      evening: { kind: 'daily', time: '18:30' },
      weekly: { kind: 'weekly', weekday: 1, time: '10:00' },
    }
    var schedule = map[label] || map.daily
    return { schedule: schedule, when: whenText(schedule) }
  }

  /**
   * 老数据/乱数据 → 规范任务数组。
   * 规则：无存储/空 → DEFAULTS；"对标雷达"（做不到的活）→ 换成"今日战报"（保留 id 与开关）；
   * 其余项内容保留、补 schedule/when/createdAt；非法项过滤。
   */
  function migrate(items) {
    if (!Array.isArray(items) || items.length === 0) return DEFAULTS.map(function (d) { return stamp(copyItem(d)) })
    var out = []
    items.forEach(function (t) {
      if (!t || typeof t !== 'object' || typeof t.name !== 'string' || t.name.trim() === '') return
      if (t.name === '对标雷达') {
        var bullet = copyItem(DEFAULTS[0])
        bullet.id = String(t.id || bullet.id)
        bullet.on = t.on !== false
        out.push(stamp(bullet))
        return
      }
      var item = {
        id: String(t.id || ('t' + Math.random().toString(36).slice(2, 8))),
        name: String(t.name).trim().slice(0, 60),
        desc: String(t.desc || '').slice(0, 300),
        icon: String(t.icon || 'ti-sparkles'),
        on: t.on !== false,
        createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
      }
      item.schedule = validSchedule(t.schedule) ? copyItem(t.schedule) : (parseWhen(t.when) || { kind: 'daily', time: '09:00' })
      item.when = whenText(item.schedule)
      out.push(item)
    })
    return out.length > 0 ? out : DEFAULTS.map(function (d) { return stamp(copyItem(d)) })
  }

  function stamp(item) {
    if (typeof item.createdAt !== 'number') item.createdAt = Date.now()
    if (!validSchedule(item.schedule)) item.schedule = { kind: 'daily', time: '09:00' }
    item.when = whenText(item.schedule)
    return item
  }

  return { DEFAULTS: DEFAULTS, migrate: migrate, makeSchedule: makeSchedule, whenText: whenText }
})
