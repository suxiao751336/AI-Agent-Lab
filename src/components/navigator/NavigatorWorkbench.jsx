/* ============================================================
 * Conversation Navigator Agent · 工作台主组件
 * ------------------------------------------------------------
 * 三栏布局（整体为正常 AI 聊天应用）：
 *   左栏 26%：新建聊天 + 体验示例入口 + 目录 Agent 状态 +
 *             统一导航树（会话 → 话题 → 子话题）
 *   中栏 flex：未打开会话时显示聊天首页；打开后显示消息流
 *             + 底部输入框（可继续追加消息）
 *   右栏 26%：AI 帮我找（未打开会话时显示功能介绍）
 *
 * 会话模型：{ id, title, subtitle, demo, messages, topics }
 * - 内置 TravelMate 演示会话（单份，不随用户操作增删）
 * - 用户会话 localStorage 持久化，与演示数据完全分离
 *
 * 跳转机制：全部基于稳定 messageId -> DOM（msg-<id>）的
 * scrollIntoView 精准定位 + 短暂高亮。pendingJump 协调
 * 「跨会话话题跳转」与「打开会话自动滚动动画」的先后顺序。
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NavSidebar from './NavSidebar'
import MessageList from './MessageList'
import RetracePanel from './RetracePanel'
import ChatComposer from './ChatComposer'
import ChatHome from './ChatHome'
import {
  AGENT_STATUS,
  CONVERSATION,
  DEMO_QUERIES,
  TOPICS,
  blockToText,
  countTopics,
  createDemoAgentState,
  createFailedAgentState,
  createGeneratedAgentState,
  createPendingAgentState,
  createRunningAgentState,
  createAssistantMessage,
  createIncrementalRunningAgentState,
  createIncrementalDoneAgentState,
  createIncrementalFailedAgentState,
  createUserMessage,
  createUserSession,
  deriveCodeIndex,
  deriveMediaIndex,
  flattenTopicTree,
  loadMaintenanceTasks,
  loadUserSessions,
  roundOfMessage,
  saveMaintenanceTasks,
  saveUserSessions,
  createMaintenanceQueueManager,
} from '../../data/navigator'
import { generateTopics, maintainTopics } from '../../services/navigatorTopics'
import { streamChatReply } from '../../services/navigatorChat'

/* 运行日志工具：普通条目追加；带 tag 的条目滚动替换（如流式接收进度） */
function pushLog(logs, text, tag) {
  if (tag) return [...logs.filter((l) => l.tag !== tag), { tag, text }]
  return [...logs, { tag: null, text }]
}

/* ---------- 中间普通聊天的上下文构建（阶段 2） ---------- */

const CHAT_CONTEXT_MAX_MESSAGES = 20 /* 多轮上下文条数上限 */
const CHAT_CONTEXT_MAX_CHARS = 20000 /* 多轮上下文总字符上限 */

/* 构建多轮上下文：会话历史消息转 {role, content}，超限从最旧截取
 * （保留最近 20 条且总字符 ≤ 20000，与服务端截取策略一致）。
 * blockToText / flattenTopicTree 由数据层统一提供 */
function buildChatContext(sessionMessages, userMsg) {
  const items = []
  for (const m of sessionMessages) {
    const content = (m.blocks ?? []).map(blockToText).join('\n').trim()
    if (content) items.push({ role: m.role, content })
  }
  items.push({ role: 'user', content: userMsg.blocks[0]?.text ?? '' })
  while (items.length > CHAT_CONTEXT_MAX_MESSAGES) items.shift()
  while (
    items.length > 1 &&
    items.reduce((n, m) => n + m.content.length, 0) > CHAT_CONTEXT_MAX_CHARS
  ) {
    items.shift()
  }
  return items
}

/* ---------- 开发调试：目录映射输出（仅 DEV 构建） ----------
 * 格式：话题标题 → topicId → parentTopicId → messageIds → 实际跳转 messageId。
 * 跳转目标 = 话题关联消息中会话时间序最早的一条（与 handleTopicJump 一致），
 * 用于核对「模型关联 → 服务端校验 → 前端树 → 点击定位」全链路 */
function topicJumpTarget(topic, session) {
  const order = new Map((session?.messages ?? []).map((m, i) => [m.id, i]))
  return [...(topic.messageIds ?? [])].sort(
    (a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity),
  )[0]
}

function findTopicParent(topics, topicId, parentId = null) {
  for (const t of topics ?? []) {
    if (t.id === topicId) return parentId
    const hit = findTopicParent(t.children ?? [], topicId, t.id)
    if (hit !== undefined) return hit
  }
  return undefined
}

function logTopicMap(topics, session, label) {
  if (!import.meta.env.DEV) return
  const walk = (nodes, parentId) => {
    for (const n of nodes ?? []) {
      console.debug(
        `[目录映射${label ? ` · ${label}` : ''}] ${n.title} → ${n.id} → parent=${parentId ?? '-'} → messageIds=[${(n.messageIds ?? []).join(',')}] → 跳转=${topicJumpTarget(n, session) ?? '无'}`,
      )
      walk(n.children ?? [], n.id)
    }
  }
  walk(topics, null)
}

/* 内置演示会话（会话列表中仅此一份，标注「演示案例」） */
const DEMO_SESSION = {
  id: CONVERSATION.id,
  title: CONVERSATION.title,
  subtitle: CONVERSATION.subtitle,
  demo: true,
  topics: TOPICS,
}

/* 演示目录 Agent 状态：明确标注「示例目录」，不伪造 AI 分析 */
const DEMO_AGENT_STATE = createDemoAgentState({
  messageCount: CONVERSATION.messages.length,
  topicCount: countTopics(TOPICS),
  lastTime: CONVERSATION.messages[CONVERSATION.messages.length - 1]?.time ?? null,
})

/* 新建会话的目录 Agent 状态：「目录待生成」 */
const PENDING_AGENT_STATE = createPendingAgentState()

export default function NavigatorWorkbench() {
  /* sessions[0] 恒为演示会话（消息运行期拷贝，允许本地追加）；
   * 演示目录不缓存：每次点击示例都重新真实生成（面试演示），
   * 预置目录仅作为生成期间/失败时的本地回退 */
  const [sessions, setSessions] = useState(() => [
    { ...DEMO_SESSION, messages: CONVERSATION.messages.slice() },
    ...loadUserSessions(),
  ])
  const [activeId, setActiveId] = useState(null) // null = 聊天首页
  const [activeTopicId, setActiveTopicId] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const [pendingJump, setPendingJump] = useState(null) // { messageId, topicId } | null
  const [expandedSessions, setExpandedSessions] = useState(() => new Set())
  const [composerNotice, setComposerNotice] = useState(null)
  /* 目录生成流程覆盖态：null = 按会话派生；运行/成功/失败提示期间覆盖派生态 */
  const [topicAgentState, setTopicAgentState] = useState(null)
  const highlightTimerRef = useRef(null)
  const noticeTimerRef = useRef(null)
  const topicAbortRef = useRef(null)
  /* 待自动生成 AI 目录的会话 ID（点击示例时置位，effect 消费后清空） */
  const pendingAutoGenRef = useRef(null)
  /* 中间聊天流：进行中的 AI 回复请求（停止生成 / 切换会话时终止） */
  const [chatStreaming, setChatStreaming] = useState(false)
  const chatAbortRef = useRef(null)
  /* ---------- 增量目录维护 Agent（阶段 3） ---------- */
  /* 会话数据 / 激活会话的最新快照（后台任务读取，避免闭包过期） */
  const sessionsRef = useRef(sessions)
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    sessionsRef.current = sessions
    activeIdRef.current = activeId
  })
  /* 增量维护任务队列：按会话隔离的 FIFO（同一会话串行执行）。
   * manager 经 useState 惰性初始化仅创建一次；runTask / 忙碌判定
   * 回调在挂载 effect 中经 manager.bind 绑定（渲染期不创建读取
   * ref 的闭包），runTask 闭包经 runTaskRef 始终指向最新实现 */
  const runTaskRef = useRef(null)
  /* 各会话进行中任务的 AbortController（taskKey -> controller），
   * 支持多会话并发时的独立终止 */
  const incControllersRef = useRef(new Map())
  /* 全量目录生成所属会话（队列调度据此等待，避免并发写同一目录） */
  const topicGenConvRef = useRef(null)
  /* 队列快照（真实任务状态，供 UI 显示） */
  const [queueUi, setQueueUi] = useState({})

  const [manager] = useState(() =>
    createMaintenanceQueueManager({
      loadTasks: loadMaintenanceTasks,
      saveTasks: saveMaintenanceTasks,
      /* 队列快照由管理器计算后作为参数传入（渲染期无 ref 访问） */
      onChange: (snapshot) => setQueueUi(snapshot),
    }),
  )

  useEffect(
    () => () => {
      clearTimeout(highlightTimerRef.current)
      clearTimeout(noticeTimerRef.current)
      topicAbortRef.current?.abort()
      chatAbortRef.current?.abort()
      for (const c of incControllersRef.current.values()) c.abort()
      incControllersRef.current.clear()
    },
    [],
  )

  /* 用户会话持久化（演示会话不落盘） */
  useEffect(() => {
    saveUserSessions(sessions.filter((s) => !s.demo))
  }, [sessions])

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  )

  const showComposerNotice = useCallback((text) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setComposerNotice(text)
    noticeTimerRef.current = setTimeout(() => setComposerNotice(null), 2800)
  }, [])

  /* 基于 messageId 的精准定位：滚动 + 短暂高亮 */
  const jumpToMessage = useCallback((messageId, topicId = null) => {
    if (topicId) setActiveTopicId(topicId)
    const el = document.getElementById(`msg-${messageId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setHighlightId(messageId)
    clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), 2400)
  }, [])

  /* 跨会话跳转：切换会话渲染提交后再执行定位（避免拿到旧 DOM）。
   * 通过宏任务延迟一拍执行，期间 pendingJump 保持非空，
   * 抑制 MessageList 挂载时的自动滚动动画 */
  useEffect(() => {
    if (!pendingJump) return undefined
    const { messageId, topicId } = pendingJump
    const timer = setTimeout(() => {
      jumpToMessage(messageId, topicId ?? null)
      setPendingJump(null)
    }, 0)
    return () => clearTimeout(timer)
  }, [pendingJump, jumpToMessage])

  /* ---------- 会话操作 ---------- */

  /* 切换 / 关闭当前会话时终止进行中的目录生成并清除覆盖态
   *（旧请求的回调通过 topicAbortRef 守卫自动失效，不覆盖新状态） */
  const stopTopicGeneration = useCallback(() => {
    topicAbortRef.current?.abort()
    topicAbortRef.current = null
    topicGenConvRef.current = null
    setTopicAgentState(null)
  }, [])

  /* 切换 / 关闭当前会话时终止进行中的 AI 回复
   *（已生成部分保留在原会话，不跨会话覆盖） */
  const stopChatGeneration = useCallback(() => {
    chatAbortRef.current?.abort()
  }, [])

  const expandSession = useCallback((id) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const handleToggleSessionExpand = useCallback((id) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /* 打开会话时恢复其目录维护状态显示（后台任务照常运行，不重启、
   * 不重复入队）：运行中 → 增量状态条；失败暂停 → 失败重试卡片 */
  const restoreMaintenanceState = useCallback((sessionId) => {
    const snap = manager.getSnapshot()?.[sessionId]
    if (!snap) return
    if (snap.running) {
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      const round = session ? roundOfMessage(session.messages, snap.running.userMessageId) : null
      setTopicAgentState(createIncrementalRunningAgentState({ round }))
    } else if (snap.paused && snap.failedTask) {
      setTopicAgentState(
        createIncrementalFailedAgentState({
          footnote: `${snap.failedTask.error ?? '本轮目录更新失败'} · 已保留原目录，不影响聊天`,
          task: snap.failedTask,
        }),
      )
    }
  }, [manager])

  /* 点击会话标题：切换中间的聊天记录（pendingJump 为空 => 自动滚动动画） */
  const handleOpenSession = useCallback(
    (session) => {
      if (session.id === activeId) return
      /* 离开会话：其增量维护在后台继续（数据按会话 ID 写回，不串台）；
       * 全量生成则终止并清理状态 */
      if (manager.isRunning(activeId)) setTopicAgentState(null)
      else stopTopicGeneration()
      stopChatGeneration()
      setActiveTopicId(null)
      setActiveId(session.id)
      /* 进入会话：恢复其目录维护状态显示（不重启任务） */
      restoreMaintenanceState(session.id)
    },
    [activeId, manager, stopTopicGeneration, stopChatGeneration, restoreMaintenanceState],
  )

  /* 体验智能导航示例：打开演示会话并展开其一级话题目录（幂等，不创建副本）。
   * 无 AI 目录缓存时由下方 effect 自动触发一次真实生成；生成中重复
   * 点击不打断（也不重复发起付费请求） */
  const handleOpenDemo = useCallback(() => {
    if (activeId === DEMO_SESSION.id && topicAgentState?.status === AGENT_STATUS.RUNNING) return
    if (manager.isRunning(activeId)) setTopicAgentState(null)
    else stopTopicGeneration()
    stopChatGeneration()
    pendingAutoGenRef.current = DEMO_SESSION.id
    setActiveTopicId(null)
    setActiveId(DEMO_SESSION.id)
    restoreMaintenanceState(DEMO_SESSION.id)
    expandSession(DEMO_SESSION.id)
  }, [activeId, topicAgentState, manager, expandSession, stopTopicGeneration, stopChatGeneration, restoreMaintenanceState])

  /* 新建聊天：回到空白首页，等第一条消息创建会话 */
  const handleNewChat = useCallback(() => {
    if (manager.isRunning(activeId)) setTopicAgentState(null)
    else stopTopicGeneration()
    stopChatGeneration()
    setActiveId(null)
    setActiveTopicId(null)
  }, [activeId, manager, stopTopicGeneration, stopChatGeneration])

  const handleRenameSession = useCallback((id, title) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
  }, [])

  /* 中止某会话正在执行的增量任务（删除会话 / 用户主动全量重生成时） */
  const abortMaintenanceOf = useCallback((convId) => {
    const snap = manager.getSnapshot()?.[convId]
    if (snap?.running) {
      incControllersRef.current.get(`${convId}:${snap.running.userMessageId}`)?.abort()
    }
  }, [manager])

  const handleDeleteSession = useCallback(
    (id) => {
      setSessions((prev) => prev.filter((s) => s.id !== id))
      /* 终止该会话进行中的任务并清空其队列（数据已随会话删除） */
      abortMaintenanceOf(id)
      manager.dropConversation(id)
      if (activeId === id) {
        if (manager.isRunning(id)) setTopicAgentState(null)
        else stopTopicGeneration()
        stopChatGeneration()
        setActiveId(null)
        setActiveTopicId(null)
      }
    },
    [activeId, manager, stopTopicGeneration, stopChatGeneration, abortMaintenanceOf],
  )

  /* ---------- 导航与发送 ---------- */

  /* 点击话题：打开所属会话并精准定位（同会话直接跳，跨会话走 pendingJump）。
   * 定位目标 = 关联消息中会话时间序最早的一条（模型返回的 messageIds
   * 顺序不可信，不能直接取 [0]）；同一条长 AI 回复可被多个子话题合法
   * 关联 —— messageId 定位粒度为消息级，此时不同节点会定位到同一条消息 */
  const handleTopicJump = useCallback(
    (session, topic) => {
      setActiveTopicId(topic.id)
      const target = topicJumpTarget(topic, session)
      if (import.meta.env.DEV) {
        const parent = findTopicParent(session.topics, topic.id)
        console.debug(
          `[目录映射 · 点击] ${topic.title} → ${topic.id} → parent=${parent ?? '-'} → messageIds=[${(topic.messageIds ?? []).join(',')}] → 跳转=${target ?? '无'}`,
        )
      }
      if (!target) return
      if (session.id === activeId) {
        jumpToMessage(target, null)
      } else {
        setPendingJump({ messageId: target, topicId: topic.id })
        setActiveId(session.id)
        expandSession(session.id)
      }
    },
    [activeId, expandSession, jumpToMessage],
  )

  /* 点击话题内的「关联问答」片段：打开所属会话并跳转到该片段的
   * 首条消息（通常为该轮用户消息）。与话题标题跳转（第一次讨论）
   * 相互独立，不打断父子话题展开状态 */
  const handleSegmentJump = useCallback(
    (session, topic, segment) => {
      setActiveTopicId(topic.id)
      if (import.meta.env.DEV) {
        console.debug(
          `[目录映射 · 片段] ${topic.title} → 第 ${segment.round} 轮 → messageIds=[${segment.messageIds.join(',')}] → 跳转=${segment.firstMessageId}`,
        )
      }
      if (session.id === activeId) {
        jumpToMessage(segment.firstMessageId, null)
      } else {
        setPendingJump({ messageId: segment.firstMessageId, topicId: topic.id })
        setActiveId(session.id)
        expandSession(session.id)
      }
    },
    [activeId, expandSession, jumpToMessage],
  )

  /* ---------- 中间真实 AI 聊天（阶段 2） ---------- */

  /* ---------- 增量目录维护 Agent（阶段 3）：每轮问答完成后自动触发 ---------- */

  /* 执行单个增量维护任务：实时读取最新会话快照（不使用入队时的旧
   * 目录）→ 携带「本轮问答 + 现有目录 + 最近上下文」请求服务端
   * Agent Loop → 校验通过的新目录一次性写回（保留原 topicId / 层级 /
   * 关联）。返回 true / Error 供队列管理器判定成功或失败（含原因）；
   * 失败保留原目录，不影响聊天 */
  const runMaintenanceTask = useCallback(
    async (task) => {
      const session = sessionsRef.current.find((s) => s.id === task.conversationId)
      if (!session) return true /* 会话已被删除：任务自动作废（非失败） */
      const userMsg = session.messages.find((m) => m.id === task.userMessageId)
      const asstMsg = session.messages.find((m) => m.id === task.assistantMessageId)
      if (!userMsg || !asstMsg) return true

      /* 目录版本：任务开始时捕获，写回前校验（执行期间目录被全量
       * 重生成等其他操作更新过，则本轮结果基于旧目录，拒绝写回） */
      const startVersion = session.topicsVersion ?? 0
      const round = roundOfMessage(session.messages, task.userMessageId)

      const controller = new AbortController()
      const taskKey = `${task.conversationId}:${task.userMessageId}`
      incControllersRef.current.set(taskKey, controller)
      const isViewing = () => activeIdRef.current === task.conversationId
      /* 切换会话后不再更新状态显示（数据仍写回原会话，不串台） */
      if (isViewing()) setTopicAgentState(createIncrementalRunningAgentState({ round }))

      const history = session.messages.filter(
        (m) => m.id !== task.userMessageId && m.id !== task.assistantMessageId,
      )
      const contextMessages = history.slice(-12).map((m) => ({
        id: m.id,
        role: m.role,
        text: (m.blocks ?? []).map(blockToText).join('\n').slice(0, 400),
      }))
      const textOf = (m) => (m.blocks ?? []).map(blockToText).join('\n').slice(0, 8000)

      try {
        const result = await maintainTopics(
          {
            conversationId: task.conversationId,
            userMessage: { id: userMsg.id, text: textOf(userMsg) },
            assistantMessage: { id: asstMsg.id, text: textOf(asstMsg) },
            directory: flattenTopicTree(session.topics),
            contextMessages,
            validMessageIds: session.messages.map((m) => m.id),
          },
          {
            signal: controller.signal,
            onStage: (ev) => {
              if (incControllersRef.current.get(taskKey) !== controller || !isViewing()) return
              setTopicAgentState((prev) => {
                if (prev?.status !== AGENT_STATUS.RUNNING) return prev
                let logs = prev.logs ?? []
                let activeStepId = prev.activeStepId
                if (ev.stage === 'analyzing') {
                  activeStepId = 'inc-2'
                  logs = pushLog(logs, '正在分析新增内容。')
                } else if (ev.stage === 'tool' && ev.name === 'get_directory') {
                  activeStepId = 'inc-3'
                  logs = pushLog(logs, '读取当前话题目录。')
                } else if (ev.stage === 'tool' && ev.name === 'read_context') {
                  activeStepId = 'inc-3'
                  logs = pushLog(logs, ev.detail ?? '读取相关历史消息。')
                } else if (ev.stage === 'tool' && ev.name === 'apply_directory_changes') {
                  activeStepId = 'inc-4'
                  logs = pushLog(logs, ev.detail ?? '正在更新话题目录。')
                }
                return { ...prev, activeStepId, logs }
              })
            },
          },
        )

        const stats = result.stats ?? {}
        /* 快照完整性守卫：增量操作只增不改结构，返回目录必须包含全部
         * 已有 topicId；缺失任何旧话题都视为不完整快照，拒绝写回（保留
         * 原目录），防止异常结果覆盖整棵目录树 */
        const oldTopicIds = new Set(flattenTopicTree(session.topics).map((t) => t.topicId))
        const newTopicIds = new Set(flattenTopicTree(result.topics).map((t) => t.topicId))
        for (const id of oldTopicIds) {
          if (!newTopicIds.has(id)) {
            const err = new Error('返回目录缺失已有话题（不完整快照），已拒绝写回')
            err.code = 'SNAPSHOT_INCOMPLETE'
            err.phase = 'merge'
            throw err
          }
        }
        /* 版本检查：执行期间同一会话的目录已被其他操作（全量重生成等）
         * 提交过新版本时，本轮结果基于旧目录，拒绝写回避免旧响应覆盖 */
        const current = sessionsRef.current.find((s) => s.id === task.conversationId)
        if (!current) return true
        if ((current.topicsVersion ?? 0) !== startVersion) {
          const err = new Error('目录已被其他操作更新（版本冲突），本轮结果已丢弃')
          err.code = 'VERSION_CONFLICT'
          err.phase = 'merge'
          throw err
        }
        const basedOn = session.topicsSource === 'ai' ? 'ai' : session.demo ? 'preset' : 'none'
        const meta = {
          model: stats.model ?? null,
          generatedAt: Date.now(),
          analyzedCount: session.messages.length,
          mode: 'incremental',
          basedOn,
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === task.conversationId
              ? {
                  ...s,
                  topics: result.topics,
                  topicsSource: 'ai',
                  topicsMeta: meta,
                  topicsVersion: startVersion + 1,
                }
              : s,
          ),
        )
        logTopicMap(result.topics, session, '增量维护')
        if (isViewing()) {
          const footnote = stats.noChange
            ? `本轮无需修改目录${stats.note ? ` · ${stats.note}` : ''}`
            : `目录已增量更新${stats.summary?.length ? ` · ${stats.summary.join('；')}` : stats.changeCount ? ` · ${stats.changeCount} 项修改` : ''}${stats.note ? ` · ${stats.note}` : ''}${stats.warnings?.length ? ` · ${stats.warnings.length} 项校验警告` : ''}`
          setTopicAgentState(
            createIncrementalDoneAgentState({
              topicCount: countTopics(result.topics),
              footnote,
              lastUpdatedAt: meta.generatedAt,
            }),
          )
        }
        return true
      } catch (e) {
        /* 技术日志：错误码 + 失败阶段（服务端细分：model_call / tool_args /
         * validate / decision / timeout / abort），便于排查卡在哪一步 */
        console.warn(
          `[增量维护失败] conversation=${task.conversationId} · 本轮 ${task.userMessageId}/${task.assistantMessageId} · code=${e?.code ?? 'UNKNOWN'} · phase=${e?.phase ?? 'client'} · ${e?.message ?? ''}`,
        )
        if (incControllersRef.current.get(taskKey) === controller && isViewing()) {
          setTopicAgentState(
            createIncrementalFailedAgentState({
              footnote: `${e?.message ?? '增量维护失败'} · 已保留原目录，不影响聊天`,
              /* 携带本轮定位：重试只针对未成功处理的两条消息，不触发全量 */
              task: {
                conversationId: task.conversationId,
                userMessageId: task.userMessageId,
                assistantMessageId: task.assistantMessageId,
              },
            }),
          )
        }
        return e ?? new Error('增量维护失败')
      } finally {
        if (incControllersRef.current.get(taskKey) === controller) {
          incControllersRef.current.delete(taskKey)
        }
      }
    },
    [],
  )

  /* 队列管理器接入：runTask / 忙碌判定回调在此绑定（effect 内读取
   * ref，渲染期零 ref 访问）；runTask 闭包始终指向最新实现；挂载（含
   * 刷新恢复）后启动队列——持久化的 pending / failed 任务继续处理，
   * 已完成任务不在持久化中，不会重复执行、不产生重复付费调用 */
  useEffect(() => {
    manager.bind({
      runTask: (task) => runTaskRef.current?.(task) ?? false,
      isConversationBusy: (convId) =>
        topicAbortRef.current !== null && topicGenConvRef.current === convId,
    })
    runTaskRef.current = runMaintenanceTask
    manager.start()
  }, [manager, runMaintenanceTask])

  /* 本轮完整问答完成后自动排队一次增量维护（触发点唯一，按
   * userMessageId / assistantMessageId 定位，天然不重复执行） */
  const onTurnCompleted = useCallback((conversationId, userMessageId, assistantMessageId) => {
    manager.enqueue({ conversationId, userMessageId, assistantMessageId })
  }, [manager])

  /* 增量维护失败后的「重试本轮维护」：恢复队首失败任务并解除该会话
   * 队列暂停，继续处理后续等待任务；不触发全量目录重生成 */
  const handleRetryIncremental = useCallback((task) => {
    manager.retry(task.conversationId)
  }, [manager])

  /* 发起 AI 回复：追加占位 assistant 消息（稳定唯一 id）→ SSE 分片
   * 逐字更新 → 完成定型并触发「本轮问答完成」事件。出错 / 停止时：
   * 无内容则移除占位（不伪造回复），有内容则保留已生成部分 */
  const startAssistantReply = useCallback(
    (sessionId, contextMessages, userMsg) => {
      const assistantMsg = createAssistantMessage()
      setChatStreaming(true)
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, messages: [...s.messages, assistantMsg] } : s)),
      )

      const controller = new AbortController()
      chatAbortRef.current = controller
      let received = ''
      let reasoningText = ''
      let contentStarted = false
      /* 渲染节流：分片到达节奏不均（一帧多字 / 一帧几字），按 ~80ms
       * 定时刷新累积文本，使思考流与正文的输出节奏均匀平滑 */
      let pendingBlock = null
      let flushTimer = null
      const flushNow = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        if (!pendingBlock) return
        const block = pendingBlock
        pendingBlock = null
        patchAssistant((m) => ({ ...m, blocks: [block] }))
      }
      const scheduleRender = (block) => {
        pendingBlock = block
        if (flushTimer) return
        flushTimer = setTimeout(flushNow, 80)
      }

      const patchAssistant = (updater) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id !== sessionId
              ? s
              : { ...s, messages: s.messages.map((m) => (m.id === assistantMsg.id ? updater(m) : m)) },
          ),
        )
      }
      const removeAssistant = () => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, messages: s.messages.filter((m) => m.id !== assistantMsg.id) } : s,
          ),
        )
      }

      streamChatReply({ messages: contextMessages }, {
        signal: controller.signal,
        onReasoning: (piece) => {
          /* 思考流：浅色实时展示（正文开始后不再更新） */
          if (contentStarted) return
          reasoningText += piece
          scheduleRender({ type: 'reasoning', text: reasoningText })
        },
        onDelta: (piece) => {
          /* 正文首分片：替换思考流，此后逐字更新正文 */
          contentStarted = true
          received += piece
          scheduleRender({ type: 'text', text: received })
        },
      })
        .then(() => {
          if (chatAbortRef.current !== controller) return
          flushNow()
          if (!received.trim()) {
            removeAssistant()
            showComposerNotice('AI 未返回内容，请重试')
          } else {
            onTurnCompleted(sessionId, userMsg.id, assistantMsg.id)
          }
        })
        .catch((e) => {
          if (chatAbortRef.current !== controller) return
          flushNow()
          if (received.trim()) {
            showComposerNotice(
              e?.code === 'CANCELLED'
                ? '已停止生成 · 已保留部分回复'
                : `${e?.message ?? '回复失败'} · 已保留部分回复`,
            )
          } else {
            removeAssistant()
            showComposerNotice(e?.code === 'CANCELLED' ? '已停止生成' : `AI 回复失败：${e?.message ?? '未知错误'}`)
          }
        })
        .finally(() => {
          if (chatAbortRef.current === controller) {
            chatAbortRef.current = null
            setChatStreaming(false)
          }
        })
    },
    [onTurnCompleted, showComposerNotice],
  )

  /* 用户点击停止：终止上游请求（已生成部分经 catch 分支保留） */
  const handleStopChat = useCallback(() => {
    chatAbortRef.current?.abort()
  }, [])

  /* 发送消息：立即显示用户消息并发起流式 AI 回复。首页首条消息
   * 创建新会话；已有会话（含演示会话，仅改工作副本）追加消息并
   * 滚动定位；多轮上下文随请求携带（超限截取最近消息） */
  const handleSend = useCallback(
    (text) => {
      const trimmed = text.trim()
      if (!trimmed || chatStreaming) return
      /* 新消息未纳入现有目录：清除覆盖态，让派生状态如实显示「待分析」
       *（分析进行中除外，完成后按消息快照数如实显示） */
      if (topicAgentState?.status !== AGENT_STATUS.RUNNING) setTopicAgentState(null)
      const userMsg = createUserMessage(trimmed)
      if (!activeSession) {
        const session = createUserSession(userMsg)
        setSessions((prev) => [...prev, session])
        setActiveId(session.id)
        startAssistantReply(session.id, [{ role: 'user', content: trimmed }], userMsg)
        return
      }
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, messages: [...s.messages, userMsg] } : s)),
      )
      setPendingJump({ messageId: userMsg.id, topicId: null })
      startAssistantReply(activeSession.id, buildChatContext(activeSession.messages, userMsg), userMsg)
    },
    [activeSession, chatStreaming, startAssistantReply, topicAgentState],
  )

  /* ---------- 阶段 1：真实 AI 话题目录生成（全量分析） ---------- */

  /* 重新生成目录：当前会话全量消息 → 后端模型分析 → 服务端校验
   * 通过后写入目录树。运行中再次点击 = 停止分析（终止上游付费
   * 请求，保留旧目录）。失败 / 取消不改动会话数据 */
  const handleRegenerateTopics = useCallback(() => {
    if (!activeSession) return
    if (topicAgentState?.status === AGENT_STATUS.RUNNING) {
      topicAbortRef.current?.abort()
      abortMaintenanceOf(activeSession.id)
      return
    }
    /* 用户主动全量重生成：终止该会话后台增量任务并清空其待处理
     * 队列（全量分析已包含这些轮次，避免重复付费） */
    abortMaintenanceOf(activeSession.id)
    manager.dropConversation(activeSession.id)
    const messageCount = activeSession.messages.length
    if (messageCount === 0) {
      showComposerNotice('当前会话暂无消息，无法生成话题目录。')
      return
    }
    /* 消息快照：分析期间新追加的消息不进入本次请求，完成后如实显示「待分析」 */
    const messagesSnapshot = activeSession.messages
    const sessionId = activeSession.id
    const controller = new AbortController()
    topicAbortRef.current = controller
    /* 全量生成所属会话：该会话的增量任务等待其完成（队列调度查询） */
    topicGenConvRef.current = sessionId
    setTopicAgentState(createRunningAgentState({ messageCount }))
    expandSession(sessionId)

    generateTopics(
      { messages: messagesSnapshot },
      {
        signal: controller.signal,
        onStage: (ev) => {
          if (topicAbortRef.current !== controller) return
          setTopicAgentState((prev) => {
            if (prev?.status !== AGENT_STATUS.RUNNING) return prev
            let logs = prev.logs ?? []
            let activeStepId = prev.activeStepId
            if (ev.stage === 'loaded') {
              activeStepId = 'fa-2'
              logs = pushLog(logs, `已读取 ${ev.messageCount ?? 0} 条消息。`)
            } else if (ev.stage === 'analyzing') {
              activeStepId = 'fa-2'
              logs = pushLog(logs, `正在请求 ${ev.model ? ev.model.split('/').pop() : '模型'} 分析。`)
            } else if (ev.stage === 'reasoning_start') {
              activeStepId = 'fa-2'
              logs = pushLog(logs, '模型正在分析对话……')
            } else if (ev.stage === 'reasoning_progress') {
              activeStepId = 'fa-2'
              logs = pushLog(logs, `推理数据持续接收中，累计 ${ev.chars ?? 0} 字符。`, 'reasoning')
            } else if (ev.stage === 'stream_start') {
              activeStepId = 'fa-2'
              logs = pushLog(logs, '正在生成目录内容。')
            } else if (ev.stage === 'stream_progress') {
              activeStepId = 'fa-2'
              logs = pushLog(logs, `正在生成目录内容，累计 ${ev.chars ?? 0} 字符。`, 'progress')
            } else if (ev.stage === 'validating') {
              activeStepId = 'fa-3'
              logs = pushLog(logs, '正在验证目录结构……')
            }
            return { ...prev, activeStepId, model: ev.model ?? prev.model, logs }
          })
        },
      },
    )
      .then((result) => {
        if (topicAbortRef.current !== controller) return
        topicAbortRef.current = null
        topicGenConvRef.current = null
        const { topics, stats } = result
        const analyzedCount = stats.messageCount ?? messageCount
        const topicsMeta = {
          model: stats.model ?? null,
          generatedAt: Date.now(),
          analyzedCount,
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  topics,
                  /* AI 生成标记：派生状态据此显示真实生成信息（不落盘缓存）。
                   * 版本 +1：使执行中未完成的增量任务版本校验失败，
                   * 丢弃其基于旧目录的结果（不覆盖全量新目录） */
                  topicsSource: 'ai',
                  topicsMeta,
                  topicsVersion: (s.topicsVersion ?? 0) + 1,
                }
              : s,
          ),
        )
        const elapsedSec = ((stats.elapsedMs ?? 0) / 1000).toFixed(1)
        logTopicMap(topics, activeSession, '全量分析')
        setTopicAgentState(
          createGeneratedAgentState({
            messageCount: analyzedCount,
            topicCount: countTopics(topics),
            footnote: `目录由 ${stats.model ?? '模型'} 真实生成 · ${stats.topicCount ?? 0} 个一级话题 / ${stats.subTopicCount ?? 0} 个二级话题 · 消息覆盖 ${stats.linkedMessageCount ?? 0}/${analyzedCount} · 耗时 ${elapsedSec}s`,
          }),
        )
        setActiveTopicId(null)
        expandSession(sessionId)
      })
      .catch((e) => {
        if (topicAbortRef.current !== controller) return
        topicAbortRef.current = null
        topicGenConvRef.current = null
        setTopicAgentState(
          createFailedAgentState({
            messageCount,
            footnote: `${e?.message ?? '目录生成失败'}，可重试`,
          }),
        )
      })
  }, [activeSession, topicAgentState, manager, expandSession, showComposerNotice, abortMaintenanceOf])

  /* 点击示例后的自动生成：仅对演示会话、且无 AI 目录时触发一次。
   * 缓存命中（topicsSource='ai'）直接读缓存不付费；生成期间
   * handleOpenDemo 幂等守卫 + topicAbortRef 单控制器保证不并发 */
  useEffect(() => {
    const target = pendingAutoGenRef.current
    if (!target || target !== activeId || !activeSession) return undefined
    if (activeSession.topicsSource === 'ai') {
      pendingAutoGenRef.current = null
      return undefined
    }
    /* 当前会话增量维护进行中：暂不触发全量生成（pendingAutoGen 保留，
     * 增量写回触发渲染后本 effect 重跑再判断），避免并发写目录 */
    if (manager.isRunning(activeId)) return undefined
    const timer = setTimeout(() => {
      pendingAutoGenRef.current = null
      handleRegenerateTopics()
    }, 0)
    return () => clearTimeout(timer)
  }, [activeId, activeSession, manager, handleRegenerateTopics])

  /* ---------- 派生数据（单一数据源） ---------- */

  const mediaIndex = useMemo(
    () => (activeSession ? deriveMediaIndex(activeSession.messages) : []),
    [activeSession],
  )
  const codeIndex = useMemo(
    () => (activeSession ? deriveCodeIndex(activeSession.messages) : []),
    [activeSession],
  )

  /* 目录 Agent 状态针对当前会话派生（不落地存储、不伪造分析）：
   * 生成流程覆盖态（运行 / 成功 / 失败提示期间）优先；
   * AI 生成会话按 topicsMeta 派生（有未覆盖新消息时转「待分析」）；
   * 演示会话 = 示例目录（追加过消息则转待分析）；其余 = 目录待生成 */
  const agentState = useMemo(() => {
    if (topicAgentState) return topicAgentState
    if (!activeSession) return null
    if (activeSession.topicsSource === 'ai') {
      const meta = activeSession.topicsMeta ?? {}
      const analyzed = meta.analyzedCount ?? activeSession.messages.length
      /* 增量维护与全量分析区分标注；增量基于预置目录时说明来源 */
      const modeLabel =
        meta.mode === 'incremental'
          ? meta.basedOn === 'preset'
            ? '增量维护 · 基于预置目录'
            : '增量维护'
          : '全量分析'
      const state = createGeneratedAgentState({
        messageCount: analyzed,
        topicCount: countTopics(activeSession.topics),
        footnote: meta.model
          ? `目录由 ${meta.model} 生成（真实模型输出 · ${modeLabel}）。`
          : `目录由真实模型生成（${modeLabel}）。`,
        lastUpdatedAt: meta.generatedAt ?? null,
      })
      return activeSession.messages.length > analyzed
        ? { ...state, status: AGENT_STATUS.IDLE }
        : state
    }
    if (activeSession.demo) {
      return activeSession.messages.length > CONVERSATION.messages.length
        ? { ...DEMO_AGENT_STATE, status: AGENT_STATUS.IDLE }
        : DEMO_AGENT_STATE
    }
    return PENDING_AGENT_STATE
  }, [activeSession, topicAgentState])

  const stats = useMemo(
    () => ({
      messageCount: activeSession ? activeSession.messages.length : 0,
      topicCount: activeSession ? countTopics(activeSession.topics) : 0,
      mediaCount: mediaIndex.length,
      codeCount: codeIndex.length,
    }),
    [activeSession, mediaIndex, codeIndex],
  )

  /* 当前会话的队列状态（真实任务快照 + 轮次号派生）：供左栏
   * 「AI 目录 Agent 区域」显示正在分析第几轮 / 等待数量 / 完成失败计数 */
  const activeQueue = useMemo(() => {
    const snap = activeId ? queueUi[activeId] : null
    if (!snap) return null
    const roundOf = (userMessageId) =>
      activeSession ? roundOfMessage(activeSession.messages, userMessageId) : null
    return {
      ...snap,
      runningRound: snap.running ? roundOf(snap.running.userMessageId) : null,
      failedRound: snap.failedTask ? roundOf(snap.failedTask.userMessageId) : null,
    }
  }, [queueUi, activeId, activeSession])

  return (
    <div className="flex h-full min-h-0">
      <NavSidebar
        sessions={sessions}
        activeId={activeId}
        activeTopicId={activeTopicId}
        agentState={agentState}
        totalMessages={activeSession ? activeSession.messages.length : 0}
        activeMediaIndex={mediaIndex}
        activeCodeIndex={codeIndex}
        expandedSessions={expandedSessions}
        onToggleSessionExpand={handleToggleSessionExpand}
        onOpenSession={handleOpenSession}
        onNewChat={handleNewChat}
        onOpenDemo={handleOpenDemo}
        onTopicJump={handleTopicJump}
        onSegmentJump={handleSegmentJump}
        onJump={jumpToMessage}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        generating={topicAgentState?.status === AGENT_STATUS.RUNNING}
        onRegenerateTopics={handleRegenerateTopics}
        onRetryIncremental={handleRetryIncremental}
        queue={activeQueue}
        topicGenState={topicAgentState}
      />

      {/* 中栏：首页 or 会话消息流 */}
      {activeSession ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MessageList
            key={activeSession.id}
            conversation={activeSession}
            stats={stats}
            highlightId={highlightId}
            autoScroll={!pendingJump}
            demo={!!activeSession.demo}
          />
          <ChatComposer
            notice={composerNotice}
            onSend={handleSend}
            streaming={chatStreaming}
            onStop={handleStopChat}
          />
        </div>
      ) : (
        <ChatHome onSend={handleSend} onOpenDemo={handleOpenDemo} />
      )}

      {/* 右栏：按会话切换重置检索状态（keyed 重挂载，旧结果不跨会话） */}
      <RetracePanel
        key={activeId ?? 'home'}
        active={!!activeSession}
        conversation={activeSession}
        queries={activeSession?.demo ? DEMO_QUERIES : []}
        onJump={jumpToMessage}
      />
    </div>
  )
}
