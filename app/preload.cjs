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
    draw: (payload) => ipcRenderer.invoke('kernel:draw', {
      prompt: String((payload && payload.prompt) || ''),
      size: String((payload && payload.size) || ''),
      sizePx: String((payload && payload.sizePx) || ''),
      aspect: String((payload && payload.aspect) || ''),
      model: String((payload && payload.model) || ''),
    }),
    /** 真出视频：返回 { ok, url, videoId, seconds } 或 { ok:false, error }（用「出片成视频」的配置） */
    video: (payload) => ipcRenderer.invoke('kernel:video', {
      prompt: String((payload && payload.prompt) || ''),
      seconds: (payload && payload.seconds) || 5,
      aspect: String((payload && payload.aspect) || '9:16'),
      size: String((payload && payload.size) || '720P'),
      model: String((payload && payload.model) || ''),
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
    get: () => ipcRenderer.invoke('skills:get'),
    sync: (items) => ipcRenderer.invoke('skills:sync', {
      items: (Array.isArray(items) ? items : []).map((i) => ({
        id: String((i && i.id) || ''),
        name: String((i && i.name) || ''),
        desc: String((i && i.desc) || ''),
        entry: String((i && i.entry) || ''),
        icon: String((i && i.icon) || ''),
        kind: String((i && i.kind) || 'video'),
        scenes: Array.isArray(i && i.scenes) ? i.scenes.map(String) : [],
        on: Boolean(i && i.on),
      })),
    }),
    save: (items) => ipcRenderer.invoke('skills:save', {
      items: (Array.isArray(items) ? items : []).map((i) => ({
        id: String((i && i.id) || ''),
        name: String((i && i.name) || ''),
        desc: String((i && i.desc) || ''),
        entry: String((i && i.entry) || ''),
        icon: String((i && i.icon) || ''),
        kind: String((i && i.kind) || 'video'),
        scenes: Array.isArray(i && i.scenes) ? i.scenes.map(String) : [],
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
        when: String((t && t.when) || ''),
        on: Boolean(t && t.on),
        createdAt: Number(t && t.createdAt) || 0,
        schedule: {
          kind: String((t && t.schedule && t.schedule.kind) || 'daily'),
          time: String((t && t.schedule && t.schedule.time) || '09:00'),
          weekday: Number(t && t.schedule && t.schedule.weekday) || 0,
        },
      })),
    }),
    get: () => ipcRenderer.invoke('tasks:get'),
    save: (items) => ipcRenderer.invoke('tasks:save', {
      items: (Array.isArray(items) ? items : []).map((t) => ({
        id: String((t && t.id) || ''),
        name: String((t && t.name) || ''),
        desc: String((t && t.desc) || ''),
        icon: String((t && t.icon) || ''),
        when: String((t && t.when) || ''),
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
        platform: String((payload && payload.platform) || ''),
      }),
    sessions: () => ipcRenderer.invoke('tasks:sessions'),
    session: (id) => ipcRenderer.invoke('tasks:session:get', { id: String(id || '') }),
    /** W1-03：任务卡确认前只提案，不创建可执行 Task */
    propose: (task) => ipcRenderer.invoke('tasks:propose', {
      task: {
        title: String((task && task.title) || ''),
        goal: String((task && task.goal) || ''),
        type: String((task && task.type) || 'custom'),
        ownerRole: String((task && task.ownerRole) || ''),
        inputs: Array.isArray(task && task.inputs) ? task.inputs : [],
        constraints: Array.isArray(task && task.constraints) ? task.constraints : [],
        deliverables: Array.isArray(task && task.deliverables) ? task.deliverables : [],
        approvalPolicy: (task && task.approvalPolicy) || {},
        sourceConversationId: String((task && task.sourceConversationId) || ''),
      },
    }),
    confirm: (id) => ipcRenderer.invoke('tasks:confirm', { id: String(id || '') }),
    approval: (id, decision) => ipcRenderer.invoke('tasks:approval', {
      id: String(id || ''),
      decision: String(decision || ''),
    }),
    cancel: (id) => ipcRenderer.invoke('tasks:cancel', { id: String(id || '') }),
  },
  topics: {
    get: () => ipcRenderer.invoke('topics:get'),
    save: (data) => ipcRenderer.invoke('topics:save', {
      inspos: Array.isArray(data && data.inspos) ? data.inspos : [],
      radar: Array.isArray(data && data.radar) ? data.radar : [],
      favs: Array.isArray(data && data.favs) ? data.favs : [],
    }),
    migrate: (data) => ipcRenderer.invoke('topics:migrate', {
      inspos: Array.isArray(data && data.inspos) ? data.inspos : [],
      radar: Array.isArray(data && data.radar) ? data.radar : [],
      favs: Array.isArray(data && data.favs) ? data.favs : [],
    }),
  },
  materials: {
    get: () => ipcRenderer.invoke('materials:get'),
    save: (data) => ipcRenderer.invoke('materials:save', {
      items: Array.isArray(data && data.items) ? data.items : [],
    }),
    migrate: (data) => ipcRenderer.invoke('materials:migrate', {
      items: Array.isArray(data && data.items) ? data.items : [],
    }),
  },
  brand: {
    get: () => ipcRenderer.invoke('brand:get'),
    save: (data) => ipcRenderer.invoke('brand:save', {
      industry: String((data && data.industry) || ''),
      business: String((data && data.business) || ''),
      products: String((data && data.products) || ''),
      audience: String((data && data.audience) || ''),
      platforms: Array.isArray(data && data.platforms) ? data.platforms.map(String) : [],
      tone: String((data && data.tone) || ''),
      forbidden: Array.isArray(data && data.forbidden) ? data.forbidden.map(String) : [],
      knowledgeAutoLearn: !data || data.knowledgeAutoLearn !== false,
      knowledge: Array.isArray(data && data.knowledge)
        ? data.knowledge.map((entry) => ({
            id: String((entry && entry.id) || ''),
            title: String((entry && entry.title) || ''),
            content: String((entry && entry.content) || ''),
            tags: Array.isArray(entry && entry.tags) ? entry.tags.map(String) : [],
            enabled: !entry || entry.enabled !== false,
            updatedAt: Number(entry && entry.updatedAt) || 0,
            source: String((entry && entry.source) || 'manual'),
            sourceTaskId: String((entry && entry.sourceTaskId) || ''),
            sourceTaskTitle: String((entry && entry.sourceTaskTitle) || ''),
          }))
        : [],
    }),
  },
  knowledge: {
    import: () => ipcRenderer.invoke('knowledge:import'),
    onEvent: (callback) => {
      if (typeof callback !== 'function') return
      ipcRenderer.on('knowledge:event', (_event, payload) => {
        try {
          callback(payload || null)
        } catch (error) {
          /* 页面回调异常不扩散 */
        }
      })
    },
  },
  updates: {
    get: () => ipcRenderer.invoke('updates:get'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onEvent: (callback) => {
      if (typeof callback !== 'function') return
      ipcRenderer.on('update:event', (_event, state) => {
        try {
          callback(state || null)
        } catch (error) {
          /* 页面回调异常不扩散 */
        }
      })
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    getSync: () => ipcRenderer.sendSync('settings:get-sync'),
    save: (data) => ipcRenderer.invoke('settings:save', data || {}),
  },
  scripts: {
    get: () => ipcRenderer.invoke('scripts:get'),
    save: (data) => ipcRenderer.invoke('scripts:save', { current: data || null }),
    migrate: (data) => ipcRenderer.invoke('scripts:migrate', { current: data || null }),
  },
  drafts: {
    get: () => ipcRenderer.invoke('drafts:get'),
    save: (data) => ipcRenderer.invoke('drafts:save', {
      items: Array.isArray(data && data.items) ? data.items : [],
    }),
    migrate: (data) => ipcRenderer.invoke('drafts:migrate', {
      items: Array.isArray(data && data.items) ? data.items : [],
    }),
  },
  media: {
    start: (payload) => ipcRenderer.invoke('media:job:start', {
      kind: payload && payload.kind === 'image' ? 'image' : 'video',
      draftId: Number(payload && payload.draftId),
      prompts: Array.isArray(payload && payload.prompts) ? payload.prompts.map(String) : [],
      shots: Array.isArray(payload && payload.shots)
        ? payload.shots.map((shot) => ({
          index: Number(shot && shot.index) || 0,
          prompt: String((shot && shot.prompt) || ''),
          seconds: Number((shot && shot.seconds) || 5),
        }))
        : [],
      ratio: String((payload && payload.ratio) || '9:16'),
      res: String((payload && payload.res) || ''),
      sizePx: String((payload && payload.sizePx) || ''),
      model: String((payload && payload.model) || ''),
    }),
    get: (id) => ipcRenderer.invoke('media:job:get', { id: String(id || '') }),
    list: (draftId) => ipcRenderer.invoke('media:job:list', {
      draftId: draftId === undefined || draftId === null ? null : Number(draftId),
    }),
    cancel: (id) => ipcRenderer.invoke('media:job:cancel', { id: String(id || '') }),
    onJob: (callback) => {
      if (typeof callback !== 'function') return
      ipcRenderer.on('media:job', (_event, job) => {
        try {
          callback(job)
        } catch (error) {
          /* 页面回调异常不扩散 */
        }
      })
    },
  },
  ops: {
    get: () => ipcRenderer.invoke('ops:get'),
    save: (data) => ipcRenderer.invoke('ops:save', {
      report: data && data.report ? data.report : null,
      comments: Array.isArray(data && data.comments) ? data.comments : [],
    }),
    updateComment: (id, patch) => ipcRenderer.invoke('ops:update-comment', {
      id: String(id || ''),
      patch: patch && typeof patch === 'object' ? patch : {},
    }),
  },
  accounts: {
    get: () => ipcRenderer.invoke('accounts:get'),
    save: (data) => ipcRenderer.invoke('accounts:save', {
      platforms: data && data.platforms && typeof data.platforms === 'object' ? data.platforms : {},
    }),
    migrate: (data) => ipcRenderer.invoke('accounts:migrate', {
      platforms: data && data.platforms && typeof data.platforms === 'object' ? data.platforms : {},
    }),
  },
  /** 系统级开关：主题（真切换）/ 开机启动（系统登录项）/ 清缓存（真清理） */
  sys: {
    theme: (mode) => ipcRenderer.invoke('sys:theme', String(mode || 'system')),
    getTheme: () => ipcRenderer.invoke('sys:theme:get'),
    onTheme: (callback) => {
      if (typeof callback !== 'function') return
      ipcRenderer.on('sys:theme', (_event, payload) => {
        try {
          callback(payload || null)
        } catch (error) {
          /* 页面回调异常不扩散 */
        }
      })
    },
    login: (enable) => ipcRenderer.invoke('sys:login', !!enable),
    getLogin: () => ipcRenderer.invoke('sys:login:get'),
    clean: () => ipcRenderer.invoke('sys:clean'),
    /** 列成片目录（后期页「手头成片」用） */
    listAssets: () => ipcRenderer.invoke('sys:list-assets'),
    pickFiles: () => ipcRenderer.invoke('sys:pick-files'),
    pickFolder: () => ipcRenderer.invoke('sys:pick-folder'),
    appInfo: () => ipcRenderer.invoke('sys:app-info'),
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
