// J.Co 后期工具插件（M9 后期 · AI 代劳）
// 六个本地视频处理工具（ffmpeg）：列素材 / 看信息 / 加字幕 / 配音乐 / 裁剪 / 拼接。
// 安全：一切文件操作限定在成片目录（assetsDir）内；永不覆盖原件；spawn 参数数组不拼 shell。
// 设计依据：docs/plans/M9-后期-AI代劳/方案冻结.md
import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync, realpathSync, unlinkSync } from 'node:fs'
import { resolve, basename, extname, join, relative, isAbsolute } from 'node:path'
import { spawn } from 'node:child_process'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'jco-edit-tools'
export const inject = ['tools']

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi'])
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg'])

/** 目标路径必须落在目录内（防任意文件操作） */
export function insideDir(dir, p) {
  const r = relative(dir, p)
  return r !== '' && !r.startsWith('..') && !isAbsolute(r)
}

/** 解析真实路径并确认仍在目录内（同时挡住符号链接逃逸） */
export function resolveInside(dir, file) {
  const base = resolve(String(dir || ''))
  const target = resolve(base, String(file || ''))
  if (!insideDir(base, target)) return null
  try {
    const realBase = realpathSync(base)
    const realTarget = realpathSync(target)
    return insideDir(realBase, realTarget) ? realTarget : null
  } catch {
    return null
  }
}

/** 毫秒 → SRT 时间戳 00:00:01,250 */
export function srtTime(ms) {
  const m = Math.max(0, Math.floor(ms))
  const h = Math.floor(m / 3600000)
  const min = Math.floor((m % 3600000) / 60000)
  const sec = Math.floor((m % 60000) / 1000)
  const msRest = m % 1000
  const pad = (n, w) => String(n).padStart(w, '0')
  return pad(h, 2) + ':' + pad(min, 2) + ':' + pad(sec, 2) + ',' + pad(msRest, 3)
}

/** 分句 → SRT（v1：按总时长均分；空行过滤；最多 80 句） */
export function buildSrt(lines, durationSec) {
  const clean = (Array.isArray(lines) ? lines : [])
    .map((s) => String(s || '').trim())
    .filter((s) => s !== '')
    .slice(0, 80)
  if (clean.length === 0 || !(durationSec > 0)) return ''
  const per = (durationSec * 1000) / clean.length
  return clean
    .map((text, i) => {
      const start = Math.round(i * per)
      const end = Math.max(start + 200, Math.round((i + 1) * per) - 60)
      return String(i + 1) + '\n' + srtTime(start) + ' --> ' + srtTime(end) + '\n' + text + '\n'
    })
    .join('\n')
}

/** 解析 `ffmpeg -i` 的 stderr：时长（秒）/尺寸/有无音轨 */
export function parseProbe(stderr) {
  const s = String(stderr || '')
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s)
  const durationSec = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  const v = /Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(s)
  return {
    durationSec: Number(durationSec.toFixed(2)),
    width: v ? Number(v[1]) : 0,
    height: v ? Number(v[2]) : 0,
    hasAudio: /Stream #.*Audio:/.test(s),
    hasVideo: /Stream #.*Video:/.test(s),
  }
}

export function runFfmpeg(bin, args, cwd, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 0
  const cancelFile = String(options.cancelFile || '')
  const cancelPollMs = Math.max(20, Number(options.cancelPollMs) || 250)
  return new Promise((done) => {
    let err = ''
    let settled = false
    let timer = null
    let cancelTimer = null
    const p = spawn(bin, args, { cwd, windowsHide: true })
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (cancelTimer) clearInterval(cancelTimer)
      done(result)
    }
    const stop = (code, message) => {
      try {
        p.kill()
      } catch {
        /* 进程可能已退出 */
      }
      finish({ ok: false, code, err: (err ? err + '\n' : '') + message })
    }
    p.stderr.on('data', (chunk) => {
      err += chunk
      if (err.length > 60000) err = err.slice(-60000)
    })
    p.on('error', (e) => finish({ ok: false, code: -1, err: String((e && e.message) || e) }))
    p.on('close', (code) => {
      if (settled) return
      finish({ ok: code === 0, code, err })
    })
    if (timeoutMs > 0) {
      timer = setTimeout(() => stop('TIMEOUT', 'ffmpeg 超过 ' + Math.round(timeoutMs / 1000) + ' 秒，已停止。'), timeoutMs)
    }
    if (cancelFile) {
      if (existsSync(cancelFile)) {
        try {
          unlinkSync(cancelFile)
        } catch {
          /* 忽略清理失败 */
        }
        stop('CANCELLED', '任务已取消。')
        return
      }
      cancelTimer = setInterval(() => {
        if (!existsSync(cancelFile)) return
        try {
          unlinkSync(cancelFile)
        } catch {
          /* 忽略清理失败 */
        }
        stop('CANCELLED', '任务已取消。')
      }, cancelPollMs)
    }
  })
}

export function apply(ctx, config) {
  const cfg = config || {}
  const assetsDir = resolve(String(cfg.assetsDir || ''))
  const ffmpeg = String(cfg.ffmpeg || '')
  const allow = Array.isArray(cfg.allowedTools) ? new Set(cfg.allowedTools) : null
  const timeoutMs = Number(cfg.timeoutMs) || 600000
  const cancelFile = String(cfg.cancelFile || '')
  const run = (argv) => runFfmpeg(ffmpeg, argv, assetsDir, { timeoutMs, cancelFile })

  const ensure = () => {
    if (!cfg.assetsDir) return '后期引擎未就绪：没有成片目录（先启动一次 J.Co 应用）。'
    if (!ffmpeg || !existsSync(ffmpeg)) return '后期引擎未就绪：ffmpeg 不可用。'
    return ''
  }
  const guard = (file) => {
    const p = resolveInside(assetsDir, file)
    if (!p || !existsSync(p)) return null
    return p
  }
  const outName = (base, tag, ext) => base + '-' + tag + '-' + Date.now().toString(36) + '.' + ext

  const register = (toolName, description, parameters, execute) => {
    // profile 工具白名单：未列出的工具不注册，模型看不到也调不到。
    if (allow && !allow.has(toolName)) return
    ctx.tools.register(
      defineTool({
        name: toolName,
        description,
        parameters,
        output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: String(value) }] },
        async execute(args) {
          const bad = ensure()
          if (bad) return bad
          try {
            return await execute(args || {})
          } catch (error) {
            return '工具出错：' + String((error && error.message) || error)
          }
        },
      }),
    )
  }

  register('jco_list_assets', '列出成片目录里的视频与音乐文件（用户和你可用的素材）。', {}, async () => {
    const out = []
    for (const f of readdirSync(assetsDir)) {
      const ext = extname(f).toLowerCase()
      if (!VIDEO_EXT.has(ext) && !AUDIO_EXT.has(ext)) continue
      try {
        const st = statSync(join(assetsDir, f))
        out.push({ name: f, kind: VIDEO_EXT.has(ext) ? 'video' : 'audio', sizeKB: Math.round(st.size / 1024), modified: st.mtimeMs })
      } catch {}
    }
    out.sort((a, b) => b.modified - a.modified)
    return JSON.stringify({ dir: assetsDir, files: out.slice(0, 60) })
  })

  register(
    'jco_probe_video',
    '查看一个视频文件的时长（秒）、分辨率与有无音轨。用于安排字幕或判断能否混音/拼接。',
    { file: { type: 'string', required: true, description: '成片目录里的文件名（如 视频-abc.mp4）' } },
    async (args) => {
      const p = guard(args.file)
      if (!p) return '找不到这个文件（必须是成片目录里已有的文件）。'
      const r = await run(['-hide_banner', '-i', basename(p)])
      const info = parseProbe(r.err)
      return JSON.stringify({ file: basename(p), ...info })
    },
  )

  register(
    'jco_add_subtitles',
    '给视频烧录字幕（白字黑边、底部居中）。lines 是按顺序分好的句子；v1 时间按片长平均分配。产出新文件，不改原件。',
    {
      file: { type: 'string', required: true, description: '成片目录里的视频文件名' },
      lines: { type: 'array', required: true, description: '按顺序的句子列表（每句一行，最多 80 句）' },
      fontSize: { type: 'number', description: '字号（默认 20，手机竖屏建议 20~28）' },
    },
    async (args) => {
      const p = guard(args.file)
      if (!p) return '找不到这个文件（必须是成片目录里已有的文件）。'
      const probe = await run(['-hide_banner', '-i', basename(p)])
      const info = parseProbe(probe.err)
      if (!(info.durationSec > 0)) return '读不出这个视频的时长，换个文件试试。'
      const srt = buildSrt(args.lines, info.durationSec)
      if (!srt) return '没有可用的字幕句子（lines 为空）。'
      const size = Math.max(12, Math.min(48, Math.round(Number(args.fontSize) || 20)))
      const base = basename(p, extname(p))
      const srtName = base + '-sub-' + Date.now().toString(36) + '.srt'
      writeFileSync(join(assetsDir, srtName), '\ufeff' + srt, 'utf8')
      const out = outName(base, 'sub', 'mp4')
      const style =
        "FontName=Microsoft YaHei,FontSize=" + size + ',PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=36,Alignment=2'
      const vf = "subtitles=" + srtName + ":force_style='" + style + "'"
      const argv = ['-hide_banner', '-y', '-i', basename(p), '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
      if (info.hasAudio) argv.push('-c:a', 'copy')
      argv.push(out)
      const r = await run(argv)
      if (!r.ok) return '加字幕失败：' + r.err.split('\n').slice(-3).join(' ').slice(0, 200)
      return JSON.stringify({ ok: true, output: out, note: '已烧录 ' + (args.lines || []).filter((s) => String(s || '').trim()).length + ' 句字幕' })
    },
  )

  register(
    'jco_add_music',
    '给视频配背景音乐（循环到片长、音量可调、淡入 1 秒）。原视频有对白时会压低音乐音量保留人声。产出新文件。',
    {
      file: { type: 'string', required: true, description: '成片目录里的视频文件名' },
      music: { type: 'string', required: true, description: '成片目录里的音乐文件名' },
      volume: { type: 'number', description: '音乐音量 0~1（默认 0.3；有对白时建议 0.15~0.25）' },
    },
    async (args) => {
      const p = guard(args.file)
      const m = guard(args.music)
      if (!p) return '找不到视频文件。'
      if (!m) return '找不到音乐文件（先把音乐导入成片目录）。'
      const probe = await run(['-hide_banner', '-i', basename(p)])
      const info = parseProbe(probe.err)
      const vol = Math.max(0, Math.min(1, Number(args.volume) || 0.3))
      const base = basename(p, extname(p))
      const out = outName(base, 'music', 'mp4')
      const argv = ['-hide_banner', '-y', '-i', basename(p), '-stream_loop', '-1', '-i', basename(m)]
      if (info.hasAudio) {
        argv.push(
          '-filter_complex',
          '[1:a]volume=' + vol + ',afade=t=in:st=0:d=1[a1];[0:a][a1]amix=inputs=2:duration=first:dropout_transition=2[a]',
          '-map', '0:v', '-map', '[a]',
        )
      } else {
        argv.push('-map', '0:v', '-map', '1:a')
      }
      argv.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out)
      const r = await run(argv)
      if (!r.ok) return '配音乐失败：' + r.err.split('\n').slice(-3).join(' ').slice(0, 200)
      return JSON.stringify({ ok: true, output: out, note: info.hasAudio ? '已混入音乐（保留人声，音乐音量 ' + vol + '）' : '已配上背景音乐' })
    },
  )

  register(
    'jco_trim',
    '裁剪视频：从 start 秒开始，到 end 秒结束（不填 end 表示到片尾）。产出新文件。',
    {
      file: { type: 'string', required: true, description: '成片目录里的视频文件名' },
      start: { type: 'number', required: true, description: '开始秒数（如 1.5）' },
      end: { type: 'number', description: '结束秒数（不填=到片尾）' },
    },
    async (args) => {
      const p = guard(args.file)
      if (!p) return '找不到这个文件。'
      const start = Math.max(0, Number(args.start) || 0)
      const base = basename(p, extname(p))
      const out = outName(base, 'trim', 'mp4')
      const argv = ['-hide_banner', '-y', '-ss', String(start), '-i', basename(p)]
      if (Number(args.end) > start) argv.push('-t', String(Number(args.end) - start))
      // 重编码裁剪（-c copy 会因关键帧稀疏而裁不准——实测 3s 片只出一个关键帧时整段保留）
      argv.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', out)
      const r = await run(argv)
      if (!r.ok) return '裁剪失败：' + r.err.split('\n').slice(-3).join(' ').slice(0, 200)
      return JSON.stringify({ ok: true, output: out, note: '已裁剪 ' + start + 's 起' + (Number(args.end) > start ? ' 到 ' + args.end + 's' : ' 到片尾') })
    },
  )

  register(
    'jco_concat',
    '把多条成片按顺序接成一条（要求各段编码参数一致——本软件产出的成片通常满足）。产出新文件。',
    {
      files: { type: 'array', required: true, description: '按顺序的视频文件名列表（至少 2 条）' },
    },
    async (args) => {
      const list = (Array.isArray(args.files) ? args.files : []).map((f) => guard(f)).filter(Boolean)
      if (list.length < 2) return '至少要两条有效视频。'
      const base = basename(list[0], extname(list[0]))
      const out = outName(base, 'mix', 'mp4')
      const listName = 'concat-' + Date.now().toString(36) + '.txt'
      writeFileSync(join(assetsDir, listName), list.map((f) => "file '" + basename(f) + "'").join('\n'), 'utf8')
      // 重编码拼接（比 -c copy 兼容：允许各段编码参数略有差异）
      const r = await run([
        '-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listName,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', out,
      ])
      if (!r.ok) return '拼接失败（可能是几段格式不一致）：' + r.err.split('\n').slice(-3).join(' ').slice(0, 200)
      return JSON.stringify({ ok: true, output: out, note: '已接成一条（' + list.length + ' 段）' })
    },
  )
}
