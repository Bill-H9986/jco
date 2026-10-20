/**
 * J.Co 媒体参数单一来源（做视频 / 做图共用）
 * 只做纯计算，不碰网络、不碰文件，便于页面和单测共用。
 */
(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  root.JCO_MEDIA = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
  }

  function parseSeconds(label) {
    var match = String(label || '').trim().match(/(\d+(?:\.\d+)?)\s*(秒|分钟)/)
    if (!match) return 0
    var value = Number(match[1])
    return match[2] === '分钟' ? Math.round(value * 60) : Math.round(value)
  }

  function targetShotCount(label) {
    var total = parseSeconds(label)
    if (!total) return 8
    return clamp(Math.ceil(total / 8), 1, 40)
  }

  function shotSecondsFor(label, count) {
    var total = parseSeconds(label)
    var shots = Math.max(1, Number(count) || 1)
    if (!total) return 5
    return clamp(Math.round(total / shots), 4, 12)
  }

  function imageSizeFor(ratio, res) {
    var base = res === '4K' ? 3072 : res === '2K' ? 1536 : 1024
    var value = String(ratio || '1:1')
    if (value === '3:4') return base + 'x' + Math.round((base * 4) / 3)
    if (value === '9:16') return base + 'x' + Math.round((base * 16) / 9)
    if (value === '16:9') return Math.round((base * 16) / 9) + 'x' + base
    return base + 'x' + base
  }

  function aspectWord(ratio) {
    var value = String(ratio || '')
    if (value === '3:4') return '3:4 竖版'
    if (value === '9:16') return '9:16 竖屏'
    if (value === '16:9') return '16:9 横屏'
    return '1:1 方形'
  }

  function ensurePromptCount(text, wanted, idea) {
    var count = clamp(Number(wanted) || 1, 1, 20)
    var lines = (Array.isArray(text) ? text : String(text || '').split(/\r?\n/))
      .map(function (line) {
        return String(line || '')
          .replace(/^#{1,6}\s*/, '')
          .replace(/^[-•*]\s+/, '')
          .replace(/^\d{1,2}[.、)]\s+/, '')
          .trim()
      })
      .filter(function (line) {
        return line.length > 3
      })

    var expanded = []
    lines.forEach(function (line) {
      var parts = line
        .split(/[。；;]/)
        .map(function (part) {
          return part.trim()
        })
        .filter(function (part) {
          return part.length > 3
        })
      if (parts.length > 1) expanded = expanded.concat(parts)
      else expanded.push(line)
    })

    var base = String(idea || '画面').trim() || '画面'
    var variants = ['主画面', '细节特写', '场景全景', '人物近景', '产品特写', '结尾画面']
    while (expanded.length < count) {
      expanded.push(base + '（' + variants[expanded.length % variants.length] + '）')
    }
    return expanded.slice(0, count)
  }

  function normalizeImages(images) {
    return (Array.isArray(images) ? images : []).filter(function (item) {
      return item && typeof item.src === 'string' && item.src.trim() !== ''
    })
  }

  function videoProgress(draft) {
    var total = draft && Array.isArray(draft.shots) ? draft.shots.length : 0
    var done = draft && draft.videos
      ? Object.keys(draft.videos).filter(function (key) {
          return draft.videos[key] && draft.videos[key].status === 'done' && draft.videos[key].url
        }).length
      : 0
    return { total: total, done: done, complete: total > 0 && done >= total }
  }

  return {
    parseSeconds: parseSeconds,
    targetShotCount: targetShotCount,
    shotSecondsFor: shotSecondsFor,
    imageSizeFor: imageSizeFor,
    aspectWord: aspectWord,
    ensurePromptCount: ensurePromptCount,
    normalizeImages: normalizeImages,
    videoProgress: videoProgress,
  }
})
