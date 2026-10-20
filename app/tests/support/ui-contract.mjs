// UI 操作控件契约：共享样式改动后，跨页面实测尺寸必须仍然一致。

export const CONTROL_SPECS = {
  regular: { height: 36, radius: 10, paddingX: 14, fontSize: 13 },
  compact: { height: 30, radius: 8, paddingX: 10, fontSize: 12 },
  round: { width: 40, height: 40, radius: 20 },
  square: { width: 32, height: 32, radius: 8 },
  switch: { width: 44, height: 26, radius: 13 },
  card: { radius: 16 },
  badge: { height: 24, radius: 999 },
  input: { height: 36, radius: 10 },
}

export async function inspectPage(frame, page) {
  return frame.evaluate((pageName) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      )
    }

    const selectors = {
      round: '.send, .send-big, .cp-send, .copilot-btn, .play-btn, .ib-nav',
      square: '.icon-btn, .side-toggle, .board-close, .cp-fold, .f-eye, .msg-actions button, .star',
      compact:
        '.ghost.mini, .tool, .model-pill, .param-chip, .chip, .cp-act, .msg .act, .seg button, .agent-tabs button',
      regular: '.ghost, .ghost-btn, .btn-ghost, .go-btn, .btn-sm, .use-btn, .export-btn, .tbtn, .pf-add, .regen',
      card: '.card, .tp, .dcard, .draft, .skill, .skl, .ib-thumb, .ib-add, .pf, .staff, .recent-item',
      nav: '.nav-item, .convo, .group-label, .mm-item, .mode-pop button, .me, .convo-more',
      link: '.linkbtn, .notice',
    }

    function roleOf(el) {
      if (el.matches('.tg')) return 'switch'
      if (el.matches(selectors.round)) return 'round'
      if (el.matches(selectors.square) || el.closest('.msg-actions')) return 'square'
      if (el.matches(selectors.compact) || el.closest('.seg') || el.closest('.agent-tabs')) {
        return 'compact'
      }
      if (el.matches(selectors.regular)) return 'regular'
      if (el.matches(selectors.card)) return 'card'
      if (el.matches('.tab') || el.closest('.tabs')) return 'tab'
      if (el.matches(selectors.nav)) return 'nav'
      if (el.matches(selectors.link)) return 'link'
      return 'unclassified'
    }

    function metric(el, role) {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      const after = getComputedStyle(el, '::after')
      const [padTop = 0, padRight = 0, padBottom = 0, padLeft = 0] = style.padding
        .split(/\s+/)
        .map((value) => Number.parseFloat(value) || 0)
      return {
        page: pageName,
        role,
        tag: el.tagName,
        id: el.id || '',
        classes: String(el.className || ''),
        text: String(el.innerText || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 60),
        ariaLabel: el.getAttribute('aria-label') || '',
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
        paddingX: Math.max(padLeft, padRight),
        paddingY: Math.max(padTop, padBottom),
        fontSize: Number.parseFloat(style.fontSize) || 0,
        boxShadow: style.boxShadow,
        knobWidth: Number.parseFloat(after.width) || 0,
        knobHeight: Number.parseFloat(after.height) || 0,
      }
    }

    const controls = [...document.querySelectorAll('button, [role="button"], a.card')]
      .filter(visible)
      .map((el) => metric(el, roleOf(el)))

    const switches = [...document.querySelectorAll('.tg')].filter(visible).map((el) => metric(el, 'switch'))

    const badges = [
      ...document.querySelectorAll(
        '.badge, .tag, .s-badge, .tk-badge, .sk-tag, .kind-badge, .stage, .planrow .ps, .brain-badge, .conn-badge, .b-role',
      ),
    ]
      .filter(visible)
      .map((el) => metric(el, 'badge'))

    const forms = [...document.querySelectorAll('input.inp, #titleInp, #tagInp, #descInp')]
      .filter(visible)
      .map((el) => metric(el, 'input'))

    return { controls, switches, badges, forms }
  }, page)
}

function nearly(value, expected, tolerance = 0.75) {
  return Math.abs(Number(value) - expected) <= tolerance
}

export function validateInventory(inventory) {
  const violations = []
  const allControls = []

  for (const pageResult of inventory) {
    allControls.push(...pageResult.controls)
    for (const item of pageResult.controls) {
      if (item.role === 'unclassified') {
        violations.push(`${item.page}: 未分类按钮 ${item.tag}.${item.classes || '(无类名)'} "${item.text}"`)
        continue
      }
      if (item.role === 'regular') {
        const spec = CONTROL_SPECS.regular
        if (
          !nearly(item.height, spec.height) ||
          !nearly(item.radius, spec.radius) ||
          !nearly(item.paddingX, spec.paddingX) ||
          !nearly(item.fontSize, spec.fontSize)
        ) {
          violations.push(
            `${item.page}: regular ${item.classes} 实测 ${item.height}h/${item.radius}r/${item.paddingX}px/${item.fontSize}px，期望 ${spec.height}/${spec.radius}/${spec.paddingX}/${spec.fontSize}`,
          )
        }
      }
      if (item.role === 'compact') {
        const spec = CONTROL_SPECS.compact
        if (
          !nearly(item.height, spec.height) ||
          !nearly(item.radius, spec.radius) ||
          !nearly(item.paddingX, spec.paddingX) ||
          !nearly(item.fontSize, spec.fontSize)
        ) {
          violations.push(
            `${item.page}: compact ${item.classes} 实测 ${item.height}h/${item.radius}r/${item.paddingX}px/${item.fontSize}px，期望 ${spec.height}/${spec.radius}/${spec.paddingX}/${spec.fontSize}`,
          )
        }
      }
      if (item.role === 'round') {
        const spec = CONTROL_SPECS.round
        if (!nearly(item.width, spec.width) || !nearly(item.height, spec.height) || item.radius < 19.5) {
          violations.push(`${item.page}: round ${item.classes} 实测 ${item.width}x${item.height}/${item.radius}r`)
        }
      }
      if (item.role === 'square') {
        const spec = CONTROL_SPECS.square
        if (!nearly(item.width, spec.width) || !nearly(item.height, spec.height) || !nearly(item.radius, spec.radius)) {
          violations.push(
            `${item.page}: square ${item.classes || item.tag} 实测 ${item.width}x${item.height}/${item.radius}r`,
          )
        }
      }
      if (item.role === 'card' && !nearly(item.radius, CONTROL_SPECS.card.radius)) {
        violations.push(`${item.page}: card ${item.classes} 圆角 ${item.radius}，期望 16`)
      }
    }

    for (const item of pageResult.switches) {
      if (
        !nearly(item.width, CONTROL_SPECS.switch.width) ||
        !nearly(item.height, CONTROL_SPECS.switch.height) ||
        item.radius < 12.5 ||
        item.boxShadow !== 'none' ||
        !nearly(item.knobWidth, 22) ||
        !nearly(item.knobHeight, 22)
      ) {
        violations.push(
          `${item.page}: switch ${item.classes} 实测 ${item.width}x${item.height}/${item.radius}r shadow=${item.boxShadow} knob=${item.knobWidth}x${item.knobHeight}`,
        )
      }
    }

    for (const item of pageResult.badges) {
      if (!nearly(item.height, CONTROL_SPECS.badge.height) || item.radius < 12) {
        violations.push(`${item.page}: badge ${item.classes} 实测 ${item.height}h/${item.radius}r`)
      }
    }

    for (const item of pageResult.forms) {
      if (!nearly(item.height, CONTROL_SPECS.input.height) || !nearly(item.radius, CONTROL_SPECS.input.radius)) {
        violations.push(`${item.page}: input ${item.id || item.classes} 实测 ${item.height}h/${item.radius}r`)
      }
    }
  }

  return { violations, allControls }
}
