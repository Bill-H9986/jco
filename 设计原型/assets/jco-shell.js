// J.Co 共享外壳（M7 前端统一第一步）
// 职责：①唯一导航映射（全站一份）②页面切换过渡（消白屏硬切）③侧栏折叠徽章（防"像没了"）
//       ④历史折叠偏好一次性重置（全部展开）
// 所有页面在 <head> 的 jco-ui.css 之后引用本文件；页面内重复的导航逻辑逐步退休。
(function () {
  'use strict'
  var PAGES = {
    总管: 'J.Co总管.html',
    选题: 'J.Co工作台-选题.html',
    素材: 'J.Co工作台-素材.html',
    文案: 'J.Co工作台-创作.html',
    创作: 'J.Co工作台-做视频.html',
    后期: 'J.Co工作台-后期.html',
    发布: 'J.Co工作台-发布.html',
    运营: 'J.Co工作台-运营.html',
    管家团队: 'J.Co管家团队.html',
    账号中心: 'J.Co账号中心.html',
    设置: 'J.Co设置.html',
    自动任务: 'J.Co自动任务.html',
    技能库: 'J.Co技能库.html',
  }

  // 0) 过渡样式（页面淡入 / 切换淡出）
  try {
    var style = document.createElement('style')
    style.textContent =
      'body{opacity:0;transition:opacity .13s ease}body.shell-ready{opacity:1}body.shell-leaving{opacity:0}' +
      // 折叠计数徽章：纯 CSS 伪元素（不改变 label.textContent，避免污染折叠逻辑的分组名）
      '.group-label.folded::after{content:attr(data-count);margin-left:6px;font-size:11px;line-height:1;padding:2px 6px;border-radius:999px;background:var(--tint,#eee);color:var(--text-3,#888);font-weight:400}'
    document.head.appendChild(style)
  } catch (err) {}

  function ready() {
    try {
      document.body.classList.add('shell-ready')
    } catch (err) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready)
  else ready()
  window.addEventListener('load', ready)

  // 1) 统一接管侧栏导航（捕获阶段）：淡出 → 跳转
  var leaving = false
  document.addEventListener(
    'click',
    function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.nav-item') : null
      if (!item) return
      var target = PAGES[item.textContent.trim()]
      if (!target) return
      var here = decodeURIComponent(location.pathname.split('/').pop())
      if (target === here) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (leaving) return
      leaving = true
      try {
        document.body.classList.add('shell-leaving')
      } catch (err) {}
      setTimeout(function () {
        location.href = target
      }, 110)
    },
    true,
  )

  // 2) 折叠徽章：折叠的组在标签上显示条目数（防"看起来像没有了"）
  function decorate() {
    document.querySelectorAll('.group-label').forEach(function (label) {
      var count = 0
      var el = label.nextElementSibling
      while (el && !el.classList.contains('group-label')) {
        if (el.classList.contains('nav-item')) count++
        else if (el.classList.contains('convos')) count += el.querySelectorAll('.convo').length
        el = el.nextElementSibling
      }
      label.setAttribute('data-count', String(count))
    })
  }
  function redecorate() {
    setTimeout(decorate, 0)
    setTimeout(decorate, 120)
  }
  document.addEventListener(
    'click',
    function (e) {
      if (e.target && e.target.closest && e.target.closest('.group-label')) redecorate()
    },
    true,
  )
  // 3) 侧栏统一：非总管页注入「任务」「对话」两区（结构与总管页同款；点击跳总管对应内容）
  function bindFold(label, box) {
    label.classList.toggle('foldable', true)
    label.addEventListener('click', function () {
      var hide = box.style.display !== 'none'
      box.style.display = hide ? 'none' : ''
      label.classList.toggle('folded', hide)
      redecorate()
    })
  }
  function groupLabel(icon, text) {
    var label = document.createElement('button')
    label.className = 'group-label'
    label.type = 'button'
    label.innerHTML = '<span class="ti ' + icon + '"></span>' + text + '<span class="ti ti-chevron-down"></span>'
    return label
  }
  function injectSidebarLists() {
    try {
      if (document.getElementById('taskList')) return // 总管页自带同款区块
      var inner = document.querySelector('.sidebar-inner')
      if (!inner) return
      var foot = inner.querySelector('.side-foot')
      // 任务
      var taskLabel = groupLabel('ti-clock-hour-3', '任务')
      var taskBox = document.createElement('div')
      taskBox.className = 'convos'
      taskBox.id = 'taskList'
      inner.insertBefore(taskLabel, foot)
      inner.insertBefore(taskBox, foot)
      bindFold(taskLabel, taskBox)
      var tasksApi = window.jco && window.jco.tasks && window.jco.tasks.sessions ? window.jco.tasks : null
      if (tasksApi) {
        tasksApi
          .sessions()
          .then(function (r) {
            var list = (r && r.tasks) || []
            if (!list.length) {
              taskBox.innerHTML = '<div style="padding:6px 10px;font-size:12.5px;color:var(--text-3)">还没有派出去的任务</div>'
              return
            }
            list.slice(0, 6).forEach(function (t) {
              var b = document.createElement('button')
              b.className = 'convo'
              b.innerHTML = '<span class="name"></span>'
              b.querySelector('.name').textContent = t.name + ' ' + (t.state === 'done' ? '✓' : t.state === 'failed' ? '✗' : '…')
              b.addEventListener('click', function () {
                try {
                  sessionStorage.setItem('jco-open-task', t.id)
                } catch (e) {}
                location.href = 'J.Co总管.html'
              })
              taskBox.appendChild(b)
            })
          })
          .catch(function () {})
      }
      // 对话：接管页面已有的 .convos（静态示例容器；页面若自带渲染也写这里，最终以本次渲染为准，不产生两段列表）
      var chatBox = inner.querySelector('.convos:not(#taskList)')
      if (!chatBox) {
        var chatLabel = groupLabel('ti-messages', '对话')
        chatBox = document.createElement('div')
        chatBox.className = 'convos'
        inner.insertBefore(chatLabel, foot)
        inner.insertBefore(chatBox, foot)
        bindFold(chatLabel, chatBox)
      }
      chatBox.innerHTML = ''
      try {
        var d = JSON.parse(localStorage.getItem('jco-chats-v1') || 'null')
        var chats = (d && d.chats) || []
        // 与总管页同一清理口径：空会话只留当前这一个（跨页列表条数一致）
        chats = chats.filter(function (c) {
          return (c.messages && c.messages.length > 0) || c.id === d.activeId
        })
        if (!chats.length) chatBox.innerHTML = '<div style="padding:6px 10px;font-size:12.5px;color:var(--text-3)">还没有对话</div>'
        chats.slice(0, 6).forEach(function (c) {
          var b = document.createElement('button')
          b.className = 'convo'
          b.innerHTML = '<span class="name"></span>'
          b.querySelector('.name').textContent = c.title || '新会话'
          b.addEventListener('click', function () {
            try {
              sessionStorage.setItem('jco-open-chat', c.id)
            } catch (e) {}
            location.href = 'J.Co总管.html'
          })
          chatBox.appendChild(b)
        })
      } catch (e) {}
    } catch (e) {}
  }
  function init() {
    injectSidebarLists()
    decorate()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // 3) 历史折叠偏好一次性重置：全部展开（产品负责人反馈"工具板块像没了"）
  try {
    if (!localStorage.getItem('jco-shell-reset-v2')) {
      localStorage.removeItem('jco-sidebar-folded-groups')
      localStorage.setItem('jco-shell-reset-v2', '1')
    }
  } catch (err) {}
})()
