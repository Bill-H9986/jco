// M20：创作页的已选素材和最后打开的草稿要跨页面重载/进程重启恢复。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const FIXTURE = path.join(APP_DIR, 'tests', 'visual', 'baseline', 'local', 'materials-light-1440x900.png')
const TEST_KERNEL_DIR = path.join(os.tmpdir(), 'jco-test-kernel-data')
const MEDIA_JOBS_DIR = path.join(TEST_KERNEL_DIR, 'media-jobs')

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
      { timeout: 8000 },
    )
    .toBe(true)
  return found
}

async function waitForPicker(win) {
  let found = null
  await expect
    .poll(
      async () => {
        const frames = win.frames()
        const frame = frames.find((item) => {
          try {
            const url = new URL(item.url())
            return decodeURIComponent(url.pathname).endsWith('/J.Co工作台-素材.html') && url.search.includes('pick=1')
          } catch {
            return false
          }
        })
        if (!frame) return false
        try {
          const ready = await frame.evaluate(() => document.documentElement.getAttribute('data-jco-ready'))
          if (ready === '1') found = frame
          return ready === '1'
        } catch {
          return false
        }
      },
      { timeout: 8000 },
    )
    .toBe(true)
  return found
}

test('M20：已选素材跨页面重载仍保留', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    await win.evaluate(
      async ({ file, label }) => {
        await window.jco.materials.save({
          items: [{ cat: 'mine', type: 'photo', name: label, src: '导入 · 本机文件', imported: true, path: file }],
        })
      },
      { file: FIXTURE.replace(/\\/g, '/'), label: '重启后还要在的素材.png' },
    )

    const create = await openPage(win, 'J.Co工作台-做视频.html')
    await create.locator('.ask-bar .tool', { hasText: '素材' }).click()
    const picker = await waitForPicker(win)
    await picker.locator('#grid .mat').first().click()
    await picker.locator('#pickDone').click()
    await openPage(win, 'J.Co工作台-做视频.html')
    await expect(create.locator('#pickedBar')).toBeVisible()
    await expect(create.locator('#pickedList')).toContainText('重启后还要在的素材.png')

    await win.evaluate(() => {
      sessionStorage.removeItem('jco-picked-materials')
    })
    await win.reload()
    await win.waitForTimeout(1800)
    const createAgain = await openPage(win, 'J.Co工作台-做视频.html')
    await expect(createAgain.locator('#pickedBar')).toBeVisible()
    await expect(createAgain.locator('#pickedList')).toContainText('重启后还要在的素材.png')
  } finally {
    try {
      const win = await app.firstWindow()
      await win.evaluate(async () => {
        await window.jco.materials.save({ items: [] })
        localStorage.removeItem('jco-make-picked-materials-v1')
      })
    } catch {}
    await app.close()
  }
})

test('M20：最后打开的草稿跨页面重载仍恢复', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(2400)
    const draft = (id, idea) => ({
      id,
      idea,
      status: 'review',
      type: 'video',
      ratio: '9:16',
      duration: '10 秒',
      res: '720P',
      voice: '标准女声',
      method: 'assemble',
      shots: [{ line: idea, pic: '蓝色背景' }],
      videos: { 0: { status: 'done', url: 'file:///C:/nonexistent.mp4', path: 'C:/nonexistent.mp4' } },
      images: [],
    })
    await win.evaluate(
      async (items) => {
        await window.jco.drafts.save({ items })
      },
      [draft(9921, '第一条草稿'), draft(9922, '第二条草稿'), draft(9923, '第三条草稿')],
    )

    const create = await openPage(win, 'J.Co工作台-做视频.html')
    await create.locator('.dcard', { hasText: '第三条草稿' }).click()
    await expect(create.locator('#doneTitle')).toHaveText('第三条草稿')
    await win.evaluate(() => {
      sessionStorage.removeItem('jco-make-last-draft')
    })
    await win.reload()
    await win.waitForTimeout(1800)
    const createAgain = await openPage(win, 'J.Co工作台-做视频.html')
    await expect(createAgain.locator('#doneTitle')).toHaveText('第三条草稿')
  } finally {
    try {
      const win = await app.firstWindow()
      await win.evaluate(async () => {
        await window.jco.drafts.save({ items: [] })
        localStorage.removeItem('jco-make-last-draft-v1')
      })
    } catch {}
    await app.close()
  }
})

test('M20：进程重启后运行中的媒体任务标为中断，已完成结果保留', async () => {
  const shots = Array.from({ length: 6 }, (_, index) => ({
    index,
    prompt: `第 ${index + 1} 段`,
    seconds: 5,
  }))
  const draft = {
    id: 9941,
    idea: '重启中断草稿',
    status: 'review',
    type: 'video',
    ratio: '9:16',
    duration: '30 秒',
    res: '720P',
    voice: '标准女声',
    method: 'assemble',
    shots: shots.map((shot) => ({ line: shot.prompt, pic: '蓝色背景' })),
    videos: {},
    images: [],
  }
  const appA = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, '--jco-test'],
    env: { ...process.env, JCO_TEST_MEDIA_FAKE: '1' },
  })
  let appB = null
  try {
    const winA = await appA.firstWindow()
    await winA.waitForTimeout(2400)
    await winA.evaluate(async (item) => {
      await window.jco.drafts.save({ items: [item] })
      await window.jco.media.start({
        kind: 'video',
        draftId: item.id,
        shots: item.shots.map((shot, index) => ({ index, prompt: shot.line, seconds: 5 })),
        ratio: item.ratio,
        res: item.res,
      })
    }, draft)
    await expect
      .poll(
        async () =>
          await winA.evaluate(async () => {
            const data = await window.jco.media.list(9941)
            return data.jobs?.[0]?.status || ''
          }),
        { timeout: 5000 },
      )
      .toBe('running')
    await appA.close()

    appB = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: [APP_DIR, '--jco-test'],
      env: { ...process.env, JCO_TEST_MEDIA_FAKE: '1' },
    })
    const winB = await appB.firstWindow()
    await winB.waitForTimeout(2400)
    const jobs = await winB.evaluate(async () => await window.jco.media.list(9941))
    expect(jobs.jobs?.[0]?.status).toBe('interrupted')
    const persisted = await winB.evaluate(async () => {
      const data = await window.jco.drafts.get()
      return data.data.items.find((item) => item.id === 9941)
    })
    expect(persisted.status).toBe('interrupted')
    expect(Object.values(persisted.videos || {}).some((item) => item && item.status === 'failed')).toBe(true)

    const create = await openPage(winB, 'J.Co工作台-做视频.html')
    await create.locator('.dcard', { hasText: '重启中断草稿' }).click()
    await expect(create.locator('#dStatus')).toContainText('已中断')
  } finally {
    try {
      if (appB) await appB.close()
    } catch {}
    try {
      await appA.close()
    } catch {}
    fs.rmSync(MEDIA_JOBS_DIR, { recursive: true, force: true })
    fs.writeFileSync(
      path.join(TEST_KERNEL_DIR, 'drafts.json'),
      JSON.stringify({ version: 1, items: [] }, null, 2),
      'utf8',
    )
  }
})
