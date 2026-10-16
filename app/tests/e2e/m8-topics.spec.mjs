// M8 选题环：真化后全交互回归（贴入卡/雷达/收藏/评论挖题空态/点题开写/弹层）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

test('选题页：贴入拆解卡 / 雷达 / 收藏 / 评论挖题空态 / 点题开写', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)
    // 预置本机真数据（模拟"贴过一条 + 雷达里有题 + 收藏过一条"）
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-inspo-v1',
        JSON.stringify([
          {
            t: Date.now(),
            text: '成人高考报名流程全攻略，看这一条就够了',
            why: '把 7 步压成 3 步，观众"终于搞懂了"',
            structure: '先亮结果→三步→点名人群',
            myTitle: '成人高考报名其实就 3 步',
            hook: '别被流程吓到',
            who: '在职人群',
          },
        ]),
      )
      localStorage.setItem(
        'jco-radar-v1',
        JSON.stringify([
          { kind: 'hot', kindName: 'AI 热点', heat: '新', title: '2026 报名时间表出炉' },
          { kind: 'ai', kindName: 'AI 现想的', heat: '刚出炉', title: '上班族每天 30 分钟怎么学' },
        ]),
      )
      localStorage.setItem('jco-favs-v1', JSON.stringify(['上班族每天 30 分钟怎么学']))
    })
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-选题.html'
    })
    await win.waitForTimeout(1400)

    // 贴入拆解卡：渲染 + 展开 + 真字段
    await expect(win.locator('.hit')).toHaveCount(1)
    await expect(win.locator('.hit .mt-line')).toContainText('3 步')
    await win.locator('.hit .use-btn').click()
    await expect(win.locator('.hit')).toHaveClass(/open/)
    await expect(win.locator('.hit .why')).toContainText('压成 3 步')

    // 雷达：hot 渲染；AI 标已收藏；收藏 tab 只显示收藏的
    await expect(win.locator('#radar .r-card')).toHaveCount(1)
    await win.locator('.tab[data-f="ai"]').click()
    await expect(win.locator('#radar .r-card')).toHaveCount(1)
    await expect(win.locator('#radar .r-card .star.on')).toHaveCount(1)
    await win.locator('.tab[data-f="fav"]').click()
    await expect(win.locator('#radar .r-card')).toHaveCount(1)
    await expect(win.locator('#radar .r-card .t')).toContainText('30 分钟')

    // 评论挖题：本机无评论数据 → 如实空态
    await win.locator('.tab[data-f="cmt"]').click()
    await expect(win.locator('#radar .empty')).toContainText('还没有评论数据')

    // 点题开写 → 跳「创作」页 + 交接键写入
    await win.locator('.tab[data-f="hot"]').click()
    await win.locator('#radar .r-card').first().click()
    await win.waitForTimeout(1500)
    expect(decodeURIComponent(win.url())).toContain('创作')
    // 交接键由创作页消费后清除（设计如此）——以"创作页真的接住了主题"为准
    await expect(win.locator('#topicName')).toContainText('报名时间表')

    // 弹层（贴一条爆款）
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-选题.html'
    })
    await win.waitForTimeout(1200)
    await win.locator('button:has-text("贴一条爆款")').first().click()
    await expect(win.locator('#inspoOverlay.show')).toHaveCount(1)
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})

test('创作页：接住「选题」带过来的主题 / 无题空态 / 真稿恢复', async () => {
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [APP_DIR, '--jco-test'] })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
    await win.waitForTimeout(2500)

    // ① 无题空态（真模式不再显示假样例稿）
    await win.evaluate(() => {
      window.location.href = 'J.Co工作台-创作.html'
    })
    await win.waitForTimeout(1300)
    await expect(win.locator('#topicName')).toContainText('还没选主题')
    await expect(win.locator('#script .empty-script')).toContainText('还没有稿子')

    // ② 带题进页（模拟选题页点「拿去开写」）
    await win.evaluate(() => {
      sessionStorage.setItem('jco-pick-topic', '成人高考报名其实就 3 步')
    })
    await win.reload()
    await win.waitForTimeout(1300)
    await expect(win.locator('#topicName')).toContainText('成人高考报名其实就 3 步')
    await expect(win.locator('#paperTitle')).toContainText('成人高考报名其实就 3 步')
    await expect(win.locator('#script .empty-script')).toContainText('还没有稿子')

    // ③ 有真稿 → 恢复显示
    await win.evaluate(() => {
      localStorage.setItem(
        'jco-script-v1',
        JSON.stringify({
          topic: '成人高考报名其实就 3 步',
          lines: ['第一步，定学校和专业。', '第二步，备齐三样东西。'],
          xhs: false,
          t: Date.now(),
        }),
      )
    })
    await win.reload()
    await win.waitForTimeout(1300)
    await expect(win.locator('#script p')).toHaveCount(2)
    await expect(win.locator('#script p').first()).toContainText('第一步')
    expect(errors, `JS 错误：\n${errors.join('\n')}`).toEqual([])
  } finally {
    await app.close()
  }
})
