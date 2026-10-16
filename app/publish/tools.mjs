// J.Co 发布引擎 · AI 操作工具集（AI 的"手"）
// 设计依据：《AI 员工方法论与系统提示词规范》《AI 安全与数据安全规范》
// 原则：白名单 + 原子化 + 最小权限。
// 红线：本文件不提供"发布 / 删除 / 支付"类能力，也没有"执行任意代码"的能力——
//       AI 再被诱导，能用的也只有下面 TOOLS 里这些。
import { resolve } from 'node:path'

/** 白名单工具清单——增删必须过"安全评审清单"（见《AI 安全与数据安全规范》） */
export const TOOLS = Object.freeze([
  'open_page',
  'snapshot',
  'click',
  'type_text',
  'upload_file',
  'scroll',
  'screenshot',
  'wait',
])

const WAIT_MAX_MS = 10_000

/** URL 是否在允许的域名白名单内（AI 只许在指定平台域名里活动） */
export function isAllowedUrl(url, allowedDomains) {
  try {
    const parsed = new URL(String(url))
    if (!/^https?:$/.test(parsed.protocol)) return false
    return (allowedDomains || []).some((d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/** 页面快照：AI 的"眼睛"——可见可交互元素（打上引用编号 data-jco-ref）+ 主要标题 */
export async function snapshot(page) {
  return await page.evaluate(() => {
    document.querySelectorAll('[data-jco-ref]').forEach((el) => {
      el.removeAttribute('data-jco-ref')
    })
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
    }
    const selector =
      'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="switch"], [role="combobox"], [role="textbox"], [role="radio"], [role="checkbox"], label'
    const elements = []
    let ref = 0
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.top + window.scrollY < -200) continue // 视口上方远处的不收（快照聚焦"当前可见区 + 下方"）
      ref += 1
      el.setAttribute('data-jco-ref', String(ref))
      elements.push({
        ref,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || undefined,
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        aria: el.getAttribute('aria-label') || undefined,
        editable: el.isContentEditable || undefined,
        checked: el.checked === true || undefined,
        y: Math.round(r.top + window.scrollY),
      })
    }
    const headings = [...document.querySelectorAll('h1, h2, h3, h4')]
      .filter(visible)
      .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50))
      .filter(Boolean)
      .slice(0, 30)
    return {
      url: location.href,
      title: document.title,
      scrollY: Math.round(window.scrollY),
      pageHeight: document.body.scrollHeight,
      headings,
      elements,
    }
  })
}

/** 按快照引用点击（Playwright 真实鼠标事件 + 自动滚动 + 可操作性检查） */
export async function click(page, ref) {
  await page.locator(`[data-jco-ref="${Number(ref)}"]`).click({ timeout: 15_000 })
}

/** 按快照引用输入文字（对 contenteditable 逐字键入，更像人） */
export async function typeText(page, ref, text) {
  const locator = page.locator(`[data-jco-ref="${Number(ref)}"]`)
  const editable = await locator.evaluate((el) => el.isContentEditable)
  if (editable) {
    await locator.click()
    await page.keyboard.type(String(text), { delay: 20 })
  } else {
    await locator.fill(String(text))
  }
}

/** 上传文件（给 file input） */
export async function uploadFile(page, ref, filePath) {
  await page.locator(`[data-jco-ref="${Number(ref)}"]`).setInputFiles(resolve(String(filePath)))
}

/** 滚动（down / up / top / bottom） */
export async function scroll(page, direction = 'down') {
  await page.evaluate((dir) => {
    const step = Math.round(window.innerHeight * 0.8)
    if (dir === 'up') window.scrollBy(0, -step)
    else if (dir === 'top') window.scrollTo(0, 0)
    else if (dir === 'bottom') window.scrollTo(0, document.body.scrollHeight)
    else window.scrollBy(0, step)
  }, String(direction))
}

/** 截图（调用方负责传入本机诊断目录内的路径） */
export async function screenshot(page, filePath) {
  await page.screenshot({ path: resolve(String(filePath)) })
}

/** 等待（上限 10 秒；安全：不允许无限等待） */
export async function wait(page, ms) {
  const capped = Math.min(Math.max(0, Number(ms) || 0), WAIT_MAX_MS)
  await page.waitForTimeout(capped)
}

/** 打开页面（域名白名单强制；白名单外的地址一律拒开） */
export async function openPage(page, url, allowedDomains) {
  if (!isAllowedUrl(url, allowedDomains)) {
    throw new Error(`不许打开白名单以外的地址：${String(url)}`)
  }
  await page.goto(String(url), { waitUntil: 'domcontentloaded', timeout: 60_000 })
}

/** 工具名 → 实现 的映射（测试会断言：这里与 TOOLS 恰好一一对应，不多不少） */
export const IMPLEMENTATIONS = Object.freeze({
  open_page: openPage,
  snapshot,
  click,
  type_text: typeText,
  upload_file: uploadFile,
  scroll,
  screenshot,
  wait,
})
