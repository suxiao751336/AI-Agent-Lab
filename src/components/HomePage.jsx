import Icon from './Icon'

const AGENTS = [
  {
    key: 'vibe',
    name: 'Vibe Coding Agent｜代码生成 + AI 视觉增强',
    desc: '通过自然语言生成或修改移动端页面，不仅支持真实代码生成，还能调用 AI 生图能力生成按钮、背景、插画等视觉素材，并直接落地为可交互界面。',
    tags: ['真实代码', 'AI 生图落地', '可交互界面'],
    icon: 'code',
    gradient: 'from-indigo-500 to-violet-500',
    glow: 'shadow-indigo-500/25',
  },
  {
    key: 'navigator',
    name: '对话导航 Agent｜长对话整理与回溯',
    desc: '自动整理长篇 AI 对话，生成话题目录与多媒体索引，并支持模糊语义回溯和原始消息精准定位。',
    tags: ['智能目录', '语义回溯', '精准定位'],
    icon: 'compass',
    gradient: 'from-sky-500 to-indigo-500',
    glow: 'shadow-sky-500/25',
  },
]

const FEATURES = [
  { icon: 'zap', title: '可直接体验', desc: '无需复杂配置，可直接进入 Demo。' },
  { icon: 'target', title: '真实能力验证', desc: '包含真实模型调用、Function Calling 与流式交互。' },
  { icon: 'list', title: '两个 Agent 场景', desc: '分别展示代码生成与长对话导航。' },
]

export default function HomePage({ onEnter }) {
  return (
    <div className="h-full overflow-y-auto">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-3xl" />
        <div className="relative mx-auto max-w-5xl px-6 pb-4 pt-16 text-center">
          <h1 className="text-2xl font-bold leading-snug text-white md:text-3xl">
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              AI Agent Lab
            </span>
            <span className="mx-2 text-zinc-600">｜</span>
            AI Agent 面试作业展示
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-zinc-400">
            这里包含两个可交互 Demo，分别展示多模态代码生成与长对话智能导航能力。
          </p>
        </div>
      </section>

      {/* Agent 卡片 */}
      <section className="mx-auto grid max-w-5xl gap-5 px-6 pb-10 md:grid-cols-2">
        {AGENTS.map((a) => (
          <button
            key={a.key}
            onClick={() => onEnter(a.key)}
            className={`glow-card group flex flex-col rounded-2xl p-6 text-left transition-transform hover:-translate-y-1 hover:shadow-2xl ${a.glow}`}
          >
            <div
              className={`grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${a.gradient} text-white shadow-lg ${a.glow}`}
            >
              <Icon name={a.icon} size={22} />
            </div>
            <h2 className="mt-5 text-lg font-semibold leading-snug text-white">{a.name}</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-zinc-400">{a.desc}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {a.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-400"
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-zinc-800/80 pt-4">
              <span className="text-sm font-medium text-indigo-300 transition-colors group-hover:text-indigo-200">
                进入演示
              </span>
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-500 transition-all group-hover:border-indigo-500/50 group-hover:text-indigo-300">
                <Icon name="arrowRight" size={14} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </button>
        ))}
      </section>

      {/* 特性 */}
      <section className="mx-auto max-w-5xl px-6 pb-14">
        <div className="grid gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-3 px-2">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-800 bg-zinc-900 text-indigo-400">
                <Icon name={f.icon} size={15} />
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-200">{f.title}</h3>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-zinc-600">AI Agent Lab｜AI Agent 面试作业展示</p>
      </section>
    </div>
  )
}
