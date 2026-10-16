/**
 * J.Co 技能表（全站单一事实源，M5）
 *
 * 技能库页是"编辑入口"（开关真存 localStorage jco-skills-v1），
 * 做视频页的技能排、以及注入 AI 的"手艺清单"都从这一份数据来：
 * - merge(local)：按 id 合并用户开关——已存在项以用户为准，新项按默认补入；
 * - makeVideoSkills(items)：做视频页要显示的（scenes 含 make-video 且已启用）。
 *
 * 来源说明：s1–s12 原样来自《J.Co技能库.html》定稿；s13–s16 原样来自
 * 《J.Co工作台-做视频.html》正在用的技能排（本次统一进技能库，消灭两套数据）。
 * 本文件同时供浏览器（window.JCO_SKILLS）与单测（module.exports）使用。
 */
(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.JCO_SKILLS = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  var DEFAULTS = [
    // —— 技能库定稿 12 项（s1–s12）——
    { id: 's1', name: '爆款复刻', desc: '拆爆款的结构、换成你的内容，照着跑', kind: 'video', icon: 'ti-flame', on: true,
      scenes: ['make-video'], entry: '做视频页 →「爆款复刻」',
      action: { icon: 'ti-repeat', fill: '帮我复刻这条爆款视频，链接：', method: 't2v', toast: '把爆款链接粘在后面就行，AI 拆它的结构，做你的内容' } },
    { id: 's2', name: '数字人口播', desc: '一段音色样本，数字人替你出镜说话', kind: 'video', icon: 'ti-microphone', on: true,
      scenes: ['make-video'], entry: '做视频页 →「数字人口播」',
      action: { icon: 'ti-users-group', fill: '用数字人把这份稿子讲出来，帮我选个合适的形象', method: 'assemble', toast: '数字人口播：AI 选形象、配音、出成片' } },
    { id: 's3', name: '智能换背景', desc: '口播素材换任意场景背景，不用绿幕', kind: 'video', icon: 'ti-photo', on: true,
      scenes: ['make-video'], entry: '做视频页 →「智能换背景」',
      action: { icon: 'ti-wand', fill: '把这张图的背景换成：', method: 'i2v', toast: '换背景：抠图 + 新背景 + 光影处理' } },
    { id: 's4', name: '一镜到底', desc: '一个长镜头讲完故事，几乎不用剪', kind: 'video', icon: 'ti-video', on: true,
      scenes: ['make-video'], entry: '做视频页 →「一镜到底」',
      action: { fill: '把这张图做成连续运镜、一镜到底的短视频', method: 'i2v', toast: '一镜到底：一张图延展出连续运镜' } },
    { id: 's5', name: '长视频拆条', desc: '一条长视频拆成 5 条短视频', kind: 'video', icon: 'ti-copy', on: false,
      scenes: [], entry: '（还没接入，先别答应用户）' },
    { id: 's6', name: '学员故事收集', desc: '从素材库找对口的画面，成一条故事片', kind: 'video', icon: 'ti-users-group', on: false,
      scenes: [], entry: '（还没接入，先别答应用户）' },
    { id: 's7', name: '封面设计', desc: '一次出三套封面方案，挑一套就用', kind: 'graphic', icon: 'ti-photo-video', on: true,
      scenes: [], entry: '发布页 →「生成封面图」' },
    { id: 's8', name: '标题工厂', desc: '一组内容，三种风格的标题候选', kind: 'graphic', icon: 'ti-file-text', on: true,
      scenes: [], entry: '聊天里直接说（你现在就能出标题）' },
    { id: 's9', name: '评论回复官', desc: '评论先拟稿，你点头才发出去', kind: 'social', icon: 'ti-message-dots', on: true,
      scenes: [], entry: '运营页 →「取评论」' },
    { id: 's10', name: '私信引导', desc: '问价的评论，自动给一段私信话术', kind: 'social', icon: 'ti-at', on: false,
      scenes: [], entry: '（还没接入，先别答应用户）' },
    { id: 's11', name: '话题雷达', desc: '热点话题和对标话题，发之前看一眼', kind: 'data', icon: 'ti-search', on: true,
      scenes: [], entry: '（还没接入，先别答应用户）' },
    { id: 's12', name: '周报生成器', desc: '每周数据汇成一页纸，发给谁都能看', kind: 'data', icon: 'ti-chart-bar', on: true,
      scenes: [], entry: '（还没接入，先别答应用户）' },
    // —— 做视频页（侧栏「创作」）在用的 4 项（s13–s16），本次统一进技能库 ——
    { id: 's13', name: '照片会说话', desc: '让静态照片开口念稿，像真人一样说话', kind: 'video', icon: 'ti-photo', on: true,
      scenes: ['make-video'], entry: '做视频页 →「照片会说话」',
      action: { fill: '让这张照片开口说话，念这段稿子：', method: 'i2v', toast: '从素材里选照片，让它像真人一样开口' } },
    { id: 's14', name: '图片设计', desc: '给稿子配图或封面，一次出几张挑着用', kind: 'graphic', icon: 'ti-photo-video', on: true,
      scenes: ['make-video'], entry: '做视频页 →「图片设计」',
      action: { fill: '帮我出几张配图，风格：', type: 'image', toast: '已切到做图模式，说说要什么风格的图' } },
    { id: 's15', name: '长视频', desc: '整条片子拉到 3 分钟，分段生成自动拼接', kind: 'video', icon: 'ti-movie', on: true,
      scenes: ['make-video'], entry: '做视频页 →「长视频」',
      action: { fill: '', type: 'video', duration: '3 分钟', toast: '已把时长调到 3 分钟：长视频由 AI 分段生成、自动拼接' } },
    { id: 's16', name: '我自己出镜念', desc: '你对着提词器念，拍完传回来接着做', kind: 'video', icon: 'ti-device-mobile', on: true,
      scenes: ['make-video'], entry: '做视频页 →「我自己出镜念」',
      action: { fill: '', method: 'shoot', toast: '（原型示意）正式版会打开提词器，你拍完传回来 AI 帮你剪' } },
  ]

  /** 深拷贝一项（防页面改动污染 DEFAULTS 里的 action 对象） */
  function copyItem(def) {
    var item = {}
    for (var k in def) {
      if (!Object.prototype.hasOwnProperty.call(def, k)) continue
      var v = def[k]
      item[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v
    }
    return item
  }

  /**
   * 按 id 合并：共享表是权威清单（名称/描述以表为准），
   * 本地存的只有"开关状态"说话——已存在的项沿用本地 on，新项按默认补入。
   */
  function merge(localItems) {
    var local = Array.isArray(localItems) ? localItems : []
    var byId = {}
    local.forEach(function (x) {
      if (x && typeof x.id === 'string' && x.id !== '') byId[x.id] = x
    })
    return DEFAULTS.map(function (def) {
      var item = copyItem(def)
      var mine = byId[def.id]
      if (mine && typeof mine.on === 'boolean') item.on = mine.on
      return item
    })
  }

  /** 做视频页技能排：scenes 含 make-video 且已启用 */
  function makeVideoSkills(items) {
    var list = Array.isArray(items) ? items : []
    return list.filter(function (s) {
      return s && s.on === true && Array.isArray(s.scenes) && s.scenes.indexOf('make-video') !== -1
    })
  }

  return { DEFAULTS: DEFAULTS, merge: merge, makeVideoSkills: makeVideoSkills }
})
