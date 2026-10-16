/**
 * J.Co preload：给界面页一条最小通道。
 * 只暴露内核对话能力（ask / 增量回调 / 状态），不开任何文件、命令、外部通道。
 */
const { contextBridge, ipcRenderer } = require('electron')

// 活动日志收编（M7 批 5）：任务跑完/没跑成 → 写全站动态（"干过的活"在动态里一处可查；
// 收编在本层 = 一处代码覆盖所有页面、所有时刻，不依赖某个页面开着）
ipcRenderer.on('kernel:task', (_event, ev) => {
  try {
    if (!ev || typeof ev !== 'object') return
    if (ev.phase !== 'done' && ev.phase !== 'fail') return
    const data = JSON.parse(localStorage.getItem('jco-log-v1') || '{"items":[]}')
    if (!Array.isArray(data.items)) data.items = []
    data.items.unshift({
      t: Date.now(),
      kind: 'task',
      title: '任务「' + String(ev.name || '').slice(0, 40) + '」' + (ev.phase === 'done' ? '跑完了' : '没跑成'),
      detail: String(ev.summary || '').slice(0, 120),
    })
    if (data.items.length > 200) data.items.length = 200
    localStorage.setItem('jco-log-v1', JSON.stringify(data))
  } catch (error) {
    /* 记录失败无碍 */
  }
})

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
    /** 干活活动（M5 员工实时状态）：订阅 AI 的工具调用/回合事件 */
    onActivity: (callback) => {
      if (typeof callback !== 'function') return
      ipcRenderer.on('kernel:activity', (_event, act) => {
        try {
          callback(act)
        } catch (error) {
          /* 页面回调异常不扩散 */
        }
      })
    },
    /** 任务会话桥（M7 批 1b）：派活任务状态变化（start/done/fail）订阅 */
    onTask: (callback) => {
      if (typeof callback !== 'function') return
      ipcRenderer.on('kernel:task', (_event, ev) => {
        try {
          callback(ev)
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
      /** 账号中心「去登录」：启动该平台会话并打开登录页（AI 干活用的同一个浏览器） */
      login: (platform) => ipcRenderer.invoke('publish:session:login', { platform: String(platform || '') }),
    },
    /** 运营数据（战报 / 评论）：读本机数据文件（AI 提交后由会话服务写入） */
    data: {
      get: () => ipcRenderer.invoke('publish:data:get'),
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
  /** 技能库（M5）：启用状态同步给内核侧（系统提示词注入"手艺清单"用；界面是单一事实源） */
  skills: {
    sync: (items) => ipcRenderer.invoke('skills:sync', {
      items: (Array.isArray(items) ? items : []).map((i) => ({
        id: String((i && i.id) || ''),
        name: String((i && i.name) || ''),
        desc: String((i && i.desc) || ''),
        entry: String((i && i.entry) || ''),
        on: Boolean(i && i.on),
      })),
    }),
  },
  /** 自动任务（M6）：任务表同步给调度器；执行记录反查（页面只读展示"上次执行"） */
  tasks: {
    sync: (items) => ipcRenderer.invoke('tasks:sync', {
      items: (Array.isArray(items) ? items : []).map((t) => ({
        id: String((t && t.id) || ''),
        name: String((t && t.name) || ''),
        desc: String((t && t.desc) || ''),
        icon: String((t && t.icon) || ''),
        on: Boolean(t && t.on),
        createdAt: Number(t && t.createdAt) || 0,
        schedule: {
          kind: String((t && t.schedule && t.schedule.kind) || 'daily'),
          time: String((t && t.schedule && t.schedule.time) || '09:00'),
          weekday: Number(t && t.schedule && t.schedule.weekday) || 0,
        },
      })),
    }),
    runs: () => ipcRenderer.invoke('tasks:runs:get'),
    /** 「马上跑」：并入唯一执行管道（TaskRunner），与到点同路 */
    run: (id) => ipcRenderer.invoke('tasks:run', { id: String(id || '') }),
    /** 任务会话桥（M7）：派活 → 任务会话；列表与回看 */
    dispatch: (payload) =>
      ipcRenderer.invoke('tasks:dispatch', {
        name: String((payload && payload.name) || ''),
        prompt: String((payload && payload.prompt) || ''),
        staff: String((payload && payload.staff) || ''),
      }),
    sessions: () => ipcRenderer.invoke('tasks:sessions'),
    session: (id) => ipcRenderer.invoke('tasks:session:get', { id: String(id || '') }),
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
