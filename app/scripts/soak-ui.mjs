#!/usr/bin/env node
// 无人值守 UI 浸泡：多轮全站切换与安全交互，输出缓存、长任务和内存报告。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { PAGES } from '../tests/pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const REPORT = path.join(APP_DIR, 'quality', 'generated', 'soak-report.json')
const PAGE_LIST = PAGES.filter((page) => page !== 'J.Co工作台-发布.html')
const ROUNDS = Math.max(2, Number(process.env.JCO_SOAK_ROUNDS) || 5)

async function activeFrame(win) {
  const handle = await win.locator('#jcoFrame').elementHandle()
  return handle ? await handle.contentFrame() : null
}

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  let found = null
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && !found) {
    const frame = await activeFrame(win)
    if (frame && decodeURIComponent(frame.url()).endsWith(`/${page}`)) {
      try {
        if ((await frame.evaluate(() => document.documentElement.getAttribute('data-jco-ready'))) === '1') {
          found = frame
        }
      } catch {}
    }
    if (!found) await win.waitForTimeout(40)
  }
  if (!found) throw new Error(`页面未打开：${page}`)
  return found
}

async function instrument(frame) {
  await frame.evaluate(() => {
    if (window.__jcoSoakLongTasks) return
    window.__jcoSoakLongTasks = []
    const observedAt = performance.now()
    window.__jcoSoakObservedAt = observedAt
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime < observedAt) continue
          window.__jcoSoakLongTasks.push({
            startTime: Math.round(entry.startTime * 10) / 10,
            duration: Math.round(entry.duration * 10) / 10,
          })
        }
      }).observe({ type: 'longtask' })
    } catch {}
  })
}

async function exercise(frame, serial) {
  await frame.evaluate((value) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const main = document.querySelector('main')
    if (!main) return
    const field = [...main.querySelectorAll('input, textarea')].find((el) => {
      if (!visible(el) || el.disabled || el.readOnly || el.closest('[data-jco-no-persist]')) return false
      if (el.tagName === 'TEXTAREA') return true
      return ['text', 'search', 'url', 'number', 'email', 'tel'].includes(
        String(el.getAttribute('type') || 'text').toLowerCase(),
      )
    })
    if (field) {
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
    }
    for (const group of main.querySelectorAll('.tabs, .seg')) {
      const buttons = [...group.querySelectorAll('button:not([disabled])')].filter(visible)
      if (buttons.length < 2) continue
      const target =
        buttons.find((button) => !button.classList.contains('on') && !button.classList.contains('active')) ||
        buttons[buttons.length - 1]
      target?.click()
      break
    }
    const scroller = main.querySelector(':scope > .scroll') || main.querySelector('#chat') || main
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    if (maxScroll > 0) scroller.scrollTop = Math.min(640, maxScroll)
  }, `soak-${serial}-${Date.now()}`)
}

async function memoryOf(app) {
  const metrics = await app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((item) => Number(item.memory?.workingSetSize) || 0),
  )
  return Math.round((metrics.reduce((sum, value) => sum + value, 0) / 1024) * 10) / 10
}

async function longTasks(frames) {
  const unique = new Map()
  for (const frame of frames) {
    try {
      const items = await frame.evaluate(() => window.__jcoSoakLongTasks || [])
      for (const item of items) {
        unique.set(`${item.startTime}:${item.duration}`, item)
      }
    } catch {}
  }
  return [...unique.values()].sort((left, right) => left.startTime - right.startTime)
}

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-ui-soak-'))
const app = await electron.launch({
  executablePath: ELECTRON_BIN,
  args: [APP_DIR, '--jco-test'],
  env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir, JCO_TEST_MEDIA_FAKE: '1' },
})
const errors = []
const memorySamples = []
let stats = null
let seenFrames = []
try {
  const win = await app.firstWindow()
  win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 300)))
  await win.waitForTimeout(2400)
  let serial = 0
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const page of PAGE_LIST) {
      const frame = await openPage(win, page)
      await instrument(frame)
      await exercise(frame, ++serial)
    }
    await win.waitForTimeout(500)
    memorySamples.push(await memoryOf(app))
    seenFrames = win.frames()
  }
  stats = await win.evaluate(() => ({
    frames: document.querySelectorAll('.jco-frame').length,
    cache: { ...window.__jcoFrameStats },
  }))
  const taskDetails = await longTasks(seenFrames)
  const tasks = taskDetails.map((task) => task.duration)
  const maxLongTask = tasks.length ? Math.max(...tasks) : 0
  const memoryGrowthMb = Math.max(0, memorySamples.at(-1) - memorySamples[0])
  const report = {
    generatedAt: new Date().toISOString(),
    rounds: ROUNDS,
    pagesPerRound: PAGE_LIST.length,
    interactions: PAGE_LIST.length * ROUNDS,
    errors,
    memorySamplesMb: memorySamples,
    memoryGrowthMb,
    frames: stats.frames,
    cache: stats.cache,
    longTasks: tasks,
    longTaskDetails: taskDetails,
    maxLongTask,
    passed:
      errors.length === 0 &&
      stats.frames <= 16 &&
      stats.cache.evictions === 0 &&
      maxLongTask < 100 &&
      memoryGrowthMb <= 128,
  }
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  if (!report.passed) process.exitCode = 1
} finally {
  try {
    await app.close()
  } catch {}
  fs.rmSync(profileDir, { recursive: true, force: true })
}
