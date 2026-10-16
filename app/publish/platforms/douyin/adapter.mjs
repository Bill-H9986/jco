// 抖音适配包（第一个平台适配）——各平台差别全部收在这里
// 契约（已冻结）：导出恰好 5 个方法 open / detectLogin / uploadVideo / fillMeta / waitForReady。
// 红线：不得实现"点击发布"的任何能力。
import { SEL } from './selectors.mjs'

const PUBLISH_URL = 'https://creator.douyin.com/creator-micro/content/upload'

export async function open(page) {
  await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 55000 })
}

export async function detectLogin(page) {
  const verdict = await Promise.race([
    page
      .waitForSelector(SEL.uploadInput, { timeout: 5000 })
      .then(() => 'logged_in')
      .catch(() => null),
    page
      .waitForSelector(SEL.loginMarker, { timeout: 5000 })
      .then(() => 'need_login')
      .catch(() => null),
  ])
  // 不确定时按"未登录"处理（引擎会保持等待并提示扫码）
  return verdict === 'logged_in' ? 'logged_in' : 'need_login'
}

export async function uploadVideo(page, filePath, onProgress) {
  const input = await page.waitForSelector(SEL.uploadInput, { timeout: 30000 })
  if (typeof onProgress === 'function') onProgress('0%')
  await input.setInputFiles(filePath)
  // 等待上传完成信号（超时由引擎兜底）
  await page.waitForSelector(SEL.uploadDone, { timeout: 4 * 60 * 1000 }).catch(() => {
    const error = new Error('等待上传完成超时')
    error.code = 'UPLOAD_FAILED'
    throw error
  })
  if (typeof onProgress === 'function') onProgress('100%')
}

export async function fillMeta(page, { title, topics }) {
  const text = [title, ...(topics || [])].filter(Boolean).join(' ')
  const box = await page.waitForSelector(SEL.descInput, { timeout: 30000 }).catch(() => {
    const error = new Error('找不到标题输入框')
    error.code = 'PAGE_CHANGED'
    throw error
  })
  await box.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await box.type(text, { delay: 25 })
}

export async function waitForReady(page) {
  // 判定"已到达发布前"：发布按钮已出现（可见性即就绪；永不点击）
  await page.waitForSelector(SEL.publishButton, { timeout: 60000 }).catch(() => {
    const error = new Error('没找到发布按钮（页面可能改版）')
    error.code = 'PAGE_CHANGED'
    throw error
  })
}
