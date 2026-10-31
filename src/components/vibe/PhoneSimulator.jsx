import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon'

/* 手机模拟器：390×844 逻辑分辨率，等比例缩放（自适应 / 手动） */

const LOGICAL_W = 390
const LOGICAL_H = 844
const STATUS_H = 44

export default function PhoneSimulator({ doc, generating }) {
  const [nonce, setNonce] = useState(0)
  const [zoom, setZoom] = useState(null) // null = 自适应
  const [fit, setFit] = useState(0.75)
  const areaRef = useRef(null)

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      // 预留外壳描边(约10px)与呼吸空间
      const s = Math.min((r.height - 36) / LOGICAL_H, (r.width - 36) / (LOGICAL_W + 20), 1)
      setFit(Math.max(0.35, s))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = zoom ?? fit
  const stepZoom = (delta) => {
    setZoom((z) => {
      const base = z ?? fit
      return Math.min(1, Math.max(0.4, Math.round((base + delta) * 20) / 20))
    })
  }

  return (
    <section className="flex h-full w-[420px] min-w-[380px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      {/* 工具栏 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <span className="flex items-center gap-1.5 text-xs text-zinc-300">
          <Icon name="phone" size={13} className="text-indigo-400" />
          iPhone 模拟
        </span>
        <span className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
          {LOGICAL_W}×{LOGICAL_H}
        </span>
        <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
          模拟
        </span>

        <div className="ml-auto flex items-center gap-1">
          {generating ? (
            <span className="mr-1 flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[10px] text-indigo-300">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-indigo-400" />
              构建中
            </span>
          ) : null}
          <button
            onClick={() => stepZoom(-0.05)}
            title="缩小"
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
          >
            <span className="text-sm leading-none">−</span>
          </button>
          <span className="w-10 text-center font-mono text-[11px] text-zinc-400">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => stepZoom(0.05)}
            title="放大"
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
          >
            <span className="text-sm leading-none">＋</span>
          </button>
          <button
            onClick={() => setZoom(null)}
            title="自适应"
            className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
              zoom === null ? 'bg-zinc-800 text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            适应
          </button>
          <button
            onClick={() => setNonce((n) => n + 1)}
            title="刷新预览"
            className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </div>

      {/* 模拟器画布 */}
      <div
        ref={areaRef}
        className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-zinc-900/40"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(82,82,91,.25) 1px, transparent 0)',
          backgroundSize: '22px 22px',
        }}
      >
        <div
          className="relative"
          style={{ width: LOGICAL_W * scale, height: LOGICAL_H * scale }}
        >
          <div
            className="absolute left-0 top-0 overflow-hidden rounded-[48px] bg-black ring-[10px] ring-zinc-800"
            style={{
              width: LOGICAL_W,
              height: LOGICAL_H,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              boxShadow: '0 24px 60px rgba(0,0,0,.55)',
            }}
          >
            {/* 状态栏 */}
            <div
              className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-white/75 to-transparent px-7"
              style={{ height: STATUS_H }}
            >
              <span className="text-[13px] font-semibold text-zinc-800">9:41</span>
              <div className="flex items-center gap-1.5 text-zinc-800">
                {/* 信号 */}
                <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
                  <rect x="0" y="7" width="3" height="4" rx="0.5" />
                  <rect x="4.5" y="5" width="3" height="6" rx="0.5" />
                  <rect x="9" y="2.5" width="3" height="8.5" rx="0.5" />
                  <rect x="13.5" y="0" width="3" height="11" rx="0.5" />
                </svg>
                {/* WiFi */}
                <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M1.5 4A9 9 0 0 1 13.5 4" />
                  <path d="M4 6.8a5 5 0 0 1 7 0" />
                  <circle cx="7.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
                </svg>
                {/* 电池 */}
                <svg width="24" height="11" viewBox="0 0 24 11">
                  <rect x="0.5" y="0.5" width="20" height="10" rx="2.5" fill="none" stroke="currentColor" strokeOpacity=".45" />
                  <rect x="2" y="2" width="14" height="7" rx="1.5" fill="currentColor" />
                  <rect x="22" y="3.5" width="1.5" height="4" rx="0.5" fill="currentColor" fillOpacity=".45" />
                </svg>
              </div>
            </div>
            {/* 灵动岛 */}
            <div className="absolute left-1/2 top-[9px] z-20 h-[30px] w-[112px] -translate-x-1/2 rounded-full bg-black" />

            {/* 页面视口（状态栏以下）
                sandbox 不含 allow-modals：原生 alert/confirm/prompt 无法逃出模拟器，
                预览文档内的 DIALOG_SHIM 会将其替换为模拟器画面内的样式化弹窗 */}
            <iframe
              key={nonce}
              title="手机模拟器预览"
              srcDoc={doc}
              sandbox="allow-scripts"
              className="absolute border-0 bg-white"
              style={{ top: STATUS_H, left: 0, width: LOGICAL_W, height: LOGICAL_H - STATUS_H }}
            />

            {/* Home Indicator */}
            <div className="absolute bottom-[7px] left-1/2 z-10 h-[5px] w-[130px] -translate-x-1/2 rounded-full bg-zinc-500/70 backdrop-blur-sm" />
          </div>
        </div>
      </div>
    </section>
  )
}
