#!/usr/bin/env node
/**
 * 全站一致性审计（M7 收编 · 进 gate）
 *
 * 防的就是"只改一页、忘掉全站"的蠢问题（2026-10-16 教训：新会话按钮只改了总管页）。
 * 双检查：
 *   A. 组件矩阵：15 个内容页 × 公共组件/功能块 逐项核对——任何一页缺项即失败；
 *      应用壳单独做“常驻壳”检查（iframe / 首页 / 任务会话刷新 / 通知回壳）；
 *   B. 产品目录干净：设计原型/ 只允许页面（*.html）与 assets/——验证副本/临时文件一律放开发工作区。
 *
 * 豁免（写明白理由，不静默放过）：
 *  - J.Co设计系统.html：设计物料样张，不是应用页；
 *  - 助手浮球：设计分层——干活页有、总览/管理页（总管/首页/账号中心/设置）没有。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..') // J.Co 工程根
const UI = path.join(ROOT, '设计原型')

const PAGES = [
  'J.Co总管.html',
  'J.Co主界面-首页.html',
  'J.Co工作台-选题.html',
  'J.Co工作台-素材.html',
  'J.Co工作台-创作.html',
  'J.Co工作台-做视频.html',
  'J.Co工作台-后期.html',
  'J.Co工作台-发布.html',
  'J.Co工作台-运营.html',
  'J.Co自动任务.html',
  'J.Co技能库.html',
  'J.Co管家团队.html',
  'J.Co账号中心.html',
  'J.Co设置.html',
  'J.Co设计系统.html',
]
const MATERIAL_PAGE = 'J.Co设计系统.html' // 物料样张豁免
const SHELL_PAGE = 'J.Co应用壳.html'
const COPILOT_ALLOWED_MISSING = new Set([
  'J.Co总管.html', // 聊天本体
  'J.Co主界面-首页.html', // 总览
  'J.Co账号中心.html', // 管理
  'J.Co设置.html', // 管理
  MATERIAL_PAGE,
])
// 按页豁免（写明白理由，不静默放过）：
// 总管页的会话数据由页面自身初始化（chatsLoad），按钮不依赖外部数据 → 无需"常驻"补丁
const PER_PAGE_EXEMPT = {
  'J.Co总管.html': ['新会话按钮常驻（数据缺失也渲染）'],
}

// 应用壳不是内容页：检查它是否真的是“唯一外壳”，而不是再抄一套内容页组件。
const SHELL_CHECKS = [
  ['内容 iframe', /id="jcoFrame"/],
  ['首页入口', /data-page="J\.Co主界面-首页\.html"/],
  ['新会话入口', /id="newChatSlot"/],
  ['侧栏导航', /class="nav-item"/],
  ['通知入口', /id="bellBtn"/],
  ['通知回壳钩子', /__jcoOpenTaskById/],
]
const SHELL_JS_CHECKS = [
  ['任务/会话刷新', /function refreshSidebarLists/],
  ['任务列表读取', /jco\.tasks\.sessions|tasksApi\.sessions\(\)/],
  ['任务事件订阅', /onTask/],
  ['刷新钩子', /__refreshJcoSidebar/],
]

// [键, 说明, 正则, 期望出现]
const CHECKS = [
  ['搜索框', /<div class="search">/],
  ['新会话容器（顶部）', /id="newChatSlot"/],
  ['新会话挂载顶部容器（JS）', /getElementById\('newChatSlot'\)/],
  ['新会话按钮常驻（数据缺失也渲染）', /数据缺失也渲染/],
  ['固定展开按钮', /class="side-toggle"/],
  ['对话列表容器', /<div class="convos/],
  ['侧栏底部（用户区）', /class="side-foot"/],
  ['侧栏固定逻辑（JS）', /side-pinned/],
  ['分组折叠（JS）', /sidebar-folded-groups/],
  ['跨页开新会话（JS）', /jco-open-chat/],
  ['会话菜单（JS）', /function showMenu\(|function jcoShowConvMenu\(/],
  ['会话分享', /分享对话/],
  ['会话重命名', /convo-rename/],
  ['提示条函数', /function (showToast|toast)\(/],
]

let failed = false
const missingPerPage = []

// —— A. 组件矩阵 ——
for (const page of PAGES) {
  const src = readFileSync(path.join(UI, page), 'utf8')
  const missing = []
  for (const [label, re] of CHECKS) {
    if (!re.test(src) && !(PER_PAGE_EXEMPT[page] || []).includes(label)) missing.push(label)
  }
  if (page !== MATERIAL_PAGE && !/class="copilot-btn"/.test(src) && !COPILOT_ALLOWED_MISSING.has(page))
    missing.push('助手浮球')
  // 内联不得重复定义共享样式（防止旧样式覆盖共享件）
  for (const [label, re] of [
    ['内联 .convo 样式（应走共享）', /\n {2}\.convo\s*\{|\n\.convo\s*\{/],
    ['内联 .search 样式（应走共享）', /\n {2}\.search\s*\{|\n\.search\s*\{/],
    ['内联 .newchat 样式（应走共享）', /\.newchat\s*\{/],
  ]) {
    if (re.test(src)) missing.push(label)
  }
  if (missing.length > 0) {
    // 物料页只豁免"应用组件"，样式重复定义仍要报
    const real = page === MATERIAL_PAGE ? missing.filter((m) => m.includes('内联')) : missing
    if (real.length > 0) {
      failed = true
      missingPerPage.push('  ❌ ' + page + ' 缺少：' + real.join('、'))
    }
  }
}

// —— A2. 设计系统与产品组件同源（W4-05） ——
const sharedCss = readFileSync(path.join(UI, 'assets', 'jco-ui.css'), 'utf8')
const materialSrc = readFileSync(path.join(UI, MATERIAL_PAGE), 'utf8')
const productSources = {
  master: readFileSync(path.join(UI, 'J.Co总管.html'), 'utf8'),
  shell: readFileSync(path.join(UI, SHELL_PAGE), 'utf8'),
  auto: readFileSync(path.join(UI, 'J.Co自动任务.html'), 'utf8'),
  skills: readFileSync(path.join(UI, 'J.Co技能库.html'), 'utf8'),
  team: readFileSync(path.join(UI, 'J.Co管家团队.html'), 'utf8'),
}
const DESIGN_CHECKS = [
  ['共享消息样式', /\.msg\.user \.bubble\s*\{/.test(sharedCss) && /\.msg\.ai \.bubble\s*\{/.test(sharedCss)],
  ['共享任务卡样式', /\.task-card\s*\{/.test(sharedCss)],
  ['共享任务状态样式', /\.tv-status\.waiting\s*\{/.test(sharedCss)],
  ['共享员工状态样式', /\.s-badge\.busy\s*\{/.test(sharedCss)],
  ['设计系统消息样例', /id="dsMessages"/.test(materialSrc)],
  ['设计系统任务卡样例', /id="dsTaskCard"/.test(materialSrc)],
  ['设计系统状态样例', /id="dsTaskStates"/.test(materialSrc) && /id="dsStaffStates"/.test(materialSrc)],
  ['设计系统消息渲染器', /assets\/message\.js/.test(materialSrc)],
  ['总管不再重画消息样式', !/\n\.msg\.user\s*\{/.test(productSources.master)],
  ['应用壳不再重画任务状态样式', !/\n\s*\.tv-status\s*\{/.test(productSources.shell)],
  [
    '状态页不再重画员工徽标样式',
    !/\n\.s-badge\s*\{/.test(productSources.auto) &&
      !/\n\.s-badge\s*\{/.test(productSources.skills) &&
      !/\n\.s-badge\s*\{/.test(productSources.team),
  ],
]
const designMissing = DESIGN_CHECKS.filter(([, ok]) => !ok).map(([label]) => label)
if (designMissing.length > 0) failed = true

// —— B. 产品目录干净 ——
const junk = []
for (const name of readdirSync(UI)) {
  const full = path.join(UI, name)
  const isDir = statSync(full).isDirectory()
  if (isDir) {
    if (name !== 'assets') junk.push(name + '/（应只在 assets 下）')
    continue
  }
  if (name.startsWith('.') || !name.endsWith('.html')) junk.push(name)
}
if (junk.length > 0) {
  failed = true
}

// —— C. 应用壳常驻检查 ——
const shellMissing = []
const shellSrc = readFileSync(path.join(UI, SHELL_PAGE), 'utf8')
const shellJs = readFileSync(path.join(UI, 'assets', 'jco-shell.js'), 'utf8')
for (const [label, re] of SHELL_CHECKS) {
  if (!re.test(shellSrc)) shellMissing.push(label)
}
for (const [label, re] of SHELL_JS_CHECKS) {
  if (!re.test(shellJs)) shellMissing.push(label)
}
if (shellMissing.length > 0) failed = true

console.log('===== 全站一致性审计（机器门）=====')
console.log('页面矩阵：' + PAGES.length + ' 页 × ' + (CHECKS.length + 4) + ' 项检查')
console.log(
  designMissing.length > 0
    ? '  ❌ 设计系统与产品组件不同源：' + designMissing.join('、')
    : '  ✅ 设计系统消息 / 任务卡 / 状态 / 表单样例与产品组件同源',
)
if (missingPerPage.length > 0) {
  console.log('组件分叉：')
  for (const line of missingPerPage) console.log(line)
} else {
  console.log(
    '  ✅ 组件矩阵无分叉（豁免：设计系统物料页；助手浮球按设计分层：' +
      [...COPILOT_ALLOWED_MISSING].length +
      ' 页不上）',
  )
}
if (junk.length > 0) {
  console.log('  ❌ 产品目录不干净（设计原型/ 只许 *.html 与 assets/）：')
  for (const j of junk) console.log('     · ' + j)
} else {
  console.log('  ✅ 产品目录干净（设计原型/ 仅页面 + assets/）')
}
console.log(
  shellMissing.length > 0
    ? '  ❌ 应用壳缺少：' + shellMissing.join('、')
    : '  ✅ 应用壳常驻检查通过（iframe / 首页 / 任务会话刷新 / 通知回壳）',
)
console.log(failed ? '❌ 审计未通过' : '✅ 审计通过')
process.exit(failed ? 1 : 0)
