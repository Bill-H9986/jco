/**
 * J.Co preload：给界面页一条最小通道。
 * 只暴露内核对话能力（ask / 增量回调 / 状态），不开任何文件、命令、外部通道。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jco', {
  kernel: {
    /** 发一句话，返回 { ok, text, streamed } 或 { ok:false, error } */
    ask: (text, sessionId) => ipcRenderer.invoke('kernel:ask', { text: String(text || ''), sessionId: String(sessionId || '') }),
    /** 订阅正文增量（逐段回调字符串） */
    onDelta: (callback) => {
      if (typeof callback !== 'function') return
      ipcRenderer.on('kernel:delta', (_event, delta) => {
        try {
          callback(String(delta || ''))
        } catch (error) {
          /* 页面回调异常不扩散 */
        }
      })
    },
    /** 内核状态（是否已就绪） */
    status: () => ipcRenderer.invoke('kernel:status'),
    /** 真探测一个 OpenAI 兼容接口：GET {url}/models，返回 { ok, models } 或 { ok:false, error } */
    probe: (payload) => ipcRenderer.invoke('kernel:probe', { url: String(payload && payload.url || ''), key: String(payload && payload.key || '') }),
    /** 保存「说话写稿」配置到内核（内核会按新配置重建；返回 { ok, route } 或 { ok:false, error }） */
    setModel: (config) => ipcRenderer.invoke('kernel:set-model', config || {}),
    /** 一次性生成任务（创作/选题/分镜等）：传入 { system, input }，返回 { ok, text } 或 { ok:false, error } */
    task: (payload) => ipcRenderer.invoke('kernel:task', {
      system: String((payload && payload.system) || ''),
      input: String((payload && payload.input) || ''),
    }),
    /** 真画图：返回 { ok, dataUrl|url } 或 { ok:false, error }（用「画图修图」的配置） */
    draw: (payload) => ipcRenderer.invoke('kernel:draw', { prompt: String((payload && payload.prompt) || '') }),
    /** 真出视频：返回 { ok, url, videoId, seconds } 或 { ok:false, error }（用「出片成视频」的配置） */
    video: (payload) => ipcRenderer.invoke('kernel:video', {
      prompt: String((payload && payload.prompt) || ''),
      seconds: (payload && payload.seconds) || 5,
      aspect: String((payload && payload.aspect) || '9:16'),
    }),
  },
  /** 发布引擎（M2 通用引擎 + 平台适配层）：平台差异由引擎内适配包承担，这里只传事实 */
  publish: {
    start: (payload) => ipcRenderer.invoke('publish:start', {
      platform: String((payload && payload.platform) || ''),
      videoPath: String((payload && payload.videoPath) || ''),
      title: String((payload && payload.title) || ''),
      topics: Array.isArray(payload && payload.topics) ? payload.topics.map(String) : [],
    }),
    stop: (taskId) => ipcRenderer.invoke('publish:stop', { taskId: String(taskId || '') }),
    status: () => ipcRenderer.invoke('publish:status'),
    /** 发布会话（AI 的"手"的宿主）：启动/停止常驻浏览器会话（本机、按需） */
    session: {
      start: (platform) => ipcRenderer.invoke('publish:session:start', { platform: String(platform || '') }),
      stop: () => ipcRenderer.invoke('publish:session:stop'),
      status: () => ipcRenderer.invoke('publish:session:status'),
    },
    onEvent: (callback) => {
      if (typeof callback !== 'function') return
      ipcRenderer.on('publish:event', (_event, ev) => {
        try {
          callback(ev)
        } catch (error) {
          /* 页面回调异常不扩散 */
        }
      })
    },
  },
  /** 系统级开关：主题（真切换）/ 开机启动（系统登录项）/ 清缓存（真清理） */
  sys: {
    theme: (mode) => ipcRenderer.invoke('sys:theme', String(mode || 'system')),
    getTheme: () => ipcRenderer.invoke('sys:theme:get'),
    login: (enable) => ipcRenderer.invoke('sys:login', !!enable),
    getLogin: () => ipcRenderer.invoke('sys:login:get'),
    clean: () => ipcRenderer.invoke('sys:clean'),
    pickFiles: () => ipcRenderer.invoke('sys:pick-files'),
    pickFolder: () => ipcRenderer.invoke('sys:pick-folder'),
    /** 生成物落盘：{ kind:'image'|'video', dataUrl? , url?, ext? } → { ok, path } */
    saveAsset: (payload) => ipcRenderer.invoke('sys:save-asset', payload || {}),
    openExternal: (url) => ipcRenderer.invoke('sys:open-external', String(url || '')),
    /** 托盘：关窗缩到右下角（真）；返回 { ok, enabled } */
    tray: (enable) => ipcRenderer.invoke('sys:tray', !!enable),
    getTray: () => ipcRenderer.invoke('sys:tray:get'),
    /** 系统通知：{ title, body } */
    notify: (payload) => ipcRenderer.invoke('sys:notify', { title: String((payload && payload.title) || ''), body: String((payload && payload.body) || '') }),
  },
})
