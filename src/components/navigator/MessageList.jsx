/* ============================================================
 * Conversation Navigator Agent · 中栏：对话阅读区
 * ------------------------------------------------------------
 * - ChatGPT 式长对话阅读体验：区分用户 / AI 消息
 * - 日期分隔、消息元信息（时间 + 稳定 messageId）
 * - 每条消息以 msg-<id> 挂载 DOM 节点，供目录 / 索引 / 检索
 *   精准 scrollIntoView 定位；跳转后由父级触发短暂高亮
 * ============================================================ */

import { useEffect, useRef } from 'react'
import Icon from '../Icon'
import MessageBlocks from './MessageBlocks'

function DayDivider({ day }) {
  return (
    <div className="flex items-center gap-3 px-1 py-1.5">
      <span className="h-px flex-1 bg-zinc-800/70" />
      <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] text-zinc-500">
        {day}
      </span>
      <span className="h-px flex-1 bg-zinc-800/70" />
    </div>
  )
}

function UserMessage({ msg, highlighted }) {
  return (
    <div className="flex justify-end">
      <div
        className={`max-w-[82%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm leading-6 text-white shadow-md shadow-indigo-950/40 transition-all ${
          highlighted ? 'ring-2 ring-indigo-300/70' : ''
        }`}
      >
        {(msg.blocks ?? []).map((b, i) =>
          b.type === 'text' ? (
            <p key={i} className="whitespace-pre-wrap">
              {b.text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, j) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>
                }
                if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                  return <code key={j} className="rounded bg-indigo-500/40 px-1 py-0.5 font-mono text-[12px]">{part.slice(1, -1)}</code>
                }
                return <span key={j}>{part}</span>
              })}
            </p>
          ) : null,
        )}
      </div>
    </div>
  )
}

function AssistantMessage({ msg, highlighted }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-4 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-md shadow-indigo-950/40">
        <Icon name="sparkles" size={13} />
      </div>
      <div
        className={`min-w-0 max-w-[88%] flex-1 rounded-2xl rounded-tl-md border bg-zinc-900/60 px-4 py-3 transition-all ${
          highlighted ? 'border-indigo-500/60 bg-indigo-500/[0.06]' : 'border-zinc-800'
        }`}
      >
        <MessageBlocks blocks={msg.blocks} />
      </div>
    </div>
  )
}

function MetaRow({ msg, isUser }) {
  return (
    <div
      className={`mt-1 flex items-center gap-2 px-1 text-[11px] text-zinc-600 ${
        isUser ? 'justify-end' : 'pl-10'
      }`}
    >
      <span>{isUser ? '用户' : 'AI 助手'}</span>
      <span className="text-zinc-700">·</span>
      <span className="font-mono">{msg.time}</span>
      <span className="text-zinc-700">·</span>
      <span className="font-mono text-zinc-500">#{msg.id}</span>
    </div>
  )
}

export default function MessageList({ conversation, stats, highlightId, autoScroll = false, demo = false }) {
  const { messages } = conversation
  const scrollRef = useRef(null)
  /* mount-only 模式：仅读取挂载瞬间的 autoScroll 值，
   * 避免 pendingJump 清除后 prop 变化重新触发滚动动画 */
  const autoScrollRef = useRef(autoScroll)
  /* 流式跟随：用户位于底部附近时，思考流 / 正文 / 新消息自动贴底；
   * 上滚查看历史时不打扰（回到底部附近后恢复跟随） */
  const stickToBottomRef = useRef(true)
  const animatingRef = useRef(false)
  useEffect(() => {
    autoScrollRef.current = autoScroll
  })

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  /* 打开会话时自动滚动到底部：rAF 缓动动画展示完整滚动过程，
   * 用户滚轮 / 触摸可随时中断；每帧重算目标位置以兼容布局变化 */
  useEffect(() => {
    if (!autoScrollRef.current) return undefined
    const el = scrollRef.current
    if (!el) return undefined
    animatingRef.current = true

    const duration = 2600
    const startTime = performance.now()
    let rafId = 0
    let canceled = false
    const cancel = () => {
      canceled = true
      animatingRef.current = false
    }
    el.addEventListener('wheel', cancel, { passive: true })
    el.addEventListener('touchmove', cancel, { passive: true })

    const tick = (now) => {
      if (canceled) return
      const t = Math.min((now - startTime) / duration, 1)
      /* easeInOutCubic：起步慢 → 中段快 → 收尾缓 */
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const target = el.scrollHeight - el.clientHeight
      el.scrollTop = target * eased
      if (t < 1) rafId = requestAnimationFrame(tick)
      else animatingRef.current = false
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      canceled = true
      animatingRef.current = false
      cancelAnimationFrame(rafId)
      el.removeEventListener('wheel', cancel)
      el.removeEventListener('touchmove', cancel)
    }
  }, [])

  /* 流式输出 / 新消息到达：位于底部附近时直接贴底（无动画）；
   * mount 缓动动画期间跳过（动画每帧重算目标，已自带跟随） */
  useEffect(() => {
    if (animatingRef.current) return
    if (!stickToBottomRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight - el.clientHeight
  }, [conversation])

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0b0b10]">
      {/* 顶部信息栏 */}
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-zinc-800 px-4">
        <Icon name="messageSquare" size={14} className="text-indigo-400" />
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-zinc-100">{conversation.title}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-zinc-500">
          <span title="消息总数">{stats.messageCount} 条消息</span>
          <span className="text-zinc-800">|</span>
          <span title="话题总数（含二级）">{stats.topicCount} 个话题</span>
          <span className="text-zinc-800">|</span>
          <span title="图片与图表数量">{stats.mediaCount} 个媒体</span>
          <span className="text-zinc-800">|</span>
          <span title="代码片段数量">{stats.codeCount} 段代码</span>
        </div>
      </div>

      {/* 阅读区：独立滚动 */}
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          {/* 演示数据标识（仅内置演示会话显示） */}
          {demo ? (
            <div className="mb-2 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-3 py-2 text-[11px] text-zinc-500">
              <Icon name="file" size={11} />
              本地演示对话 · 非真实用户历史记录 · 用于展示对话导航能力
            </div>
          ) : null}

          {messages.map((msg, i) => {
            const day = msg.time.slice(0, 5)
            const prevDay = i > 0 ? messages[i - 1].time.slice(0, 5) : null
            const showDivider = day !== prevDay
            const highlighted = highlightId === msg.id
            const isUser = msg.role === 'user'
            return (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                style={{ scrollMarginTop: '14px' }}
                className={`fade-up scroll-mt-3 rounded-2xl px-1 py-1 transition-all ${
                  highlighted ? 'bg-indigo-500/10 ring-1 ring-indigo-500/40' : ''
                }`}
              >
                {showDivider ? <DayDivider day={day} /> : null}
                {isUser ? (
                  <UserMessage msg={msg} highlighted={highlighted} />
                ) : (
                  <AssistantMessage msg={msg} highlighted={highlighted} />
                )}
                <MetaRow msg={msg} isUser={isUser} />
              </div>
            )
          })}

          <div className="flex items-center justify-center gap-2 px-1 pb-2 pt-4 text-[11px] text-zinc-600">
            {stats.topicCount > 0 ? (
              <>
                <Icon name="check" size={12} />
                对话已读完 · 共 {stats.messageCount} 条 · 点击左侧目录或右侧检索结果可跳回任意位置
              </>
            ) : (
              <>
                <Icon name="clock" size={12} />
                共 {stats.messageCount} 条消息 · AI 回复与目录生成即将接入
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
