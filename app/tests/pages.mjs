// 设计原型页面清单（单一来源：单元测试与 E2E 测试共用）
export const SHELL_PAGE = 'J.Co应用壳.html'

export const PAGES = [
  'J.Co主界面-首页.html',
  'J.Co总管.html',
  'J.Co工作台-选题.html',
  'J.Co工作台-素材.html',
  'J.Co工作台-创作.html',
  'J.Co工作台-做视频.html',
  'J.Co工作台-后期.html',
  'J.Co工作台-发布.html',
  'J.Co工作台-运营.html',
  'J.Co管家团队.html',
  'J.Co技能库.html',
  'J.Co自动任务.html',
  'J.Co账号中心.html',
  'J.Co设置.html',
  'J.Co设计系统.html',
]

// 全站巡检范围：唯一应用壳 + 15 个内容页（14 个业务页 + 设计系统页）。
export const ALL_PAGES = [SHELL_PAGE, ...PAGES]
