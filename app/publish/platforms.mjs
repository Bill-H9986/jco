// J.Co 发布平台表（单一来源）——会话服务用它取域名白名单；发布页/主进程按 id 引用
// 侦察记录（2026-10-16 未登录态实测）见 docs/plans/M1-发布工作流/平台接入档案.md
export const PLATFORMS = {
  douyin: {
    name: '抖音',
    domains: ['douyin.com'],
    publishUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    hint: '封面有横竖两个上传位，可直接各传一张图（也可点"选择封面"开弹窗用默认帧）。',
  },
  shipinhao: {
    name: '视频号',
    domains: ['weixin.qq.com', 'qq.com'],
    publishUrl: 'https://channels.weixin.qq.com/platform/post/create',
    hint: '未登录会跳 channels.weixin.qq.com/login.html（微信扫码）；登录后回到发布页继续。',
  },
  xiaohongshu: {
    name: '小红书',
    domains: ['xiaohongshu.com'],
    publishUrl: 'https://creator.xiaohongshu.com/publish/publish',
    hint: '未登录会跳创作者平台登录页（短信登录）；登录后回到发布页继续。',
  },
  bilibili: {
    name: 'B站',
    domains: ['bilibili.com'],
    publishUrl: 'https://member.bilibili.com/platform/upload/video/frame',
    hint: '创作中心投稿页；未登录可能弹登录框。',
  },
  kuaishou: {
    name: '快手',
    domains: ['kuaishou.com'],
    publishUrl: 'https://cp.kuaishou.com/article/publish/video',
    hint: '创作者服务平台；未登录页有"立即登录"。',
  },
}

export function domainsOf(platformId) {
  const conf = PLATFORMS[platformId]
  return conf ? conf.domains : []
}
