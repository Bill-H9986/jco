// 抖音页面选择器 —— 全平台唯一的收口处（页面改版只改本文件）
// ⚠️ v1 初版为合理初值，M2 真机校准步骤会逐项核对更新（校准记录随里程碑存档）。
export const SEL = {
  // 上传控件（已登录的创作页会有 file input）
  uploadInput: 'input[type="file"]',
  // 未登录标志（扫码登录相关文案/控件）
  loginMarker: 'text=扫码登录',
  // 上传完成信号
  uploadDone: 'text=上传成功',
  // 作品描述输入区（富文本）
  descInput: 'div[contenteditable="true"]',
  // "发布"按钮 —— 仅用于"已就绪"判定；任何代码永不点击它（红线）
  publishButton: 'button:has-text("发布")',
}
