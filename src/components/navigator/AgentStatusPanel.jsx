/* ============================================================
 * Conversation Navigator Agent · AI 目录 Agent 状态区
 * ------------------------------------------------------------
 * 左栏顶部紧凑卡片：运行状态 / 分析消息数 / 话题数 / 最近更新，
 * 可展开「查看分析过程」（6 步标准执行定义）。
 * 状态来自结构化 DirectoryAgentState（data/navigator/agent.js），
 * 未来由真实 Agent 事件经 applyAgentEvent 实时驱动；
 * 内置示例数据明确显示「示例目录」，不伪造 AI 分析过程。
 * ============================================================ */

import { useState } from 'react'
import Icon from '../Icon'

const STATUS_META = {
  demo: { label: '示例目录', dot: 'bg-sky-400', text: 'text-sky-300', chip: 'border-sky-500/30 bg-sky-500/10' },
  pending: { label: '目录待生成', dot: 'bg-zinc-500', text: 'text-zinc-400', chip: 'border-zinc-700 bg-zinc-800/60' },
  idle: { label: '待分析', dot: 'bg-zinc-400', text: 'text-zinc-300', chip: 'border-zinc-700 bg-zinc-800/60' },
  running: { label: '分析中', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300', chip: 'border-amber-500/30 bg-amber-500/10' },
  done: { label: '已完成', dot: 'bg-emerald-400', text: 'text-emerald-300', chip: 'border-emerald-500/30 bg-emerald-500/10' },
  failed: { label: '分析失败', dot: 'bg-rose-400', text: 'text-rose-300', chip: 'border-rose-500/30 bg-rose-500/10' },
}

export default function AgentStatusPanel({ state, totalMessages, queue = null }) {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[state.status] ?? STATUS_META.idle
  const countLabel =
    state.analyzedCount === totalMessages
      ? `${totalMessages} 条消息`
      : `已分析 ${state.analyzedCount} / ${totalMessages} 条`
  /* 队列状态行（真实任务队列快照，无伪造进度）：
   * 运行中 → 正在第几轮 + 等待数；失败暂停 → 失败轮次 + 暂停提示；
   * 仅等待 → 待处理轮数。全部来自本地任务队列管理器 */
  const queueActive = !!queue && (!!queue.running || queue.pending > 0 || queue.failed > 0)
  const queueLine = !queueActive
    ? null
    : queue.running
      ? `正在分析第 ${queue.runningRound ?? '—'} 轮${queue.pending ? ` · 还有 ${queue.pending} 轮等待处理` : ''}`
      : queue.failed > 0
        ? `第 ${queue.failedRound ?? '—'} 轮维护失败，队列已暂停${queue.pending ? ` · ${queue.pending} 轮待重试后继续` : ''}`
        : `${queue.pending} 轮问答等待目录更新`

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-2.5">
      {/* 标题行 + 状态徽标 */}
      <div className="flex items-center gap-2">
        <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-500 text-white">
          <Icon name="sparkles" size={12} />
        </div>
        <span className="truncate text-[13px] font-medium text-zinc-100">AI 目录 Agent</span>
        <span
          className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${meta.chip} ${meta.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>

      <p className="mt-1.5 text-[11px] leading-4 text-zinc-500">
        通过语义理解识别话题边界、合并相关讨论、自动更新导航目录。
      </p>

      {/* 统计行 */}
      <div className="mt-2 flex items-center gap-2.5 text-[11px] text-zinc-400">
        <span className="flex items-center gap-1" title="已纳入目录的消息数">
          <Icon name="messageSquare" size={11} className="shrink-0 text-zinc-500" />
          {countLabel}
        </span>
        <span className="flex items-center gap-1" title="识别话题总数（含二级）">
          <Icon name="list" size={11} className="shrink-0 text-zinc-500" />
          {state.topicCount} 个话题
        </span>
        <span className="ml-auto shrink-0 text-zinc-500" title="最近一次目录更新时间">
          更新于 {state.lastUpdatedAt ?? '—'}
        </span>
      </div>

      {/* 增量维护任务队列状态（真实队列快照） */}
      {queueActive ? (
        <div className="mt-2 rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-2 py-1.5">
          <p
            className={`text-[11px] leading-4 ${
              queue.running
                ? 'text-amber-200/90'
                : queue.failed > 0
                  ? 'text-rose-200/90'
                  : 'text-zinc-300'
            }`}
          >
            {queueLine}
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-zinc-600">
            已完成 {queue.done} · 待处理 {queue.pending + (queue.running ? 1 : 0)} · 失败 {queue.failed}
          </p>
        </div>
      ) : null}

      {/* 展开分析过程 */}
      <button
        onClick={() => setOpen(!open)}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
      >
        查看分析过程 · {state.steps.length} 步
        <Icon name="chevronDown" size={12} className={open ? 'rotate-0' : '-rotate-90'} />
      </button>

      {open ? (
        <ol className="fade-up mt-2 space-y-1.5 rounded-lg border border-zinc-800/70 bg-zinc-950/60 p-2">
          {state.steps.map((step, i) => {
            const active = state.status === 'running' && step.id === state.activeStepId
            return (
              <li key={step.id} className="flex items-center gap-2">
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] ${
                    active
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-600'
                  }`}
                >
                  {i + 1}
                </span>
                <span className={`text-[11px] leading-4 ${active ? 'text-amber-200' : 'text-zinc-400'}`}>
                  {step.title}
                  <span className="ml-1 text-[10px] text-zinc-600">{step.desc}</span>
                </span>
              </li>
            )
          })}
          <li className="mt-1 border-t border-zinc-800/60 pt-1.5 text-[10px] leading-4 text-zinc-600">
            {state.footnote ??
              (state.status === 'demo'
                ? '示例目录为本地预置数据。以上为目录 Agent 的标准执行步骤定义，接入真实 LLM 后将按事件实时更新。'
                : state.status === 'pending'
                  ? '该会话目录尚未生成。接入真实 LLM 后将自动分析话题结构并更新目录。'
                  : '执行过程将在接入真实 LLM 后按 Agent 事件实时更新。')}
          </li>
        </ol>
      ) : null}
    </div>
  )
}
