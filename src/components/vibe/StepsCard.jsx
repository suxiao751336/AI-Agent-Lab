/* Agent 执行步骤卡片（聊天流内嵌）
 * 本地模拟引擎五阶段：需求分析 → 页面生成 → 素材生成 → 代码整合 → 预览验证
 * 真实模型引擎五阶段：需求分析 → 模型生成代码 → 解析与校验 → 更新项目 → 预览
 * status: pending / running / done / skipped / error
 * badge：'真实执行'（真实模型流程）/ '模拟执行'（本地规则流程）
 * 步骤定义见 data/visualProjects.js（STEP_DEFS / initSteps）与 VibeWorkbench.jsx（LLM_STEPS）
 */

function StepIcon({ status, index }) {
  if (status === 'done') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-emerald-500/50 bg-emerald-500/15 text-emerald-400">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-rose-500/50 bg-rose-500/15 text-rose-400">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-amber-400/50 bg-amber-400/10">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-400" />
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-zinc-700 bg-zinc-800 text-xs text-zinc-600">
        —
      </span>
    )
  }
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-[11px] text-zinc-600">
      {index + 1}
    </span>
  )
}

export default function StepsCard({ steps, badge = '模拟执行' }) {
  const done = steps.filter((s) => s.status === 'done').length
  const isReal = badge === '真实执行'
  return (
    <div className="fade-up ml-10 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">Agent 执行步骤</span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">
            {done}/{steps.length}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              isReal
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-zinc-700 bg-zinc-800 text-zinc-500'
            }`}
          >
            {badge}
          </span>
        </span>
      </div>
      <ol className="space-y-0.5">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5">
            <StepIcon status={s.status} index={i} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[13px] font-medium ${
                    s.status === 'pending'
                      ? 'text-zinc-600'
                      : s.status === 'error'
                        ? 'text-rose-300'
                        : 'text-zinc-200'
                  }`}
                >
                  {s.title}
                </span>
                {s.status === 'running' ? (
                  <span className="text-[10px] text-amber-400">进行中…</span>
                ) : null}
                {s.status === 'skipped' ? (
                  <span className="text-[10px] text-zinc-600">已跳过</span>
                ) : null}
                {s.status === 'error' ? (
                  <span className="text-[10px] text-rose-400">失败</span>
                ) : null}
              </div>
              {s.detail ? (
                <p
                  className={`mt-0.5 truncate text-[11px] ${
                    s.status === 'error' ? 'text-rose-400/80' : 'text-zinc-500'
                  }`}
                >
                  {s.detail}
                </p>
              ) : (
                <p className="mt-0.5 truncate text-[11px] text-zinc-700">{s.tip}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
