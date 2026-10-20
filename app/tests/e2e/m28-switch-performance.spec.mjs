// M28：缓存页切页的可见完成时间、长任务和进程内存预算。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { PAGES } from '../pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const WORK_PAGES = PAGES.filter((page) => page !== 'J.Co工作台-发布.html')

async function activeFrame(win) {
  const handle = await win.locator('#jcoFrame').elementHandle()
  return handle ? await handle.contentFrame() : null
}

async function openPage(win, page) {
  await win.evaluate((target) => window.__jcoGo(target), page)
  let found = null
  await expect
    .poll(
      async () => {
        const frame = await activeFrame(win)
        if (!frame || !decodeURIComponent(frame.url()).endsWith(`/${page}`)) return false
        try {
          const ready = await frame.evaluate(() => document.documentElement.getAttribute('data-jco-ready'))
          if (ready === '1') found = frame
          return ready === '1'
        } catch {
          return false
        }
      },
      { message: `页面未打开：${page}`, timeout: 10_000 },
    )
    .toBe(true)
  return found
}

async function switchAndWaitPaint(win, page) {
  return await win.evaluate(async (target) => {
    const started = performance.now()
    window.__jcoGo(target)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return Math.round((performance.now() - started) * 10) / 10
  }, page)
}

async function memoryOf(app) {
  const metrics = await app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((item) => ({
      type: item.type,
      workingSetKb: Number(item.memory?.workingSetSize) || 0,
      peakWorkingSetKb: Number(item.memory?.peakWorkingSetSize) || 0,
    })),
  )
  return {
    totalKb: metrics.reduce((sum, item) => sum + item.workingSetKb, 0),
    peakKb: metrics.reduce((sum, item) => sum + item.peakWorkingSetKb, 0),
    processes: metrics.length,
  }
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

test('M28：缓存页连续切换性能、长任务与内存不越预算', async () => {
  test.setTimeout(180_000)
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jco-switch-performance-'))
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_PROFILE_DIR: profileDir, JCO_TEST_MEDIA_FAKE: '1' },
  })
  try {
    const win = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0]
      if (!target) return
      target.webContents.setBackgroundThrottling(false)
      target.show()
      target.focus()
    })
    const errors = []
    win.on('pageerror', (error) => errors.push(String(error.message).slice(0, 240)))
    await win.waitForTimeout(2400)
    await win.evaluate(() => {
      window.__m28LongTasks = []
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__m28LongTasks.push(Math.round(entry.duration * 10) / 10)
          }
        }).observe({ type: 'longtask', buffered: true })
      } catch {}
    })

    for (const page of WORK_PAGES) await openPage(win, page)
    for (let index = 0; index < 120; index += 1) {
      await switchAndWaitPaint(win, WORK_PAGES[index % WORK_PAGES.length])
    }
    await win.waitForTimeout(1000)
    const memoryBefore = await memoryOf(app)
    const durations = []
    for (let index = 0; index < 120; index += 1) {
      durations.push(await switchAndWaitPaint(win, WORK_PAGES[index % WORK_PAGES.length]))
    }
    await win.waitForTimeout(1000)
    const memoryAfter = await memoryOf(app)
    const stats = await win.evaluate(() => ({
      frames: document.querySelectorAll('.jco-frame').length,
      cache: { ...window.__jcoFrameStats },
      longTasks: [...window.__m28LongTasks],
      heapBytes: Number(performance.memory?.usedJSHeapSize) || 0,
    }))
    const p95 = percentile(durations, 0.95)
    const max = Math.max(...durations)
    const memoryGrowthMb = Math.max(0, memoryAfter.totalKb - memoryBefore.totalKb) / 1024

    console.log(
      JSON.stringify({
        p50: percentile(durations, 0.5),
        p95,
        max,
        longTaskCount: stats.longTasks.length,
        maxLongTask: stats.longTasks.length ? Math.max(...stats.longTasks) : 0,
        memoryBeforeMb: Math.round(memoryBefore.totalKb / 1024),
        memoryAfterMb: Math.round(memoryAfter.totalKb / 1024),
        memoryGrowthMb: Math.round(memoryGrowthMb * 10) / 10,
        frames: stats.frames,
        cache: stats.cache,
      }),
    )

    expect(p95, '缓存页切页 P95 超过 100ms').toBeLessThanOrEqual(100)
    expect(max, '单次缓存页切页超过 250ms').toBeLessThanOrEqual(250)
    expect(stats.longTasks.filter((duration) => duration >= 50).length, '连续切页出现超过 50ms 的主线程长任务').toBe(0)
    expect(stats.frames, '页面缓存数量超过上限').toBeLessThanOrEqual(16)
    expect(stats.cache.cacheHits, '连续切页没有命中页面缓存').toBeGreaterThanOrEqual(240)
    expect(stats.cache.evictions, '本轮页面数量不应触发淘汰').toBe(0)
    expect(memoryGrowthMb, '连续切页导致工作集增长超过 64MB').toBeLessThanOrEqual(64)
    expect(errors, `页面 JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    try {
      await app.close()
    } catch {}
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
