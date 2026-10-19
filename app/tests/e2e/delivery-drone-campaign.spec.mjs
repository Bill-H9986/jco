// 交付验收：无人机培训宣传题的分镜 → 创作 → 发布链路（固定数据，不调真实 AI）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

const SHOTS = [
  { line: '想拿无人机装调检修工等级证，又担心没基础学不会？', pic: '小雅出镜·近景' },
  { line: '人社局牵头的免费就业培训，来啦！', pic: '小雅出镜·中景' },
  { line: '无人机装调检修工，涵盖飞行、组装和故障诊断。', pic: '无人机实机操作混剪' },
  { line: '全程实操训练，零基础也能快速上手。', pic: '学员拆装机实操特写' },
  { line: '结业后直接对接岗位推荐，好就业才是硬道理。', pic: '就业对接或证书展示' },
  { line: '培训免费，名额有限，赶紧报名！', pic: '小雅出镜·近景' },
]

test('交付验收：无人机宣传 30 秒 6 段 → 创作页 → 发布页', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2600)

    const draftId = Date.now()
    const videoPath = path.join(APP_DIR, 'release', 'smoke-packaged-expanded.png')
    const saved = await win.evaluate(
      async ({ id, shots, vid }) => {
        return await window.jco.drafts.save({
          items: [
            {
              id,
              title: '无人机装调检修·免费培训',
              idea: '无人机装调检修操作工 人社局等级证 免费就业培训',
              status: 'approved',
              duration: '30 秒',
              ratio: '9:16',
              res: '720P',
              shots,
              videos: { 0: { status: 'done', path: vid, url: 'file:///' + vid } },
            },
          ],
        })
      },
      { id: draftId, shots: SHOTS, vid: videoPath.replace(/\\/g, '/') },
    )
    expect(saved.ok).toBe(true)
    expect(saved.data.items.length).toBe(1)
    expect(saved.data.items[0].shots.length).toBe(6)
    expect(saved.data.items[0].shots.every((s) => s.line && s.pic)).toBe(true)
    expect(saved.data.items[0].duration).toBe('30 秒')
    expect(saved.data.items[0].ratio).toBe('9:16')
    expect(saved.data.items[0].res).toBe('720P')

    // 创作页：参数 chip 必须是 5 个，且模型来自设置
    await win.evaluate(() => window.__jcoGo('J.Co工作台-做视频.html'))
    await win.waitForTimeout(2200)
    const frame = win.frames().find((f) => f.name() === 'jcoFrame')
    const chips = await frame.locator('.ask-params .param-chip').allTextContents()
    expect(chips.length).toBe(5)
    expect(chips[1]).toBe('9:16')
    expect(chips[3]).toBe('720P')

    // 发布页：读到成片、标记已通过、标题可填
    await win.evaluate(() => window.__jcoGo('J.Co工作台-发布.html'))
    await win.waitForTimeout(2400)
    const pubFrame = win.frames().find((f) => f.name() === 'jcoFrame')
    await expect(pubFrame.locator('#sourceTitle')).not.toContainText('还没有成片')
    await expect(pubFrame.locator('#sourceBadge')).toContainText('已通过')
    await pubFrame.locator('#titleInp').fill('免费学无人机装调检修，人社局等级证')
    await expect(pubFrame.locator('#titleInp')).toHaveValue('免费学无人机装调检修，人社局等级证')
    // 未登录平台时发布按钮必须禁用
    await expect(pubFrame.locator('#pubBtn')).toBeDisabled()

    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
