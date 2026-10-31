import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'
import AssetPanel from './AssetPanel'
import { highlight, langOf } from '../../utils/highlight'

const FILE_META = {
  html: { name: 'index.html', dot: 'bg-orange-400' },
  css: { name: 'style.css', dot: 'bg-sky-400' },
  js: { name: 'app.js', dot: 'bg-yellow-400' },
  assets: { name: '素材库', dot: 'bg-fuchsia-400' },
}

export default function CodePanel({
  files,
  activeFile,
  onActiveChange,
  generating,
  onRun,
  onExport,
  onFileChange,
  assets,
  aiAssets = [],
}) {
  const [editing, setEditing] = useState(false)
  const scrollRef = useRef(null)
  const isAssets = activeFile === 'assets'
  const code = !isAssets ? files[activeFile] ?? '' : ''
  const lineCount = code ? code.split('\n').length : 0

  useEffect(() => {
    if (generating && scrollRef.current && !isAssets) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [code, generating, isAssets])

  const canEdit = !generating && !isAssets

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-[#0c0c11]">
      {/* 文件标签栏 */}
      <div className="flex h-11 shrink-0 items-center border-b border-zinc-800 bg-zinc-950/60 pl-2">
        <div className="flex h-full items-end gap-1 overflow-x-auto">
          {Object.keys(FILE_META).map((key) => {
            const meta = FILE_META[key]
            const active = activeFile === key
            return (
              <button
                key={key}
                onClick={() => {
                  onActiveChange(key)
                  if (key !== 'assets') setEditing(false)
                }}
                className={`flex h-full items-center gap-2 rounded-t-lg border-b-2 px-3.5 text-[13px] transition-colors ${
                  active
                    ? 'border-indigo-500 bg-[#0c0c11] text-zinc-100'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${meta.dot} ${active ? '' : 'opacity-50'}`} />
                {meta.name}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 pr-3">
          {generating ? (
            <span className="flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] text-indigo-300">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-indigo-400" />
              生成中
            </span>
          ) : null}
          {!isAssets ? (
            <button
              onClick={() => canEdit && setEditing((v) => !v)}
              disabled={!canEdit}
              title={editing ? '退出编辑' : '编辑代码'}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                editing
                  ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon name="pencil" size={12} />
              {editing ? '编辑中' : '编辑'}
            </button>
          ) : null}
          <button
            onClick={onExport}
            disabled={generating}
            title="导出 ZIP（代码 + 素材 + README，与预览一致）"
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-indigo-500/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="download" size={12} />
            导出 ZIP
          </button>
          <button
            onClick={onRun}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="play" size={11} />
            运行
          </button>
        </div>
      </div>

      {/* 内容区：代码 / 素材 */}
      {isAssets ? (
        <div className="min-h-0 flex-1">
          <AssetPanel assets={assets} aiAssets={aiAssets} />
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {editing ? (
            <textarea
              value={code}
              spellCheck={false}
              onChange={(e) => onFileChange(activeFile, e.target.value)}
              className="h-full min-h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-6 text-zinc-200 caret-indigo-400 focus:outline-none"
            />
          ) : (
            <div className="flex min-h-full p-4">
              <div className="sticky left-0 select-none pr-4 text-right font-mono text-[13px] leading-6 text-zinc-700">
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre className="flex-1 whitespace-pre font-mono text-[13px] leading-6 text-zinc-300">
                <code dangerouslySetInnerHTML={{ __html: highlight(code, langOf(activeFile)) }} />
                {generating ? <span className="caret text-indigo-400">▍</span> : null}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 状态栏 */}
      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-800 bg-zinc-950/60 px-4 text-[11px] text-zinc-500">
        {isAssets ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400" />
              素材库
            </span>
            <span>{assets.length} 枚素材</span>
            <span>{assets.filter((a) => a.used).length} 枚已应用</span>
            {aiAssets.length ? (
              <span>
                {aiAssets.length} 张 AI 素材 · {aiAssets.filter((a) => a.used).length} 张已应用
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${FILE_META[activeFile].dot}`} />
              {FILE_META[activeFile].name}
            </span>
            <span>{lineCount} 行</span>
            <span>UTF-8</span>
            <span className="ml-auto uppercase">{langOf(activeFile)}</span>
          </>
        )}
      </div>
    </section>
  )
}
