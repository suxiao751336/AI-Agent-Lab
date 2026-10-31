/* ============================================================
 * Conversation Navigator Agent · 底部对话输入框
 * ------------------------------------------------------------
 * - 多行输入：Enter 发送 / Shift+Enter 换行
 * - 发送按钮按内容启用 / 禁用；AI 回复期间变「停止生成」按钮
 *   （终止上游请求，保留已生成部分）
 * - floating 模式：首页居中悬浮卡片（无边框贴底）
 * - 流式回复经 /api/navigator/chat（SSE）逐字显示，错误时由
 *   父级 notice 提示，不伪造 AI 回复
 * ============================================================ */

import { useState } from 'react'
import Icon from '../Icon'

export default function ChatComposer({ onSend, onStop, streaming = false, placeholder, notice, floating = false }) {
  const [value, setValue] = useState('')
  const canSend = value.trim().length > 0 && !streaming

  const send = () => {
    if (!canSend) return
    onSend(value)
    setValue('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div
      className={
        floating ? 'w-full' : 'shrink-0 border-t border-zinc-800 bg-zinc-950 px-5 py-3'
      }
    >
      <div className={floating ? '' : 'mx-auto max-w-3xl'}>
        {notice ? (
          <p className="fade-up mb-2 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
            <Icon name="sparkles" size={11} className="shrink-0" />
            {notice}
          </p>
        ) : null}

        <div className="flex items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-2 transition-colors focus-within:border-indigo-500/50">
          <textarea
            rows={2}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? (streaming ? 'AI 正在回复……' : '输入消息，继续与 AI 讨论……')}
            className="min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-6 text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <button
            onClick={streaming ? onStop : send}
            disabled={!streaming && !canSend}
            title={streaming ? '停止生成' : '发送（Enter）'}
            className={
              streaming
                ? 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-700 text-zinc-200 transition-colors hover:bg-zinc-600'
                : 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
            }
          >
            <Icon name={streaming ? 'stop' : 'arrowRight'} size={15} />
          </button>
        </div>

        <p className="mt-1.5 px-1 text-[10.5px] text-zinc-600">
          {streaming
            ? 'AI 正在回复 · 点击右侧按钮可停止生成'
            : 'Enter 发送 · Shift + Enter 换行 · AI 回复由 DeepSeek 实时生成'}
        </p>
      </div>
    </div>
  )
}
