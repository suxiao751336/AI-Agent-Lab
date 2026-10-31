import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import StepsCard from './StepsCard'
import { VISUAL_MODES, VISUAL_QUICK_PROMPTS } from '../../data/visualProjects'
import { EDIT_HINTS } from '../../services/codeEditor'

function MessageBubble({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="fade-up flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2.5 text-sm leading-6 text-white shadow-md shadow-indigo-950/40">
          {msg.text}
        </div>
      </div>
    )
  }
  return (
    <div className="fade-up flex items-start gap-2.5">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
        <Icon name="code" size={13} />
      </div>
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-sm leading-6 text-zinc-200">
        {msg.thinking ? (
          <span className="flex items-center gap-1 py-1">
            {msg.text ? <span className="mr-2 text-xs text-zinc-400">{msg.text}</span> : null}
            <span className="dot-bounce h-1.5 w-1.5 rounded-full bg-zinc-400" />
            <span className="dot-bounce h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animationDelay: '0.15s' }} />
            <span className="dot-bounce h-1.5 w-1.5 rounded-full bg-zinc-400" style={{ animationDelay: '0.3s' }} />
          </span>
        ) : (
          <>
            {msg.text}
            {msg.streaming ? <span className="caret text-indigo-400">▍</span> : null}
          </>
        )}
      </div>
    </div>
  )
}

export default function ChatPanel({
  messages,
  generating,
  mode,
  engine,
  hasProject,
  onModeChange,
  onEngineChange,
  onSend,
  onStop,
  onContinue,
}) {
  const [input, setInput] = useState('')
  const [devOpen, setDevOpen] = useState(false)
  const listRef = useRef(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const submit = () => {
    const text = input.trim()
    if (!text || generating) return
    setInput('')
    onSend(text)
  }

  return (
    <section className="flex h-full w-[340px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* 面板头 */}
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-zinc-800 px-4">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
          <Icon name="code" size={12} />
        </div>
        <span className="text-sm font-medium text-zinc-200">AI 对话</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${generating ? 'bg-amber-400' : 'bg-emerald-400'}`}
          />
          {generating ? '生成中' : '在线'}
        </span>
      </div>

      {/* 消息列表 */}
      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m) =>
          m.type === 'steps' ? (
            <StepsCard key={m.id} steps={m.steps} badge={m.badge} />
          ) : m.type === 'continue' ? (
            <div key={m.id} className="fade-up flex items-start gap-2.5">
              <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
                <Icon name="code" size={13} />
              </div>
              <button
                onClick={onContinue}
                disabled={generating}
                title="接着上次中断的位置继续完成剩余开发"
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-md shadow-indigo-950/40 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ▶ 继续执行
              </button>
            </div>
          ) : (
            <MessageBubble key={m.id} msg={m} />
          ),
        )}
        {!generating && hasProject && engine === 'local' ? (
          <div className="space-y-2 pt-2">
            <p className="px-1 text-[11px] text-zinc-500">继续修改当前项目（增量 · 保留已有功能）</p>
            {EDIT_HINTS.map((h) => (
              <button
                key={h.label}
                onClick={() => onSend(h.prompt)}
                className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-left text-[13px] text-zinc-300 transition-colors hover:border-indigo-500/50 hover:bg-zinc-900 hover:text-white"
              >
                <span>{h.label}</span>
                <Icon name="send" size={12} className="text-zinc-600" />
              </button>
            ))}
          </div>
        ) : null}
        {!generating && !hasProject && messages.length <= 1 ? (
          <div className="space-y-2 pt-2">
            {VISUAL_QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                onClick={() => onSend(q.prompt)}
                className="flex w-full items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-left text-[13px] text-zinc-300 transition-colors hover:border-indigo-500/50 hover:bg-zinc-900 hover:text-white"
              >
                <span>{q.label}</span>
                <Icon name="send" size={12} className="text-zinc-600" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* 输入区：视觉增强开关 + 需求输入 + 发送（引擎切换隐藏于开发者设置） */}
      <div className="shrink-0 space-y-2.5 border-t border-zinc-800 p-3">
        {/* AI 视觉增强开关：仅真实模型引擎可用（Kimi 代码 + Z-Image-Turbo 图像协同，
            开关状态随请求传给后端决定 generate_image 工具权限）；
            本地模拟引擎不支持 AI 生图（其素材注入走开发者设置的模式按钮） */}
        {engine === 'llm' ? (
          <button
            type="button"
            disabled={generating}
            onClick={() => onModeChange(mode === 'enhanced' ? 'standard' : 'enhanced')}
            title={
              mode === 'enhanced'
                ? '已开启：AI 可按需调用图像模型生成真实图片素材（每次任务最多 2 张，普通修改仍纯代码完成）'
                : '开启后 AI 可根据需求调用图像模型（Z-Image-Turbo）生成真实图片素材'
            }
            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              mode === 'enhanced'
                ? 'border-fuchsia-500/50 bg-fuchsia-500/10'
                : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
            }`}
          >
            <span className="flex items-center gap-2 text-xs text-zinc-300">
              🎨 AI 视觉增强
              {mode === 'enhanced' ? (
                <span className="rounded-full border border-fuchsia-500/40 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-300">
                  Z-Image-Turbo
                </span>
              ) : null}
            </span>
            <span className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-zinc-700 bg-zinc-800">
              <span
                className={`ml-0.5 h-4 w-4 rounded-full transition-transform ${
                  mode === 'enhanced' ? 'translate-x-4 bg-fuchsia-400' : 'bg-zinc-600'
                }`}
              />
            </span>
          </button>
        ) : (
          <label
            title="本地模拟引擎不支持 AI 生图（其视觉增强由本地素材注入实现，可在开发者设置中切换模式）"
            className="flex cursor-not-allowed items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 opacity-70"
          >
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              🎨 AI 视觉增强
              <span className="rounded-full border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                需真实引擎
              </span>
            </span>
            <span className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-zinc-700 bg-zinc-800">
              <span
                className={`ml-0.5 h-4 w-4 rounded-full bg-zinc-600 transition-transform ${
                  mode === 'enhanced' ? 'translate-x-4 bg-indigo-400' : ''
                }`}
              />
            </span>
          </label>
        )}

        <div className="flex items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-2 transition-colors focus-within:border-indigo-500/60">
          <textarea
            rows={1}
            value={input}
            disabled={generating}
            placeholder={
              generating
                ? '生成中，请稍候…'
                : engine === 'llm'
                  ? hasProject
                    ? '用自然语言描述修改需求（如：增加任务优先级，分高中低三档），Enter 发送'
                    : '描述任意移动端应用需求（如：兔子主题宠物签到 App），Enter 发送'
                  : hasProject
                    ? '描述要修改的内容（如：把主色改成蓝色），Enter 发送'
                    : '描述你想要的移动端界面，Enter 发送'
            }
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            className="max-h-28 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none disabled:opacity-60"
          />
          {generating ? (
            <button
              onClick={onStop}
              title="停止生成"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 transition-colors hover:border-rose-500/60 hover:text-rose-400"
            >
              <Icon name="stop" size={13} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              title="发送"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="send" size={13} />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between px-1">
          <p className="text-[11px] text-zinc-600">
            {engine === 'llm'
              ? '真实模型 · Kimi K2.7 Code（硅基流动）· Enter 发送'
              : '本地模拟引擎（开发者调试）· Enter 发送'}
          </p>
          <button
            onClick={() => setDevOpen((v) => !v)}
            title="调试设置：代码生成引擎切换（普通用户无需调整）"
            className="text-[11px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            ⚙ 开发者设置{devOpen ? ' ▴' : ' ▾'}
          </button>
        </div>

        {/* 开发者调试设置：引擎切换（默认真实模型，普通用户不可见） */}
        {devOpen ? (
          <div className="space-y-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-2.5">
            <p className="text-[10px] text-zinc-600">
              调试专用 · 代码生成引擎切换（普通用户默认使用真实模型）
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">引擎</span>
              <button
                disabled={generating}
                onClick={() => onEngineChange('llm')}
                title="硅基流动 Kimi K2.7 Code · 需在项目根目录 .env 配置 SILICONFLOW_API_KEY"
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  engine === 'llm'
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                🤖 真实模型
              </button>
              <button
                disabled={generating}
                onClick={() => onEngineChange('local')}
                title="本地预设模板 + 规则式修改 + 本地素材注入，离线可用（模拟）"
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  engine === 'local'
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                🧪 本地模拟
              </button>
            </div>
            {engine === 'local' ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-500">模式</span>
                {Object.values(VISUAL_MODES).map((m) => (
                  <button
                    key={m.key}
                    disabled={generating}
                    onClick={() => onModeChange(m.key)}
                    title={m.desc}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      mode === m.key
                        ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-300'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="text-[10px] text-zinc-600">
              {engine === 'local'
                ? '本地引擎：预设模板 + 规则式修改 + 素材注入（全程本地，未调用真实模型）'
                : '真实引擎：需求经服务端代理调用硅基流动 API（Key 仅存 .env，不进前端）'}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}