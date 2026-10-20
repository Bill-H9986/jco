// 静态检查：页面内联样式不得再次定义共享操作控件的尺寸和形状。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const PRODUCT_DIR = path.resolve(APP_DIR, '..', '设计原型')
const CONTROL_CLASSES = new Set([
  'ghost',
  'ghost-btn',
  'btn-ghost',
  'go-btn',
  'btn-sm',
  'use-btn',
  'export-btn',
  'tbtn',
  'pf-add',
  'regen',
  'send',
  'send-big',
  'cp-send',
  'copilot-btn',
  'play-btn',
  'icon-btn',
  'side-toggle',
  'board-close',
  'cp-fold',
  'f-eye',
  'star',
  'tool',
  'model-pill',
  'param-chip',
  'chip',
  'tg',
])

const violations = []
for (const file of fs.readdirSync(PRODUCT_DIR).filter((name) => name.endsWith('.html'))) {
  const source = fs.readFileSync(path.join(PRODUCT_DIR, file), 'utf8')
  if (!source.includes('./assets/jco-ui.css')) {
    violations.push(`${file}: 未引用共享 jco-ui.css`)
  }
  for (const styleBlock of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const rule of styleBlock[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim()
      const tokens = [...selector.matchAll(/\.([a-z0-9-]+)/gi)].map((match) => match[1])
      if (!tokens.some((token) => CONTROL_CLASSES.has(token))) continue
      const declarations = rule[2]
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
      for (const declaration of declarations) {
        const [property, rawValue = ''] = declaration.split(':', 2).map((part) => part.trim())
        const value = rawValue.toLowerCase()
        if (
          property === 'height' ||
          property === 'min-height' ||
          property === 'padding' ||
          property === 'border-radius'
        ) {
          violations.push(`${file}: ${selector} 不得改写 ${property}`)
        }
        if (property === 'width' && value !== '100%' && value !== 'auto') {
          violations.push(`${file}: ${selector} 不得改写固定宽度 ${rawValue}`)
        }
        if (selector.includes('.tg') && property === 'box-shadow' && value !== 'none') {
          violations.push(`${file}: .tg 不得增加页面级阴影`)
        }
      }
    }
  }
}

if (violations.length) {
  console.error(`UI 样式来源违规 ${violations.length} 项：`)
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log('✅ 页面未重复定义共享操作控件的尺寸和形状')
