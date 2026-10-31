/* ============================================================
 * Conversation Navigator Agent · 左栏统一导航树
 * ------------------------------------------------------------
 * 「全部会话列表」与「当前会话的智能目录」合并为同一棵树：
 *   会话标题（点击切换会话）→ 话题 → 子话题（点击精准定位消息）
 * - 标题左侧箭头独立控制目录展开 / 收起，不强制切换会话
 * - 话题支持一级、二级等多级递归展开
 * - 媒体 / 代码标签下会话列表保持可见，仅当前会话展示索引
 * - 新会话无目录时显示「目录待生成」，不虚构话题
 * ============================================================ */

import { useState } from 'react'
import Icon from '../Icon'
import { MediaThumb } from './Figures'
import { deriveTopicSegments } from '../../data/navigator'

/* ---------- AI 目录生成状态条（真实阶段驱动，无伪造进度） ---------- */

/* 运行中：加载动画 + 模型名 + 当前真实阶段 + 灰色动态日志
 * （日志由真实 SSE 事件驱动：读取消息 / 请求模型 / 接收进度 / 解析验证） */
function TopicGenStatus({ state }) {
  const step = state.steps?.find((s) => s.id === state.activeStepId)
  const model =
    typeof state.model === 'string' && state.model ? state.model.split('/').pop() : 'AI 模型'
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-2">
        <span className="mt-1 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-amber-200">
            {model} 正在分析对话目录
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-amber-200/60">
            {step ? `${step.title} · ${step.desc}` : '准备分析输入'}
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-amber-200/40">对话内容仍可正常阅读</p>
        </div>
      </div>
      {state.logs?.length ? (
        <div className="space-y-0.5 px-1">
          {state.logs.map((l, i) => (
            <p key={`${i}-${l.tag ?? 'log'}`} className="truncate text-[10px] leading-4 text-zinc-500">
              {l.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* 增量维护进行中：保留已有目录树，仅在顶部显示小型状态条 +
 * 最近几条真实流式执行日志（最新一条高亮）。
 * queue 携带真实队列信息（正在分析第几轮 / 等待数量） */
function IncUpdatingStatus({ state, queue }) {
  const logs = (state.logs ?? []).slice(-3)
  const roundLabel = state.round ? ` · 第 ${state.round} 轮` : ''
  const waitLabel = queue?.pending ? ` · 还有 ${queue.pending} 轮等待` : ''
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
        <p className="truncate text-[11px] font-medium text-amber-200">
          AI 正在更新目录{roundLabel}{waitLabel}
        </p>
      </div>
      {logs.length ? (
        <div className="mt-1 space-y-0.5 pl-3.5">
          {logs.map((l, i) => (
            <p
              key={`${i}-${l.text}`}
              className={`truncate text-[10px] leading-4 ${
                i === logs.length - 1 ? 'text-amber-200/80' : 'text-amber-200/45'
              }`}
              title={l.text}
            >
              {l.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* 失败：错误提示 + 重试按钮 + 目录来源标注。
 * state.task 存在 = 增量维护失败：「重试本轮维护」只把该轮两条消息
 * 重新入队（不触发全量重生成）；否则为全量失败，走「重试」全量分析。
 * 队列暂停时提示等待中的轮次（失败轮次保持「未分析」） */
function TopicGenFailed({ state, fallback, onRetry, onRetryIncremental, queue }) {
  const incremental = !!state.task
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.07] px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-red-200">
          {incremental ? '本轮目录更新失败，可重试' : 'AI 目录生成失败'}
        </p>
        {state.footnote ? (
          <p className="mt-0.5 text-[10px] leading-4 text-red-200/70">{state.footnote}</p>
        ) : null}
        {incremental && queue?.pending ? (
          <p className="mt-0.5 text-[10px] leading-4 text-red-200/60">
            队列已暂停 · {queue.pending} 轮待重试后继续
          </p>
        ) : null}
        {fallback === 'demo' ? (
          <p className="mt-0.5 text-[10px] leading-4 text-red-200/60">当前展示示例目录（本地回退）</p>
        ) : fallback === 'none' ? (
          <p className="mt-0.5 text-[10px] leading-4 text-red-200/60">会话暂无目录，可重试</p>
        ) : (
          <p className="mt-0.5 text-[10px] leading-4 text-red-200/60">已保留上一次 AI 目录</p>
        )}
        <button
          type="button"
          onClick={() => (incremental ? onRetryIncremental?.(state.task) : onRetry())}
          className="mt-1.5 flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-200 transition-colors hover:bg-red-500/20"
        >
          <Icon name="refresh" size={11} />
          {incremental ? '重试本轮维护' : '重试'}
        </button>
      </div>
    </div>
  )
}

/* ---------- 话题节点（递归支持多级） ---------- */

function TopicNode({ topic, expanded, activeTopicId, onToggle, onSelect, getSegments, onJumpSegment }) {
  const hasChildren = (topic.children?.length ?? 0) > 0
  /* 关联问答片段（纯本地派生，非 AI 子话题）：多于 1 段时提供独立的
   * 「第 N 轮」定位入口，与标题默认跳转（第一次讨论）互补 */
  const segments = getSegments ? getSegments(topic) : []
  const showSegments = segments.length > 1
  const expandable = hasChildren || showSegments
  const isExpanded = expanded.has(topic.id)
  const isActive = activeTopicId === topic.id
  const count = topic.messageIds.length

  /* 点击标题 = 跳转第一次讨论；未展开时顺带展开（含关联问答片段） */
  const handleSelect = () => {
    onSelect(topic)
    if (expandable && !isExpanded) onToggle(topic.id)
  }

  return (
    <div>
      <div
        className={`group flex cursor-pointer items-start gap-1.5 rounded-xl border px-2.5 py-2 transition-colors ${
          isActive
            ? 'border-indigo-500/50 bg-indigo-500/10'
            : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900/60'
        }`}
        onClick={handleSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleSelect()
        }}
      >
        {expandable ? (
          <button
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border bg-zinc-800/80 transition-all ${
              isExpanded
                ? 'rotate-0 border-indigo-500/50 text-indigo-300'
                : '-rotate-90 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(topic.id)
            }}
            title={isExpanded ? '收起' : '展开子话题 / 关联问答'}
          >
            <Icon name="chevronDown" size={14} />
          </button>
        ) : (
          <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-zinc-700" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`truncate text-[13px] font-medium ${
                isActive ? 'text-indigo-200' : 'text-zinc-200'
              }`}
            >
              {topic.title}
            </span>
            <span className="ml-auto shrink-0 rounded-full border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] text-zinc-500">
              {count} 条
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">{topic.desc}</p>
        </div>
      </div>

      {expandable && isExpanded ? (
        <div className="mt-0.5 ml-3 space-y-0.5 border-l border-zinc-800/80 pl-1.5">
          {topic.children?.map((child) => (
            <TopicNode
              key={child.id}
              topic={child}
              expanded={expanded}
              activeTopicId={activeTopicId}
              onToggle={onToggle}
              onSelect={onSelect}
              getSegments={getSegments}
              onJumpSegment={onJumpSegment}
            />
          ))}
          {showSegments ? (
            /* 关联问答定位入口：虚线容器与子话题卡片视觉区分，
             * 明示这是「普通定位入口」而非 AI 生成的子话题 */
            <div className="rounded-lg border border-dashed border-zinc-800/80 px-1.5 py-1">
              <p className="px-0.5 pb-0.5 text-[10px] leading-4 text-zinc-600">
                关联问答 · {segments.length} 段
              </p>
              <div className="space-y-0.5">
                {segments.map((seg) => (
                  <button
                    key={seg.key}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onJumpSegment?.(topic, seg)
                    }}
                    title={`第 ${seg.round} 轮 · ${seg.messageIds.length} 条消息 · 点击定位该轮问答`}
                    className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-zinc-900/80"
                  >
                    <Icon name="messageSquare" size={10} className="shrink-0 text-zinc-600" />
                    <span className="shrink-0 text-[10px] text-zinc-500">第{seg.round}轮</span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-400">
                      {seg.preview || '（无文本）'}
                    </span>
                    <span className="shrink-0 text-[9px] text-zinc-600">{seg.messageIds.length}条</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ---------- 媒体 / 代码索引卡片 ---------- */

function MediaIndexList({ mediaIndex, onJump }) {
  if (!mediaIndex.length) {
    return (
      <p className="mt-1 ml-6 rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-[11px] text-zinc-600">
        当前对话暂无图片 / 图表
      </p>
    )
  }
  return (
    <div className="mt-1 ml-6 space-y-2">
      {mediaIndex.map((asset) => (
        <button
          key={asset.assetId}
          onClick={() => onJump(asset.messageId)}
          className="flex w-full items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-2 text-left transition-colors hover:border-indigo-500/50 hover:bg-zinc-900"
        >
          <MediaThumb type={asset.type} variant={asset.variant} kind={asset.kind} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-zinc-200">{asset.title}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span
                className={`rounded border px-1 py-0.5 text-[10px] ${
                  asset.type === 'image'
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                {asset.type === 'image' ? '图片' : '图表'}
              </span>
              <span className="font-mono">#{asset.messageId}</span>
              <span>{asset.time}</span>
            </p>
          </div>
          <Icon name="locate" size={13} className="shrink-0 text-zinc-600" />
        </button>
      ))}
    </div>
  )
}

function CodeIndexList({ codeIndex, onJump }) {
  if (!codeIndex.length) {
    return (
      <p className="mt-1 ml-6 rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-[11px] text-zinc-600">
        当前对话暂无代码片段
      </p>
    )
  }
  return (
    <div className="mt-1 ml-6 space-y-2">
      {codeIndex.map((asset) => (
        <button
          key={asset.assetId}
          onClick={() => onJump(asset.messageId)}
          className="flex w-full items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-2 text-left transition-colors hover:border-indigo-500/50 hover:bg-zinc-900"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-800 bg-[#0b0b10] text-amber-300">
            <Icon name="code" size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-zinc-200">{asset.title}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="rounded border border-indigo-500/40 bg-indigo-500/10 px-1 py-0.5 text-[10px] text-indigo-300">
                {asset.language.toUpperCase()}
              </span>
              <span className="font-mono">#{asset.messageId}</span>
              <span>{asset.time}</span>
            </p>
          </div>
          <Icon name="locate" size={13} className="shrink-0 text-zinc-600" />
        </button>
      ))}
    </div>
  )
}

/* ---------- 会话节点：标题行 + 目录 / 索引 ---------- */

function SessionNode({
  session,
  isActive,
  isExpanded,
  tab,
  activeTopicId,
  mediaIndex,
  codeIndex,
  genState,
  topicExpanded,
  onToggleTopic,
  onToggleExpand,
  onOpen,
  onTopicJump,
  onSegmentJump,
  onJump,
  onRename,
  onDelete,
  onRegenerateTopics,
  onRetryIncremental,
  queue,
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)

  const startRename = () => {
    setDraft(session.title)
    setRenaming(true)
  }
  const commitRename = () => {
    const t = draft.trim()
    if (t && t !== session.title) onRename(session.id, t)
    setRenaming(false)
  }
  const selectTopic = (topic) => onTopicJump(session, topic)
  /* 关联问答片段：纯本地派生（复用话题 messageIds，不调用模型） */
  const getSegments = (topic) => deriveTopicSegments(topic, session.messages)
  const jumpSegment = (topic, seg) => onSegmentJump(session, topic, seg)

  return (
    <div>
      {/* 会话标题行：点击标题切换会话；左侧箭头独立展开 / 收起目录 */}
      <div
        className={`group flex items-center gap-1.5 rounded-xl border px-2 py-1.5 transition-colors ${
          isActive
            ? 'border-indigo-500/50 bg-indigo-500/10'
            : 'border-transparent hover:bg-zinc-900/60'
        }`}
      >
        <button
          type="button"
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border bg-zinc-800/80 transition-all ${
            isExpanded
              ? 'rotate-0 border-indigo-500/50 text-indigo-300'
              : '-rotate-90 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
          title={isExpanded ? '收起目录' : '展开目录'}
        >
          <Icon name="chevronDown" size={14} />
        </button>

        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="min-w-0 flex-1 rounded-lg border border-indigo-500/50 bg-zinc-950 px-2 py-1 text-[13px] text-zinc-100 outline-none"
          />
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onOpen(session)}
            title={session.title}
          >
            <span
              className={`flex items-center gap-1.5 truncate text-[13px] font-medium ${
                isActive ? 'text-indigo-200' : 'text-zinc-200'
              }`}
            >
              <span className="truncate">{session.title}</span>
              {session.demo ? (
                <span className="shrink-0 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-300">
                  演示案例
                </span>
              ) : null}
            </span>
            <span className="block truncate text-[11px] text-zinc-500">
              {session.messages.length} 条消息
              {session.topics.length ? ` · ${session.topics.length} 个话题` : ' · 目录待生成'}
            </span>
          </button>
        )}

        {/* 悬停操作：重命名 / 删除（内置演示会话不可改删） */}
        {!renaming && !session.demo ? (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                startRename()
              }}
              title="重命名会话"
              className="grid h-6 w-6 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <Icon name="pencil" size={12} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirming(true)
              }}
              title="删除会话"
              className="grid h-6 w-6 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-red-500/15 hover:text-red-300"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        ) : null}
      </div>

      {/* 删除确认条 */}
      {confirming ? (
        <div className="mt-1 ml-6 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
          <span className="min-w-0 flex-1 truncate">删除「{session.title}」？删除后不可恢复。</span>
          <button
            type="button"
            onClick={() => onDelete(session.id)}
            className="shrink-0 rounded-md bg-red-500/80 px-2 py-0.5 font-medium text-white transition-colors hover:bg-red-500"
          >
            删除
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="shrink-0 rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            取消
          </button>
        </div>
      ) : null}

      {/* 话题目录：仅话题标签下、且会话处于展开态。
          生成中隐藏目录树（避免预设目录被误认为 AI 输出），仅显示
          状态条与真实动态日志；失败后恢复目录并标注来源 */}
      {tab === 'topics' && isExpanded ? (
        <div className="mt-1 ml-3 space-y-0.5 border-l border-zinc-800/80 pl-2">
          {isActive && genState?.status === 'running' &&
                (genState.mode !== 'incremental' || !session.topics.length) ? (
                  /* 全量生成 / 会话首次生成目录（原本无目录）：完整初始化加载状态 */
                  <TopicGenStatus state={genState} />
                ) : (
                  <>
                    {isActive && genState?.status === 'running' ? (
                      /* 增量维护进行中：保留目录树，仅顶部小型状态条 */
                      <IncUpdatingStatus state={genState} queue={queue} />
                    ) : null}
                    {isActive && genState?.status === 'failed' ? (
                      <TopicGenFailed
                        state={genState}
                        fallback={
                          genState.task
                            ? session.topics.length
                              ? 'ai'
                              : 'none'
                            : session.topicsSource === 'ai' || session.topics.length
                              ? session.demo && session.topicsSource !== 'ai'
                                ? 'demo'
                                : 'ai'
                              : 'none'
                        }
                        onRetry={onRegenerateTopics}
                        onRetryIncremental={onRetryIncremental}
                        queue={queue}
                      />
                    ) : null}
                    {session.topics.length ? (
                      session.topics.map((t) => (
                        <TopicNode
                          key={t.id}
                          topic={t}
                          expanded={topicExpanded}
                          activeTopicId={isActive ? activeTopicId : null}
                          onToggle={onToggleTopic}
                          onSelect={selectTopic}
                          getSegments={getSegments}
                          onJumpSegment={jumpSegment}
                        />
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-zinc-800 px-2.5 py-2 text-[11px] leading-5 text-zinc-600">
                        AI 目录待生成 · 点击下方「重新生成目录」开始分析
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : null}

      {/* 媒体 / 代码索引：仅当前会话展示 */}
      {tab === 'media' && isActive ? (
        <MediaIndexList mediaIndex={mediaIndex} onJump={onJump} />
      ) : null}
      {tab === 'code' && isActive ? (
        <CodeIndexList codeIndex={codeIndex} onJump={onJump} />
      ) : null}
    </div>
  )
}

/* ---------- 统一导航树 ---------- */

export default function SessionTree({
  sessions,
  activeId,
  activeTopicId,
  tab,
  mediaIndex,
  codeIndex,
  expandedSessions,
  genState,
  onToggleSessionExpand,
  onOpenSession,
  onTopicJump,
  onSegmentJump,
  onJump,
  onRenameSession,
  onDeleteSession,
  onRegenerateTopics,
  onRetryIncremental,
  queue,
}) {
  const [topicExpanded, setTopicExpanded] = useState(() => new Set())

  const toggleTopic = (id) =>
    setTopicExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-1">
      {sessions.map((session) => (
        <SessionNode
          key={session.id}
          session={session}
          isActive={session.id === activeId}
          isExpanded={expandedSessions.has(session.id)}
          tab={tab}
          activeTopicId={activeTopicId}
          mediaIndex={mediaIndex}
          codeIndex={codeIndex}
          genState={session.id === activeId ? genState : null}
          topicExpanded={topicExpanded}
          onToggleTopic={toggleTopic}
          onToggleExpand={() => onToggleSessionExpand(session.id)}
          onOpen={onOpenSession}
          onTopicJump={onTopicJump}
          onSegmentJump={onSegmentJump}
          onJump={onJump}
          onRename={onRenameSession}
          onDelete={onDeleteSession}
          onRegenerateTopics={onRegenerateTopics}
          onRetryIncremental={onRetryIncremental}
          queue={session.id === activeId ? queue : null}
        />
      ))}
      {!sessions.length ? (
        <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-[11px] leading-5 text-zinc-600">
          暂无会话 · 点击上方「新建聊天」开始
        </p>
      ) : null}
    </div>
  )
}
