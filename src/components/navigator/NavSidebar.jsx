/* ============================================================
 * Conversation Navigator Agent · 左栏：会话导航与内容索引
 * ------------------------------------------------------------
 * - 新建聊天 + 醒目的「体验智能导航示例」紫色入口
 * - AI 目录 Agent 状态区（针对当前会话显示）
 * - 三个标签：话题目录 / 图片·图表 / 代码片段
 *   统一渲染 SessionTree（会话 → 话题 → 子话题），
 *   切换标签时会话列表始终可见
 * ============================================================ */

import { useRef, useState } from 'react'
import Icon from '../Icon'
import AgentStatusPanel from './AgentStatusPanel'
import SessionTree from './SessionTree'

const TABS = [
  { key: 'topics', label: '话题目录', icon: 'list' },
  { key: 'media', label: '图片 / 图表', icon: 'image' },
  { key: 'code', label: '代码片段', icon: 'code' },
]

export default function NavSidebar({
  sessions,
  activeId,
  activeTopicId,
  agentState,
  totalMessages,
  activeMediaIndex,
  activeCodeIndex,
  expandedSessions,
  generating = false,
  topicGenState,
  queue = null,
  onToggleSessionExpand,
  onOpenSession,
  onNewChat,
  onOpenDemo,
  onTopicJump,
  onSegmentJump,
  onJump,
  onRenameSession,
  onDeleteSession,
  onRegenerateTopics,
  onRetryIncremental,
}) {
  const [tab, setTab] = useState('topics')
  const [notice, setNotice] = useState(null)
  const noticeTimerRef = useRef(null)

  const showNotice = (text) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setNotice(text)
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2800)
  }

  return (
    <aside className="flex h-full w-[26%] min-w-[260px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* 头部 */}
      <div className="shrink-0 border-b border-zinc-800 px-4 pt-3">
        <div className="flex items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-500 text-white">
            <Icon name="compass" size={13} />
          </div>
          <span className="text-sm font-medium text-zinc-100">智能导航</span>
          <span className="ml-auto rounded-full border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {sessions.length} 个会话
          </span>
        </div>

        {/* 新建聊天 */}
        <button
          onClick={onNewChat}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 py-2 text-[13px] font-medium text-zinc-200 transition-colors hover:border-indigo-500/60 hover:bg-zinc-800 hover:text-white"
        >
          <Icon name="plus" size={14} />
          新建聊天
        </button>

        {/* 体验智能导航示例：简洁快捷入口（主入口在中间首页卡片，调用同一示例加载逻辑） */}
        <button
          onClick={onOpenDemo}
          title="打开内置 TravelMate 演示会话"
          className="mt-2 flex w-full items-center gap-2 rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/[0.06] px-3 py-1.5 text-left transition-colors hover:border-fuchsia-500/50 hover:bg-fuchsia-500/10"
        >
          <Icon name="sparkles" size={13} className="shrink-0 text-fuchsia-300" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-fuchsia-200/90">
            体验智能导航示例
          </span>
          <Icon name="arrowRight" size={12} className="shrink-0 text-fuchsia-300/60" />
        </button>

        {/* AI 目录 Agent 状态区（针对当前会话） */}
        {agentState ? (
          <div className="mt-2.5">
            <AgentStatusPanel state={agentState} totalMessages={totalMessages} queue={queue} />
          </div>
        ) : null}

        {/* 标签切换 */}
        <div className="mt-2.5 flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[12px] transition-colors ${
                tab === t.key
                  ? 'bg-indigo-500/15 text-indigo-300'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
              }`}
            >
              <Icon name={t.icon} size={12} />
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="h-2" />
      </div>

      {/* 统一导航树：独立滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <SessionTree
          sessions={sessions}
          activeId={activeId}
          activeTopicId={activeTopicId}
          tab={tab}
          mediaIndex={activeMediaIndex}
          codeIndex={activeCodeIndex}
          expandedSessions={expandedSessions}
          genState={topicGenState}
          onRegenerateTopics={onRegenerateTopics}
          onRetryIncremental={onRetryIncremental}
          onToggleSessionExpand={onToggleSessionExpand}
          onOpenSession={onOpenSession}
          onTopicJump={onTopicJump}
          onSegmentJump={onSegmentJump}
          queue={queue}
          onJump={onJump}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSession}
        />
      </div>

      {/* 底部操作 + 提示 */}
      <div className="shrink-0 border-t border-zinc-800 p-3">
        {notice ? (
          <p className="fade-up mb-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] leading-5 text-indigo-200">
            {notice}
          </p>
        ) : null}
        {/* 真实目录生成（阶段 1）：运行中再次点击 = 停止分析并终止上游请求 */}
        <button
          onClick={() => {
            if (generating) {
              onRegenerateTopics()
              return
            }
            if (!activeId) {
              showNotice('请先打开一个会话，再生成话题目录。')
              return
            }
            onRegenerateTopics()
          }}
          disabled={!generating && !activeId}
          title={generating ? '停止当前分析（终止上游付费请求）' : '调用真实模型分析当前会话并生成话题目录'}
          className={`flex w-full flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] transition-colors ${
            generating
              ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60'
              : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50'
          }`}
        >
          <Icon
            name={generating ? 'stop' : 'refresh'}
            size={14}
            className={generating ? 'text-red-300' : 'text-zinc-500'}
          />
          {generating ? '停止分析' : '重新生成目录'}
        </button>
      </div>
    </aside>
  )
}
