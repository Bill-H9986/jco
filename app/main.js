const { app, BrowserWindow, Menu, shell, screen, ipcMain, nativeTheme, session, dialog, Tray, nativeImage, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFileSync, spawn } = require('child_process')
const { pathToFileURL } = require('url')
const PACKAGE_JSON = require('./package.json')
const { createMediaJobService } = require('./media-jobs.cjs')

const JCO_TEST_MODE = process.argv.includes('--jco-test')
// 测试模式必须先切 userData，再初始化发布会话、素材目录和任何依赖用户路径的服务。
// 名字带随机段：防 pid 复用时读到上一个测试实例残留的 profile。
if (JCO_TEST_MODE) {
  const tempRoot = path.resolve(app.getPath('temp'))
  const requestedProfile = String(process.env.JCO_TEST_PROFILE_DIR || '').trim()
  const resolvedProfile = requestedProfile ? path.resolve(requestedProfile) : ''
  if (requestedProfile && (resolvedProfile === tempRoot || !resolvedProfile.startsWith(tempRoot + path.sep))) {
    throw new Error('JCO_TEST_PROFILE_DIR 必须位于系统临时目录内')
  }
  app.setPath(
    'userData',
    resolvedProfile || path.join(tempRoot, 'jco-test-' + process.pid + '-' + Date.now().toString(36)),
  )
}

// 界面文件在 J.Co\设计原型 里（和本工程是邻居），整个 J.Co 文件夹搬走也能正常打开
const UI_DIR = path.join(__dirname, '..', '设计原型')
const ENTRY = 'J.Co应用壳.html' // 应用壳（M10 前端一壳化）：侧栏常驻，内容区只换视图

// ---------- 应用级设置（主进程持有：主题偏好等；开机启动由系统记录） ----------
// 打包版：设置写入用户数据目录（安装目录只读）；开发版：沿用工程内文件
const SETTINGS_PATH = JCO_TEST_MODE
  ? path.join(app.getPath('userData'), 'settings.json')
  : (app.isPackaged ? path.join(app.getPath('userData'), 'settings.json') : path.join(__dirname, 'settings.json'))
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) } catch (e) { return {} }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch }
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2)) } catch (e) {}
  return next
}
function settingsView() {
  const saved = readSettings()
  return {
    theme: saved.theme || 'system',
    tray: saved.tray === true,
    mode: saved.mode === 'ask' ? 'ask' : 'auto',
    notifyDone: saved.notifyDone !== false,
    notifyAuth: saved.notifyAuth !== false,
    assetsDir: saved.assetsDir || assetsDirPath(),
  }
}
ipcMain.handle('settings:get', () => ({ ok: true, ...settingsView() }))
ipcMain.on('settings:get-sync', (event) => {
  event.returnValue = { ok: true, ...settingsView() }
})
ipcMain.handle('settings:save', (_event, patch) => {
  const safe = {}
  if (patch && (patch.mode === 'auto' || patch.mode === 'ask')) safe.mode = patch.mode
  if (patch && typeof patch.notifyDone === 'boolean') safe.notifyDone = patch.notifyDone
  if (patch && typeof patch.notifyAuth === 'boolean') safe.notifyAuth = patch.notifyAuth
  writeSettings(safe)
  return { ok: true, ...settingsView() }
})

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
  const payload = { theme: m, resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' }
  BrowserWindow.getAllWindows().forEach((win) => {
    try { win.webContents.send('sys:theme', payload) } catch (error) { /* 窗口已关闭则忽略 */ }
  })
  return { ok: true, ...payload }
})
ipcMain.handle('sys:theme:get', () => ({
  ok: true,
  theme: readSettings().theme || 'system',
  resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
}))
const DSH_VERSION = String((PACKAGE_JSON.dependencies && PACKAGE_JSON.dependencies['@deepseek-ai/dsh']) || '')
  .replace(/^[~^]/, '')
ipcMain.handle('sys:app-info', () => ({
  ok: true,
  version: app.getVersion(),
  dshVersion: DSH_VERSION,
  packaged: app.isPackaged,
}))

// ---------- 自动更新（electron-updater + generic HTTPS 静态源） ----------
let updateController = null
let updateTimer = null
let updateCheckInFlight = false
let updateDownloadInFlight = false
const UPDATE_CHECK_TIMEOUT_MS = 20_000
let updateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  dshVersion: DSH_VERSION,
  latestVersion: '',
  percent: 0,
  message: '自动更新准备中…',
  feedConfigured: false,
  checkedAt: 0,
}
function updateUserConfigPath() {
  return path.join(app.getPath('userData'), 'update-channel.json')
}
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return null
  }
}
function packagedUpdateFeedUrl() {
  if (!app.isPackaged) return ''
  try {
    const text = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const match = text.match(/^url:\s*['"]?(.+?)['"]?\s*$/m)
    return match ? match[1].trim() : ''
  } catch (error) {
    return ''
  }
}
function resolveUpdateChannel() {
  const module = require('./dist/application/update-channel.js')
  const bundled = PACKAGE_JSON.jco || {}
  const user = readJsonFile(updateUserConfigPath()) || {}
  const envFeedUrl = String(process.env.JCO_UPDATE_FEED_URL || '').trim()
  const feedUrl = envFeedUrl || user.feedUrl || bundled.feedUrl || packagedUpdateFeedUrl()
  return module.normalizeUpdateChannel(
    {
      ...bundled,
      ...user,
      feedUrl,
    },
    {
      allowInsecure: process.env.JCO_UPDATE_ALLOW_INSECURE === '1',
      currentVersion: app.getVersion(),
    },
  )
}
function broadcastUpdateState() {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send('update:event', updateState)
    } catch (error) {
      /* 窗口已关闭则忽略 */
    }
  })
}
function setUpdateState(patch) {
  updateState = { ...updateState, ...patch }
  broadcastUpdateState()
  return updateState
}
function updateErrorText(error) {
  return String((error && error.message) || error || '未知错误')
}
function isNewerVersion(candidate) {
  const module = require('./dist/application/update-installer.js')
  return module.isNewerVersion(String(candidate || ''), app.getVersion())
}
function pruneStaleUpdateCache() {
  try {
    const dir = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'jco-updater', 'pending')
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      try {
        fs.rmSync(path.join(dir, name), { force: true })
      } catch (error) {}
    }
  } catch (error) {}
}
function updateChannelName(version) {
  const match = String(version || '').match(/-(alpha|beta|rc|next)\./i)
  return match ? match[1].toLowerCase() : 'latest'
}
async function checkForUpdates(manual = false) {
  if (!updateController) return updateState
  if (updateCheckInFlight || ['checking', 'downloading', 'downloaded', 'installing'].includes(updateState.phase)) {
    return updateState
  }
  updateCheckInFlight = true
  setUpdateState({ phase: 'checking', message: manual ? '正在检查更新…' : '后台检查更新…' })
  try {
    const module = require('./dist/application/update-channel.js')
    await module.withTimeout(
      Promise.resolve(updateController.checkForUpdates()),
      UPDATE_CHECK_TIMEOUT_MS,
      '检查更新超时：连不上 GitHub，请检查网络后重试',
    )
  } catch (error) {
    setUpdateState({ phase: 'error', message: '检查更新失败：' + updateErrorText(error) })
  } finally {
    updateCheckInFlight = false
  }
  return updateState
}
function installUpdateNow() {
  if (!updateController || updateState.phase !== 'downloaded') return updateState
  const installer = resolveInstallerPath()
  if (!installer) {
    setUpdateState({ phase: 'error', message: '找不到已下载的安装包，请重新下载更新。' })
    return updateState
  }
  setUpdateState({ phase: 'installing', message: '正在退出并安装更新…' })
  try {
    let target = installer
    if (!/\.exe$/i.test(target)) {
      const copy = path.join(path.dirname(target), 'installer.exe')
      fs.copyFileSync(target, copy)
      target = copy
    }
    const child = spawn(target, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
    child.on('error', (error) => {
      setUpdateState({ phase: 'error', message: '启动安装程序失败：' + updateErrorText(error) })
    })
    child.unref()
    setImmediate(() => app.quit())
  } catch (error) {
    setUpdateState({ phase: 'error', message: '启动安装程序失败：' + updateErrorText(error) })
  }
  return updateState
}

function resolveInstallerPath() {
  const module = require('./dist/application/update-installer.js')
  const helper = updateController && updateController.downloadedUpdateHelper
  const helperFile = helper ? String(helper.packageFile || '') : ''
  const cacheRoot = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'jco-updater')
  const installerExe = path.join(cacheRoot, 'installer.exe')
  const pendingDownload = path.join(cacheRoot, 'pending', 'download')
  return module.pickInstallerPath([
    { path: helperFile, exists: Boolean(helperFile) && fs.existsSync(helperFile) },
    { path: pendingDownload, exists: fs.existsSync(pendingDownload) },
    { path: installerExe, exists: fs.existsSync(installerExe) },
  ])
}
async function downloadUpdateNow() {
  if (!updateController) return updateState
  if (updateDownloadInFlight || !['available', 'error'].includes(updateState.phase)) return updateState
  updateDownloadInFlight = true
  setUpdateState({ phase: 'downloading', percent: 0, message: '正在下载更新…' })
  try {
    await updateController.downloadUpdate()
  } catch (error) {
    setUpdateState({ phase: 'error', message: '下载更新失败：' + updateErrorText(error) })
  } finally {
    updateDownloadInFlight = false
  }
  return updateState
}
function initAutoUpdater() {
  updateState = {
    ...updateState,
    currentVersion: app.getVersion(),
    dshVersion: DSH_VERSION,
  }
  if (JCO_TEST_MODE && process.env.JCO_UPDATE_TEST_MODE !== '1') {
    return setUpdateState({ phase: 'disabled', message: '测试模式不检查更新' })
  }
  if (!app.isPackaged) {
    return setUpdateState({ phase: 'disabled', message: '开发模式不检查更新' })
  }
  let config
  try {
    config = resolveUpdateChannel()
  } catch (error) {
    return setUpdateState({ phase: 'error', message: '更新配置无效：' + updateErrorText(error) })
  }
  if (!config.feedUrl) {
    return setUpdateState({ phase: 'disabled', feedConfigured: false, message: '安装包未配置更新源' })
  }
  try {
    const { autoUpdater } = require('electron-updater')
    // 只自动检测，不自动下载或安装；下载/安装必须由用户点击确认。
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = config.allowPrerelease
    const channel = updateChannelName(app.getVersion())
    autoUpdater.channel = channel
    autoUpdater.setFeedURL({ provider: 'generic', url: config.feedUrl, channel })
    autoUpdater.on('checking-for-update', () => {
      setUpdateState({ phase: 'checking', feedConfigured: true, message: '正在检查更新…' })
    })
    autoUpdater.on('update-available', (info) => {
      if (!isNewerVersion(info && info.version)) return
      setUpdateState({
        phase: 'available',
        feedConfigured: true,
        latestVersion: String((info && info.version) || ''),
        message: '发现新版本，点「下载更新」后才会开始下载。',
      })
      if (Notification.isSupported()) {
        try {
          new Notification({
            title: 'J.Co 有新版本',
            body: `v${String((info && info.version) || '')} 可用；打开应用点「下载更新」才会下载。`,
          }).show()
        } catch (error) {}
      }
    })
    autoUpdater.on('update-not-available', () => {
      pruneStaleUpdateCache()
      setUpdateState({
        phase: 'up-to-date',
        feedConfigured: true,
        latestVersion: '',
        percent: 0,
        checkedAt: Date.now(),
        message: '已是最新版本',
      })
    })
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, Number(progress && progress.percent) || 0))
      setUpdateState({
        phase: 'downloading',
        feedConfigured: true,
        percent,
        message: `正在下载更新 ${percent.toFixed(0)}%`,
      })
    })
    autoUpdater.on('update-downloaded', (info) => {
      const latestVersion = String((info && info.version) || updateState.latestVersion || '')
      if (!isNewerVersion(latestVersion)) {
        pruneStaleUpdateCache()
        setUpdateState({
          phase: 'up-to-date',
          feedConfigured: true,
          latestVersion: '',
          percent: 0,
          checkedAt: Date.now(),
          message: '已是最新版本',
        })
        return
      }
      setUpdateState({
        phase: 'downloaded',
        feedConfigured: true,
        latestVersion,
        percent: 100,
        checkedAt: Date.now(),
        message: `v${latestVersion} 已下载，点「重启并安装」后才会安装。`,
      })
      if (Notification.isSupported()) {
        try {
          new Notification({
            title: 'J.Co 更新已准备好',
          body: `v${latestVersion} 已下载；点「重启并安装」后才会安装。`,
          }).show()
        } catch (error) {}
      }
    })
    autoUpdater.on('error', (error) => {
      setUpdateState({ phase: 'error', feedConfigured: true, message: '自动更新失败：' + updateErrorText(error) })
    })
    updateController = autoUpdater
    updateState = { ...updateState, phase: 'idle', feedConfigured: true, message: '自动更新已开启' }
    broadcastUpdateState()
    setTimeout(() => void checkForUpdates(false), 15_000)
    updateTimer = setInterval(() => void checkForUpdates(false), config.checkIntervalHours * 60 * 60 * 1000)
  } catch (error) {
    setUpdateState({ phase: 'error', message: '自动更新初始化失败：' + updateErrorText(error) })
  }
}
ipcMain.handle('updates:get', () => updateState)
ipcMain.handle('updates:check', () => checkForUpdates(true))
ipcMain.handle('updates:download', () => downloadUpdateNow())
ipcMain.handle('updates:install', () => installUpdateNow())

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
  if (JCO_TEST_MODE) {
    testLoginEnabled = !!enable
    writeSettings({ __testLoginEnabled: testLoginEnabled })
    return { ok: true, enabled: testLoginEnabled }
  }
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
  if (JCO_TEST_MODE) return { ok: true, enabled: testLoginEnabled }
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
    if (JCO_TEST_MODE && process.env.JCO_TEST_PICK_FILES) {
      return {
        ok: true,
        files: process.env.JCO_TEST_PICK_FILES.split(path.delimiter)
          .filter(Boolean)
          .map((filePath) => ({ path: filePath, name: path.basename(filePath) })),
      }
    }
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
    const chosen = res.filePaths[0]
    // 设置页选择目录后必须写进主进程设置；只写 localStorage = 生成物仍落默认目录。
    writeSettings({ assetsDir: chosen })
    // 刷新后期工具配置；已运行的内核要等下次启动/重建才读取新目录。
    writeEditToolsConfig()
    return { ok: true, path: chosen }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

// 生成物落盘（真：图片/视频存进素材文件夹；设置页选过目录就存那儿）
async function saveAssetPayload(payload) {
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
}
ipcMain.handle('sys:save-asset', async (_event, payload) => saveAssetPayload(payload))

// 用系统浏览器打开链接（只放行 https；用于平台登录页等）
/** 成片目录（素材库）——后期与做视频共用 */
function assetsDirPath() {
  const dir = readSettings().assetsDir || path.join(app.getPath('userData'), 'assets')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
function editAssetNames() {
  try {
    return fs.readdirSync(assetsDirPath()).filter((name) => /\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(name))
  } catch (error) {
    return []
  }
}
/** 后期工具配置（M9 后期·AI 代劳）：成片目录 + ffmpeg 路径；bridge 生成 patch 时读 */
function writeEditToolsConfig() {
  try {
    const ffmpegPath = kernelUnpackedPath(String(require('@ffmpeg-installer/ffmpeg').path || ''))
    const file = kernelUnpackedPath(path.join(__dirname, 'kernel', 'edit-tools.json'))
    const cancelFile = kernelUnpackedPath(path.join(__dirname, 'kernel', 'edit-tools.cancel'))
    fs.writeFileSync(
      file,
      JSON.stringify({ assetsDir: assetsDirPath(), ffmpeg: ffmpegPath, timeoutMs: 600000, cancelFile }),
      'utf8',
    )
  } catch (error) {
    console.warn('[edit] 后期工具配置写入失败：' + String((error && error.message) || error))
  }
}
function requestEditCancel() {
  try {
    fs.writeFileSync(kernelUnpackedPath(path.join(__dirname, 'kernel', 'edit-tools.cancel')), 'cancel', 'utf8')
  } catch (error) {
    console.warn('[edit] 写入取消标记失败：' + String((error && error.message) || error))
  }
}
function clearEditCancel() {
  try {
    fs.rmSync(kernelUnpackedPath(path.join(__dirname, 'kernel', 'edit-tools.cancel')), { force: true })
  } catch (error) {
    /* 忽略清理失败 */
  }
}
/** 列成片目录（后期页「手头成片」/做视频「手头素材」共用） */
ipcMain.handle('sys:list-assets', () => {
  try {
    const dir = assetsDirPath()
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(mp4|mov|m4v|mkv|webm|avi|mp3|m4a|wav|aac|flac|ogg)$/i.test(f))
      .map((f) => {
        try {
          const st = fs.statSync(path.join(dir, f))
          return { name: f, sizeKB: Math.round(st.size / 1024), modified: st.mtimeMs }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.modified - a.modified)
      .slice(0, 100)
    return { ok: true, dir, files }
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
let testLoginEnabled = false
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
  if (JCO_TEST_MODE) return { ok: true, enabled: trayEnabled }
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
const TEST_KERNEL_DATA_DIR = path.join(app.getPath('temp'), 'jco-test-kernel-data')
function kernelDataPath(name) {
  return JCO_TEST_MODE ? path.join(TEST_KERNEL_DATA_DIR, name) : kernelUnpackedPath(path.join(__dirname, 'kernel', name))
}
const SKILLS_FILE = kernelDataPath('skills.json')
/** 自动任务（M6）：任务表（页面同步，调度器只读）与执行记录（调度器写，页面只读） */
const AUTO_TASKS_FILE = kernelDataPath('auto-tasks.json')
const AUTO_RUNS_FILE = kernelDataPath('auto-runs.json')
const TOPICS_FILE = kernelDataPath('topics.json')
const BRAND_PROFILE_FILE = kernelDataPath('brand-profile.json')
const KNOWLEDGE_CONTENT_LIMIT = 8000
const BRAND_BUSINESS_LIMIT = 500
const BRAND_PRODUCTS_LIMIT = 1000
const KNOWLEDGE_SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi,
]
function redactKnowledgeText(value) {
  let output = String(value || '')
  for (const pattern of KNOWLEDGE_SECRET_PATTERNS) output = output.replace(pattern, '[已脱敏]')
  return output
}
function clipKnowledgeContent(value) {
  return String(value || '').slice(0, KNOWLEDGE_CONTENT_LIMIT)
}
const MATERIALS_FILE = kernelDataPath('materials.json')
const SCRIPTS_FILE = kernelDataPath('scripts.json')
const DRAFTS_FILE = kernelDataPath('drafts.json')
const OPS_FILE = kernelDataPath('ops.json')
const ACCOUNTS_FILE = kernelDataPath('accounts.json')
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
    const sessionId = (payload && typeof payload === 'object' && payload.sessionId) ? ('chat:' + String(payload.sessionId)) : undefined
    const bridge = await getBridge()
    const options = { profile: 'chat' }
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

// 内核模型配置：安装目录里的文件会被覆盖安装清掉，userData 里保留一份并在启动时恢复
function modelConfigFile() {
  const dev = path.join(__dirname, 'kernel', 'model-config.json')
  const packed = path.join(process.resourcesPath, 'app.asar.unpacked', 'kernel', 'model-config.json')
  return app.isPackaged ? packed : dev
}
function modelConfigBackup() {
  return path.join(app.getPath('userData'), 'kernel', 'model-config.json')
}
function restoreModelConfig() {
  try {
    const file = modelConfigFile()
    const backup = modelConfigBackup()
    if (!fs.existsSync(file) && fs.existsSync(backup)) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.copyFileSync(backup, file)
    }
  } catch (error) {}
}
function backupModelConfig() {
  try {
    const file = modelConfigFile()
    const backup = modelConfigBackup()
    if (fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(backup), { recursive: true })
      fs.copyFileSync(file, backup)
    }
  } catch (error) {}
}

// 保存设置页「说话写稿」配置：写配置 + 重建内核（下一条消息按新路由走）
ipcMain.handle('kernel:set-model', async (_event, config) => {
  try {
    const bridge = await getBridge()
    const result = await bridge.setModel(config)
    backupModelConfig()
    return result
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
const SKILL_TOOL_MAP = {
  writer: [],
  editor: ['jco_list_assets', 'jco_probe_video', 'jco_add_subtitles', 'jco_add_music', 'jco_trim', 'jco_concat'],
  operator: [
    'jco_open_page', 'jco_snapshot', 'jco_click', 'jco_type_text', 'jco_upload_file',
    'jco_scroll', 'jco_screenshot', 'jco_wait', 'jco_save_report', 'jco_save_comments',
  ],
  publisher: ['jco_open_page', 'jco_snapshot', 'jco_click', 'jco_type_text', 'jco_upload_file', 'jco_scroll', 'jco_screenshot', 'jco_wait'],
}
function normalizeSkills(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((i) => i && typeof i.id === 'string' && i.id !== '')
    .map((i) => {
      const kind = ['video', 'graphic', 'social', 'data'].includes(i.kind) ? i.kind : 'video'
      const scenes = Array.isArray(i.scenes) ? i.scenes.map(String).slice(0, 10) : []
      const role = kind === 'social' || kind === 'data'
        ? 'operator'
        : (kind === 'video' || scenes.includes('make-video'))
          ? 'editor'
          : 'writer'
      return {
        id: String(i.id).slice(0, 24),
        name: String(i.name || '').slice(0, 40),
        desc: String(i.desc || '').slice(0, 200),
        entry: String(i.entry || '').slice(0, 160),
        icon: String(i.icon || 'ti-sparkles').slice(0, 32),
        kind,
        scenes,
        role,
        allowedTools: SKILL_TOOL_MAP[role] || [],
        on: i.on === true,
      }
    })
}
function readSkills() {
  try {
    const data = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'))
    return normalizeSkills(data && data.items)
  } catch (error) {
    return []
  }
}
function writeSkills(raw) {
  const items = normalizeSkills(raw)
  fs.mkdirSync(path.dirname(SKILLS_FILE), { recursive: true })
  fs.writeFileSync(SKILLS_FILE, JSON.stringify({ items }, null, 2), 'utf8')
  // 技能段属于 chat 的系统 persona：变更后重建已存在的 chat Harness，下一轮生效。
  void getBridge()
    .then((bridge) => bridge.reloadProfile('chat'))
    .catch(() => {})
  return items
}
ipcMain.handle('skills:sync', (_event, payload) => {
  try {
    const items = writeSkills(payload && payload.items)
    return { ok: true, count: items.length }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('skills:get', () => ({ ok: true, items: readSkills() }))
ipcMain.handle('skills:save', (_event, payload) => {
  try {
    return { ok: true, items: writeSkills(payload && payload.items) }
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
        assetsDir: assetsDirPath(),
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
      return JSON.parse(fs.readFileSync(path.join(publishDataDir(), name), 'utf8'))
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
function normalizeAutoTasks(raw) {
  return (Array.isArray(raw) ? raw : [])
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
        when: String(t.when || (schedule.kind === 'weekly'
          ? '每周' + ['一', '二', '三', '四', '五', '六', '日'][schedule.weekday - 1] + ' ' + time
          : '每天 ' + time)).slice(0, 40),
        on: t.on === true,
        createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
        schedule,
      }
    })
}
function writeAutoTasks(raw) {
  const items = normalizeAutoTasks(raw)
  fs.writeFileSync(AUTO_TASKS_FILE, JSON.stringify({ items }, null, 2), 'utf8')
  return items
}
function emptyTopics() {
  return { version: 1, inspos: [], radar: [], favs: [] }
}
function normalizeTopics(input) {
  const data = input && typeof input === 'object' ? input : {}
  return {
    version: 1,
    inspos: Array.isArray(data.inspos) ? data.inspos.filter((item) => item && typeof item === 'object').slice(0, 10) : [],
    radar: Array.isArray(data.radar) ? data.radar.filter((item) => item && typeof item === 'object').slice(0, 60) : [],
    favs: Array.isArray(data.favs) ? data.favs.map((item) => String(item || '').slice(0, 200)).filter(Boolean).slice(0, 100) : [],
  }
}
function readTopics() {
  try {
    return normalizeTopics(JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8')))
  } catch (error) {
    return emptyTopics()
  }
}
function writeTopics(data) {
  const normalized = normalizeTopics(data)
  fs.mkdirSync(path.dirname(TOPICS_FILE), { recursive: true })
  const temp = TOPICS_FILE + '.tmp-' + process.pid
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(temp, TOPICS_FILE)
  return normalized
}
function normalizeBrandProfile(input) {
  const data = input && typeof input === 'object' ? input : {}
  const platforms = Array.isArray(data.platforms)
    ? [...new Set(data.platforms.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 10)
    : []
  const forbidden = Array.isArray(data.forbidden)
    ? [...new Set(data.forbidden.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 20)
    : []
  return {
    industry: String(data.industry || '').trim().slice(0, 100),
    business: String(data.business || '').trim().slice(0, BRAND_BUSINESS_LIMIT),
    products: String(data.products || '').trim().slice(0, BRAND_PRODUCTS_LIMIT),
    audience: String(data.audience || '').trim().slice(0, 200),
    platforms,
    tone: String(data.tone || '').trim().slice(0, 100),
    forbidden,
    knowledgeAutoLearn: data.knowledgeAutoLearn !== false,
    knowledge: normalizeKnowledgeEntries(data.knowledge),
  }
}
function normalizeKnowledgeEntries(input) {
  const entries = Array.isArray(input) ? input : []
  const seen = new Set()
  return entries
    .filter((entry) => entry && typeof entry === 'object' && String(entry.content || '').trim())
    .map((entry, index) => {
      const fallback = `kb-${Date.now().toString(36)}-${index}`
      let id = String(entry.id || fallback).slice(0, 80)
      if (seen.has(id)) id = fallback
      seen.add(id)
      const tags = Array.isArray(entry.tags)
        ? [...new Set(entry.tags.map((tag) => redactKnowledgeText(tag).trim()).filter(Boolean))].slice(0, 10)
        : []
      return {
        id,
        title: redactKnowledgeText(String(entry.title || `知识 ${index + 1}`).trim()).slice(0, 120),
        content: clipKnowledgeContent(redactKnowledgeText(String(entry.content || '').trim())),
        tags,
        enabled: entry.enabled !== false,
        updatedAt: Number(entry.updatedAt) || Date.now(),
        source: ['manual', 'import', 'ai'].includes(entry.source) ? entry.source : 'manual',
        sourceTaskId: String(entry.sourceTaskId || '').slice(0, 80),
        sourceTaskTitle: redactKnowledgeText(String(entry.sourceTaskTitle || '')).slice(0, 100),
      }
    })
    .slice(0, 100)
}
function readBrandProfile() {
  try {
    return normalizeBrandProfile(JSON.parse(fs.readFileSync(BRAND_PROFILE_FILE, 'utf8')))
  } catch (error) {
    return {}
  }
}
function writeBrandProfile(input) {
  const normalized = normalizeBrandProfile(input)
  fs.mkdirSync(path.dirname(BRAND_PROFILE_FILE), { recursive: true })
  const temp = BRAND_PROFILE_FILE + '.tmp-' + process.pid
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(temp, BRAND_PROFILE_FILE)
  void getBridge()
    .then((bridge) =>
      Promise.all(
        ['chat', 'writer', 'publisher', 'operator', 'editor'].map((profile) =>
          bridge.reloadProfile(profile).catch(() => {}),
        ),
      ),
    )
    .catch(() => {})
  return normalized
}
function recordTaskKnowledge(task, resultText) {
  try {
    const profile = readBrandProfile()
    if (profile.knowledgeAutoLearn === false) return null
    const module = require('./dist/application/self-learning.js')
    const learned = module.buildLearnedKnowledge(
      {
        id: String(task.id || ''),
        title: String(task.title || task.name || '任务结果'),
        type: String(task.type || ''),
        status: String(task.status || ''),
      },
      String(resultText || ''),
    )
    if (!learned) return null
    const knowledge = module.mergeLearnedKnowledge(profile.knowledge || [], learned, 100)
    const saved = writeBrandProfile({ ...profile, knowledge })
    const entry = saved.knowledge.find((item) => item.sourceTaskId === learned.sourceTaskId) || learned
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        win.webContents.send('knowledge:event', { type: 'learned', entry, count: saved.knowledge.length })
      } catch (error) {
        /* 窗口已关闭则忽略 */
      }
    })
    return entry
  } catch (error) {
    return null
  }
}
function emptyMaterials() {
  return { version: 1, items: [] }
}
function normalizeMaterials(input) {
  const data = input && typeof input === 'object' ? input : {}
  const items = Array.isArray(data.items) ? data.items : []
  return {
    version: 1,
    items: items
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        cat: ['mine', 'web', 'idea'].includes(item.cat) ? item.cat : 'idea',
        type: ['video', 'photo', 'star', 'audio'].includes(item.type) ? item.type : 'photo',
        name: String(item.name || '').slice(0, 200),
        src: String(item.src || '').slice(0, 300),
        badge: String(item.badge || '').slice(0, 40),
        wm: item.wm === true,
        imported: item.imported === true,
        path: String(item.path || ''),
      }))
      .filter((item) => item.name)
      .slice(0, 100),
  }
}
function readMaterials() {
  try {
    return normalizeMaterials(JSON.parse(fs.readFileSync(MATERIALS_FILE, 'utf8')))
  } catch (error) {
    return emptyMaterials()
  }
}
function writeMaterials(data) {
  const normalized = normalizeMaterials(data)
  fs.mkdirSync(path.dirname(MATERIALS_FILE), { recursive: true })
  const temp = MATERIALS_FILE + '.tmp-' + process.pid
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(temp, MATERIALS_FILE)
  return normalized
}
function emptyScripts() {
  return { version: 1, current: null, artifacts: [] }
}
function normalizeScriptRecord(input) {
  if (!input || typeof input !== 'object') return null
  const lines = Array.isArray(input.lines) ? input.lines.map((line) => String(line ?? '')).slice(0, 500) : []
  if (!lines.some((line) => line.trim())) return null
  const now = Date.now()
  return {
    id: String(input.id || '').slice(0, 120),
    topic: String(input.topic || '').slice(0, 300),
    lines,
    xhs: input.xhs === true,
    source: ['generate', 'revise', 'manual', 'migrate'].includes(input.source) ? input.source : 'manual',
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now,
  }
}
function normalizeScripts(input) {
  const data = input && typeof input === 'object' ? input : {}
  const current = normalizeScriptRecord(data.current)
  const artifacts = Array.isArray(data.artifacts)
    ? data.artifacts.map(normalizeScriptRecord).filter(Boolean).slice(0, 50)
    : []
  if (current && !artifacts.some((item) => item.id === current.id)) artifacts.unshift(current)
  return { version: 1, current, artifacts: artifacts.slice(0, 50) }
}
function readScripts() {
  try {
    return normalizeScripts(JSON.parse(fs.readFileSync(SCRIPTS_FILE, 'utf8')))
  } catch (error) {
    return emptyScripts()
  }
}
function writeScripts(data) {
  const normalized = normalizeScripts(data)
  fs.mkdirSync(path.dirname(SCRIPTS_FILE), { recursive: true })
  const temp = SCRIPTS_FILE + '.tmp-' + process.pid
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(temp, SCRIPTS_FILE)
  return normalized
}
function saveScriptRecord(payload) {
  const incoming = normalizeScriptRecord(payload && payload.current ? payload.current : payload)
  if (!incoming) return readScripts()
  const data = readScripts()
  const now = Date.now()
  const id = incoming.id || 'script-' + now + '-' + Math.random().toString(36).slice(2, 8)
  const record = {
    ...incoming,
    id,
    createdAt: incoming.createdAt || now,
    updatedAt: now,
  }
  const artifacts = [record, ...data.artifacts.filter((item) => item.id !== id)].slice(0, 50)
  return writeScripts({ version: 1, current: record, artifacts })
}
function emptyDrafts() {
  return { version: 1, items: [] }
}
function normalizeDraft(input) {
  if (!input || typeof input !== 'object') return null
  const id = Number(input.id)
  if (!Number.isFinite(id)) return null
  const status = ['generating', 'interrupted', 'review', 'adjusted', 'approved'].includes(input.status)
    ? input.status
    : 'review'
  const shots = Array.isArray(input.shots)
    ? input.shots
        .filter((shot) => shot && typeof shot === 'object')
        .slice(0, 50)
        .map((shot) => ({
          line: String(shot.line || ''),
          pic: String(shot.pic || ''),
          picSrc: String(shot.picSrc || ''),
          picPath: String(shot.picPath || ''),
        }))
    : []
  const videos = {}
  if (input.videos && typeof input.videos === 'object') {
    Object.keys(input.videos).slice(0, 50).forEach((key) => {
      const video = input.videos[key]
      if (!video || typeof video !== 'object') return
      const videoStatus = ['done', 'failed', 'doing'].includes(video.status) ? video.status : 'failed'
      videos[key] = {
        status: videoStatus,
        url: String(video.url || ''),
        path: String(video.path || ''),
        videoId: String(video.videoId || ''),
        error: String(video.error || (videoStatus === 'doing' ? '上次出片被中断，点「重试」。' : '')),
      }
    })
  }
  const images = Array.isArray(input.images)
    ? input.images
        .filter((image) => image && typeof image === 'object')
        .slice(0, 20)
        .map((image) => {
          const src = String(image.src || '')
          const imagePath = String(image.path || '')
          const prompt = String(image.prompt || '')
          if (src.length > 300000 && !imagePath) {
            return { src: '', path: '', prompt: prompt + '（旧版大图未入草稿）' }
          }
          return { src, path: imagePath, prompt }
        })
    : []
  const now = Date.now()
  return {
    id,
    idea: String(input.idea || ''),
    title: String(input.title || '').slice(0, 120),
    status,
    type: input.type === 'image' ? 'image' : 'video',
    ratio: String(input.ratio || '9:16'),
    duration: String(input.duration || '30 秒'),
    res: String(input.res || '1080P'),
    voice: String(input.voice || '标准女声'),
    method: String(input.method || 'assemble'),
    fixNote: String(input.fixNote || ''),
    progress: Math.max(0, Math.min(100, Number(input.progress) || 0)),
    stepText: String(input.stepText || '').slice(0, 300),
    jobId: String(input.jobId || ''),
    jobKind: input.jobKind === 'image' || input.jobKind === 'video' ? input.jobKind : '',
    shots,
    videos,
    images,
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now,
  }
}
function normalizeDrafts(input) {
  const data = input && typeof input === 'object' ? input : {}
  const items = Array.isArray(data.items) ? data.items : []
  return {
    version: 1,
    items: items.map(normalizeDraft).filter(Boolean).slice(0, 30),
  }
}
function readDrafts() {
  try {
    return normalizeDrafts(JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')))
  } catch (error) {
    return emptyDrafts()
  }
}
function writeDrafts(data) {
  const normalized = normalizeDrafts(data)
  fs.mkdirSync(path.dirname(DRAFTS_FILE), { recursive: true })
  const temp = DRAFTS_FILE + '.tmp-' + process.pid
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(temp, DRAFTS_FILE)
  return normalized
}
let mediaJobService = null
function fakeMediaBridge() {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const mp4 = Buffer.from('fake-mp4-for-ui-test').toString('base64')
  return {
    drawImage: async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
      return { ok: true, dataUrl: 'data:image/png;base64,' + png }
    },
    videoGenerate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return { ok: true, dataUrl: 'data:video/mp4;base64,' + mp4 }
    },
  }
}
function getMediaJobService() {
  if (!mediaJobService) {
    mediaJobService = createMediaJobService({
      dir: kernelDataPath('media-jobs'),
      readDrafts,
      writeDrafts,
      getBridge: async () => {
        if (JCO_TEST_MODE && process.env.JCO_TEST_MEDIA_FAKE === '1') return fakeMediaBridge()
        return getBridge()
      },
      saveAsset: saveAssetPayload,
      onJob: (job) => {
        BrowserWindow.getAllWindows().forEach((win) => {
          try {
            if (!win.webContents.isDestroyed()) win.webContents.send('media:job', job)
          } catch (error) {
            /* 窗口已销毁则忽略 */
          }
        })
      },
    })
  }
  return mediaJobService
}
function emptyOps() {
  return { version: 1, report: null, comments: [] }
}
function normalizeOpsReport(report) {
  if (!report || typeof report !== 'object') return null
  const metrics = {}
  const sourceMetrics = report.metrics && typeof report.metrics === 'object' ? report.metrics : {}
  Object.keys(sourceMetrics).slice(0, 20).forEach((key) => {
    const value = Number(sourceMetrics[key])
    if (Number.isFinite(value)) metrics[String(key).slice(0, 40)] = value
  })
  return {
    platform: String(report.platform || 'douyin').slice(0, 40),
    at: Number(report.at) || Date.now(),
    metrics,
    note: String(report.note || '').slice(0, 500),
  }
}
function normalizeOpsComment(comment, index) {
  if (!comment || typeof comment !== 'object') return null
  const status = ['draft', 'skipped', 'pending_approval', 'sent', 'failed', 'rejected'].includes(comment.status)
    ? comment.status
    : 'draft'
  return {
    id: String(comment.id || 'comment-' + index).slice(0, 120),
    platform: String(comment.platform || 'douyin').slice(0, 40),
    author: String(comment.author || '').slice(0, 200),
    text: String(comment.text || ''),
    draft: String(comment.draft || ''),
    status,
    taskId: String(comment.taskId || '').slice(0, 120),
    createdAt: Number(comment.createdAt) || Date.now(),
    updatedAt: Number(comment.updatedAt) || Date.now(),
  }
}
function normalizeOps(input) {
  const data = input && typeof input === 'object' ? input : {}
  const comments = Array.isArray(data.comments) ? data.comments : []
  return {
    version: 1,
    report: normalizeOpsReport(data.report),
    comments: comments.map(normalizeOpsComment).filter(Boolean).slice(0, 100),
  }
}
function publishDataDir() {
  return path.join(app.getPath('userData'), 'publish', 'data')
}
function readOpsLegacy() {
  const read = (name) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(publishDataDir(), name), 'utf8'))
    } catch (error) {
      return null
    }
  }
  return { report: read('report-latest.json'), comments: read('comments-latest.json') }
}
function readOps() {
  let current = emptyOps()
  try {
    current = normalizeOps(JSON.parse(fs.readFileSync(OPS_FILE, 'utf8')))
  } catch (error) {
    current = emptyOps()
  }
  const legacy = readOpsLegacy()
  let changed = false
  const legacyReport = normalizeOpsReport(legacy.report)
  if (legacyReport && (!current.report || legacyReport.at > current.report.at)) {
    current.report = legacyReport
    changed = true
  }
  const legacyComments = Array.isArray(legacy.comments && legacy.comments.items) ? legacy.comments.items : []
  const byId = new Map(current.comments.map((item) => [item.id, item]))
  legacyComments.forEach((item, index) => {
    const normalized = normalizeOpsComment(item, index)
    if (!normalized) return
    const existing = byId.get(normalized.id)
    if (!existing) {
      normalized.createdAt = Number(item.at) || Date.now()
      normalized.updatedAt = normalized.createdAt
      byId.set(normalized.id, normalized)
      changed = true
      return
    }
    if (existing.status === 'draft' && normalized.draft && normalized.draft !== existing.draft) {
      existing.draft = normalized.draft
      existing.updatedAt = Date.now()
      changed = true
    }
  })
  current.comments = Array.from(byId.values()).slice(0, 100)
  if (changed) writeOps(current)
  return current
}
function writeOps(data) {
  const normalized = normalizeOps(data)
  fs.mkdirSync(path.dirname(OPS_FILE), { recursive: true })
  const temp = OPS_FILE + '.tmp-' + process.pid
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(temp, OPS_FILE)
  return normalized
}
function updateOpsCommentRecord(id, patch) {
  const data = readOps()
  const comment = data.comments.find((item) => item.id === String(id || ''))
  if (!comment) return null
  if (patch && typeof patch.draft === 'string') comment.draft = patch.draft
  if (patch && ['draft', 'skipped', 'pending_approval', 'sent', 'failed', 'rejected'].includes(patch.status)) {
    comment.status = patch.status
  }
  if (patch && typeof patch.taskId === 'string') comment.taskId = patch.taskId.slice(0, 120)
  comment.updatedAt = Date.now()
  writeOps(data)
  return comment
}
function emptyAccounts() {
  return { version: 1, platforms: {} }
}
function normalizeAccounts(input) {
  const data = input && typeof input === 'object' ? input : {}
  const source = data.platforms && typeof data.platforms === 'object' ? data.platforms : {}
  const platforms = {}
  Object.keys(source).slice(0, 20).forEach((id) => {
    const record = source[id]
    if (!record || typeof record !== 'object') return
    platforms[String(id).slice(0, 40)] = {
      ok: record.ok === true,
      at: Number(record.at) || 0,
    }
  })
  return { version: 1, platforms }
}
function readAccounts() {
  try {
    return normalizeAccounts(JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')))
  } catch (error) {
    return emptyAccounts()
  }
}
function writeAccounts(data) {
  const normalized = normalizeAccounts(data)
  fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true })
  const temp = ACCOUNTS_FILE + '.tmp-' + process.pid
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(temp, ACCOUNTS_FILE)
  return normalized
}
ipcMain.handle('topics:get', () => ({ ok: true, data: readTopics(), brand: readBrandProfile() }))
ipcMain.handle('topics:save', (_event, payload) => {
  try {
    return { ok: true, data: writeTopics(payload || {}) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('topics:migrate', (_event, payload) => {
  try {
    const current = readTopics()
    const hasData = current.inspos.length + current.radar.length + current.favs.length > 0
    if (hasData) return { ok: true, data: current, migrated: false }
    return { ok: true, data: writeTopics(payload || {}), migrated: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('materials:get', () => ({ ok: true, data: readMaterials() }))
ipcMain.handle('materials:save', (_event, payload) => {
  try {
    return { ok: true, data: writeMaterials(payload || {}) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('materials:migrate', (_event, payload) => {
  try {
    const current = readMaterials()
    if (current.items.length > 0) return { ok: true, data: current, migrated: false }
    return { ok: true, data: writeMaterials(payload || {}), migrated: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('brand:get', () => ({ ok: true, data: readBrandProfile() }))
ipcMain.handle('brand:save', (_event, payload) => {
  try {
    return { ok: true, data: writeBrandProfile(payload || {}) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('knowledge:import', async (event) => {
  try {
    let filePaths = []
    if (JCO_TEST_MODE && process.env.JCO_TEST_KNOWLEDGE_FILES) {
      filePaths = process.env.JCO_TEST_KNOWLEDGE_FILES.split(path.delimiter).filter(Boolean)
    } else {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win, {
        title: '导入业务资料',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '文本资料', extensions: ['txt', 'md', 'markdown', 'csv', 'json'] },
          { name: '全部文件', extensions: ['*'] },
        ],
      })
      if (result.canceled) return { ok: true, entries: [], skipped: [] }
      filePaths = result.filePaths
    }
    const entries = []
    const skipped = []
    for (const [index, filePath] of filePaths.slice(0, 10).entries()) {
      const ext = path.extname(filePath).toLowerCase()
      if (!['.txt', '.md', '.markdown', '.csv', '.json'].includes(ext)) {
        skipped.push({ name: path.basename(filePath), reason: '暂只支持 txt / md / csv / json' })
        continue
      }
      const stat = fs.statSync(filePath)
      if (stat.size > 200 * 1024) {
        skipped.push({ name: path.basename(filePath), reason: '单个文件超过 200 KB' })
        continue
      }
      const content = redactKnowledgeText(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim())
      if (!content) {
        skipped.push({ name: path.basename(filePath), reason: '文件内容为空' })
        continue
      }
      entries.push({
        id: `kb-import-${Date.now().toString(36)}-${index}`,
        title: path.basename(filePath).slice(0, 120),
        content: clipKnowledgeContent(content),
        tags: ['导入'],
        enabled: true,
        updatedAt: Date.now(),
        source: 'import',
      })
    }
    return { ok: true, entries, skipped }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('scripts:get', () => ({ ok: true, data: readScripts() }))
ipcMain.handle('scripts:save', (_event, payload) => {
  try {
    return { ok: true, data: saveScriptRecord(payload || {}) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('scripts:migrate', (_event, payload) => {
  try {
    const current = readScripts()
    if (current.current) return { ok: true, data: current, migrated: false }
    const record = payload && payload.current ? { ...payload.current, source: 'migrate' } : null
    return { ok: true, data: saveScriptRecord({ current: record }), migrated: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('drafts:get', () => ({ ok: true, data: readDrafts() }))
ipcMain.handle('drafts:save', (_event, payload) => {
  try {
    return { ok: true, data: writeDrafts(payload || {}) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('drafts:migrate', (_event, payload) => {
  try {
    const current = readDrafts()
    if (current.items.length > 0) return { ok: true, data: current, migrated: false }
    return { ok: true, data: writeDrafts(payload || {}), migrated: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('media:job:start', async (_event, payload) => {
  try {
    return await getMediaJobService().start(payload || {})
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('media:job:get', (_event, payload) => {
  try {
    const job = getMediaJobService().get(String((payload && payload.id) || ''))
    return job ? { ok: true, job } : { ok: false, error: '任务不存在' }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('media:job:list', (_event, payload) => {
  try {
    return { ok: true, jobs: getMediaJobService().list(payload && payload.draftId) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error), jobs: [] }
  }
})
ipcMain.handle('media:job:cancel', (_event, payload) => {
  try {
    return getMediaJobService().cancel(String((payload && payload.id) || ''))
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('ops:get', () => ({ ok: true, data: readOps() }))
ipcMain.handle('ops:save', (_event, payload) => {
  try {
    return { ok: true, data: writeOps(payload || {}) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('ops:update-comment', (_event, payload) => {
  try {
    const comment = updateOpsCommentRecord(payload && payload.id, payload && payload.patch)
    if (!comment) return { ok: false, code: 'NOT_FOUND', error: '评论不存在' }
    return { ok: true, comment }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('accounts:get', () => ({ ok: true, data: readAccounts() }))
ipcMain.handle('accounts:save', (_event, payload) => {
  try {
    return { ok: true, data: writeAccounts(payload || {}) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('accounts:migrate', (_event, payload) => {
  try {
    const current = readAccounts()
    if (Object.keys(current.platforms).length > 0) return { ok: true, data: current, migrated: false }
    return { ok: true, data: writeAccounts(payload || {}), migrated: true }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
function saveAutoRun(taskId, record) {
  // W1-04：执行结果统一写 work-tasks；auto-runs.json 只作为历史迁移来源读取，不再新增写入。
  void taskId
  void record
}
/**
 * 自动任务的历史执行索引：以 work-tasks 为唯一事实源，旧 auto-runs.json 只做兼容读取。
 */
function autoRunIndex() {
  const runs = Object.assign({}, autoRuns.runs || {})
  for (const task of workTasks.values()) {
    if (!task || !task.sourceAutomationId) continue
    const id = task.sourceAutomationId
    const previous = runs[id]
    const stamp = Number(task.updatedAt || task.createdAt || 0)
    if (!previous || stamp >= Number(previous.lastRunAt || 0)) {
      runs[id] = {
        lastRunAt: stamp,
        dueAt: Number(task.createdAt || stamp),
        ok: task.status === 'done',
        summary: String(task.summary || task.goal || '').slice(0, 140),
      }
    }
  }
  return runs
}
/** 只有需要浏览器平台的活才预热发布会话，避免写稿/后期任务白等 60 秒。 */
const PUBLISH_BROWSER_HINT = /发布|发到|抖音|视频号|小红书|快手|B站|评论|战报|运营|登录|扫码|创作者中心/
function needsPublishBrowser(text) {
  return PUBLISH_BROWSER_HINT.test(String(text || ''))
}
/**
 * 岗位 → 内核 profile（M11 W0-05 最小接线）。
 * 结构化 staff 优先；旧数据没有 staff 时按任务文字保守判断。
 * W1-04 统一 TaskService 后由任务卡显式字段决定，不再靠关键词猜。
 */
function profileOfTask(staff, prompt) {
  if (staff === 'post') return 'editor'
  if (staff === 'publish') return 'publisher'
  if (staff === 'ops') return 'operator'
  const text = String(prompt || '')
  if (/(后期|剪辑|字幕|配乐|裁剪|拼接|ffmpeg)/i.test(text)) return 'editor'
  if (needsPublishBrowser(text)) return 'operator'
  return 'writer'
}
/** 执行前确保目标平台的发布会话就绪（≤60 秒）；起不来也照常发任务（AI 会如实说，我们不装成功） */
async function ensurePublishReady(platformId) {
  if (!publishSessionManager) return false
  try {
    const want = String(platformId || 'douyin')
    const st = publishSessionManager.status()
    if (!st || !st.active || st.platform !== want) publishSessionManager.start(want)
    for (let i = 0; i < 40; i++) {
      const s = publishSessionManager.status()
      if (s && s.ready && s.platform === want) return true
      if (s && !s.active) return false
      await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
    }
  } catch (error) {
    /* 起不来：照常发任务 */
  }
  return false
}
function autoTaskShape(task) {
  const text = task.name + ' ' + String(task.desc || '')
  const type = /(发到|发布|上传)/.test(text) ? 'publish' : /(剪辑|后期|字幕|配乐|裁剪|拼接)/.test(text) ? 'edit' : /(评论|战报|数据|运营)/.test(text) ? 'operate' : 'content'
  const ownerRole = type === 'publish' ? 'publisher' : type === 'edit' ? 'editor' : type === 'operate' ? 'operator' : 'writer'
  return { type, ownerRole }
}
function createAutoWorkTask(task) {
  const shape = autoTaskShape(task)
  const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const now = Date.now()
  const workTask = {
    id,
    title: String(task.name || '自动任务').slice(0, 80),
    goal: String(task.desc || task.name || '执行自动任务'),
    type: shape.type,
    ownerRole: shape.ownerRole,
    status: 'running',
    inputs: [{ kind: 'text', ref: String(task.id || ''), label: '自动任务模板' }],
    constraints: ['自动任务执行；发布、删除、支付等不可逆动作仍需用户确认'],
    deliverables: ['执行结果与任务记录'],
    approvalPolicy: { requirePublishApproval: true, requireDeleteApproval: true, requirePaymentApproval: true, requireFinalApproval: true },
    sourceAutomationId: String(task.id || ''),
    createdAt: now,
    updatedAt: now,
    runId: id + '-run1',
    events: [],
    approvals: [],
    artifacts: [],
    messages: [],
    summary: '',
  }
  workTaskEvent(workTask, 'state_changed', '自动任务已启动')
  workTasks.set(id, workTask)
  saveWorkTask(id)
  broadcastWorkTask(workTask, 'start')
  task.__workTaskId = id
  return workTask
}
async function runAutoTask(task) {
  const workTask = createAutoWorkTask(task)
  try {
    if (needsPublishBrowser(task.name + ' ' + String(task.desc || ''))) await ensurePublishReady('douyin')
    const bridge = await getBridge()
    const prompt = '现在就跑一遍「' + task.name + '」：' + String(task.desc || '') + '。\n' + AUTO_DISCIPLINE
    const result = await bridge.ask(prompt, null, {
      profile: profileOfTask('', prompt),
      sessionId: 'task:auto-' + task.id,
      onActivity: (act) => {
        BrowserWindow.getAllWindows().forEach((win) => {
          try {
            win.webContents.send('kernel:activity', { ...act, auto: true, taskName: task.name, taskId: workTask.id })
          } catch (error) {
            /* 窗口已关闭则忽略 */
          }
        })
      },
    })
    workTask.status = result.ok ? 'done' : 'failed'
    workTask.summary = clipSafe(String((result.ok ? result.text : result.error) || ''), 300)
    workTask.messages = [
      { role: 'user', text: prompt, t: workTask.createdAt },
      { role: 'assistant', text: workTask.summary, t: Date.now() },
    ]
    workTaskEvent(workTask, result.ok ? 'state_changed' : 'error', result.ok ? '自动任务完成' : '自动任务失败：' + workTask.summary)
    saveWorkTask(workTask.id)
    broadcastWorkTask(workTask, result.ok ? 'done' : 'fail')
    if (result.ok) recordTaskKnowledge(workTask, String(result.text || workTask.summary || ''))
    return { ok: !!result.ok, summary: workTask.summary, taskId: workTask.id }
  } catch (error) {
    workTask.status = 'failed'
    workTask.summary = '调度出错：' + clipSafe(String((error && error.message) || error), 200)
    workTaskEvent(workTask, 'error', workTask.summary)
    saveWorkTask(workTask.id)
    broadcastWorkTask(workTask, 'fail')
    return { ok: false, summary: workTask.summary, taskId: workTask.id }
  }
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
      getRuns: autoRunIndex,
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
    const items = writeAutoTasks(payload && payload.items)
    return { ok: true, count: items.length }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('tasks:get', () => ({ ok: true, items: readAutoTasks() }))
ipcMain.handle('tasks:save', (_event, payload) => {
  try {
    return { ok: true, items: writeAutoTasks(payload && payload.items) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})

ipcMain.handle('tasks:runs:get', () => ({ runs: autoRunIndex() }))

// 「马上跑」（M7 统一）：与到点走同一条执行管道（TaskRunner）——不再跳总管聊天。
// 立即返回"已开跑"；执行在后台进行（跑完写记录 + 通知），同一任务并发时拒绝。
ipcMain.handle('tasks:run', (_event, payload) => {
  const id = payload && typeof payload.id === 'string' ? payload.id : ''
  if (id === '') return { ok: false, error: '没给任务' }
  if (!autoScheduler) return { ok: false, error: '调度器还没就绪，稍后再试' }
  const task = readAutoTasks().find((t) => t && t.id === id)
  if (!task) return { ok: false, error: '任务不存在（先在自动任务页建好它）' }
  const started = autoScheduler.runNow(task)
  return started
    ? { ok: true, ...(typeof started === 'string' ? { taskId: started } : {}) }
    : { ok: false, error: '这个任务正在跑，跑完再看' }
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
/* ---------- W1-03 structured task cards / detail / approval ---------- */
const WORK_TASKS_DIR = kernelDataPath('work-tasks')
const workTasks = new Map()
function saveWorkTask(id) {
  try {
    fs.mkdirSync(WORK_TASKS_DIR, { recursive: true })
    fs.writeFileSync(path.join(WORK_TASKS_DIR, id + '.json'), JSON.stringify(workTasks.get(id), null, 2), 'utf8')
  } catch (error) {
    /* 落盘失败不阻塞任务卡流程 */
  }
}
function loadWorkTasks() {
  try {
    fs.mkdirSync(WORK_TASKS_DIR, { recursive: true })
    for (const file of fs.readdirSync(WORK_TASKS_DIR).filter((name) => name.endsWith('.json'))) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(WORK_TASKS_DIR, file), 'utf8'))
        if (task && typeof task.id === 'string') workTasks.set(task.id, task)
      } catch (error) {
        /* 坏文件跳过 */
      }
    }
  } catch (error) {
    /* 目录不可用 */
  }
}
function workTaskEvent(task, type, summary, data) {
  task.events.push({
    id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    taskId: task.id,
    runId: task.runId,
    type,
    at: Date.now(),
    summary,
    ...(data ? { data } : {}),
  })
  task.updatedAt = Date.now()
}
function broadcastWorkTask(task, phase) {
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send('kernel:task', {
        taskId: task.id,
        phase,
        state: task.status,
        name: task.title,
        summary: String(task.goal || '').slice(0, 120),
      })
    } catch (error) {
      /* 窗口已关闭 */
    }
  })
}
function workTaskView(task) {
  return {
    ...task,
    name: task.title,
    state: task.status,
    startedAt: task.createdAt,
    messages: task.messages || [],
    live: [],
  }
}
function profileOfWorkTask(task) {
  if (task.type === 'publish') return 'publisher'
  if (task.type === 'edit') return 'editor'
  if (task.type === 'operate') return 'operator'
  return 'writer'
}
function platformOfWorkTask(task) {
  const inputs = Array.isArray(task && task.inputs) ? task.inputs : []
  const found = inputs.map((item) => String(item || '')).find((item) => item.startsWith('platform:'))
  return found ? found.slice('platform:'.length) : 'douyin'
}
function taskInputValue(task, prefix) {
  const inputs = Array.isArray(task && task.inputs) ? task.inputs : []
  const found = inputs.map((item) => String(item || '')).find((item) => item.startsWith(prefix))
  return found ? found.slice(prefix.length) : ''
}
/** W1-05：审批通过后，用真实内核执行任务；事件进入同一任务详情时间线。 */
async function runWorkTask(task) {
  if (!task || task.status !== 'running') return
  try {
    const profile = profileOfWorkTask(task)
    const promptBuilder = await import(pathToFileURL(path.join(__dirname, 'dist', 'kernel', 'prompt-builder.js')).href)
    const artifactModule = await import(pathToFileURL(path.join(__dirname, 'dist', 'application', 'artifacts.js')).href)
    const prompt = promptBuilder.buildTaskPrompt({
      profile,
      task: {
        title: task.title,
        goal: task.goal,
        ownerRole: task.ownerRole,
        inputs: task.inputs,
        constraints: task.constraints,
        deliverables: task.deliverables,
      },
    })
    workTaskEvent(task, 'note', '任务执行已交给「' + task.ownerRole + '」岗位')
    saveWorkTask(task.id)
    const editBefore = task.type === 'edit' ? editAssetNames() : []
    if (task.type === 'publish' || task.type === 'operate') {
      const ready = await ensurePublishReady(platformOfWorkTask(task))
      if (!ready) workTaskEvent(task, 'note', '发布会话没有就绪；AI 会如实报告，不假装已登录')
    }
    const bridge = await getBridge()
    const result = await bridge.ask(prompt, null, {
      profile,
      sessionId: 'task:' + task.id,
      onActivity: (act) => {
        if (act && act.kind === 'tool' && act.phase === 'call') {
          workTaskEvent(task, 'tool_call', '调用工具：' + String(act.tool || '未知工具'))
          saveWorkTask(task.id)
          broadcastWorkTask(task, 'update')
        }
      },
    })
    if (result.ok && task.type === 'publish') {
      task.status = 'waiting_user'
      task.summary = clipSafe(String(result.text || '已准备到发布前，等你亲手点发布'), 300)
      workTaskEvent(task, 'note', 'AI 已准备到发布前；请你在浏览器里亲手点发布')
    } else {
      task.status = result.ok ? 'done' : 'failed'
      task.summary = clipSafe(String((result.ok ? result.text : result.error) || ''), 300)
      workTaskEvent(task, result.ok ? 'state_changed' : 'error', result.ok ? '任务执行完成' : '任务执行失败：' + task.summary)
    }
    if (task.type === 'operate') {
      const commentId = taskInputValue(task, 'commentId:')
      if (commentId) updateOpsCommentRecord(commentId, { status: result.ok ? 'sent' : 'failed', taskId: task.id })
    }
    if (task.type === 'edit' && result.ok) {
      const created = artifactModule.collectNewEditArtifacts(editBefore, editAssetNames(), assetsDirPath())
      if (created.length > 0) {
        task.artifacts = [...(task.artifacts || []), ...created].slice(0, 50)
        for (const artifact of created) {
          workTaskEvent(task, 'artifact_added', '产物已登记：' + artifact.name, {
            artifactId: artifact.id,
            path: artifact.path,
            kind: artifact.kind,
          })
        }
      } else {
        workTaskEvent(task, 'note', '任务完成，但没有发现新的成片文件')
      }
    }
    task.messages = [
      { role: 'user', text: prompt, t: Date.now() },
      { role: 'assistant', text: task.summary || '（没有返回内容）', t: Date.now() },
    ]
    saveWorkTask(task.id)
    broadcastWorkTask(task, result.ok ? (task.type === 'publish' ? 'update' : 'done') : 'fail')
    if (result.ok) recordTaskKnowledge(task, String(result.text || task.summary || ''))
  } catch (error) {
    task.status = 'failed'
    task.summary = '执行出错：' + clipSafe(String((error && error.message) || error), 200)
    task.messages = [{ role: 'assistant', text: task.summary, t: Date.now() }]
    workTaskEvent(task, 'error', task.summary)
    saveWorkTask(task.id)
    broadcastWorkTask(task, 'fail')
  }
}
ipcMain.handle('tasks:propose', (_event, payload) => {
  try {
    const draft = (payload && payload.task) || payload || {}
    const title = clipSafe(String(draft.title || '').trim(), 80)
    const goal = String(draft.goal || '').trim()
    const type = ['content', 'publish', 'operate', 'edit', 'research', 'custom'].includes(String(draft.type))
      ? String(draft.type)
      : 'custom'
    const deliverables = Array.isArray(draft.deliverables)
      ? draft.deliverables.map((item) => clipSafe(String(item || '').trim(), 200)).filter(Boolean)
      : []
    if (!title || !goal || deliverables.length === 0) {
      return { ok: false, error: '任务卡必须有标题、目标和交付物' }
    }
    const approvals = draft.approvalPolicy || {}
    const approvalPolicy = {
      requirePublishApproval: true,
      requireDeleteApproval: true,
      requirePaymentApproval: true,
      requireFinalApproval: approvals.requireFinalApproval !== false,
    }
    const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const task = {
      id,
      title,
      goal,
      type,
      ownerRole: String(draft.ownerRole || (type === 'publish' ? 'publisher' : type === 'edit' ? 'editor' : 'writer')).slice(0, 40),
      status: 'pending_confirm',
      inputs: Array.isArray(draft.inputs) ? draft.inputs.slice(0, 20) : [],
      constraints: Array.isArray(draft.constraints) ? draft.constraints.map((item) => String(item || '').slice(0, 300)).filter(Boolean) : [],
      deliverables,
      approvalPolicy,
      sourceConversationId: String(draft.sourceConversationId || '').slice(0, 120),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runId: id + '-run1',
      events: [],
      approvals: [],
      artifacts: [],
      messages: [],
    }
    workTaskEvent(task, 'state_changed', '任务卡已提出，等待用户确认')
    workTasks.set(id, task)
    saveWorkTask(id)
    broadcastWorkTask(task, 'start')
    return { ok: true, task: workTaskView(task) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('tasks:confirm', (_event, payload) => {
  try {
    const id = String((payload && payload.id) || '')
    const task = workTasks.get(id)
    if (!task) return { ok: false, code: 'NOT_FOUND', error: '任务不存在' }
    if (task.status !== 'pending_confirm') return { ok: false, code: 'INVALID_STATE', error: '任务不在待确认状态' }
    task.status = 'queued'
    workTaskEvent(task, 'state_changed', '任务已确认，进入队列')
    if (task.type === 'publish' || task.approvalPolicy.requireFinalApproval) {
      task.status = 'running'
      workTaskEvent(task, 'state_changed', '任务开始准备')
      task.status = 'waiting_user'
      const approval = {
        id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        taskId: task.id,
        runId: task.runId,
        type: task.type === 'publish' ? 'publish' : 'confirm',
        reason: task.type === 'publish' ? '发布前需要你亲手确认' : '任务执行前需要你确认',
        options: [
          { id: 'approve', label: '确认继续' },
          { id: 'reject', label: '取消任务', danger: true },
        ],
        status: 'pending',
        createdAt: Date.now(),
      }
      task.approvals.push(approval)
      workTaskEvent(task, 'approval_requested', approval.reason, { approvalId: approval.id, type: approval.type })
    } else {
      task.status = 'running'
      workTaskEvent(task, 'state_changed', '任务开始执行')
      void runWorkTask(task)
    }
    task.updatedAt = Date.now()
    saveWorkTask(id)
    broadcastWorkTask(task, 'update')
    return { ok: true, task: workTaskView(task) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('tasks:approval', (_event, payload) => {
  try {
    const id = String((payload && payload.id) || '')
    const decision = String((payload && payload.decision) || '')
    const task = workTasks.get(id)
    if (!task) return { ok: false, code: 'NOT_FOUND', error: '任务不存在' }
    const approval = task.approvals.find((item) => item.status === 'pending')
    if (!approval) return { ok: false, code: 'APPROVAL_REQUIRED', error: '没有等待处理的审批' }
    if (decision !== 'approve' && decision !== 'reject') return { ok: false, error: '审批决定不合法' }
    approval.status = decision === 'approve' ? 'approved' : 'rejected'
    approval.resolvedAt = Date.now()
    if (decision === 'approve') {
      task.status = 'running'
      workTaskEvent(task, 'approval_resolved', '用户已批准，任务继续', { approvalId: approval.id, decision })
    } else {
      task.status = 'cancelled'
      if (task.type === 'operate') {
        const commentId = taskInputValue(task, 'commentId:')
        if (commentId) updateOpsCommentRecord(commentId, { status: 'rejected', taskId: task.id })
      }
      workTaskEvent(task, 'approval_resolved', '用户拒绝了任务', { approvalId: approval.id, decision })
    }
    task.updatedAt = Date.now()
    saveWorkTask(id)
    broadcastWorkTask(task, decision === 'approve' ? 'update' : 'fail')
    if (decision === 'approve') void runWorkTask(task)
    return { ok: true, task: workTaskView(task) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
ipcMain.handle('tasks:cancel', (_event, payload) => {
  try {
    const id = String((payload && payload.id) || '')
    const task = workTasks.get(id)
    if (task && task.type === 'edit') requestEditCancel()
    const session = taskSessions.get(id)
    if (session && session.staff === 'post') requestEditCancel()
    if (!task) return { ok: false, code: 'NOT_FOUND', error: '任务不存在' }
    if (task.status === 'done' || task.status === 'cancelled') return { ok: true, task: workTaskView(task) }
    task.status = 'cancelled'
    workTaskEvent(task, 'state_changed', '用户取消了任务')
    task.updatedAt = Date.now()
    saveWorkTask(id)
    broadcastWorkTask(task, 'fail')
    return { ok: true, task: workTaskView(task) }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) }
  }
})
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
    if (rec.staff !== 'post' && needsPublishBrowser(prompt)) await ensurePublishReady(rec.platform || 'douyin')
    const bridge = await getBridge()
    // 过程行（对抗审查 R1）：运行中任务视图的实时反馈（人话短语，不携带工具参数）
    const { liveLineOf } = await import(pathToFileURL(path.join(__dirname, 'kernel', 'activity.mjs')).href)
    let streamedText = ''
    const result = await bridge.ask(prompt, (delta) => { streamedText += delta }, {
      profile: profileOfTask(rec.staff, prompt),
      sessionId: 'task:' + id,
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
    const platform = String((payload && payload.platform) || '').slice(0, 32)
    if (name === '' || prompt === '') return { ok: false, error: '没给任务名或内容' }
    if (staff === 'post') clearEditCancel()
    const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    // 上限保护（对抗审查 R4）：>50 条时清最旧的已完成记录（台账文件保留，内存只留活跃 + 最近）
    if (taskSessions.size > 50) {
      const finished = Array.from(taskSessions.values())
        .filter((r) => r.state !== 'running')
        .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
      while (taskSessions.size > 50 && finished.length > 0) taskSessions.delete(finished.shift().id)
    }
    taskSessions.set(id, {
      id,
      name,
      staff,
      platform,
      state: 'running',
      startedAt: Date.now(),
      endedAt: 0,
      summary: '',
      messages: [],
      live: [],
    })
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
  const structured = Array.from(workTasks.values()).map((task) => ({
    id: task.id,
    name: task.title,
    staff: task.ownerRole,
    platform: '',
    state: task.status,
    startedAt: task.createdAt,
    endedAt: task.status === 'done' || task.status === 'cancelled' ? task.updatedAt : 0,
    summary: String(task.goal || '').slice(0, 120),
    structured: true,
    sourceAutomationId: task.sourceAutomationId || '',
  }))
  const legacy = Array.from(taskSessions.values()).map((r) => ({
    id: r.id,
    name: r.name,
    staff: r.staff,
    platform: r.platform || '',
    state: r.state,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    summary: String(r.summary || '').slice(0, 120),
    structured: false,
  }))
  const list = [...structured, ...legacy]
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, 20)
  return { tasks: list }
})
ipcMain.handle('tasks:session:get', (_event, payload) => {
  const id = payload && typeof payload.id === 'string' ? payload.id : ''
  const structured = workTasks.get(id)
  if (structured) return { ok: true, task: workTaskView(structured) }
  const rec = taskSessions.get(id)
  if (!rec) return { ok: false, error: '任务不存在' }
  return { ok: true, task: { ...rec, messages: Array.isArray(rec.messages) ? rec.messages.slice(-30) : [], structured: false } }
})

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
      // 测试窗口隐藏时仍要推进 CSS 过渡，否则侧栏宽度会停在展开值。
      backgroundThrottling: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    // E2E 默认隐藏窗口：测试照常跑，但不抢用户桌面。
    if (!JCO_TEST_MODE) win.show()
  })
  // 每次页面导航完成：按当前主题偏好重新注入覆盖（页面切换后主题不丢）
  win.webContents.on('did-finish-load', () => applyThemeToWindow(win))
  // 托盘开启时：关窗口=缩到托盘（不退出）；托盘菜单「退出」才真退出
  win.on('close', (event) => {
    if (trayEnabled && !JCO_TEST_MODE && !app.isQuitting) {
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
    restoreModelConfig()
    const saved = readSettings()
    testLoginEnabled = saved.__testLoginEnabled === true
    if (saved.theme === 'dark' || saved.theme === 'light') nativeTheme.themeSource = saved.theme
    if (saved.tray === true) {
      trayEnabled = true
      if (!JCO_TEST_MODE) createTray()
    }
    createWindow()
    initAutoUpdater()
    // 后台预热内核（几秒就绪；不阻塞窗口显示，失败也不影响界面）
    getBridge()
      .then((bridge) => bridge.warmUp().catch(() => {}))
      .catch(() => {})
    // 自动任务调度器（M6）：每分钟心跳；启动即补跑检查
    startAutoScheduler().catch(() => {})
    // 任务会话（M7 桥）：加载历史任务台账（重启后任务列表/回看不丢）
    loadTaskSessions()
    // W1-03 结构化任务卡：加载独立的 work-tasks 台账
    loadWorkTasks()
    // 后期工具（M9 后期·AI 代劳）：写成片目录与 ffmpeg 配置（bridge 生成工具 patch 时读）
    writeEditToolsConfig()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// 退出前回收内核进程（带 1.5s 兜底，不让清理拖住退出）
// 退出前收掉发布会话（浏览器会跟着关闭；不等它，防拖住退出）
app.on('before-quit', () => {
  if (publishSessionManager) publishSessionManager.stop()
  if (updateTimer) clearInterval(updateTimer)
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
  if (trayEnabled && !JCO_TEST_MODE && !app.isQuitting) return // 托盘模式：关窗只是收起，应用继续活着
  app.quit()
})
