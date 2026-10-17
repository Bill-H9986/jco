// J.Co 发布引擎 · AI 操作工具集（AI 的"手"）
// 设计依据：《AI 员工方法论与系统提示词规范》《AI 安全与数据安全规范》
// 原则：白名单 + 原子化 + 最小权限。
// 红线：工具集不提供"发布 / 删除 / 支付"专用能力；通用 click 另做目标拦截，
//       不能把安全只交给提示词。
import { extname, resolve } from 'node:path'

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

/** 数据提交工具（非页面操作；由会话服务写本机数据文件，供运营页读取）——
 *  安全评审：只写本机、无外部副作用；全集（TOOLS + DATA_TOOLS）无危险动作词汇（测试守着）。 */
export const DATA_TOOLS = Object.freeze(['save_report', 'save_comments'])

const WAIT_MAX_MS = 10_000

/** 不可逆 / 高风险点击目标：即使页面把按钮给了 AI，也不允许通用 click 点下去。 */
const DANGEROUS_CLICK_TEXT = /发布|删除|移除|注销|解绑|支付|购买|确认订单|提交订单/

/** 只允许上传媒体文件，避免模型被诱导把任意本机文件传上平台。 */
export const ALLOWED_UPLOAD_EXTS = Object.freeze(
  new Set([
    '.mp4',
    '.mov',
    '.m4v',
    '.mkv',
    '.webm',
    '.avi',
    '.mp3',
    '.m4a',
    '.wav',
    '.aac',
    '.flac',
    '.ogg',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.bmp',
    '.gif',
  ]),
)

/** 返回拒绝原因；空串表示允许点击。 */
export function clickGuardReason(label) {
  const text = String(label || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') return ''
  if (DANGEROUS_CLICK_TEXT.test(text)) {
    return `为了安全，不能点击「${text.slice(0, 40)}」：发布 / 删除 / 支付类动作必须由用户亲手完成。`
  }
  return ''
}

/** 上传文件扩展名白名单（大小写不敏感）。 */
export function isAllowedUploadPath(filePath) {
  return ALLOWED_UPLOAD_EXTS.has(extname(String(filePath || '')).toLowerCase())
}

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
    // 隐藏的文件选择控件：单独列出（上传文件的直路——即使不可见，也值得 AI 知道）
    for (const el of document.querySelectorAll('input[type="file"]')) {
      if (visible(el)) continue
      ref += 1
      el.setAttribute('data-jco-ref', String(ref))
      elements.push({ ref, tag: 'input', type: 'file', hidden: true, y: -1 })
    }
    elements.sort((a, b) => a.y - b.y)
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
  const locator = page.locator(`[data-jco-ref="${Number(ref)}"]`)
  const label = await locator.evaluate((el) =>
    [el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  const reason = clickGuardReason(label)
  if (reason !== '') throw new Error(reason)
  await locator.click({ timeout: 8_000 })
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

/** 上传文件（两种真人模式）：
 *  - ref 指向真的 <input type=file>：直接选定文件；
 *  - ref 指向按钮等其它元素：点击它，并拦截系统"文件选择"对话框，把文件递给对话框。 */
export async function uploadFile(page, ref, filePath) {
  const locator = page.locator(`[data-jco-ref="${Number(ref)}"]`)
  const file = resolve(String(filePath))
  if (!isAllowedUploadPath(file)) {
    throw new Error('只允许上传视频、音频或图片文件；其他类型的本机文件不能交给 AI 上传。')
  }
  const isFileInput = await locator.evaluate(
    (el) => el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'file',
  )
  if (isFileInput) {
    await locator.setInputFiles(file)
    return
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), locator.click()])
  await chooser.setFiles(file)
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
