/**
 * 技能清单 → 系统提示词注入段（M5 技能库真化）
 *
 * 设计出处（先例调研笔记 §二·1）：Anthropic Agent Skills 的"渐进式披露"第一层——
 * 启动只装轻量元数据（名字 + 描述），正文按需再读。这里就是第一层：
 * 把用户启用的技能渲染成一小段人话，追加进 CHAT_SYSTEM。
 *
 * 诚实红线：注入的是"入口指路"（这些手艺在哪个页面点哪个入口），
 * 不是"你会做"——聊天链路暂时没有这些执行工具，吹牛即违规。
 *
 * 纯函数、零副作用：单测直接 import（bridge.mjs 因有加载副作用不能被测）。
 */
export function buildSkillsSection(items) {
  const on = (Array.isArray(items) ? items : []).filter(
    (s) => s && s.on === true && typeof s.name === 'string' && s.name !== '',
  )
  if (on.length === 0) return ''
  const lines = on.map((s) => {
    const desc = typeof s.desc === 'string' && s.desc !== '' ? s.desc : ''
    const entry = typeof s.entry === 'string' && s.entry !== '' ? s.entry : ''
    const base = desc !== '' ? `${s.name}：${desc}` : s.name
    return entry !== '' ? `- ${base}（入口：${entry}）` : `- ${base}`
  })
  return [
    '【你的技能库】（用户在技能库里启用的手艺；如实说，不夸大）：',
    ...lines,
    '这些技能的执行入口在各自页面（点按钮真跑）；你在聊天里不能直接替用户执行——用户想在聊天里用某技能时，如实告诉他去哪个页面点哪个入口。没启用的手艺不要提。',
  ].join('\n')
}
