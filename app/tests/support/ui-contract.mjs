// UI 操作控件契约：共享样式改动后，跨页面实测尺寸必须仍然一致。

export const CONTROL_SPECS = {
  regular: { height: 36, radius: 10, paddingX: 14, fontSize: 13, cornerShape: 'superellipse(1.5)' },
  compact: { height: 30, radius: 8, paddingX: 10, fontSize: 12, cornerShape: 'superellipse(1.5)' },
  round: { width: 40, height: 40, radius: 20, cornerShape: 'superellipse(1)' },
  square: { width: 32, height: 32, radius: 8, cornerShape: 'superellipse(1.5)' },
  switch: { width: 44, height: 26, radius: 13, cornerShape: 'superellipse(1)' },
  card: { radius: 16, cornerShape: 'superellipse(1.5)' },
  badge: { height: 24, radius: 999, cornerShape: 'superellipse(1)' },
  input: { height: 36, radius: 10, cornerShape: 'superellipse(1.5)' },
}

const STATE_CLASSES = new Set([
  'active',
  'busy',
  'cancelled',
  'done',
  'failed',
  'folded',
  'free',
  'in',
  'off',
  'ok',
  'on',
  'open',
  'primary',
  'running',
  'sched',
  'show',
  'wait',
  'waiting',
  'warn',
])

export async function inspectPage(frame, page) {
  return frame.evaluate(
    ({ pageName, stateClasses }) => {
      const stateClassSet = new Set(stateClasses)
      if (!document.getElementById('__jco-ui-contract-freeze')) {
        const freeze = document.createElement('style')
        freeze.id = '__jco-ui-contract-freeze'
        freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'
        document.head.appendChild(freeze)
        void document.body.offsetHeight
      }
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
          '.ghost.mini, .tool, .model-pill, .param-chip, .chip, .cp-act, .msg .act, .seg button, .agent-tabs button, .shot .swap',
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
          backgroundColor: style.backgroundColor,
          borderWidth: Number.parseFloat(style.borderTopWidth) || 0,
          cornerShape: style.cornerShape,
          boxShadow: style.boxShadow,
          knobWidth: Number.parseFloat(after.width) || 0,
          knobHeight: Number.parseFloat(after.height) || 0,
          knobBackground: after.backgroundColor,
          knobCornerShape: after.cornerShape,
          knobBoxShadow: after.boxShadow,
          isOn: el.classList.contains('on'),
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

      const rounded = [...document.querySelectorAll('body *')]
        .filter(visible)
        .filter((el) => {
          if (el.classList.contains('ti')) return false
          const style = getComputedStyle(el)
          const radius = Number.parseFloat(style.borderTopLeftRadius) || 0
          return radius > 0 && el.className
        })
        .map((el) => {
          const rect = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          const classes = String(el.className)
            .split(/\s+/)
            .filter((name) => name && !stateClassSet.has(name))
            .sort()
          return {
            page: pageName,
            classes: classes.join('.'),
            tag: el.tagName,
            radius: style.borderTopLeftRadius,
            cornerShape: style.cornerShape,
            height: Math.round(rect.height * 100) / 100,
          }
        })
        .filter((item) => item.classes)

      return { page: pageName, controls, switches, badges, forms, rounded }
    },
    { pageName: page, stateClasses: [...STATE_CLASSES] },
  )
}

function nearly(value, expected, tolerance = 0.75) {
  return Math.abs(Number(value) - expected) <= tolerance
}

export function validateInventory(inventory) {
  const violations = []
  const allControls = []
  const switchStates = {
    on: { backgrounds: new Set(), knobBackgrounds: new Set(), knobShadows: new Set() },
    off: { backgrounds: new Set(), knobBackgrounds: new Set(), knobShadows: new Set() },
  }

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
          !nearly(item.fontSize, spec.fontSize) ||
          item.cornerShape !== spec.cornerShape
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
          !nearly(item.fontSize, spec.fontSize) ||
          item.cornerShape !== spec.cornerShape
        ) {
          violations.push(
            `${item.page}: compact ${item.classes} 实测 ${item.height}h/${item.radius}r/${item.paddingX}px/${item.fontSize}px，期望 ${spec.height}/${spec.radius}/${spec.paddingX}/${spec.fontSize}`,
          )
        }
      }
      if (item.role === 'round') {
        const spec = CONTROL_SPECS.round
        if (
          !nearly(item.width, spec.width) ||
          !nearly(item.height, spec.height) ||
          item.radius < 19.5 ||
          item.cornerShape !== spec.cornerShape
        ) {
          violations.push(`${item.page}: round ${item.classes} 实测 ${item.width}x${item.height}/${item.radius}r`)
        }
      }
      if (item.role === 'square') {
        const spec = CONTROL_SPECS.square
        if (
          !nearly(item.width, spec.width) ||
          !nearly(item.height, spec.height) ||
          !nearly(item.radius, spec.radius) ||
          item.cornerShape !== spec.cornerShape
        ) {
          violations.push(
            `${item.page}: square ${item.classes || item.tag} 实测 ${item.width}x${item.height}/${item.radius}r`,
          )
        }
      }
      if (
        item.role === 'card' &&
        (!nearly(item.radius, CONTROL_SPECS.card.radius) || item.cornerShape !== CONTROL_SPECS.card.cornerShape)
      ) {
        violations.push(`${item.page}: card ${item.classes} 圆角 ${item.radius}，期望 16`)
      }
    }

    for (const item of pageResult.switches) {
      if (
        !nearly(item.width, CONTROL_SPECS.switch.width) ||
        !nearly(item.height, CONTROL_SPECS.switch.height) ||
        item.radius < 12.5 ||
        item.borderWidth !== 0 ||
        item.cornerShape !== CONTROL_SPECS.switch.cornerShape ||
        item.boxShadow !== 'none' ||
        !nearly(item.knobWidth, 22) ||
        !nearly(item.knobHeight, 22) ||
        item.knobCornerShape !== CONTROL_SPECS.switch.cornerShape
      ) {
        violations.push(
          `${item.page}: switch ${item.classes} 实测 ${item.width}x${item.height}/${item.radius}r shadow=${item.boxShadow} knob=${item.knobWidth}x${item.knobHeight}`,
        )
      }
      const state = switchStates[item.isOn ? 'on' : 'off']
      state.backgrounds.add(item.backgroundColor)
      state.knobBackgrounds.add(item.knobBackground)
      state.knobShadows.add(item.knobBoxShadow)
      if (/rgba\([^)]*,\s*0?\.\d+\)/.test(item.backgroundColor) || item.backgroundColor === 'transparent') {
        violations.push(`${item.page}: switch 轨道必须是实色，当前 ${item.backgroundColor}`)
      }
    }

    for (const item of pageResult.badges) {
      if (
        !nearly(item.height, CONTROL_SPECS.badge.height) ||
        item.radius < 12 ||
        item.cornerShape !== CONTROL_SPECS.badge.cornerShape
      ) {
        violations.push(`${item.page}: badge ${item.classes} 实测 ${item.height}h/${item.radius}r`)
      }
    }

    for (const item of pageResult.forms) {
      if (
        !nearly(item.height, CONTROL_SPECS.input.height) ||
        !nearly(item.radius, CONTROL_SPECS.input.radius) ||
        item.cornerShape !== CONTROL_SPECS.input.cornerShape
      ) {
        violations.push(`${item.page}: input ${item.id || item.classes} 实测 ${item.height}h/${item.radius}r`)
      }
    }
  }

  for (const [state, values] of Object.entries(switchStates)) {
    if (values.backgrounds.size > 1) {
      violations.push(`switch ${state} 轨道颜色不统一：${[...values.backgrounds].join(' | ')}`)
    }
    if (values.knobBackgrounds.size > 1) {
      violations.push(`switch ${state} 圆钮颜色不统一：${[...values.knobBackgrounds].join(' | ')}`)
    }
    if (values.knobShadows.size > 1) {
      violations.push(`switch ${state} 圆钮阴影不统一：${[...values.knobShadows].join(' | ')}`)
    }
  }
  const allKnobShadows = new Set([...switchStates.on.knobShadows, ...switchStates.off.knobShadows])
  if (allKnobShadows.size > 1) {
    violations.push(`switch 开/关状态的圆钮阴影不一致：${[...allKnobShadows].join(' | ')}`)
  }

  const roundedGroups = new Map()
  for (const pageResult of inventory) {
    for (const item of pageResult.rounded) {
      const list = roundedGroups.get(item.classes) || []
      list.push(item)
      roundedGroups.set(item.classes, list)
    }
  }
  for (const [classes, items] of roundedGroups) {
    const shapes = new Set(items.map((item) => item.cornerShape))
    if (shapes.size > 1) {
      const examples = items.slice(0, 5).map((item) => `${item.page}:${item.cornerShape}`)
      violations.push(`同名组件轮廓不一致 .${classes}：${examples.join(' | ')}`)
    }
  }

  for (const item of roundedGroups.values()) {
    for (const entry of item) {
      if (entry.classes.startsWith('dsx-')) continue
      const radius = Number.parseFloat(entry.radius) || 0
      const fullyRounded =
        String(entry.radius).includes('50%') || (entry.height > 0 && radius >= entry.height / 2 - 0.5)
      if (fullyRounded && entry.cornerShape !== 'superellipse(1)') {
        violations.push(
          `${entry.page}: 全圆/胶囊组件 .${entry.classes} 轮廓为 ${entry.cornerShape}，应为 superellipse(1)`,
        )
      }
    }
  }

  return { violations, allControls }
}
