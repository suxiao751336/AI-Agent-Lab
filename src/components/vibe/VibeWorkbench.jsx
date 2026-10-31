import { useEffect, useMemo, useRef, useState } from 'react'
import ChatPanel from './ChatPanel'
import CodePanel from './CodePanel'
import PhoneSimulator from './PhoneSimulator'
import DebugConsole from './DebugConsole'
import {
  getVisualSummary,
  initSteps,
  matchVisualProject,
  VISUAL_GREETING,
  VISUAL_MODES,
  VISUAL_STARTER,
} from '../../data/visualProjects'
import { ASSET_LIBRARY } from '../../data/visualAssets'
import { composePreview, exportProject } from '../../utils/projectExport'
import { applyEdit, EDIT_CAPABILITIES, matchEditIntent } from '../../services/codeEditor'
import { requestAgentRun, requestProjectGeneration } from '../../services/api'
import { friendlyForTypedEvent, friendlyRequestError, fileMeta } from '../../services/agentNarration'

/* ────────────────────────────────────────────────
 * 移动端 Vibe Coding Agent 工作台编排
 *
 * 双引擎：
 *  · llm   —— 真实模型 Agent Loop（硅基流动 Kimi K2.7 Code 流式 Function Calling，
 *             经服务端 /api/llm/agent 多轮工具调用循环，Key 不进前端；
 *             file_update 事件实时同步编辑器与手机预览，失败/取消回滚任务前快照）
 *  · local —— 本地模拟引擎（预设模板 + 规则式修改，离线可用，明确标记）
 *
 * 预览与导出共用同一份 files（composePreview / exportProject）
 * 视觉增强（真实引擎）：Kimi 代码 + Z-Image-Turbo 图像协同，AI 素材经 SSE
 * 实时下发（dataUrl），预览内联显示、ZIP 以二进制文件导出；开关关闭时
 * 后端不向模型提供 generate_image 工具，绝不调用图像 API
 * ──────────────────────────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* 事件回调专用（非渲染期）：requestId 生成与时间戳 */
const makeRequestId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const nowMs = () => Date.now()

let uid = 0
const nid = () => ++uid

const countLines = (p) =>
  ['html', 'css', 'js'].reduce((n, k) => n + p[k].split('\n').length, 0)

/* 新项目意图（本地模拟引擎：已有项目时仍可重新生成全新项目） */
const NEW_BUILD_RE = /做一个|生成一个|来一个|新建|创建一个|帮我做一个/

/* Agent Loop 文件路径 → 前端 files 键映射（file_update 实时同步用） */
const PATH_TO_KEY = { 'index.html': 'html', 'style.css': 'css', 'app.js': 'js' }

/* 连续 file_update 的手机预览刷新节流间隔（合并 iframe 重载） */
const PREVIEW_THROTTLE_MS = 600

export default function VibeWorkbench() {
  const [messages, setMessages] = useState([
    { id: nid(), role: 'agent', text: VISUAL_GREETING, thinking: false, streaming: false },
  ])
  const [files, setFiles] = useState(() => ({ ...VISUAL_STARTER }))
  const [activeFile, setActiveFile] = useState('html')
  const [previewDoc, setPreviewDoc] = useState(() => composePreview(VISUAL_STARTER))
  const [generating, setGenerating] = useState(false)
  const [mode, setMode] = useState('standard')
  const [engine, setEngine] = useState('llm')
  const [assets, setAssets] = useState(() =>
    ASSET_LIBRARY.map((a) => ({ ...a, used: false, fresh: false })),
  )
  /* AI 生成图片素材（视觉增强）：SSE image_generated 实时入库（dataUrl），
     多轮修改随请求回传元数据供模型复用，任务失败回滚到开始前快照 */
  const [aiAssets, setAiAssets] = useState([])
  const [hasProject, setHasProject] = useState(false)
  /* Agent 运行日志（前端 FE + 服务端 BE via SSE，requestId 关联） */
  const [logs, setLogs] = useState([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [taskStart, setTaskStart] = useState(null)

  const cancelRef = useRef(false)
  /* 同步发送锁：点击瞬间立即置位，防止极短时间内的重复点击在 generating
     状态更新生效前穿透守卫，造成多次付费请求 */
  const sendLockRef = useRef(false)
  const requestIdRef = useRef(null)
  const aliveRef = useRef(false)
  const abortRef = useRef(null)
  /* Agent 实时事件桥：SSE 处理器 → 当前运行任务（步骤 UI / 编辑器 / 手机预览） */
  const agentLiveRef = useRef(null)
  /* 当前 LLM 任务的动态步骤卡片消息 id（失败/取消时统一收尾用） */
  const stepsMsgIdRef = useRef(null)
  /* 本任务是否已收到 agent_end 事件（避免响应失败路径重复生成简洁模式错误文案） */
  const agentEndSeenRef = useRef(false)
  /* 思考流尾段累积（当前任务内按「轮次:reasoning」分组，供简洁模式实时打印思考内容） */
  const reasoningTailRef = useRef(new Map())
  /* 最近一次 LLM 任务的需求原文（轮次上限中断后「继续执行」携带原始需求续跑） */
  const lastRequirementRef = useRef('')
  /* 手机预览节流刷新（连续 file_update 合并重载 iframe） */
  const previewTimerRef = useRef(null)
  const previewLastRef = useRef(0)
  /* 流式写入过程中的最新文件快照（供整合/导出读取） */
  const filesRef = useRef(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])
  /* AI 素材实时镜像（SSE 回调非渲染期写入 ref + state 双同步） */
  const aiAssetsRef = useRef([])
  /* 当前项目上下文：模板 / 项目名 / 是否已注入视觉素材 */
  const templateRef = useRef(null)
  const nameRef = useRef('')
  const enhancedRef = useRef(false)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      cancelRef.current = true
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
    }
  }, [])

  /* 生成中守卫：关闭/刷新页面前浏览器原生确认（防误关导致任务中断与代码回滚；
     注意无法阻止浏览器丢弃后台标签页——该场景需在浏览器设置中豁本站免休眠） */
  useEffect(() => {
    if (!generating) return undefined
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [generating])

  const appendMsg = (msg) => setMessages((prev) => [...prev, msg])

  /* 运行日志（前端事件；ERROR 自动展开控制台）
     opts.friendly：简洁模式通俗文案（由事件真实字段映射，非预设）
     opts.group：同组日志原地合并更新（流式心跳不逐条刷屏） */
  const appendLog = (level, stage, text, opts) => {
    setLogs((prev) => {
      const entry = {
        id: nid(),
        t: Date.now(),
        level,
        stage,
        text: String(text),
        src: opts?.src || 'FE',
        friendly: Boolean(opts?.friendly),
        group: opts?.group,
      }
      /* 简洁模式心跳合并：从后向前查找同组最近一条原地更新（中间穿插其它日志不新开行） */
      if (entry.group) {
        const idx = prev.map((x) => x.group).lastIndexOf(entry.group)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], text: entry.text, t: entry.t }
          return next
        }
      }
      const merged = [...prev, entry]
      return merged.length > 300 ? merged.slice(merged.length - 300) : merged
    })
    if (level === 'ERROR') setConsoleOpen(true)
  }

  /* 服务端执行事件：SSE 实时订阅（/api/llm/events），按 requestId 与当前任务关联 */
  useEffect(() => {
    const es = new EventSource('/api/llm/events')
    let connected = false
    es.onopen = () => {
      connected = true
    }
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        /* 丢弃其它 requestId 的历史回放（dev server 重启前的旧事件） */
        if (data.requestId && requestIdRef.current && data.requestId !== requestIdRef.current) return
        /* 类型化 Agent 事件：无进行中任务时丢弃（页面刷新后的事件回放不展示） */
        if (data.type) {
          if (!requestIdRef.current) return
          /* 思考流尾段累积：当前轮次已输出思考内容的最近片段，
             供简洁模式日志直接展示思考内容而非字符计数 */
          let reasoningTail
          if (data.type === 'reasoning_delta' || (data.type === 'stream_progress' && data.phase === 'reasoning')) {
            const g = `sp:${data.turn}:reasoning`
            if (data.type === 'reasoning_delta') {
              const prevTail = reasoningTailRef.current.get(g) || ''
              reasoningTailRef.current.set(g, (prevTail + String(data.text || '')).slice(-200))
            }
            reasoningTail = reasoningTailRef.current.get(g)
          }
          /* 简洁模式通俗文案：统一映射层生成（仅真实事件字段，不伪造状态）；
             group 加 requestId 前缀，避免新一轮任务命中上一任务的合并行 */
          const rq = String(requestIdRef.current)
          const friendly = friendlyForTypedEvent(data, { reasoningTail })
          if (friendly) {
            appendLog(friendly.level, 'AI', friendly.text, {
              friendly: true,
              group: friendly.group ? `${rq}:${friendly.group}` : undefined,
              src: 'BE',
            })
          }
          /* 思考流仅驱动日志展示，不驱动步骤（步骤由 stream_progress 驱动） */
          if (data.type === 'reasoning_delta') return
          const live = agentLiveRef.current
          if (!live) return
          if (data.type === 'agent_start') live.onAgentStart(data)
          else if (data.type === 'turn_start') live.onTurnStart(data)
          else if (data.type === 'stream_progress') live.onStreamProgress(data)
          else if (data.type === 'image_start') live.onImageStart(data)
          else if (data.type === 'image_generated') live.onImageGenerated(data)
          else if (data.type === 'tool_call') live.onToolCall(data)
          else if (data.type === 'file_update') live.onFileUpdate(data)
          else if (data.type === 'turn_end') live.onTurnEnd(data)
          else if (data.type === 'agent_end') live.onAgentEnd(data)
          return
        }
        setLogs((prev) => {
          const next = [
            ...prev,
            {
              id: nid(),
              t: data.t || Date.now(),
              level: data.level || 'INFO',
              stage: data.stage || 'SERVER',
              text: String(data.text ?? ''),
              src: 'BE',
            },
          ]
          return next.length > 300 ? next.slice(next.length - 300) : next
        })
        if (data.level === 'ERROR') setConsoleOpen(true)
      } catch {
        /* 忽略无法解析的帧 */
      }
    }
    es.onerror = () => {
      if (connected) {
        setLogs((prev) => [
          ...prev,
          {
            id: nid(),
            t: Date.now(),
            level: 'WARNING',
            stage: 'SSE',
            text: '服务端日志流连接中断（dev server 重启或网络波动），浏览器将自动重连',
            src: 'FE',
          },
        ])
      }
      connected = false
    }
    return () => es.close()
  }, [])
  const patchMsg = (id, patch) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const updateStepsMsg = (id, fn) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, steps: fn(m.steps) } : m)))

  /* 动态步骤操作集（左侧 AI 执行状态，全部由真实事件驱动）：
     patch 原地更新 / complete 仅未完成时置为完成 / upsert 存在则更新否则追加 / remove 移除 */
  const makeStepOps = (stepsId) => ({
    patch(key, patch) {
      updateStepsMsg(stepsId, (ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)))
    },
    complete(key, detail) {
      updateStepsMsg(stepsId, (ss) =>
        ss.map((s) => (s.key === key && s.status !== 'done' ? { ...s, status: 'done', detail } : s)),
      )
    },
    upsert(step) {
      updateStepsMsg(stepsId, (ss) => {
        const i = ss.findIndex((s) => s.key === step.key)
        if (i >= 0) {
          const next = [...ss]
          next[i] = { ...next[i], ...step }
          return next
        }
        return [...ss, step]
      })
    },
    remove(key) {
      updateStepsMsg(stepsId, (ss) => ss.filter((s) => s.key !== key))
    },
  })

  const stopped = () => cancelRef.current

  /* 手机预览节流刷新：连续 file_update 合并重载 iframe（间隔 PREVIEW_THROTTLE_MS，
     尾部必达一次刷新；始终读取 filesRef 最新值，回滚后触发也只会渲染快照内容） */
  const refreshPreviewThrottled = () => {
    const now = Date.now()
    if (now - previewLastRef.current >= PREVIEW_THROTTLE_MS) {
      previewLastRef.current = now
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
      setPreviewDoc(composePreview(filesRef.current, aiAssetsRef.current))
      return
    }
    if (previewTimerRef.current) return
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null
      previewLastRef.current = Date.now()
      setPreviewDoc(composePreview(filesRef.current, aiAssetsRef.current))
    }, PREVIEW_THROTTLE_MS - (Date.now() - previewLastRef.current))
  }

  /* 立即同步预览（成功收敛 / 失败回滚时使用，清掉等待中的节流定时器） */
  const syncPreviewNow = () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    previewLastRef.current = Date.now()
    setPreviewDoc(composePreview(filesRef.current, aiAssetsRef.current))
  }

  /* 流式输出 Agent 回复文本 */
  const streamReply = async (msgId, text) => {
    for (let i = 0; i < text.length; i += 2) {
      if (stopped()) return
      patchMsg(msgId, { text: text.slice(0, i + 2), thinking: false, streaming: true })
      await sleep(20)
    }
    if (!stopped()) patchMsg(msgId, { text, streaming: false })
  }

  /* 逐行流式写入指定文件内容，节流刷新预览（与导出同一份代码） */
  const streamLines = async (key, content, next) => {
    const lines = content.split('\n')
    let count = 0
    for (let i = 0; i < lines.length; i++) {
      if (stopped()) return
      next[key] += (i === 0 && next[key] === '' ? '' : '\n') + lines[i]
      setFiles({ html: next.html, css: next.css, js: next.js })
      count++
      if (count % 6 === 0 || i === lines.length - 1) setPreviewDoc(composePreview(next))
      await sleep(26)
    }
  }

  /* 主入口：按引擎与项目状态分流（sendLockRef 在任务结束/异常时释放） */
  const handleSend = async (text) => {
    if (generating || sendLockRef.current) return
    sendLockRef.current = true
    try {
      cancelRef.current = false
      setGenerating(true)
      appendMsg({ id: nid(), role: 'user', text, thinking: false, streaming: false })

      /* 新任务：生成 requestId（前端/服务端日志关联），记录提交事件（需求仅记摘要） */
      requestIdRef.current = makeRequestId()
      reasoningTailRef.current.clear()
      lastRequirementRef.current = text
      setTaskStart(nowMs())
      setConsoleOpen(true)
      const briefText = text.replace(/\s+/g, ' ').trim()
      appendLog(
        'INFO',
        'submit',
        `用户提交需求（${briefText.length > 40 ? briefText.slice(0, 40) + '…' : briefText}）`,
      )

      if (engine === 'llm') {
        /* 真实模型 Agent Loop：有项目 → 多轮增量修改；无项目 → 首次生成 */
        await runAgentTask(text, hasProject ? 'modify' : 'generate')
        return
      }

      /* 本地模拟引擎 */
      appendLog('INFO', 'engine', '本地模拟引擎（开发者调试）：预设模板 + 规则式修改，未调用真实模型')
      const rebuild = hasProject && !matchEditIntent(text) && NEW_BUILD_RE.test(text)
      if (!hasProject || rebuild) {
        await runGenerate(text)
      } else {
        await runModify(text)
      }
    } finally {
      sendLockRef.current = false
    }
  }

  /* ══════════ 真实模型引擎：Agent Loop（首次生成 / 多轮增量修改 共用） ══════════ */

  /* Agent 实时事件 → 左侧动态步骤（AI 执行状态）
     全部由真实 SSE 事件驱动：
     · 文件步骤仅在工具执行成功（tool_call.ok）后置为完成，绝不提前标记
     · 流式阶段（reasoning / tools）由 stream_progress 事件提供真实字符计数
     · 'live' 为瞬态步骤：代表当前正在进行、尚无法归属到具体文件的动作 */
  const makeAgentLive = (steps, isModify) => {
    const counts = new Map() /* 同一（工具,文件）的执行次数（完成详情展示） */
    return {
      onAgentStart() {
        steps.patch(
          'understand',
          isModify
            ? { status: 'running', detail: 'AI 正在分析您的修改需求…' }
            : { status: 'running', detail: 'AI 正在分析您想实现的功能…' },
        )
      },
      onTurnStart(ev) {
        if (ev.turn > 1) {
          steps.upsert({ key: 'live', title: '思考中', status: 'running', detail: 'AI 正在分析下一步开发任务…' })
        }
      },
      onStreamProgress(ev) {
        if (ev.phase === 'reasoning') {
          if (ev.turn <= 1) {
            steps.patch('understand', {
              status: 'running',
              detail: 'AI 正在分析需求、规划实现方式…',
            })
          } else {
            steps.upsert({
              key: 'live',
              title: '思考中',
              status: 'running',
              detail: `AI 正在规划下一步修改（总第 ${ev.turn} 步）`,
            })
          }
        } else if (ev.phase === 'tools') {
          if (ev.turn <= 1) steps.complete('understand', '需求已理解，AI 开始执行')
          if ((ev.toolName === 'create_file' || ev.toolName === 'update_file') && ev.toolPath) {
            steps.remove('live')
            const m = fileMeta(ev.toolPath)
            steps.upsert({
              key: `${ev.toolName}:${ev.toolPath}`,
              title: ev.toolName === 'create_file' ? m.createTitle : '修改文件',
              status: 'running',
              detail:
                ev.toolName === 'create_file'
                  ? `正在编写 ${ev.toolPath}（${m.label} · 已生成 ${ev.toolArgsChars} 字符）`
                  : `正在修改 ${ev.toolPath}（${m.label} · 已修改代码）`,
            })
          } else if (ev.toolName === 'read_file') {
            steps.upsert({
              key: 'live',
              title: '查看代码',
              status: 'running',
              detail: ev.toolPath ? `AI 正在查看 ${ev.toolPath} 现有内容…` : 'AI 正在查看现有代码…',
            })
          } else if (ev.toolName === 'generate_image') {
            steps.upsert({
              key: 'live',
              title: '生成图片素材',
              status: 'running',
              detail: 'AI 正在生成专属图片素材（图像模型）…',
            })
          } else if (ev.toolName === 'finish') {
            steps.upsert({ key: 'live', title: '整理总结', status: 'running', detail: 'AI 正在整理开发总结…' })
          } else {
            /* 工具参数已开始流式输出但目标文件尚不可知：如实显示通用编写状态 */
            steps.upsert({
              key: 'live',
              title: '编写代码',
              status: 'running',
              detail: `AI 正在编写代码（已输出 ${ev.toolArgsChars} 字符）`,
            })
          }
        }
        /* content / waiting 阶段不驱动步骤（简洁模式日志已有对应文案） */
      },
      onToolCall(ev) {
        steps.remove('live')
        if (ev.turn <= 1) steps.complete('understand', '需求已理解，AI 开始执行')
        if (ev.tool === 'generate_image') {
          /* 成功步骤由 image_generated 事件驱动（含尺寸/耗时详情），此处仅覆盖失败 */
          if (!ev.ok) {
            steps.upsert({
              key: `image:${ev.turn}:${ev.callIndex}`,
              title: '生成图片素材',
              status: 'error',
              detail: `未成功：${ev.detail || '失败原因已反馈给 AI（可改用代码实现）'}`,
            })
          }
          return
        }
        if ((ev.tool !== 'create_file' && ev.tool !== 'update_file') || !ev.path) return
        const m = fileMeta(ev.path)
        const key = `${ev.tool}:${ev.path}`
        const title = ev.tool === 'create_file' ? m.createTitle : '修改文件'
        if (ev.ok) {
          const n = (counts.get(key) || 0) + 1
          counts.set(key, n)
          steps.upsert({
            key,
            title,
            status: 'done',
            detail:
              ev.tool === 'create_file'
                ? `${ev.path} 已创建（${m.label}）${n > 1 ? ` · 第 ${n} 次写入` : ''}`
                : `${ev.path} 已更新（${m.label}）${n > 1 ? ` · 累计修改 ${n} 次` : ''}`,
          })
        } else {
          steps.upsert({
            key,
            title,
            status: 'error',
            detail: `未成功：${ev.detail || '失败原因已反馈给 AI'}`,
          })
        }
      },
      onImageStart(ev) {
        steps.remove('live')
        steps.upsert({
          key: `image:${ev.turn}:${ev.callIndex}`,
          title: '生成图片素材',
          status: 'running',
          detail: `正在生成 ${ev.name || '图片素材'}…`,
        })
      },
      onImageGenerated(ev) {
        /* 素材实时入库（dataUrl 通道）：素材库面板即时可见，预览待代码集成后内联显示 */
        const asset = {
          id: `ai-${nid()}`,
          name: ev.name,
          type: ev.assetType,
          path: ev.path,
          mime: ev.mime,
          dataUrl: ev.dataUrl,
          width: ev.width,
          height: ev.height,
          model: ev.model,
          sizeBytes: ev.sizeBytes,
          createdAt: Date.now(),
        }
        const next = [...aiAssetsRef.current.filter((a) => a.path !== asset.path), asset]
        aiAssetsRef.current = next
        setAiAssets(next)
        steps.upsert({
          key: `image:${ev.turn}:${ev.callIndex}`,
          title: '生成图片素材',
          status: 'done',
          detail: `${ev.path} 已生成（${ev.width}×${ev.height} · ${Math.max(1, Math.round((ev.sizeBytes || 0) / 1024))}KB），等待 AI 集成到界面`,
        })
      },
      onFileUpdate(ev) {
        const key = PATH_TO_KEY[ev.path]
        if (!key) return
        const next = { ...filesRef.current, [key]: ev.content }
        filesRef.current = next
        setFiles(next)
        setActiveFile(key)
        refreshPreviewThrottled()
        appendLog('INFO', 'sync', `实时同步 ${ev.path}（${ev.size}B · 第 ${ev.turn} 轮）→ 编辑器 + 手机预览`)
      },
      onTurnEnd() {
        /* 本轮结束：清理瞬态步骤（轮次统计见服务端原始日志） */
        steps.remove('live')
      },
      onAgentEnd(ev) {
        agentEndSeenRef.current = true
        steps.remove('live')
        if (ev.ok) {
          appendLog(
            'SUCCESS',
            'agent',
            `Agent 任务完成 · ${ev.turns} 轮 · 耗时 ${(ev.elapsedMs / 1000).toFixed(1)}s`,
          )
          steps.upsert({ key: 'finish', title: '完成开发', status: 'running', detail: '正在生成最终文件并更新预览…' })
        } else {
          const resumable = ev.code === 'MAX_TURNS_EXCEEDED' && ev.filesCommitted
          appendLog(
            resumable ? 'WARNING' : 'ERROR',
            'agent',
            `Agent 任务${resumable ? '暂停' : '失败'} · ${ev.code || '未知错误'} · ${ev.turns} 轮 · 耗时 ${(ev.elapsedMs / 1000).toFixed(1)}s · ${ev.filesCommitted ? '已提交保留的修改（可继续执行）' : '未提交修改'}`,
          )
        }
      },
    }
  }

  /* 任务包装：成功/失败/超时/取消/异常均保证退出「生成中」；
     任务开始即保存快照，未成功结束时恢复文件与预览（不留半成品） */
  const runAgentTask = async (text, kind) => {
    const snapshot = { ...filesRef.current }
    const assetsSnapshot = [...aiAssetsRef.current]
    let succeeded = false
    try {
      succeeded = await runAgentTaskInner(text, kind)
    } catch (e) {
      appendLog('ERROR', 'client', `前端流程异常：${e?.message || e} · 已恢复任务开始前的文件`)
      appendLog('ERROR', 'AI', '任务出现未预期异常，已恢复任务开始前的项目文件。', { friendly: true })
      appendMsg({
        id: nid(),
        role: 'agent',
        text: '❌ 前端流程出现未预期异常，已退出生成状态并恢复任务开始前的项目文件，可直接重试。',
        thinking: false,
        streaming: false,
      })
    } finally {
      agentLiveRef.current = null
      abortRef.current = null
      requestIdRef.current = null
      setTaskStart(null)
      /* 未成功结束：动态步骤统一收尾（瞬态步骤移除，进行中步骤标记失败/停止） */
      const sid = stepsMsgIdRef.current
      if (sid) {
        const failed = !cancelRef.current
        updateStepsMsg(sid, (ss) =>
          ss
            .filter((s) => s.key !== 'live')
            .map((s) =>
              s.status === 'running'
                ? { ...s, status: failed ? 'error' : 'skipped', detail: failed ? '任务未完成' : '已停止' }
                : s,
            ),
        )
      }
      stepsMsgIdRef.current = null
      /* 失败 / 超时 / 取消 / 异常：回滚到任务开始前的快照（代码 + AI 素材 + 预览一并还原） */
      if (!succeeded) {
        const filesTouched =
          filesRef.current.html !== snapshot.html ||
          filesRef.current.css !== snapshot.css ||
          filesRef.current.js !== snapshot.js
        const assetsTouched =
          aiAssetsRef.current.length !== assetsSnapshot.length ||
          aiAssetsRef.current.some((a, i) => a.path !== assetsSnapshot[i]?.path)
        if (filesTouched || assetsTouched) {
          filesRef.current = { ...snapshot }
          setFiles({ ...snapshot })
          aiAssetsRef.current = [...assetsSnapshot]
          setAiAssets([...assetsSnapshot])
          syncPreviewNow()
          appendLog('WARNING', 'rollback', '已恢复任务开始前的项目文件与预览（不留半成品）')
          appendLog('WARNING', 'AI', '已恢复任务开始前的项目文件与预览。', { friendly: true })
        }
      }
      setGenerating(false)
    }
  }

  const runAgentTaskInner = async (text, kind) => {
    const isModify = kind === 'modify'
    /* 动态步骤卡片：步骤随真实事件逐步出现（理解需求 → 文件操作 → 完成开发），
       多轮修改任务只展示实际发生的动作，不重复首次创建的全套步骤 */
    const stepsId = nid()
    stepsMsgIdRef.current = stepsId
    appendMsg({
      id: stepsId,
      type: 'steps',
      role: 'agent',
      badge: '真实执行',
      steps: [
        {
          key: 'understand',
          title: '理解需求',
          status: 'running',
          detail: '正在提交开发需求…',
          tip: 'AI 正在分析需求',
        },
      ],
    })
    const stepOps = makeStepOps(stepsId)
    agentEndSeenRef.current = false
    const failRunningSteps = (detail) =>
      updateStepsMsg(stepsId, (ss) => ss.map((s) => (s.status === 'running' ? { ...s, status: 'error', detail } : s)))

    /* Agent 执行说明（最终回复占位） */
    const thinkingId = nid()
    appendMsg({
      id: thinkingId,
      role: 'agent',
      text: isModify
        ? 'Agent 正在基于当前项目代码进行增量修改（多轮工具调用），请稍候…'
        : '正在调用 Kimi K2.7 Code 生成项目代码（Agent 多轮执行，通常 30-120 秒）…',
      thinking: true,
      streaming: true,
    })

    /* 视觉增强开关：任务开始时固定（运行中开关不可切换），随请求传给后端
       决定 generate_image 工具权限；多轮修改附带已有素材元数据（不含二进制）供模型复用 */
    const visualEnhance = engine === 'llm' && mode === 'enhanced'
    const payload = {
      kind,
      requirement: text,
      requestId: requestIdRef.current,
      visualEnhance,
      ...(isModify ? { files: { ...filesRef.current } } : {}),
      ...(isModify && aiAssetsRef.current.length
        ? {
            assets: aiAssetsRef.current.map((a) => ({
              path: a.path,
              name: a.name,
              type: a.type,
              mime: a.mime,
              width: a.width,
              height: a.height,
              model: a.model,
              sizeBytes: a.sizeBytes,
            })),
          }
        : {}),
    }
    /* 响应素材合并（base64 → dataUrl 兜底：SSE 实时通道异常时最终响应补齐） */
    const mergeResponseAssets = (r) => {
      if (!Array.isArray(r?.assets) || !r.assets.length) return
      const merged = [...aiAssetsRef.current]
      for (const a of r.assets) {
        if (!a?.path || !a?.base64) continue
        const asset = {
          id: `ai-${nid()}`,
          name: a.name || a.path,
          type: a.type || 'illustration',
          path: a.path,
          mime: a.mime || 'image/png',
          dataUrl: `data:${a.mime || 'image/png'};base64,${a.base64}`,
          width: a.width,
          height: a.height,
          model: a.model,
          sizeBytes: a.sizeBytes,
          createdAt: Date.now(),
        }
        const idx = merged.findIndex((x) => x.path === a.path)
        if (idx >= 0) merged[idx] = { ...merged[idx], ...asset }
        else merged.push(asset)
      }
      aiAssetsRef.current = merged
      setAiAssets(merged)
    }
    appendLog(
      'INFO',
      'send',
      `前端发起 POST /api/llm/agent（requestId=${String(requestIdRef.current).slice(0, 8)} · kind=${kind}${isModify ? ' · 附带当前三文件' : ''}${visualEnhance ? ' · 视觉增强开启' : ''}${isModify && aiAssetsRef.current.length ? ` · 已有素材 ${aiAssetsRef.current.length} 个` : ''} · 前端超时 630s）`,
    )
    agentLiveRef.current = makeAgentLive(stepOps, isModify)

    const ctrl = new AbortController()
    abortRef.current = ctrl
    let res = await requestAgentRun(payload, { signal: ctrl.signal })
    abortRef.current = null
    if (stopped()) return finishStopped('已恢复任务开始前的项目文件与预览。')

    /* 兼容回退：Agent 路由不存在（旧版后端）→ 改走旧 /api/llm/generate 一次性生成
       （仅 404 触发，不产生额外付费请求；旧接口无实时事件与轮次信息） */
    let viaLegacy = false
    if (!res.ok && res.code === 'AGENT_ENDPOINT_NOT_FOUND') {
      viaLegacy = true
      agentLiveRef.current = null
      appendLog(
        'WARNING',
        'fallback',
        '当前后端未提供 /api/llm/agent，回退旧版 /api/llm/generate（兼容模式，无实时事件）',
      )
      stepOps.upsert({
        key: 'live',
        title: '生成中',
        status: 'running',
        detail: '兼容模式：旧版一次性生成接口（无 Agent 实时事件）…',
      })
      res = await requestProjectGeneration(payload, { signal: ctrl.signal })
      if (stopped()) return finishStopped('已恢复任务开始前的项目文件与预览。')
    }

    if (!res.ok) {
      /* 轮次上限可续跑：后端已提交保留的文件修改，前端保留文件并给出「继续执行」入口 */
      if (res.resumable) {
        appendLog(
          'WARNING',
          'resume',
          `轮次上限中断（${res.code}）· 已保留 ${res.turns} 轮内完成的文件修改，可继续执行`,
        )
        const committed = {
          html: res.files?.['index.html'] ?? filesRef.current.html,
          css: res.files?.['style.css'] ?? filesRef.current.css,
          js: res.files?.['app.js'] ?? filesRef.current.js,
        }
        filesRef.current = { ...committed }
        setFiles({ ...committed })
        mergeResponseAssets(res)
        syncPreviewNow()
        if (!hasProject) {
          setHasProject(true)
          nameRef.current = 'Kimi 生成项目'
        }
        /* 步骤收尾：进行中步骤标记为已暂停（「继续执行」会追加新的步骤卡片） */
        stepOps.remove('live')
        updateStepsMsg(stepsId, (ss) =>
          ss.map((s) =>
            s.status === 'running' ? { ...s, status: 'skipped', detail: '已暂停（可继续执行）' } : s,
          ),
        )
        patchMsg(thinkingId, {
          thinking: false,
          streaming: false,
          text: '⏸ AI 思考过多（已达到轮次上限），前面已完成的修改已全部保留。\n点击下方「继续执行」按钮，AI 将接着完成剩余开发工作。',
        })
        appendMsg({ id: nid(), type: 'continue', role: 'agent' })
        return true
      }
      appendLog(
        'ERROR',
        'response',
        `请求失败 · 类型=${res.code}${res.httpStatus ? ` HTTP=${res.httpStatus}` : ''}${res.upstream === true ? ' 上游=是' : res.upstream === false ? ' 上游=否' : ''}${res.timedOut ? ' 超时=是' : ''}${res.elapsedMs ? ` 耗时=${res.elapsedMs}ms` : ''}${res.traceId ? ` 追踪ID=${res.traceId}` : ''} · ${res.message}`,
      )
      stepOps.remove('live')
      failRunningSteps(`${res.code} · ${res.message}`)
      /* agent_end 已生成过简洁模式失败文案时不再重复（如 TURN_TIMEOUT 已提示重试） */
      if (!agentEndSeenRef.current) {
        appendLog('ERROR', 'AI', friendlyRequestError(res.code, res.message), { friendly: true })
      }
      patchMsg(thinkingId, {
        thinking: false,
        streaming: false,
        text: `❌ ${isModify ? '修改' : '生成'}失败（${res.code}）：${res.message}\n\n已恢复任务开始前的项目文件与预览。可检查 .env 配置后重试，或切换「本地模拟」引擎离线体验。`,
      })
      return false
    }

    const elapsedMs = res.elapsedMs ?? res.elapsed ?? 0
    appendLog(
      'SUCCESS',
      'response',
      `收到服务端响应（成功 · ${viaLegacy ? '旧版接口' : 'Agent Loop'} · 服务端耗时 ${elapsedMs || '?'}ms · tokens ${res.usage?.prompt_tokens ?? '?'}/${res.usage?.completion_tokens ?? '?'}）`,
    )

    /* 收敛最终文件与预览（完成开发步骤由真实 agent_end 事件启动，此处幂等补充） */
    stepOps.remove('live')
    stepOps.upsert({ key: 'finish', title: '完成开发', status: 'running', detail: '正在生成最终文件并更新预览…' })
    const next = {
      html: res.files?.['index.html'] ?? filesRef.current.html,
      css: res.files?.['style.css'] ?? filesRef.current.css,
      js: res.files?.['app.js'] ?? filesRef.current.js,
    }
    filesRef.current = { ...next }
    setFiles({ ...next })
    /* 首次生成新项目：清空上一项目素材；再合并本次响应素材（按 path 幂等，SSE 已入库的不重复） */
    if (!isModify) {
      aiAssetsRef.current = []
      setAiAssets([])
    }
    mergeResponseAssets(res)
    syncPreviewNow()
    stepOps.complete('finish', '项目文件已生成，预览已更新')
    stepOps.complete('understand', '需求已理解')
    appendLog(
      'INFO',
      'files',
      `项目文件收敛 · index.html ${next.html.length}B / style.css ${next.css.length}B / app.js ${next.js.length}B`,
    )
    appendLog('SUCCESS', 'preview', '手机模拟器沙箱已加载最终代码（iframe 与导出共用同一份文件）')

    if (!isModify) {
      templateRef.current = null
      nameRef.current = 'Kimi 生成项目'
      enhancedRef.current = false
      setHasProject(true)
    }

    const tokenLine = res.usage
      ? `· 模型：${res.model ?? 'Kimi K2.7 Code'} · tokens：${res.usage.prompt_tokens ?? '?'} 入 / ${res.usage.completion_tokens ?? '?'} 出\n· Agent 轮次：${res.turns ?? '—'} · 耗时：${Math.round(elapsedMs / 1000)}s`
      : ''
    const imageCount = Array.isArray(res.assets) ? res.assets.length : 0
    const enhancedNote =
      mode === 'enhanced'
        ? imageCount > 0
          ? `\n\n🎨 视觉增强：本次生成 ${imageCount} 张图片素材（Z-Image-Turbo），已存入素材库并以相对路径集成到界面。`
          : '\n\n🎨 视觉增强已开启：AI 判断本次无需生成图片素材，视觉效果以纯代码实现。'
        : ''
    await streamReply(
      thinkingId,
      isModify
        ? `✅ 修改完成（Kimi K2.7 Code · Agent 增量修改）\n\n${res.summary || '已按要求修改项目'}\n\n${tokenLine}\n\n请对照预览确认原有功能与 localStorage 数据是否保留；如不满意可继续发指令调整，或点「导出 ZIP」下载项目。`
        : `✅ 项目已生成（Kimi K2.7 Code · Agent Loop 真实调用）\n\n${res.summary || '移动端 H5 项目'}\n\n${tokenLine}\n\n可继续用自然语言描述修改需求（多轮增量修改），或点「导出 ZIP」下载完整项目。${enhancedNote}`,
    )
    appendLog(
      'SUCCESS',
      'done',
      `任务完成（${isModify ? '增量修改' : '首次生成'} · ${viaLegacy ? '兼容模式' : 'Agent Loop'}）：代码与预览已更新`,
    )
    return true
  }

  /* ══════════ 本地模拟引擎：新建项目 ══════════ */

  const runGenerate = async (text) => {
    setAssets((prev) => prev.map((a) => ({ ...a, used: false, fresh: false })))
    enhancedRef.current = false

    const project = matchVisualProject(text)
    appendLog('INFO', 'local', `本地模拟引擎关键词匹配：${project.name}（预设模板，流式写入为演示动画，非模型输出）`)
    const enhanced = mode === 'enhanced'

    const stepsId = nid()
    appendMsg({ id: stepsId, type: 'steps', role: 'agent', steps: initSteps() })
    const setStep = (key, status, detail) =>
      updateStepsMsg(stepsId, (ss) => ss.map((s) => (s.key === key ? { ...s, status, detail } : s)))

    /* ① 需求分析 */
    setStep('analyze', 'running', '解析需求文本…')
    await sleep(900)
    if (stopped()) return finishStopped()
    setStep('analyze', 'done', project.analyzeText + ' · ' + (enhanced ? '视觉增强' : '标准'))

    /* Agent 说明（流式） */
    const replyId = nid()
    appendMsg({ id: replyId, role: 'agent', text: '', thinking: true, streaming: true })
    await sleep(700)
    await streamReply(replyId, project.reply + (enhanced ? project.enhancedNote : ''))

    /* ② 页面生成 */
    setStep('codegen', 'running', '正在生成页面代码…')
    const next = { html: '', css: '', js: '' }
    for (const key of ['html', 'css', 'js']) {
      if (stopped()) return finishStopped()
      setActiveFile(key)
      await streamLines(key, project[key], next)
    }
    if (stopped()) return finishStopped()
    setStep('codegen', 'done', '3 个文件 · ' + countLines(project) + ' 行真实代码')

    /* ③ 素材生成（视觉增强专属） */
    let picks = []
    if (enhanced) {
      setStep('asset', 'running', '注入视觉素材（本地素材库）…')
      picks = project.assetPick
        .map((id) => ASSET_LIBRARY.find((a) => a.id === id))
        .filter(Boolean)
      setActiveFile('assets')
      await sleep(500)
      for (const a of picks) {
        if (stopped()) return finishStopped()
        setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, used: true, fresh: true } : x)))
        await sleep(550)
      }
      enhancedRef.current = true
      setStep('asset', 'done', '应用 ' + picks.length + ' 枚素材 · ' + picks.map((a) => a.name).join(' / '))
    } else {
      setStep('asset', 'skipped', '标准模式，跳过素材生成')
      await sleep(350)
    }

    /* ④ 代码整合 */
    setStep('integrate', 'running', '整合素材与页面代码…')
    if (enhanced && picks.length) {
      const cssAssets = picks.filter((a) => a.type !== 'illustration' && a.css)
      const heroAsset = picks.find((a) => a.type === 'illustration' && a.html)
      /* 素材 CSS 流式追加到 style.css 末尾 */
      for (const a of cssAssets) {
        if (stopped()) return finishStopped()
        setActiveFile('css')
        await streamLines('css', '\n\n' + a.css, next)
      }
      /* Hero 插槽替换 */
      if (heroAsset) {
        if (stopped()) return finishStopped()
        await sleep(250)
        setActiveFile('html')
        next.html = next.html.replace('<!-- SLOT:HERO -->', heroAsset.html)
        setFiles({ html: next.html, css: next.css, js: next.js })
        await sleep(350)
      }
      setStep('integrate', 'done', cssAssets.length + ' 段素材 CSS + Hero 插槽注入完成')
    } else {
      await sleep(500)
      setStep('integrate', 'done', '文件合并完成')
    }

    /* ⑤ 预览验证（沙箱运行与导出相同的一份代码） */
    setStep('verify', 'running', '布局与交互自检…')
    await sleep(800)
    if (stopped()) return finishStopped()
    setPreviewDoc(composePreview(next))
    setStep('verify', 'done', '布局 ✓ 导航切换 ✓ 本地存储交互 ✓')

    templateRef.current = project
    nameRef.current = project.name
    setHasProject(true)

    appendMsg({
      id: nid(),
      role: 'agent',
      text: getVisualSummary(mode),
      thinking: false,
      streaming: false,
    })
    appendLog('SUCCESS', 'done', '本地模拟生成完成（未调用真实模型）')
    setGenerating(false)
    return undefined
  }

  /* ══════════ 本地模拟引擎：规则式增量修改 ══════════ */

  const runModify = async (text) => {
    const intent = matchEditIntent(text)
    appendLog(
      'INFO',
      'local',
      `本地规则引擎意图识别：${intent ? `${intent.label}（${intent.type}）` : '未识别（将提示能力边界）'}`,
    )

    /* 未识别 → 诚实说明能力边界，不伪装 AI */
    if (!intent) {
      const replyId = nid()
      appendMsg({ id: replyId, role: 'agent', text: '', thinking: true, streaming: true })
      await sleep(600)
      await streamReply(
        replyId,
        '这条指令超出了本地规则引擎的支持范围 😥\n\n' +
          EDIT_CAPABILITIES +
          '\n如需任意自然语言修改，请切换到「真实模型」引擎（需配置 API Key）。',
      )
      setGenerating(false)
      return
    }

    const stepsId = nid()
    appendMsg({ id: stepsId, type: 'steps', role: 'agent', steps: initSteps() })
    const setStep = (key, status, detail) =>
      updateStepsMsg(stepsId, (ss) => ss.map((s) => (s.key === key ? { ...s, status, detail } : s)))

    /* ① 需求分析（意图识别） */
    setStep('analyze', 'running', '解析修改指令…')
    await sleep(500)
    if (stopped()) return finishStopped()
    setStep('analyze', 'done', intent.label + ' · 增量修改')

    /* ② 视觉增强类：对当前项目注入素材 */
    if (intent.type === 'enhance') {
      if (enhancedRef.current) {
        setStep('codegen', 'skipped', '当前项目已应用视觉增强')
        setStep('asset', 'skipped', '素材已注入')
        setStep('integrate', 'skipped', '无需重复注入')
        setStep('verify', 'skipped', '')
        const replyId = nid()
        appendMsg({ id: replyId, role: 'agent', text: '', thinking: true, streaming: true })
        await sleep(500)
        await streamReply(
          replyId,
          '🎨 当前项目已应用视觉增强，无需重复注入（避免素材 CSS 堆叠）。\n可改主色 / 标题微调，或发「做一个 …」重新生成新项目。',
        )
        setGenerating(false)
        return
      }

      setStep('codegen', 'skipped', '修改类型：素材注入（不改业务代码）')
      setStep('asset', 'running', '注入视觉素材（本地素材库）…')
      const picks = (templateRef.current?.assetPick || ['bg-twilight', 'illu-rocket', 'btn-neon'])
        .map((id) => ASSET_LIBRARY.find((a) => a.id === id))
        .filter(Boolean)
      setActiveFile('assets')
      await sleep(400)
      for (const a of picks) {
        if (stopped()) return finishStopped()
        setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, used: true, fresh: true } : x)))
        await sleep(450)
      }
      setStep('asset', 'done', '应用 ' + picks.length + ' 枚素材')

      setStep('integrate', 'running', '整合素材与当前代码…')
      const next = { ...filesRef.current }
      const cssAssets = picks.filter((a) => a.type !== 'illustration' && a.css)
      const heroAsset = picks.find((a) => a.type === 'illustration' && a.html)
      for (const a of cssAssets) {
        if (stopped()) return finishStopped()
        setActiveFile('css')
        await streamLines('css', '\n\n' + a.css, next)
      }
      if (heroAsset && next.html.includes('<!-- SLOT:HERO -->')) {
        if (stopped()) return finishStopped()
        await sleep(250)
        setActiveFile('html')
        next.html = next.html.replace('<!-- SLOT:HERO -->', heroAsset.html)
        setFiles({ html: next.html, css: next.css, js: next.js })
        await sleep(350)
      }
      enhancedRef.current = true
      setStep('integrate', 'done', cssAssets.length + ' 段素材 CSS' + (heroAsset ? ' + Hero 插槽' : '') + '注入完成')

      setStep('verify', 'running', '刷新沙箱预览…')
      await sleep(600)
      if (stopped()) return finishStopped()
      setPreviewDoc(composePreview(next))
      setStep('verify', 'done', '布局 ✓ 交互 ✓ 素材生效 ✓')

      appendMsg({
        id: nid(),
        role: 'agent',
        text: '🎨 视觉增强已注入当前项目（本地模拟引擎）。\n预览与代码文件同步更新，可点「导出」打包含素材的 ZIP 项目。',
        thinking: false,
        streaming: false,
      })
      setGenerating(false)
      return
    }

    /* ③ 改色 / 改标题：文件级增量替换 */
    setStep('codegen', 'running', '正在增量修改代码…')
    await sleep(600)
    if (stopped()) return finishStopped()
    setStep('asset', 'skipped', '非素材类修改')
    setStep('integrate', 'skipped', '保留其余代码与功能不变')

    const result = applyEdit(intent, filesRef.current)
    if (result.unchanged) {
      setStep('codegen', 'skipped', result.detail)
      setStep('verify', 'skipped', '')
      const replyId = nid()
      appendMsg({ id: replyId, role: 'agent', text: '', thinking: true, streaming: true })
      await sleep(500)
      await streamReply(replyId, '⚠️ ' + result.detail + '，本次未修改任何文件。')
      setGenerating(false)
      return
    }

    setFiles(result.files)
    setActiveFile(result.tab)
    setStep('codegen', 'done', result.detail)

    setStep('verify', 'running', '刷新沙箱预览…')
    await sleep(500)
    if (stopped()) return finishStopped()
    setPreviewDoc(composePreview(result.files))
    setStep('verify', 'done', '布局 ✓ 交互 ✓ 原功能保留 ✓')

    const replyId = nid()
    appendMsg({ id: replyId, role: 'agent', text: '', thinking: true, streaming: true })
    await sleep(500)
    await streamReply(
      replyId,
      '✅ 已完成增量修改（本地规则引擎）：\n' +
        result.changes.map((c) => '· ' + c).join('\n') +
        '\n\n仅替换目标代码，其余文件与功能保持不变。可继续发指令修改，或点「导出」下载 ZIP 项目。',
    )
    setGenerating(false)
  }

  const finishStopped = (note) => {
    appendMsg({
      id: nid(),
      role: 'agent',
      text: `⏹ 已停止本次任务。${note || '当前项目代码保持停止前的状态。'}`,
      thinking: false,
      streaming: false,
    })
    appendLog('WARNING', 'done', '任务已停止（用户取消）：可重新发起请求')
    setGenerating(false)
  }

  const handleStop = () => {
    cancelRef.current = true
    abortRef.current?.abort()
    appendLog('WARNING', 'stop', '用户主动停止：AbortController 已中止前端 fetch（服务端上游请求随之中止）')
  }

  /* 轮次上限中断后的「继续执行」：携带原始需求基于已保留的文件续跑（增量修改模式）；
     需求原文保持最初版本，避免多次续跑时文案嵌套 */
  const handleContinue = () => {
    if (generating || engine !== 'llm' || !lastRequirementRef.current) return
    const raw = lastRequirementRef.current
    handleSend(`继续完成上次未完成的开发任务（原始需求：${raw}）`)
    lastRequirementRef.current = raw
  }

  /* 开发者设置中的引擎切换：普通用户默认真实模型；
     切回真实引擎时重置视觉增强（AI 生图仅真实引擎可用） */
  const handleEngineChange = (next) => {
    setEngine(next)
    if (next === 'llm') setMode('standard')
  }

  const handleFileChange = (key, value) => {
    setFiles((prev) => ({ ...prev, [key]: value }))
  }

  const handleRun = () => {
    setPreviewDoc(composePreview(filesRef.current, aiAssetsRef.current))
  }

  /* 导出：与预览同一份 files + 已应用素材 + AI 图片二进制 + 引擎标识 */
  const handleExport = () => {
    exportProject(
      filesRef.current,
      assets.filter((a) => a.used),
      {
        projectName: nameRef.current || 'Visual Agent Project',
        modeLabel: VISUAL_MODES[mode].label,
        engine: engine === 'llm' ? 'llm' : 'local',
      },
      aiAssetsRef.current,
    )
  }

  /* AI 素材是否已被项目引用（代码中出现相对路径）：供素材库「已应用」标识 */
  const aiAssetsView = useMemo(
    () =>
      aiAssets.map((a) => ({
        ...a,
        used: `${files.html}${files.css}${files.js}`.includes(a.path),
      })),
    [aiAssets, files],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <ChatPanel
          messages={messages}
          generating={generating}
          mode={mode}
          engine={engine}
          hasProject={hasProject}
          onModeChange={setMode}
          onEngineChange={handleEngineChange}
          onSend={handleSend}
          onStop={handleStop}
          onContinue={handleContinue}
        />
        <CodePanel
          files={files}
          activeFile={activeFile}
          onActiveChange={setActiveFile}
          generating={generating}
          onRun={handleRun}
          onExport={handleExport}
          onFileChange={handleFileChange}
          assets={assets}
          aiAssets={aiAssetsView}
        />
        <PhoneSimulator doc={previewDoc} generating={generating} />
      </div>
      <DebugConsole
        logs={logs}
        open={consoleOpen}
        onToggle={() => setConsoleOpen((v) => !v)}
        onClear={() => setLogs([])}
        running={generating}
        taskStart={taskStart}
      />
    </div>
  )
}
