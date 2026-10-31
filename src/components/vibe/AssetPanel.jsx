import { useState } from 'react'
import Icon from '../Icon'
import { ASSET_TYPES } from '../../data/visualAssets'

/* 视觉素材面板：AI 生成素材（Z-Image-Turbo 实时入库）+ 本地预置素材（模拟） */

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'illustration', label: '插画' },
  { key: 'background', label: '背景' },
  { key: 'button', label: '按钮' },
]

function AssetPreview({ asset }) {
  if (asset.type === 'illustration') {
    return <div className="scale-90" dangerouslySetInnerHTML={{ __html: asset.html }} />
  }
  if (asset.type === 'background') {
    return <div className="h-full w-full rounded-lg" style={asset.previewStyle} />
  }
  return (
    <button
      className="rounded-xl px-5 py-2 text-sm font-medium"
      style={asset.previewStyle}
      type="button"
    >
      {asset.previewLabel || '按钮'}
    </button>
  )
}

/* AI 生成素材卡片：真实图片缩略图 + 路径/尺寸/模型/大小/是否应用 */
function AiAssetCard({ a }) {
  return (
    <div className="fade-up overflow-hidden rounded-xl border border-fuchsia-500/40 bg-zinc-900/50">
      <div className="relative grid h-28 place-items-center overflow-hidden border-b border-zinc-800/80 bg-zinc-950/60 p-2">
        <img src={a.dataUrl} alt={a.name} className="max-h-full max-w-full object-contain" />
        {a.used ? (
          <span className="absolute left-2 top-2 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] text-fuchsia-300">
            已应用
          </span>
        ) : null}
        <span className="absolute right-2 top-2 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-medium text-white">
          AI
        </span>
      </div>
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{ASSET_TYPES[a.type]?.emoji || '🖼️'}</span>
          <span className="truncate text-xs font-medium text-zinc-200" title={`${a.name} · ${a.id}`}>
            {a.name}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={a.path}>
          {a.path} · {a.width}×{a.height}
        </p>
        <div className="mt-2 flex items-center justify-between">
          <span className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-300">
            {ASSET_TYPES[a.type]?.label || a.type || '素材'}
          </span>
          <span className="text-[10px] text-zinc-600" title={a.model || ''}>
            {Math.max(1, Math.round((a.sizeBytes || 0) / 1024))}KB
          </span>
        </div>
      </div>
    </div>
  )
}

export default function AssetPanel({ assets, aiAssets = [] }) {
  const [filter, setFilter] = useState('all')
  const [copiedId, setCopiedId] = useState(null)

  const list = filter === 'all' ? assets : assets.filter((a) => a.type === filter)
  const usedCount = assets.filter((a) => a.used).length

  const copyAsset = async (asset) => {
    const text = asset.type === 'illustration' ? asset.html : asset.css
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(asset.id)
      window.setTimeout(() => setCopiedId(null), 1500)
    } catch (err) {
      console.warn('复制失败：', err)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 面板头 */}
      <div className="shrink-0 border-b border-zinc-800/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="sparkles" size={13} className="text-fuchsia-400" />
          <span className="text-[13px] font-medium text-zinc-200">视觉素材工坊</span>
          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
            本地预置 + AI 生成
          </span>
          <span className="ml-auto text-[11px] text-zinc-500">{usedCount} 枚已应用</span>
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                filter === f.key
                  ? 'bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-fuchsia-500/40'
                  : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区：AI 生成素材 + 本地预置素材 */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* AI 生成素材（视觉增强：SSE 实时入库） */}
        {aiAssets.length ? (
          <div className="mb-5">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-[12px] font-medium text-zinc-300">AI 生成素材</span>
              <span className="rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-1.5 py-0.5 text-[9px] font-medium text-white">
                Z-Image-Turbo
              </span>
              <span className="ml-auto text-[11px] text-zinc-500">
                {aiAssets.length} 张 · {aiAssets.filter((a) => a.used).length} 张已应用
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {aiAssets.map((a) => (
                <AiAssetCard key={a.id} a={a} />
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-5 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-3 py-2.5 text-[11px] leading-5 text-zinc-600">
            开启「AI 视觉增强」并发起任务后，AI 生成的图片素材会实时出现在这里（每任务最多 2 张，导出 ZIP 含图片文件）
          </div>
        )}

        {/* 本地预置素材 */}
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-[12px] font-medium text-zinc-300">本地预置素材</span>
          <span className="ml-auto text-[11px] text-zinc-500">{list.length} 枚</span>
        </div>
        <div className="grid grid-cols-2 content-start gap-3 xl:grid-cols-3">
          {list.map((a) => (
            <div
              key={a.id}
              className={`group overflow-hidden rounded-xl border bg-zinc-900/50 transition-colors ${
                a.fresh ? 'fade-up border-fuchsia-500/50' : 'border-zinc-800'
              }`}
            >
              <div className="relative grid h-28 place-items-center overflow-hidden border-b border-zinc-800/80 bg-zinc-950/60 p-2">
                <AssetPreview asset={a} />
                {a.used ? (
                  <span className="absolute left-2 top-2 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] text-fuchsia-300">
                    已应用
                  </span>
                ) : null}
                {a.fresh ? (
                  <span className="absolute right-2 top-2 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-medium text-white">
                    NEW
                  </span>
                ) : null}
              </div>
              <div className="p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">{ASSET_TYPES[a.type].emoji}</span>
                  <span className="truncate text-xs font-medium text-zinc-200">{a.name}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{a.desc}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {ASSET_TYPES[a.type].label}
                  </span>
                  <button
                    onClick={() => copyAsset(a)}
                    className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-fuchsia-500/50 hover:text-white"
                  >
                    <Icon name={copiedId === a.id ? 'check' : 'copy'} size={11} />
                    {copiedId === a.id ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 底部说明 */}
      <div className="shrink-0 border-t border-zinc-800/80 px-4 py-2.5 text-[11px] leading-5 text-zinc-600">
        本地预置素材可复制 CSS/SVG 源码 · AI 素材由 Z-Image-Turbo 生成（任务中实时入库，以相对路径 assets/
        引用，导出 ZIP 含独立图片文件）
      </div>
    </div>
  )
}
