const { app, BrowserWindow, Menu, shell, screen, ipcMain, nativeTheme, session, dialog, Tray, nativeImage, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')

// 界面文件在 J.Co\设计原型 里（和本工程是邻居），整个 J.Co 文件夹搬走也能正常打开
const UI_DIR = path.join(__dirname, '..', '设计原型')
const ENTRY = 'J.Co主界面-首页.html'

// ---------- 应用级设置（主进程持有：主题偏好等；开机启动由系统记录） ----------
// 打包版：设置写入用户数据目录（安装目录只读）；开发版：沿用工程内文件
const SETTINGS_PATH = app.isPackaged
  ? path.join(app.getPath('userData'), 'settings.json')
  : path.join(__dirname, 'settings.json')
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) } catch (e) { return {} }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch }
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2)) } catch (e) {}
  return next
}

// 主题覆盖表：渲染器的 prefers-color-scheme 未必跟随 themeSource（Electron 44 实测），
// 所以真切换用"主进程注入变量覆盖 CSS"实现；system 模式移除注入、回归系统媒体查询。
// 变量声明带 !important：insertCSS 的表在文档前部，必须靠重要性赢过页面自身 :root。
const THEME_VARS = {
  dark: {
    '--bg': '#1c1c1e', '--card': '#2c2c2e', '--tint': '#3a3a3c',
    '--text-1': '#e8e8ed', '--text-2': '#a8a8af', '--text-3': '#82828a',
    '--line': 'rgba(255,255,255,0.1)',
    '--accent': '#0a84ff', '--accent-strong': '#3d9bff',
    '--hover': 'rgba(255,255,255,0.07)', '--picked': 'rgba(255,255,255,0.12)',
    '--btn-2nd': '#3a3a3c', '--btn-2nd-hover': '#46464a',
    '--green': '#30d158', '--green-tint': 'rgba(48,209,88,0.16)',
    '--red': '#ff6961', '--red-tint': 'rgba(255,105,97,0.16)',
    '--shadow': '0 8px 16px rgba(0,0,0,0.45)',
    '--shadow-card': '0 4px 10px rgba(0,0,0,0.4)',
    '--shadow-float': '0 0 1px rgba(255,255,255,0.12), 0 4px 14px rgba(0,0,0,0.5)',
    '--shadow-modal': '0 10px 22px rgba(0,0,0,0.4), 0 39px 39px rgba(0,0,0,0.3), 0 88px 53px rgba(0,0,0,0.2)',
  },
  light: {
    '--bg': '#f7f7f7', '--card': '#ffffff', '--tint': '#f0f0f2',
    '--text-1': 'rgba(0,0,0,0.75)', '--text-2': 'rgba(0,0,0,0.55)', '--text-3': 'rgba(0,0,0,0.38)',
    '--line': 'rgba(0,0,0,0.08)',
    '--accent': '#0080ff', '--accent-strong': '#1a8cff',
    '--hover': 'rgba(15,15,15,0.06)', '--picked': 'rgba(15,15,15,0.1)',
    '--btn-2nd': 'rgba(0,0,0,0.05)', '--btn-2nd-hover': 'rgba(0,0,0,0.09)',
    '--green': '#248a3d', '--green-tint': 'rgba(36,138,61,0.12)',
    '--red': '#d70015', '--red-tint': 'rgba(215,0,21,0.1)',
    '--shadow': '0 8px 16px rgba(0,0,0,0.08)',
    '--shadow-card': '0 4px 10px rgba(0,0,0,0.03)',
    '--shadow-float': '0 0 1px rgba(0,0,0,0.3), 0 4px 14px rgba(0,0,0,0.1)',
    '--shadow-modal': '0 10px 22px rgba(0,0,0,0.06), 0 39px 39px rgba(0,0,0,0.05), 0 88px 53px rgba(0,0,0,0.03)',
  },
}
const THEME_CSS = Object.fromEntries(
  Object.entries(THEME_VARS).map(([mode, vars]) => [
    mode,
    ':root{' + Object.entries(vars).map(([name, value]) => name + ':' + value + '!important').join(';') + '}',
  ]),
)
function applyThemeToWindow(win) {
  const wc = win.webContents
  const mode = readSettings().theme || 'system'
  const css = (mode === 'dark' || mode === 'light') ? THEME_CSS[mode] : null
  if (wc.__jcoThemeKey) {
    wc.removeInsertedCSS(wc.__jcoThemeKey).catch(() => {})
    wc.__jcoThemeKey = null
  }
  if (css) {
    wc.insertCSS(css).then((key) => { wc.__jcoThemeKey = key }).catch(() => {})
  }
}
function applyThemeToAll() {
  BrowserWindow.getAllWindows().forEach(applyThemeToWindow)
}

// 主题（真切换）
ipcMain.handle('sys:theme', (_event, mode) => {
  const m = ['light', 'dark', 'system'].includes(mode) ? mode : 'system'
  nativeTheme.themeSource = m
  writeSettings({ theme: m })
  applyThemeToAll()
  return { ok: true, theme: m }
})
ipcMain.handle('sys:theme:get', () => ({ ok: true, theme: readSettings().theme || 'system' }))

// 开机自动启动（真开关：写系统登录项注册表；可读回、可复位）
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_NAME = 'J.Co'
function isLoginEnabled() {
  try {
    const out = execFileSync('reg', ['query', RUN_KEY, '/v', RUN_NAME], { windowsHide: true }).toString()
    return out.indexOf(RUN_NAME) >= 0
  } catch (error) {
    return false
  }
}
ipcMain.handle('sys:login', (_event, enable) => {
  try {
    if (enable) {
      const extra = app.isPackaged ? '' : ' "' + path.resolve(__dirname) + '"'
      const value = '"' + process.execPath + '"' + extra
      execFileSync('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true })
    } else {
      try {
        execFileSync('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f'], { windowsHide: true })
      } catch (error) {
        /* 本来就没有：视为关成功 */
      }
    }
    return { ok: true, enabled: isLoginEnabled() }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('sys:login:get', () => {
  try { return { ok: true, enabled: isLoginEnabled() } } catch (error) { return { ok: false } }
})

// 清理缓存（真清理：HTTP 缓存；不动 localStorage/配置/素材）
ipcMain.handle('sys:clean', async () => {
  try {
    await session.defaultSession.clearCache()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 选素材文件（真：系统文件对话框）
ipcMain.handle('sys:pick-files', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showOpenDialog(win, {
      title: '选素材（图片 / 视频 / 音频都行）',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '媒体文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'aac'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    })
    if (res.canceled) return { ok: true, files: [] }
    return { ok: true, files: res.filePaths.map((p) => ({ path: p, name: path.basename(p) })) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 选文件夹（真：素材和成片的存放位置）
ipcMain.handle('sys:pick-folder', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showOpenDialog(win, {
      title: '选一个文件夹，放素材和成片',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: true, path: '' }
    return { ok: true, path: res.filePaths[0] }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 生成物落盘（真：图片/视频存进素材文件夹；设置页选过目录就存那儿）
ipcMain.handle('sys:save-asset', async (_event, payload) => {
  try {
    const dir = readSettings().assetsDir || path.join(app.getPath('userData'), 'assets')
    fs.mkdirSync(dir, { recursive: true })
    const kind = String((payload && payload.kind) || 'file')
    const ext = String((payload && payload.ext) || (kind === 'video' ? 'mp4' : 'png'))
    const file = path.join(dir, kind + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '.' + ext)
    if (payload && payload.dataUrl) {
      const m = /^data:[^;]+;base64,(.+)$/.exec(String(payload.dataUrl))
      if (!m) return { ok: false, error: '数据格式不对' }
      fs.writeFileSync(file, Buffer.from(m[1], 'base64'))
    } else if (payload && payload.url && /^https:\/\//i.test(String(payload.url))) {
      const res = await fetch(String(payload.url), { signal: AbortSignal.timeout(180000) })
      if (!res.ok) return { ok: false, error: '下载失败 HTTP ' + res.status }
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    } else {
      return { ok: false, error: '没有可保存的内容' }
    }
    return { ok: true, path: file }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 用系统浏览器打开链接（只放行 https；用于平台登录页等）
ipcMain.handle('sys:open-external', (_event, url) => {
  try {
    const u = String(url || '')
    if (!/^https:\/\//i.test(u)) return { ok: false, error: '只允许 https 链接' }
    shell.openExternal(u)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// ---------- 托盘（真：关窗缩到右下角，点图标回来） ----------
let tray = null
let trayEnabled = false
function makeTrayIcon() {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const dx = x - 7.5
      const dy = y - 7.5
      buf[i] = 0xe3 // B
      buf[i + 1] = 0x71 // G
      buf[i + 2] = 0x00 // R（#0071e3）
      buf[i + 3] = dx * dx + dy * dy <= 49 ? 255 : 0
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}
function showMainWindow() {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } else {
    createWindow()
  }
}
function createTray() {
  if (tray || !trayEnabled) return
  try {
    tray = new Tray(makeTrayIcon())
    tray.setToolTip('J.Co · 自媒体工作台')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 J.Co', click: showMainWindow },
      { type: 'separator' },
      { label: '退出 J.Co', click: () => { app.isQuitting = true; app.quit() } },
    ]))
    tray.on('click', showMainWindow)
  } catch (error) {
    tray = null
  }
}
function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
ipcMain.handle('sys:tray', (_event, enable) => {
  trayEnabled = !!enable
  writeSettings({ tray: trayEnabled })
  if (trayEnabled) createTray()
  else {
    destroyTray()
    showMainWindow()
  }
  return { ok: true, enabled: trayEnabled }
})
ipcMain.handle('sys:tray:get', () => ({ ok: true, enabled: trayEnabled }))

// 系统通知（真：完事提醒）
ipcMain.handle('sys:notify', (_event, payload) => {
  try {
    if (!Notification.isSupported()) return { ok: false, error: '这台系统不支持通知' }
    const n = new Notification({
      title: String((payload && payload.title) || 'J.Co'),
      body: String((payload && payload.body) || ''),
    })
    n.show()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// ---------- DSH 内核桥（懒加载 ESM；任何失败都不阻塞窗口） ----------
let bridgePromise = null
function getBridge() {
  if (!bridgePromise) {
    bridgePromise = import(pathToFileURL(path.join(__dirname, 'kernel', 'bridge.mjs')).href)
    bridgePromise.catch(() => { bridgePromise = null })
  }
  return bridgePromise
}

/** 打包适配：kernel 内文件映射到 app.asar.unpacked（与 bridge.mjs 的 toUnpacked 同款） */
function kernelUnpackedPath(p) {
  const marker = 'app.asar' + path.sep
  return p.includes(marker) ? p.replace(marker, 'app.asar.unpacked' + path.sep) : p
}
// 测试模式（--jco-test）：kernel 运行数据（技能库 / 自动任务 / 任务台账）重定向到独立临时目录——
// 测试永不触碰开发目录的运行时文件（2026-10-17 正本清源；此前靠 E2E 全局护栏兜底恢复）。
// 固定目录名（测试串行单实例）；E2E / qa 脚本用 os.tmpdir() 下的同一路径预置与读取。
const JCO_TEST_MODE = process.argv.includes('--jco-test')
const TEST_KERNEL_DATA_DIR = path.join(app.getPath('temp'), 'jco-test-kernel-data')
function kernelDataPath(name) {
  return JCO_TEST_MODE ? path.join(TEST_KERNEL_DATA_DIR, name) : kernelUnpackedPath(path.join(__dirname, 'kernel', name))
}
const SKILLS_FILE = kernelDataPath('skills.json')
/** 自动任务（M6）：任务表（页面同步，调度器只读）与执行记录（调度器写，页面只读） */
const AUTO_TASKS_FILE = kernelDataPath('auto-tasks.json')
const AUTO_RUNS_FILE = kernelDataPath('auto-runs.json')
/** 自动任务纪律尾注（逐字，与《M6 接口契约》一致）：不可逆动作一律停下等用户 */
const AUTO_DISCIPLINE = [
  '（自动任务纪律：这是定时触发的任务，用户正在别处忙。准备工作照做；',
  '但任何"点发布""发送回复"之类不可逆的动作一律停下——准备好后等用户来确认。',
  '做完把结果说清楚：干了什么、结果如何、接下来等用户做什么。）',
].join('\n')

// 内核对话：渲染进程 ask → 内核 → 增量推回
ipcMain.handle('kernel:ask', async (event, payload) => {
  const sender = event.sender
  try {
    const text = typeof payload === 'string' ? payload : String((payload && payload.text) || '')
    const sessionId = (payload && typeof payload === 'object' && payload.sessionId) ? ('jco-chat-' + String(payload.sessionId)) : undefined
    const bridge = await getBridge()
    const options = {}
    if (sessionId) options.sessionId = sessionId
    // 干活活动（M5 员工实时状态）：广播给所有窗口——团队页/总管页谁开着谁能看
    options.onActivity = (act) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        try { win.webContents.send('kernel:activity', act) } catch (error) { /* 窗口已关闭则忽略 */ }
      })
    }
    return await bridge.ask(text, (delta) => {
      if (!sender.isDestroyed()) sender.send('kernel:delta', delta)
    }, options)
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

ipcMain.handle('kernel:status', async () => {
  try {
    const bridge = await getBridge()
    return bridge.status()
  } catch (error) {
    return { ready: false, error: String((error && error.message) || error) }
  }
})

// 真探测模型接口（设置页「测试连接 / 搜索可用模型」）
ipcMain.handle('kernel:probe', async (_event, payload) => {
  try {
    const bridge = await getBridge()
    return await bridge.probeModels(payload)
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 保存设置页「说话写稿」配置：写配置 + 重建内核（下一条消息按新路由走）
ipcMain.handle('kernel:set-model', async (_event, config) => {
  try {
    const bridge = await getBridge()
    return await bridge.setModel(config)
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 一次性生成任务（创作/选题/分镜等）：独立会话，返回完整文本
ipcMain.handle('kernel:task', async (_event, payload) => {
  try {
    const bridge = await getBridge()
    return await bridge.task(payload || {})
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 真画图（用设置页「画图修图」的配置）
ipcMain.handle('kernel:draw', async (_event, payload) => {
  try {
    const bridge = await getBridge()
    return await bridge.drawImage(payload || {})
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 真出视频（异步任务 + 轮询；单段最多等 10 分钟）
ipcMain.handle('kernel:video', async (_event, payload) => {
  try {
    const bridge = await getBridge()
    return await bridge.videoGenerate(payload || {})
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 技能库 → 内核侧同步（M5）：写 kernel/skills.json，供系统提示词注入技能段。
// 纪律：界面是单一事实源，这个文件是从属副本；只收约定字段并截断长度（防脏数据进内核）。
ipcMain.handle('skills:sync', (_event, payload) => {
  try {
    const raw = payload && Array.isArray(payload.items) ? payload.items : []
    const items = raw
      .filter((i) => i && typeof i.id === 'string' && i.id !== '')
      .map((i) => ({
        id: String(i.id).slice(0, 24),
        name: String(i.name || '').slice(0, 40),
        desc: String(i.desc || '').slice(0, 200),
        entry: String(i.entry || '').slice(0, 160),
        on: i.on === true,
      }))
    fs.writeFileSync(SKILLS_FILE, JSON.stringify({ items }, null, 2), 'utf8')
    return { ok: true, count: items.length }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// ---------- 发布引擎（M2：通用引擎 + 平台适配层；抖音首发适配） ----------
let publishEngine = null
try {
  publishEngine = require('./dist/publish-engine.js')
} catch (error) {
  console.warn('[publish] 发布引擎未构建（先运行 npm run build）：' + String((error && error.message) || error))
}

const publishManager = publishEngine
  ? new publishEngine.PublishTaskManager(
      {
        enginePath: publishEngine.unpackedPath(path.join(__dirname, 'publish', 'engine.mjs')),
        platformsDir: publishEngine.unpackedPath(path.join(__dirname, 'publish', 'platforms')),
        execPath: process.execPath,
        profileRoot: path.join(app.getPath('userData'), 'publish'),
      },
      (event) => {
        BrowserWindow.getAllWindows().forEach((win) => {
          try {
            win.webContents.send('publish:event', event)
          } catch (error) {
            /* 窗口已关闭则忽略 */
          }
        })
      },
    )
  : null

ipcMain.handle('publish:start', (_event, payload) => {
  if (!publishManager) return { ok: false, error: '发布引擎还没有构建好，需要重新构建一次' }
  try {
    return publishManager.start(payload)
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

ipcMain.handle('publish:stop', (_event, payload) => {
  if (!publishManager) return { ok: false, error: '发布引擎还没有构建好，需要重新构建一次' }
  try {
    return publishManager.stop(payload && payload.taskId)
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

ipcMain.handle('publish:status', () => {
  if (!publishManager) return { state: 'idle' }
  return publishManager.status()
})

// 发布会话（M2：AI 的"手"——浏览器 + 本机工具端点；内核插件按 sessionFile 动态取址）
/** 发布会话文件（账号中心「去登录」直调会话工具面时读 endpoint/token 用；与下面构造同路径） */
const PUBLISH_SESSION_FILE = publishEngine ? publishEngine.unpackedPath(path.join(__dirname, 'kernel', 'publish-session.json')) : ''
const publishSessionManager = publishEngine
  ? new publishEngine.PublishSessionManager(
      {
        serverPath: publishEngine.unpackedPath(path.join(__dirname, 'publish', 'session-server.mjs')),
        execPath: process.execPath,
        profileRoot: path.join(app.getPath('userData'), 'publish'),
        sessionFile: publishEngine.unpackedPath(path.join(__dirname, 'kernel', 'publish-session.json')),
        shotsDir: path.join(app.getPath('userData'), 'publish', 'shots'),
        dataDir: path.join(app.getPath('userData'), 'publish', 'data'),
      },
      (event) => {
        BrowserWindow.getAllWindows().forEach((win) => {
          try {
            win.webContents.send('publish:session:event', event)
          } catch (error) {
            /* 窗口已关闭则忽略 */
          }
        })
      },
    )
  : null

ipcMain.handle('publish:session:start', (_event, payload) => {
  if (!publishSessionManager) return { ok: false, error: '发布引擎还没有构建好，需要重新构建一次' }
  return publishSessionManager.start(payload && payload.platform)
})

ipcMain.handle('publish:session:stop', () => {
  if (!publishSessionManager) return { ok: true }
  return publishSessionManager.stop()
})

ipcMain.handle('publish:session:status', () => {
  if (!publishSessionManager) return { active: false }
  return publishSessionManager.status()
})

// 账号中心「去登录」（M9 单元⑤）：启动该平台的发布会话（= AI 干活用的同一个浏览器）→
// 用会话自己的工具面打开平台登录页——登录态从此进"发布会话 profile"，与 AI 干活完全同路
// （此前的"系统浏览器打开"是登了个寂寞：扫的码不在 AI 用的浏览器里）。
const PUBLISH_LOGIN_URLS = {
  douyin: 'https://creator.douyin.com/',
  shipinhao: 'https://channels.weixin.qq.com/',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  kuaishou: 'https://cp.kuaishou.com/',
  bilibili: 'https://member.bilibili.com/',
}
ipcMain.handle('publish:session:login', async (_event, payload) => {
  try {
    if (!publishSessionManager) return { ok: false, error: '发布引擎还没有构建好' }
    const platformId = String((payload && payload.platform) || '')
    const url = PUBLISH_LOGIN_URLS[platformId]
    if (!url) return { ok: false, error: '不认识的平台' }
    const st = publishSessionManager.status()
    if (!st.active || st.platform !== platformId) publishSessionManager.start(platformId)
    let ready = false
    for (let i = 0; i < 40; i++) {
      const s = publishSessionManager.status()
      if (s.ready && s.platform === platformId) {
        ready = true
        break
      }
      if (!s.active) break
      await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
    }
    if (!ready) return { ok: false, error: '浏览器还没起来，等几秒再点一次。' }
    const session = JSON.parse(fs.readFileSync(PUBLISH_SESSION_FILE, 'utf8'))
    const res = await fetch(session.endpoint + '/tool', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.token },
      body: JSON.stringify({ name: 'open_page', args: { url } }),
    })
    const data = await res.json().catch(() => null)
    if (data && data.ok) return { ok: true }
    return { ok: false, error: (data && data.error) || '打开登录页没成功' }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

ipcMain.handle('publish:data:get', () => {
  const read = (name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'publish', 'data', name), 'utf8'))
    } catch (error) {
      return null
    }
  }
  return { report: read('report-latest.json'), comments: read('comments-latest.json') }
})

// ---------- 自动任务调度器（M6：到点自己干活） ----------
const autoRuns = { runs: {} }
try {
  Object.assign(autoRuns, JSON.parse(fs.readFileSync(AUTO_RUNS_FILE, 'utf8')) || {})
  if (!autoRuns.runs || typeof autoRuns.runs !== 'object') autoRuns.runs = {}
} catch (error) {
  /* 无记录：从空开始 */
}
function readAutoTasks() {
  try {
    const data = JSON.parse(fs.readFileSync(AUTO_TASKS_FILE, 'utf8'))
    return Array.isArray(data && data.items) ? data.items : []
  } catch (error) {
    return []
  }
}
function saveAutoRun(taskId, record) {
  autoRuns.runs[taskId] = record
  try {
    fs.writeFileSync(AUTO_RUNS_FILE, JSON.stringify(autoRuns), 'utf8')
  } catch (error) {
    /* 写失败不阻断调度 */
  }
}
/** 执行前确保发布会话就绪（≤60 秒）；起不来也照常发任务（AI 会如实说，我们不装成功） */
async function ensurePublishReady() {
  if (!publishSessionManager) return false
  try {
    const st = publishSessionManager.status()
    if (!st || !st.active) publishSessionManager.start('douyin')
    for (let i = 0; i < 40; i++) {
      const s = publishSessionManager.status()
      if (s && s.ready) return true
      if (s && !s.active) return false
      await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
    }
  } catch (error) {
    /* 起不来：照常发任务 */
  }
  return false
}
async function runAutoTask(task) {
  await ensurePublishReady()
  const bridge = await getBridge()
  const prompt = '现在就跑一遍「' + task.name + '」：' + String(task.desc || '') + '。\n' + AUTO_DISCIPLINE
  const result = await bridge.ask(prompt, null, {
      sessionId: 'jco-chat-task-' + task.id,
    onActivity: (act) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        try {
          win.webContents.send('kernel:activity', { ...act, auto: true, taskName: task.name })
        } catch (error) {
          /* 窗口已关闭则忽略 */
        }
      })
    },
  })
  return { ok: !!result.ok, summary: result.ok ? result.text : result.error }
}
function notifyAutoResult(task, record) {
  try {
    if (!Notification.isSupported()) return
    new Notification({
      title: record.ok ? '「' + task.name + '」跑完了' : '「' + task.name + '」这轮没跑成',
      body: clipSafe(String(record.summary || ''), 120),
    }).show()
  } catch (error) {
    /* 通知失败无碍 */
  }
}
function notifyTaskResult(rec) {
  try {
    if (process.argv.includes('--jco-test')) return // 测试模式不弹通知
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: rec.state === 'done' ? '「' + rec.name + '」跑完了' : '「' + rec.name + '」没跑成',
      body: clipSafe(String(rec.summary || ''), 120),
    })
    // R7（对抗审查落地）：点击通知 → 唤醒窗口并直达该任务的"任务视图"
    // 复用总管页的既有消费链：在总管页 → 直接调钩子打开；在其它页 → 走 jco-open-task + 跳转
    n.on('click', () => {
      try {
        showMainWindow()
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) return
        const boot = `(function(){ try { var id = ${JSON.stringify(rec.id)}; if (typeof window.__jcoOpenTaskById === 'function') { window.__jcoOpenTaskById(id); } else { sessionStorage.setItem('jco-open-task', id); location.href = 'J.Co总管.html'; } } catch (e) {} })()`
        win.webContents.executeJavaScript(boot).catch(() => {})
      } catch (error) {
        /* 打开失败无碍 */
      }
    })
    n.show()
  } catch (error) {
    /* 通知失败无碍 */
  }
}
let autoScheduler = null
async function startAutoScheduler() {
  try {
    const mod = await import(pathToFileURL(path.join(__dirname, 'kernel', 'auto-scheduler.mjs')).href)
    autoScheduler = mod.createAutoScheduler({
      getTasks: readAutoTasks,
      getRuns: () => autoRuns.runs,
      saveRun: saveAutoRun,
      execute: runAutoTask,
      notify: notifyAutoResult,
    })
    autoScheduler.start()
    autoScheduler.tick().catch(() => {}) // 启动即检一遍（补跑语义）
  } catch (error) {
    console.warn('[auto] 调度器启动失败：' + String((error && error.message) || error))
  }
}

// 自动任务 IPC：页面 → 主进程同步任务表；页面反查执行记录
ipcMain.handle('tasks:sync', (_event, payload) => {
  try {
    const raw = payload && Array.isArray(payload.items) ? payload.items : []
    const items = raw
      .filter((t) => t && typeof t.id === 'string' && t.id !== '' && typeof t.name === 'string' && t.name !== '')
      .map((t) => {
        const s = t.schedule && typeof t.schedule === 'object' ? t.schedule : {}
        const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time || '')) ? String(s.time) : '09:00'
        const schedule =
          s.kind === 'weekly'
            ? { kind: 'weekly', weekday: Math.min(7, Math.max(1, parseInt(s.weekday, 10) || 1)), time }
            : { kind: 'daily', time }
        return {
          id: String(t.id).slice(0, 24),
          name: String(t.name).slice(0, 60),
          desc: String(t.desc || '').slice(0, 300),
          icon: String(t.icon || 'ti-sparkles').slice(0, 32),
          on: t.on === true,
          createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
          schedule,
        }
      })
    fs.writeFileSync(AUTO_TASKS_FILE, JSON.stringify({ items }, null, 2), 'utf8')
    return { ok: true, count: items.length }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

ipcMain.handle('tasks:runs:get', () => ({ runs: autoRuns.runs || {} }))

// 「马上跑」（M7 统一）：与到点走同一条执行管道（TaskRunner）——不再跳总管聊天。
// 立即返回"已开跑"；执行在后台进行（跑完写记录 + 通知），同一任务并发时拒绝。
ipcMain.handle('tasks:run', (_event, payload) => {
  const id = payload && typeof payload.id === 'string' ? payload.id : ''
  if (id === '') return { ok: false, error: '没给任务' }
  if (!autoScheduler) return { ok: false, error: '调度器还没就绪，稍后再试' }
  const task = readAutoTasks().find((t) => t && t.id === id)
  if (!task) return { ok: false, error: '任务不存在（先在自动任务页建好它）' }
  const started = autoScheduler.runNow(task)
  return started ? { ok: true } : { ok: false, error: '这个任务正在跑，跑完再看' }
})

// ---------- 任务会话桥（M7 批 1a：派活任务的后端与台账；发布页接入在批 1b） ----------
const TASK_SESSIONS_DIR = kernelDataPath('task-sessions')
const taskSessions = new Map() // id → { id, name, staff, state, startedAt, endedAt, summary, messages }
function saveTaskSession(id) {
  try {
    fs.mkdirSync(TASK_SESSIONS_DIR, { recursive: true })
    fs.writeFileSync(path.join(TASK_SESSIONS_DIR, id + '.json'), JSON.stringify(taskSessions.get(id)), 'utf8')
  } catch (error) {
    /* 落盘失败不影响执行 */
  }
}
function loadTaskSessions() {
  try {
    fs.mkdirSync(TASK_SESSIONS_DIR, { recursive: true })
    const files = fs
      .readdirSync(TASK_SESSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return { f, t: fs.statSync(path.join(TASK_SESSIONS_DIR, f)).mtimeMs }
        } catch (error) {
          return { f, t: 0 }
        }
      })
      .sort((a, b) => b.t - a.t)
    // 只保留最近 30 个任务文件（旧的清掉）
    for (const item of files.slice(30)) {
      try {
        fs.rmSync(path.join(TASK_SESSIONS_DIR, item.f), { force: true })
      } catch (error) {
        /* 忽略 */
      }
    }
    for (const item of files.slice(0, 30)) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(TASK_SESSIONS_DIR, item.f), 'utf8'))
        if (rec && typeof rec.id === 'string') {
          // 重启后遗留的"运行中"任务：如实标为中断（不装成功）
          if (rec.state === 'running') {
            rec.state = 'failed'
            rec.summary = rec.summary || '应用重启，这轮没跑完'
          }
          taskSessions.set(rec.id, rec)
        }
      } catch (error) {
        /* 坏文件跳过 */
      }
    }
  } catch (error) {
    /* 目录不可用时任务仍在内存里工作 */
  }
}
/** 派活任务的纪律尾注（与自动任务同源；措辞按"用户派活"场景） */
const DISPATCH_DISCIPLINE = [
  '（任务纪律：这是用户派给你的活。准备工作照做；',
  '但"发布、删除、发送回复"这类不可逆动作，除非派活内容里明确说明"用户已确认、直接做"，否则一律停下等用户来确认。',
  '做完把结果说清楚：干了什么、结果如何、接下来等用户做什么。）',
].join('\n')
/** 安全截断（按字符而非 UTF-16 单元，emoji 不截半）——对抗审查 R3 */
const clipSafe = (s, n) => Array.from(String(s == null ? '' : s)).slice(0, n).join('')
async function runDispatchedTask(id, prompt) {
  const rec = taskSessions.get(id)
  try {
    await ensurePublishReady()
    const bridge = await getBridge()
    // 过程行（对抗审查 R1）：运行中任务视图的实时反馈（人话短语，不携带工具参数）
    const { liveLineOf } = await import(pathToFileURL(path.join(__dirname, 'kernel', 'activity.mjs')).href)
    let streamedText = ''
    const result = await bridge.ask(prompt, (delta) => { streamedText += delta }, {
      sessionId: 'jco-chat-task-' + id,
      onActivity: (act) => {
        try {
          const line = liveLineOf(act)
          if (line && Array.isArray(rec.live) && rec.live.length < 30) rec.live.push({ t: Date.now(), text: line })
        } catch (error) {
          /* 过程行失败不影响任务 */
        }
        BrowserWindow.getAllWindows().forEach((win) => {
          try {
            win.webContents.send('kernel:activity', { ...act, taskId: id, taskName: rec.name, staff: rec.staff || '' })
          } catch (error) {
            /* 窗口已关闭则忽略 */
          }
        })
      },
    })
    rec.endedAt = Date.now()
    rec.state = result.ok ? 'done' : 'failed'
    rec.summary = clipSafe(String((result.ok ? result.text : result.error) || streamedText || ''), 300)
    rec.messages = [
      { role: 'user', text: prompt, t: rec.startedAt },
      { role: 'assistant', text: String((result.ok ? result.text || streamedText : '没跑成：' + (result.error || '未知错误')) || ''), t: rec.endedAt },
    ]
    rec.live = []
  } catch (error) {
    rec.endedAt = Date.now()
    rec.state = 'failed'
    rec.summary = '调度出错：' + clipSafe(String((error && error.message) || error), 200)
    rec.messages = [
      { role: 'user', text: prompt, t: rec.startedAt },
      { role: 'assistant', text: rec.summary, t: rec.endedAt },
    ]
    rec.live = []
  }
  saveTaskSession(id)
  notifyTaskResult(rec)
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send('kernel:task', { taskId: id, phase: rec.state === 'done' ? 'done' : 'fail', state: rec.state, summary: rec.summary, name: rec.name })
    } catch (error) {
      /* 窗口已关闭则忽略 */
    }
  })
}
ipcMain.handle('tasks:dispatch', (_event, payload) => {
  try {
    const name = clipSafe(String((payload && payload.name) || '').trim(), 60)
    const prompt = clipSafe(String((payload && payload.prompt) || '').trim(), 4000)
    const staff = String((payload && payload.staff) || '').slice(0, 20)
    if (name === '' || prompt === '') return { ok: false, error: '没给任务名或内容' }
    const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    // 上限保护（对抗审查 R4）：>50 条时清最旧的已完成记录（台账文件保留，内存只留活跃 + 最近）
    if (taskSessions.size > 50) {
      const finished = Array.from(taskSessions.values())
        .filter((r) => r.state !== 'running')
        .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
      while (taskSessions.size > 50 && finished.length > 0) taskSessions.delete(finished.shift().id)
    }
    taskSessions.set(id, { id, name, staff, state: 'running', startedAt: Date.now(), endedAt: 0, summary: '', messages: [], live: [] })
    saveTaskSession(id)
    void runDispatchedTask(id, prompt + '\n' + DISPATCH_DISCIPLINE)
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        win.webContents.send('kernel:task', { taskId: id, phase: 'start', state: 'running', name })
      } catch (error) {
        /* 忽略 */
      }
    })
    return { ok: true, taskId: id }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('tasks:sessions', () => {
  const list = Array.from(taskSessions.values())
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      name: r.name,
      staff: r.staff,
      state: r.state,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      summary: String(r.summary || '').slice(0, 120),
    }))
  return { tasks: list }
})
ipcMain.handle('tasks:session:get', (_event, payload) => {
  const id = payload && typeof payload.id === 'string' ? payload.id : ''
  const rec = taskSessions.get(id)
  if (!rec) return { ok: false, error: '任务不存在' }
  return { ok: true, task: { ...rec, messages: Array.isArray(rec.messages) ? rec.messages.slice(-30) : [] } }
})

// 测试模式：用独立的临时数据目录，避免和正在使用的 J.Co 抢单实例锁
// （名字加随机段：防 pid 复用时读到上一个测试实例残留的 profile——2026-10-16 全量 E2E 偶发"读到旧侧栏状态"的教训）
if (process.argv.includes('--jco-test')) {
  app.setPath('userData', path.join(app.getPath('temp'), 'jco-test-' + process.pid + '-' + Date.now().toString(36)))
}

function createWindow() {
  // 按屏幕可用区域自适应并居中：窗口永远完整落在屏幕里（高缩放/小屏也不会被切）
  const wa = screen.getPrimaryDisplay().workArea
  const width = Math.min(1440, wa.width - 32)
  const height = Math.min(900, wa.height - 32)

  const win = new BrowserWindow({
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round((wa.height - height) / 2),
    width,
    height,
    minWidth: Math.min(980, width),
    minHeight: Math.min(600, height),
    title: 'J.Co',
    backgroundColor: '#f7f7f7',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())
  // 每次页面导航完成：按当前主题偏好重新注入覆盖（页面切换后主题不丢）
  win.webContents.on('did-finish-load', () => applyThemeToWindow(win))
  // 托盘开启时：关窗口=缩到托盘（不退出）；托盘菜单「退出」才真退出
  win.on('close', (event) => {
    if (trayEnabled && !app.isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })
  win.loadFile(path.join(UI_DIR, ENTRY))

  // 外链一律交给系统浏览器打开，不在应用窗口里乱跳
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

// 不要 Electron 自带的英文菜单栏，界面保持干净
Menu.setApplicationMenu(null)

// 只允许开一个 J.Co：重复双击时把已有窗口拉到前面，不再开新的
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    const saved = readSettings()
    if (saved.theme === 'dark' || saved.theme === 'light') nativeTheme.themeSource = saved.theme
    if (saved.tray === true) {
      trayEnabled = true
      createTray()
    }
    createWindow()
    // 后台预热内核（几秒就绪；不阻塞窗口显示，失败也不影响界面）
    getBridge()
      .then((bridge) => bridge.warmUp().catch(() => {}))
      .catch(() => {})
    // 自动任务调度器（M6）：每分钟心跳；启动即补跑检查
    startAutoScheduler().catch(() => {})
    // 任务会话（M7 桥）：加载历史任务台账（重启后任务列表/回看不丢）
    loadTaskSessions()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// 退出前回收内核进程（带 1.5s 兜底，不让清理拖住退出）
// 退出前收掉发布会话（浏览器会跟着关闭；不等它，防拖住退出）
app.on('before-quit', () => {
  if (publishSessionManager) publishSessionManager.stop()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !bridgePromise) return
  event.preventDefault()
  quitting = true
  const finish = () => app.quit()
  Promise.resolve(bridgePromise)
    .then((bridge) => bridge.close())
    .catch(() => {})
    .finally(finish)
  setTimeout(finish, 1500)
})

app.on('window-all-closed', () => {
  if (trayEnabled && !app.isQuitting) return // 托盘模式：关窗只是收起，应用继续活着
  app.quit()
})
