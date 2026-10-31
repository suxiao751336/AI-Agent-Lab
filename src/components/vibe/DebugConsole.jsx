import { useEffect, useMemo, useRef, useState } from 'react'

/* AI 工作记录（工作台底部，默认收起）
 * 双模式切换：
 *  · 简洁（默认）—— 通俗中文文案（由事件真实字段映射，src/services/agentNarration.js），
 *    面向普通用户；流式心跳同组原地合并，不逐条刷屏
 *  · 技术 —— 原始日志（前端真实动作 + 服务端 SSE 事件，requestId 关联），
 *    面向开发者与面试官：requestId / 工具名 / Token / 耗时 / 错误码完整保留
 * 级别：INFO / SUCCESS / WARNING / ERROR；ERROR 到达时父组件自动展开
 * 运行中实时显示当前阶段与请求耗时（真实计时，非预设动画）
 */

const LEVEL_META = {
  INFO: { color: 'text-zinc-300', badge: 'border-zinc-600 bg-zinc-800 text-zinc-400' },
  SUCCESS: { color: 'text-emerald-300', badge: 'border-emerald-600/50 bg-emerald-500/10 text-emerald-400' },
  WARNING: { color: 'text-amber-300', badge: 'border-amber-600/50 bg-amber-500/10 text-amber-400' },
  ERROR: { color: 'text-rose-300', badge: 'border-rose-600/50 bg-rose-500/10 text-rose-400' },
}

const MODES = [
  { key: 'simple', label: '简洁' },
  { key: 'tech', label: '技术' },
]

const fmtTime = (t) => {
  const d = new Date(t)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

const fmtElapsed = (ms) => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

function formatLogLine(l) {
  if (l.friendly) return `[${fmtTime(l.t)}] ${l.text}`
  return `[${fmtTime(l.t)}] [${l.level}] [${l.src === 'BE' ? '服务端' : '前端'}.${l.stage}] ${l.text}`
}

export default function DebugConsole({ logs, open, onToggle, onClear, running, taskStart }) {
  const listRef = useRef(null)
  const [now, setNow] = useState(0)
  const [copied, setCopied] = useState(false)
  /* 展示模式：简洁（默认，普通用户）/ 技术（开发者与面试官） */
  const [mode, setMode] = useState('simple')

  const visible = useMemo(
    () => (mode === 'simple' ? logs.filter((l) => l.friendly) : logs.filter((l) => !l.friendly)),
    [logs, mode],
  )

  /* 运行期间每 500ms 刷新一次真实耗时 */
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [running])

  /* 新日志自动滚到底部 */
  useEffect(() => {
    const el = listRef.current
    if (el && open) el.scrollTop = el.scrollHeight
  }, [logs, open])

  const last = visible.length ? visible[visible.length - 1] : null
  const elapsedMs = running && taskStart && now > 0 ? now - taskStart : null
  const lastError = [...logs].reverse().find((l) => l.level === 'ERROR')

  const handleCopy = async () => {
    const text = visible.map(formatLogLine).join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const switchMode = (key) => {
    setMode(key)
  }

  return (
    <section className="shrink-0 border-t border-zinc-800 bg-zinc-950/95">
      {/* 收起 / 展开切换条 */}
      <button
        onClick={onToggle}
        className="flex h-8 w-full items-center gap-2.5 px-4 text-left transition-colors hover:bg-zinc-900/60"
      >
        <span className="text-[11px] font-medium text-zinc-400">AI 工作记录</span>
        <span className="text-[10px] text-zinc-600">{visible.length} 条</span>
        {running ? (
          <span className="flex items-center gap-1.5 text-[10px] text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            运行中{elapsedMs != null ? ` · 已耗时 ${fmtElapsed(elapsedMs)}` : ''}
          </span>
        ) : lastError ? (
          <span className="text-[10px] text-rose-400">最近一次任务失败</span>
        ) : (
          <span className="text-[10px] text-zinc-600">空闲</span>
        )}
        {/* 收起时显示最近一条记录摘要（按当前模式） */}
        {!open && last ? (
          <span className="ml-2 min-w-0 flex-1 truncate text-[11px] text-zinc-600">
            {formatLogLine(last)}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-zinc-500">
          {/* 模式切换：简洁（默认，普通用户）/ 技术（开发者） */}
          <span
            className="flex items-center rounded-md border border-zinc-800 bg-zinc-900 p-0.5"
            onClick={(e) => e.stopPropagation()}
            title="切换展示模式：简洁=通俗中文；技术=原始日志（requestId / 工具 / Token / 错误码）"
          >
            {MODES.map((m) => (
              <span
                key={m.key}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  switchMode(m.key)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    switchMode(m.key)
                  }
                }}
                className={`cursor-pointer rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                  mode === m.key
                    ? 'bg-indigo-500/15 text-indigo-300'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {m.label}
              </span>
            ))}
          </span>
          {open ? (
            <>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    onClear()
                  }
                }}
                className="rounded px-1.5 py-0.5 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                清空
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  handleCopy()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    handleCopy()
                  }
                }}
                className="rounded px-1.5 py-0.5 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                {copied ? '已复制 ✓' : '复制'}
              </span>
            </>
          ) : null}
          <span>{open ? '▾ 收起' : '▴ 展开'}</span>
        </span>
      </button>

      {/* 记录列表 */}
      {open ? (
        <div className="h-48 overflow-hidden border-t border-zinc-900">
          <div
            ref={listRef}
            className={
              mode === 'simple'
                ? 'h-full space-y-1.5 overflow-y-auto px-4 py-2 text-[12px] leading-5'
                : 'h-full space-y-0.5 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-5'
            }
          >
            {visible.length === 0 ? (
              <p className="text-zinc-600">
                {mode === 'simple'
                  ? '暂无记录。提交需求后，这里会用通俗语言实时显示 AI 的开发过程（真实事件驱动，非预设文案）。'
                  : '暂无日志。提交需求后，这里会实时显示前端与服务端的真实执行过程（通过 SSE 关联，非预设数据）。'}
              </p>
            ) : mode === 'simple' ? (
              /* 简洁模式：时间 + 通俗文案（颜色区分成功/警告/失败） */
              visible.map((l) => {
                const meta = LEVEL_META[l.level] || LEVEL_META.INFO
                return (
                  <div key={l.id} className="flex gap-2.5">
                    <span className="shrink-0 font-mono text-[10px] leading-5 text-zinc-600">
                      {fmtTime(l.t)}
                    </span>
                    <span className={`min-w-0 break-words ${meta.color}`}>{l.text}</span>
                  </div>
                )
              })
            ) : (
              /* 技术模式：原始日志（级别 / 来源 / 阶段 / 完整文本，排障能力不缩水） */
              visible.map((l) => {
                const meta = LEVEL_META[l.level] || LEVEL_META.INFO
                return (
                  <div key={l.id} className="flex gap-2">
                    <span className="shrink-0 text-zinc-600">{fmtTime(l.t)}</span>
                    <span
                      className={`inline-flex shrink-0 items-center rounded border px-1 text-[9px] leading-4 ${meta.badge}`}
                    >
                      {l.level}
                    </span>
                    <span
                      className={`shrink-0 ${l.src === 'BE' ? 'text-sky-500' : 'text-indigo-500'}`}
                      title={l.src === 'BE' ? '服务端事件（SSE 实时）' : '前端事件'}
                    >
                      {l.src === 'BE' ? '服务端' : '前端'}
                      <span className="text-zinc-600">·{l.stage}</span>
                    </span>
                    <span className={`min-w-0 break-all ${meta.color}`}>{l.text}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
