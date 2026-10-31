/* ============================================================
 * Conversation Navigator Agent · 中栏：聊天首页（未打开会话）
 * ------------------------------------------------------------
 * 首次进入 / 新建聊天时的空白首页：
 * - 主标题「让每一次 AI 对话都有迹可循」（弱化装饰）
 * - 视觉焦点：TravelMate 演示案例体验卡片（醒目大按钮，
 *   调用与左侧入口相同的示例加载逻辑）
 * - 输入框保留在卡片下方：「或者开始自己的 AI 对话」
 * ============================================================ */

import Icon from '../Icon'
import ChatComposer from './ChatComposer'

/* 案例能力标签（与示例数据实际内容一致） */
const CASE_CHIPS = [
  { icon: 'messageSquare', label: '92 条消息' },
  { icon: 'list', label: '智能话题目录' },
  { icon: 'image', label: '图片 / 图表索引' },
  { icon: 'code', label: '代码片段索引' },
]

export default function ChatHome({ onSend, onOpenDemo }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0b0b10]">
      {/* 顶部栏 */}
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-zinc-800 px-4">
        <Icon name="compass" size={14} className="text-indigo-400" />
        <span className="text-sm font-medium text-zinc-100">AI 对话</span>
        <span className="ml-auto text-[10px] text-zinc-600">尚未打开会话</span>
      </div>

      {/* 居中内容区 */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <div className="flex w-full max-w-2xl flex-col items-center">
          {/* 主标题（缩小装饰，让示例卡片成为焦点） */}
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-md shadow-indigo-950/40">
            <Icon name="compass" size={20} />
          </div>
          <h1 className="mt-3 bg-gradient-to-r from-sky-300 via-indigo-300 to-fuchsia-300 bg-clip-text text-center text-xl font-semibold text-transparent">
            让每一次 AI 对话都有迹可循
          </h1>
          <p className="mt-1.5 text-center text-xs text-zinc-500">
            话题目录 · 媒体与代码索引 · 自然语言回溯
          </p>

          {/* 示例体验卡片：首页视觉焦点 */}
          <div className="mt-7 w-full rounded-2xl border border-indigo-500/30 bg-gradient-to-b from-indigo-500/[0.08] to-zinc-900/40 p-5 shadow-lg shadow-indigo-950/20">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-medium text-indigo-300">
              <Icon name="sparkles" size={10} />
              演示案例 · 无需准备
            </span>
            <h2 className="mt-3 text-base font-semibold text-zinc-100">
              打开 TravelMate 长对话案例
            </h2>
            <p className="mt-1.5 text-[12px] leading-5 text-zinc-500">
              92 条消息、智能话题目录、图片/图表和代码索引——点击任意话题，
              精准定位到原始消息并高亮回溯。
            </p>

            {/* 案例能力标签 */}
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {CASE_CHIPS.map((c) => (
                <span
                  key={c.label}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[11px] text-zinc-300"
                >
                  <Icon name={c.icon} size={11} className="shrink-0 text-indigo-400" />
                  {c.label}
                </span>
              ))}
            </div>

            {/* 大尺寸体验按钮 */}
            <button
              onClick={onOpenDemo}
              className="mt-4.5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-950/40 transition-opacity hover:opacity-90"
            >
              <Icon name="sparkles" size={15} />
              立即体验智能导航
            </button>
          </div>

          {/* 分隔提示：自有对话入口 */}
          <div className="mt-7 flex w-full items-center gap-3">
            <span className="h-px flex-1 bg-zinc-800/80" />
            <span className="text-[11px] text-zinc-600">或者开始自己的 AI 对话</span>
            <span className="h-px flex-1 bg-zinc-800/80" />
          </div>

          {/* 首页输入框：发送第一条消息即创建新会话 */}
          <div className="mt-3 w-full">
            <ChatComposer
              floating
              placeholder="输入消息，开始一段新的对话……"
              onSend={onSend}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
