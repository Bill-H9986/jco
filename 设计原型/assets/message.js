/**
 * 消息渲染：把模型文本安全地渲染成段落、列表、代码块和少量行内格式。
 *
 * 约束：
 * - 先转义 HTML，再把极小的 Markdown 子集转成 DOM，绝不直接执行模型返回的 HTML；
 * - 只支持 http/https 链接；
 * - 不做消息截断，长文本由调用方按需滚动或虚拟化。
 */
(function () {
  'use strict'

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function inline(text) {
    var value = escapeHtml(text)
    value = value.replace(/`([^`]+)`/g, '<code>$1</code>')
    value = value.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (_all, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noreferrer noopener">' + label + '</a>'
    })
    return value
  }

  function mdToHtml(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')
    var html = []
    var paragraph = []
    var listType = ''
    var listItems = []
    var codeLines = []
    var inCode = false
    var codeLang = ''

    function flushParagraph() {
      if (!paragraph.length) return
      html.push('<p>' + paragraph.map(inline).join('<br>') + '</p>')
      paragraph = []
    }
    function flushList() {
      if (!listType) return
      html.push('<' + listType + '>' + listItems.map(function (item) { return '<li>' + inline(item) + '</li>' }).join('') + '</' + listType + '>')
      listType = ''
      listItems = []
    }
    function flushCode() {
      if (!inCode) return
      html.push('<pre><code' + (codeLang ? ' class="language-' + escapeHtml(codeLang) + '"' : '') + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>')
      codeLines = []
      codeLang = ''
      inCode = false
    }

    lines.forEach(function (line) {
      var fence = line.match(/^\s*```([A-Za-z0-9_-]*)\s*$/)
      if (fence) {
        if (inCode) flushCode()
        else {
          flushParagraph()
          flushList()
          inCode = true
          codeLang = fence[1] || ''
        }
        return
      }
      if (inCode) {
        codeLines.push(line)
        return
      }
      if (line.trim() === '') {
        flushParagraph()
        flushList()
        return
      }
      var heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/)
      if (heading) {
        flushParagraph()
        flushList()
        var level = Math.min(5, heading[1].length + 2)
        html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>')
        return
      }
      var unordered = line.match(/^\s*[-*+]\s+(.+)$/)
      if (unordered) {
        flushParagraph()
        if (listType && listType !== 'ul') flushList()
        listType = 'ul'
        listItems.push(unordered[1])
        return
      }
      var ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
      if (ordered) {
        flushParagraph()
        if (listType && listType !== 'ol') flushList()
        listType = 'ol'
        listItems.push(ordered[1])
        return
      }
      flushList()
      paragraph.push(line)
    })
    flushCode()
    flushParagraph()
    flushList()
    return html.join('')
  }

  window.JcoMessage = { escapeHtml: escapeHtml, mdToHtml: mdToHtml }
})()
