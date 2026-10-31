import Icon from './Icon'

const VIEW_META = {
  vibe: 'Vibe Coding Agent · 移动端',
  navigator: 'Conversation Navigator Agent · 对话导航',
}

export default function TopBar({ view, onBack }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        {view !== 'home' ? (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
          >
            <Icon name="back" size={14} />
            返回
          </button>
        ) : null}
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30">
            <Icon name="sparkles" size={16} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-wide text-white">AI Agent Lab</span>
            <span className="hidden text-xs text-zinc-500 sm:inline">AI 智能体实验室</span>
          </div>
        </div>
        {view !== 'home' ? (
          <div className="ml-2 hidden items-center gap-2 text-sm text-zinc-400 md:flex">
            <span className="text-zinc-700">/</span>
            <span className="text-zinc-200">{VIEW_META[view]}</span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          模拟环境 · 未接入真实 API
        </span>
        <div className="grid h-8 w-8 place-items-center rounded-full border border-zinc-700 bg-zinc-900 text-xs text-zinc-300">
          访
        </div>
      </div>
    </header>
  )
}
