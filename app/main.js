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

// 内核对话：渲染进程 ask → 内核 → 增量推回
ipcMain.handle('kernel:ask', async (event, payload) => {
  const sender = event.sender
  try {
    const text = typeof payload === 'string' ? payload : String((payload && payload.text) || '')
    const sessionId = (payload && typeof payload === 'object' && payload.sessionId) ? ('jco-chat-' + String(payload.sessionId)) : undefined
    const bridge = await getBridge()
    return await bridge.ask(text, (delta) => {
      if (!sender.isDestroyed()) sender.send('kernel:delta', delta)
    }, sessionId ? { sessionId } : undefined)
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

// 测试模式：用独立的临时数据目录，避免和正在使用的 J.Co 抢单实例锁
if (process.argv.includes('--jco-test')) {
  app.setPath('userData', path.join(app.getPath('temp'), 'jco-test-' + process.pid))
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
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// 退出前回收内核进程（带 1.5s 兜底，不让清理拖住退出）
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
