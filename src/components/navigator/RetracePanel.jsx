/* ============================================================
 * Conversation Navigator Agent · 右栏：AI 智能回溯（真实 Search Agent）
 * ------------------------------------------------------------
 * 「AI 帮我找」：用户输入模糊自然语言描述 → Search Agent
 * 通过 Function Calling 自主检索当前会话快照（话题目录 +
 * 原始消息），返回可点击、可验证的原始消息位置。
 * - 执行步骤与状态全部来自服务端真实 Agent 事件（SSE），
 *   不伪造固定流程
 * - 简洁步骤为通俗中文；技术日志保留工具名 / 参数摘要 /
 *   轮次 / 耗时 / Token / requestId
 * - 检索期间可取消；单次任务仅允许一个活动检索请求
 * - 结果 messageId 由服务端校验真实存在；点击复用 jumpToMessage
 *   精准定位并高亮，不改变聊天内容与目录结构
 * - 组件按 activeId keyed 重挂载：切换会话自动重置，旧结果
 *   不会覆盖新会话
 * ============================================================ */

import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import { buildSearchPayload, streamSearch } from '../../services/navigatorSearch'

/* 工具事件 → 通俗中文状态（真实事件驱动，非固定流程） */
const TOOL_STAGE_TEXT = {
  search_topics: '正在搜索相关话题',
  search_messages: '正在查找历史消息',
  read_context: '正在读取候选消息前后文',
}

const RELEVANCE_META = {
  high: { label: '高度相关', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  medium: { label: '可能相关', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  low: { label: '弱相关', cls: 'border-zinc-600 bg-zinc-800 text-zinc-400' },
}

/* 话题标题查找（当前会话目录树内，找不到回退通用文案） */
function topicTitleOf(topics, id) {
  if (!id) return '相关话题'
  const walk = (arr) => {
    for (const t of arr ?? []) {
      if (t.id === id) return t.title
      const hit = walk(t.children)
      if (hit) return hit
    }
    return null
  }
  return walk(topics) ?? '相关话题'
}

/* ---------- 检索结果卡片 ---------- */

function ResultCard({ result, topicTitle, onJump }) {
  const rel = RELEVANCE_META[result.relevance] ?? RELEVANCE_META.medium
  return (
    <div
      onClick={() => onJump(result.messageId, result.topicId)}
      className="cursor-pointer rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 transition-colors hover:border-indigo-500/50 hover:bg-zinc-900"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onJump(result.messageId, result.topicId)
      }}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-300">
          {topicTitle}
        </span>
        <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${rel.cls}`}>
          {rel.label}
        </span>
      </div>
      <p className="mt-2 text-[12px] font-medium leading-5 text-zinc-200">{result.title}</p>
      <p className="mt-1 text-[12px] leading-5 text-zinc-400">{result.reason}</p>
      {result.excerpt ? (
        <blockquote className="mt-2 border-l-2 border-zinc-700 pl-2 text-[11px] leading-5 text-zinc-500">
          {result.excerpt}
        </blockquote>
      ) : null}
      <div className="mt-2.5 flex items-center justify-between">
        <span className="font-mono text-[10px] text-zinc-600">#{result.messageId}</span>
        <span className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-indigo-500/50">
          <Icon name="locate" size={11} />
          定位消息
        </span>
      </div>
    </div>
  )
}

/* ---------- Agent 检索过程（真实事件时间线 + 技术日志） ---------- */

function ProcessArea({ timeline, techLogs, running }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
      <div className="flex items-center gap-2">
        <Icon name="zap" size={13} className={running ? 'text-indigo-400' : 'text-zinc-500'} />
        <span className="text-xs font-medium text-zinc-300">Agent 检索过程</span>
        {running ? (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-indigo-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
            执行中
          </span>
        ) : null}
      </div>
      <ol className="mt-2 space-y-1">
        {timeline.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] leading-5">
            <span className={`shrink-0 ${s.done ? 'text-emerald-400' : 'text-indigo-400'}`}>
              {s.done ? '✓' : '›'}
            </span>
            <span className={s.done ? 'text-zinc-500' : 'text-zinc-200'}>{s.text}</span>
          </li>
        ))}
      </ol>
      {techLogs.length > 0 ? (
        <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
          {techLogs.map((l, i) => (
            <p key={i} className="font-mono text-[10px] leading-4 text-zinc-500">
              {l}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ---------- 功能介绍模式（未打开会话）：简洁提示 ---------- */

function IntroArea() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-5 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
        <Icon name="search" size={16} />
      </div>
      <p className="mt-3 text-xs font-medium text-zinc-300">AI 帮我找 · 历史消息回溯</p>
      <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
        用模糊的记忆描述，定位到原始消息并高亮。
        <br />
        打开聊天后即可使用 AI 回溯。
      </p>
    </div>
  )
}

/* ---------- 主组件 ---------- */

export default function RetracePanel({ active = false, conversation = null, queries = [], onJump }) {
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [timeline, setTimeline] = useState([]) // [{ text, done }] · 真实事件时间线
  const [techLogs, setTechLogs] = useState([]) // 技术日志（requestId / 工具 / 参数 / 轮次 / 耗时 / Token）
  const [results, setResults] = useState(null) // Array | null
  const [noFound, setNoFound] = useState(null) // 未找到说明 | null
  const [error, setError] = useState(null) // { code, message } | null
  const abortRef = useRef(null)

  /* 卸载（含切换会话触发重挂载）时终止进行中的检索请求 */
  useEffect(() => () => abortRef.current?.abort(), [])

  const pushTimeline = (text) =>
    setTimeline((prev) => [...prev.map((x) => ({ ...x, done: true })), { text, done: false }])
  const pushTech = (line) => setTechLogs((prev) => [...prev, line])

  const runSearch = (text) => {
    const query = text.trim()
    if (!query || running || !conversation) return
    setInput(query)
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setTimeline([])
    setTechLogs([])
    setResults(null)
    setNoFound(null)
    setError(null)

    /* 点击时构建当前会话数据快照（消息 + 目录），查询期间保持一致 */
    streamSearch({ ...buildSearchPayload(conversation), query }, {
      signal: controller.signal,
      onStage: (ev) => {
        if (abortRef.current !== controller) return
        if (ev.stage === 'understanding') {
          pushTimeline('正在理解查找意图')
          pushTech(
            `${ev.requestId ?? '-'} · 启动 · model=${ev.model ?? '?'} · 消息 ${ev.messageCount ?? '?'} 条 · 话题 ${ev.topicCount ?? 0} 个`,
          )
        } else if (ev.stage === 'tool') {
          let text = TOOL_STAGE_TEXT[ev.name] ?? ev.detail ?? '正在检索'
          if (ev.name === 'search_messages' && ev.detail) text = `${text}（${ev.detail}）`
          if (ev.name === 'submit_results') text = ev.detail ?? '正在整理定位结果'
          pushTimeline(text)
          const params = ev.params ? ` · ${JSON.stringify(ev.params)}` : ''
          pushTech(
            `${ev.requestId ?? '-'} · 第 ${ev.turn ?? '?'} 轮 ${ev.name} · ${ev.detail ?? ''}${params}${ev.elapsedMs != null ? ` · ${ev.elapsedMs}ms` : ''}`,
          )
        }
      },
    })
      .then((res) => {
        if (abortRef.current !== controller) return
        abortRef.current = null
        setRunning(false)
        const usage = res.stats?.usage?.total_tokens
        pushTech(
          `${res.stats?.requestId ?? '-'} · 完成 · found=${res.found} · tokens ${usage ?? '?'} · 耗时 ${((res.stats?.elapsedMs ?? 0) / 1000).toFixed(1)}s`,
        )
        if (res.found) {
          setResults(res.results ?? [])
          pushTimeline(`已找到相关讨论 · ${res.results?.length ?? 0} 条结果`)
        } else {
          setNoFound(res.note || '当前会话中没有找到与描述匹配的讨论')
          pushTimeline('未找到可靠匹配')
        }
      })
      .catch((e) => {
        if (abortRef.current !== controller) return
        abortRef.current = null
        setRunning(false)
        if (e?.code === 'CANCELLED') {
          setError({ code: 'CANCELLED', message: '已停止检索' })
          pushTimeline('已停止检索')
        } else {
          setError({ code: e?.code ?? 'UNKNOWN', message: e?.message ?? '检索失败' })
          pushTimeline(`检索失败：${e?.message ?? '未知错误'}`)
        }
      })
  }

  const handleStop = () => abortRef.current?.abort()

  const idlePlaceholder =
    results === null && !noFound && !error && !running && timeline.length === 0

  return (
    <aside className="flex h-full w-[26%] min-w-[270px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      {/* 头部 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800 px-4">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-500 text-white">
          <Icon name="search" size={12} />
        </div>
        <span className="text-sm font-medium text-zinc-100">AI 帮我找</span>
        <span className="ml-auto text-[10px] text-zinc-600">模糊语义回溯</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5">
        {/* 功能介绍模式：未打开会话 */}
        {!active ? <IntroArea /> : null}

        {active ? (
          <>
            {/* 输入框 */}
            <div>
              <textarea
                rows={3}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    runSearch(input)
                  }
                }}
                placeholder="描述你记得的内容，不需要准确关键词……"
                className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-[13px] leading-6 text-zinc-200 placeholder:text-zinc-600 transition-colors focus:border-indigo-500/50 focus:outline-none"
              />
              {running ? (
                <button
                  onClick={handleStop}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-red-500/50 hover:text-red-300"
                >
                  <Icon name="stop" size={12} />
                  停止检索
                </button>
              ) : (
                <button
                  onClick={() => runSearch(input)}
                  disabled={!input.trim()}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name="search" size={13} />
                  开始查找
                </button>
              )}
            </div>

            {/* 快捷体验问题（仅演示会话预置；点击发起真实检索） */}
            {queries.length > 0 ? (
              <div>
                <p className="mb-2 px-0.5 text-[11px] font-medium text-zinc-500">快捷体验 · 点击填入并检索</p>
                <div className="space-y-1.5">
                  {queries.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => runSearch(q.question)}
                      disabled={running}
                      className="flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left text-[12px] leading-5 text-zinc-300 transition-colors hover:border-sky-500/50 hover:bg-zinc-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span>{q.question}</span>
                      <Icon name="arrowRight" size={12} className="shrink-0 text-zinc-600" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Agent 检索过程：真实事件时间线 + 技术日志 */}
            {timeline.length > 0 ? <ProcessArea timeline={timeline} techLogs={techLogs} running={running} /> : null}

            {/* 检索结果 */}
            <div>
              <p className="mb-2 px-0.5 text-[11px] font-medium text-zinc-500">检索结果</p>

              {idlePlaceholder ? (
                <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-5 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
                    <Icon name="search" size={16} />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-zinc-500">
                    输入你的模糊记忆
                    <br />
                    AI 将检索历史并定位到原始消息
                  </p>
                </div>
              ) : null}

              {running ? (
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 text-center">
                  <Icon name="sparkles" size={16} className="mx-auto text-indigo-300" />
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    AI 正在检索历史消息
                    <br />
                    完成后在此显示可定位的结果
                  </p>
                </div>
              ) : null}

              {!running && error ? (
                <div
                  className={`rounded-xl border p-4 text-center ${
                    error.code === 'CANCELLED'
                      ? 'border-zinc-700 bg-zinc-900/50'
                      : 'border-red-500/30 bg-red-500/5'
                  }`}
                >
                  <div
                    className={`mx-auto grid h-10 w-10 place-items-center rounded-xl border bg-zinc-900 ${
                      error.code === 'CANCELLED'
                        ? 'border-zinc-700 text-zinc-400'
                        : 'border-red-500/30 text-red-300'
                    }`}
                  >
                    <Icon name={error.code === 'CANCELLED' ? 'stop' : 'sparkles'} size={16} />
                  </div>
                  <p className={`mt-3 text-xs font-medium ${error.code === 'CANCELLED' ? 'text-zinc-300' : 'text-red-200'}`}>
                    {error.code === 'CANCELLED' ? '已停止检索' : '检索失败'}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
                    {error.message}
                    <br />
                    未产生定位结果，不会影响聊天与目录。
                  </p>
                </div>
              ) : null}

              {!running && noFound ? (
                <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 p-4 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-amber-500/30 bg-zinc-900 text-amber-300">
                    <Icon name="search" size={16} />
                  </div>
                  <p className="mt-3 text-xs font-medium text-amber-200">未找到可靠匹配</p>
                  <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">{noFound}</p>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-600">
                    可以换个说法再试一次，AI 会尝试不同的关键词。
                  </p>
                </div>
              ) : null}

              {!running && results ? (
                <div className="fade-up space-y-2">
                  <p className="flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-200">
                    <Icon name="check" size={11} />
                    真实 Agent 检索结果 · 点击卡片定位消息
                  </p>
                  {results.map((r) => (
                    <ResultCard
                      key={r.messageId}
                      result={r}
                      topicTitle={topicTitleOf(conversation?.topics, r.topicId)}
                      onJump={onJump}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  )
}
