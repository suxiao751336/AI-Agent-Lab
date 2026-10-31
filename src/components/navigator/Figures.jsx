/* ============================================================
 * Conversation Navigator Agent · 图片占位资源与图表演示组件
 * ------------------------------------------------------------
 * 全部为内联 SVG 绘制（本地演示，不依赖外部图片与付费 API）：
 * - ImageFigure：图片占位插画（水滴 Logo / 旅行 Hero / 设计稿 / 图标集）
 * - ChartFigure ：图表演示组件（bar / line / donut）
 * - MediaThumb  ：左栏索引的小尺寸缩略图
 * ============================================================ */

const W = 320
const H = 180

function FigureCard({ children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img">
        {children}
      </svg>
    </div>
  )
}

/* ---------- 图片占位插画 ---------- */

function BlueDropFigure() {
  return (
    <FigureCard>
      <defs>
        <linearGradient id="fd-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0b1220" />
          <stop offset="100%" stopColor="#0e1c33" />
        </linearGradient>
        <linearGradient id="fd-drop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="55%" stopColor="#2f9bff" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#fd-bg)" />
      <circle cx="46" cy="36" r="20" fill="#38bdf8" opacity="0.08" />
      <circle cx="284" cy="132" r="34" fill="#38bdf8" opacity="0.06" />
      {/* 涟漪 */}
      <ellipse cx="160" cy="132" rx="52" ry="10" fill="none" stroke="#38bdf8" strokeOpacity="0.35" strokeWidth="1.4" />
      <ellipse cx="160" cy="132" rx="76" ry="14" fill="none" stroke="#38bdf8" strokeOpacity="0.16" strokeWidth="1" />
      {/* 水滴主体 */}
      <path
        d="M160 38 C160 38 122 88 122 112 a38 38 0 0 0 76 0 C198 88 160 38 160 38 Z"
        fill="url(#fd-drop)"
      />
      {/* 月牙高光 */}
      <path
        d="M142 96 a26 26 0 0 1 22 -26 c-8 12 -10 24 -8 32 c-6 -1 -11 -3 -14 -6 Z"
        fill="#ffffff"
        opacity="0.45"
      />
      <ellipse cx="184" cy="118" rx="7" ry="4" fill="#ffffff" opacity="0.28" />
      {/* Wordmark */}
      <text x="160" y="164" textAnchor="middle" fontSize="15" fill="#7dd3fc" fontFamily="sans-serif" fontWeight="600" letterSpacing="2">
        TravelMate
      </text>
    </FigureCard>
  )
}

function TravelHeroFigure() {
  return (
    <FigureCard>
      <defs>
        <linearGradient id="fh-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#071a2e" />
          <stop offset="100%" stopColor="#0b3050" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#fh-bg)" />
      {/* 星星 */}
      <circle cx="30" cy="24" r="1.3" fill="#bae6fd" opacity="0.8" />
      <circle cx="72" cy="40" r="1" fill="#bae6fd" opacity="0.6" />
      <circle cx="250" cy="22" r="1.2" fill="#bae6fd" opacity="0.7" />
      <circle cx="212" cy="52" r="0.9" fill="#bae6fd" opacity="0.5" />
      {/* 太阳 */}
      <circle cx="268" cy="44" r="17" fill="#fbbf24" opacity="0.9" />
      <circle cx="268" cy="44" r="26" fill="#fbbf24" opacity="0.15" />
      {/* 航线（虚线） */}
      <path
        d="M38 150 C90 148 120 112 176 96 C212 86 244 66 262 52"
        fill="none"
        stroke="#7dd3fc"
        strokeWidth="1.6"
        strokeDasharray="5 6"
        opacity="0.85"
      />
      {/* 飞机（水滴吊舱造型） */}
      <g transform="translate(176 96)">
        <path d="M-9 -4 C-9 -4 -15 3 -15 6 a10 10 0 0 0 20 0 C5 3 -9 -4 -9 -4 Z" fill="#38bdf8" transform="rotate(38)" />
        <path d="M-2 2 L10 7" stroke="#7dd3fc" strokeWidth="1.6" strokeLinecap="round" transform="rotate(38)" />
      </g>
      {/* 终点定位 */}
      <g transform="translate(262 52)">
        <circle r="7" fill="none" stroke="#fbbf24" strokeWidth="1.4" opacity="0.8" />
        <circle r="2.4" fill="#fbbf24" />
      </g>
      {/* 远山 */}
      <path d="M0 150 L64 92 L104 128 L140 102 L196 150 Z" fill="#0f3a5f" />
      {/* 近山 */}
      <path d="M120 150 L184 96 L232 138 L268 116 L320 150 L320 180 L0 180 L0 150 Z" fill="#123f6b" />
      {/* 前景波纹 */}
      <path d="M0 164 Q40 156 80 164 T160 164 T240 164 T320 164" fill="none" stroke="#38bdf8" strokeWidth="1.2" opacity="0.5" />
      <path d="M0 172 Q40 166 80 172 T160 172 T240 172 T320 172" fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.3" />
      {/* 文案 */}
      <text x="16" y="34" fontSize="12" fill="#e0f2fe" fontFamily="sans-serif" fontWeight="600">
        下一次出发，从一份行程开始
      </text>
    </FigureCard>
  )
}

function HomeMockupFigure() {
  return (
    <FigureCard>
      <rect width={W} height={H} fill="#0d1420" />
      {/* 标注线 */}
      <g stroke="#64748b" strokeWidth="0.8" strokeDasharray="3 3">
        <line x1="8" y1="34" x2="112" y2="34" />
        <line x1="8" y1="78" x2="112" y2="78" />
        <line x1="8" y1="150" x2="112" y2="150" />
      </g>
      <text x="10" y="28" fontSize="8" fill="#94a3b8" fontFamily="sans-serif">Hero · 目的地推荐</text>
      <text x="10" y="72" fontSize="8" fill="#94a3b8" fontFamily="sans-serif">「即将出发」行程卡</text>
      <text x="10" y="144" fontSize="8" fill="#94a3b8" fontFamily="sans-serif">AI 生成入口 · 水滴悬浮</text>
      <text x="10" y="172" fontSize="8" fill="#94a3b8" fontFamily="sans-serif">底部五 Tab</text>
      {/* 手机 */}
      <rect x="118" y="14" width="86" height="152" rx="13" fill="#f5f9ff" stroke="#334155" strokeWidth="2" />
      <line x1="148" y1="20" x2="174" y2="20" stroke="#334155" strokeWidth="2" />
      {/* 状态栏 */}
      <circle cx="126" cy="26" r="1.6" fill="#94a3b8" />
      <rect x="132" y="24.6" width="26" height="3" rx="1.5" fill="#cbd5e1" />
      <rect x="190" y="24" width="8" height="4" rx="1" fill="#94a3b8" />
      {/* Hero */}
      <rect x="126" y="34" width="70" height="34" rx="6" fill="#2f9bff" />
      <path d="M150 60 l8 -10 l7 6 l9 -12 l6 16 Z" fill="#e0f2fe" opacity="0.85" />
      <circle cx="186" cy="42" r="4.5" fill="#fbbf24" />
      {/* 行程卡 */}
      <rect x="126" y="76" width="70" height="22" rx="5" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.8" />
      <rect x="129" y="79" width="10" height="10" rx="2.5" fill="#93c5fd" />
      <rect x="143" y="80" width="30" height="6" rx="3" fill="#17324d" opacity="0.9" />
      <rect x="143" y="89" width="44" height="5" rx="2.5" fill="#cbd5e1" />
      {/* 列表两行 */}
      <rect x="126" y="103" width="70" height="13" rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.6" />
      <rect x="126" y="119" width="70" height="13" rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.6" />
      {/* AI 悬浮按钮 */}
      <circle cx="188" cy="140" r="9" fill="#1f6feb" />
      <path d="M188 135 c0 0 -3.5 4.4 -3.5 6.2 a3.5 3.5 0 0 0 7 0 c0 -1.8 -3.5 -6.2 -3.5 -6.2 Z" fill="#e0f2fe" />
      {/* 底部 Tab */}
      <line x1="126" y1="146" x2="196" y2="146" stroke="#e2e8f0" strokeWidth="1" />
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx={134 + i * 15.5} cy="155" r="3.4" fill={i === 0 ? '#2f9bff' : '#94a3b8'} />
      ))}
    </FigureCard>
  )
}

function IconSetFigure() {
  const stroke = '#93c5fd'
  const accent = '#38bdf8'
  const icons = [
    /* 日历 */
    <g key="cal" stroke={stroke} fill="none" strokeWidth="1.6" strokeLinecap="round">
      <rect x="1.2" y="0" width="18" height="17" rx="3" />
      <line x1="1.2" y1="5" x2="19.2" y2="5" />
      <line x1="5" y1="-2.5" x2="5" y2="0" />
      <line x1="15" y1="-2.5" x2="15" y2="0" />
      <rect x="5" y="9" width="3.4" height="3.4" rx="0.8" fill={accent} stroke="none" />
    </g>,
    /* 定位 */
    <g key="pin" stroke={stroke} fill="none" strokeWidth="1.6" strokeLinecap="round">
      <path d="M10 1.5 c-3.6 0 -6 2.6 -6 5.8 c0 4.2 6 9.7 6 9.7 s6 -5.5 6 -9.7 c0 -3.2 -2.4 -5.8 -6 -5.8 Z" />
      <circle cx="10" cy="7" r="2.2" fill={accent} stroke="none" />
    </g>,
    /* 行李箱 */
    <g key="case" stroke={stroke} fill="none" strokeWidth="1.6" strokeLinecap="round">
      <rect x="4.5" y="3" width="11" height="14" rx="2.6" />
      <path d="M8.5 3 v-1.6 h3 v1.6" />
      <line x1="8.2" y1="6.5" x2="8.2" y2="13.5" />
      <line x1="11.8" y1="6.5" x2="11.8" y2="13.5" />
    </g>,
    /* 钱包 */
    <g key="wallet" stroke={stroke} fill="none" strokeWidth="1.6" strokeLinecap="round">
      <rect x="2.6" y="3.4" width="14.8" height="12.4" rx="2.8" />
      <path d="M2.6 8 h14.8" />
      <circle cx="13.6" cy="11.6" r="1.3" fill={accent} stroke="none" />
    </g>,
    /* 清单 */
    <g key="list" stroke={stroke} fill="none" strokeWidth="1.6" strokeLinecap="round">
      <line x1="7" y1="4.5" x2="16.4" y2="4.5" />
      <line x1="7" y1="9.6" x2="16.4" y2="9.6" />
      <line x1="7" y1="14.7" x2="13" y2="14.7" />
      <path d="M2.6 3.6 l1.5 1.6 l2.6 -3" />
      <path d="M2.6 14 l1.5 1.6 l2.6 -3" />
      <circle cx="4.4" cy="9.6" r="1" fill={accent} stroke="none" />
    </g>,
    /* 相机 */
    <g key="cam" stroke={stroke} fill="none" strokeWidth="1.6" strokeLinecap="round">
      <rect x="2.2" y="4.6" width="15.6" height="11" rx="2.6" />
      <path d="M7.4 4.6 l1.2 -2 h2.8 l1.2 2" />
      <circle cx="10" cy="10" r="3.2" />
      <circle cx="15.4" cy="7" r="0.9" fill={accent} stroke="none" />
    </g>,
  ]
  const cols = 3
  return (
    <FigureCard>
      <rect width={W} height={H} fill="#0b1526" />
      {icons.map((icon, i) => {
        const cx = 52 + (i % cols) * 88
        const cy = 40 + Math.floor(i / cols) * 74
        return (
          <g key={i} transform={`translate(${cx} ${cy})`}>
            <rect x="-30" y="-22" width="60" height="56" rx="12" fill="#12233d" stroke="#1e3a5f" strokeWidth="1" />
            <g transform="translate(-10 -8.5)">{icon}</g>
          </g>
        )
      })}
      <text x="160" y="170" textAnchor="middle" fontSize="10" fill="#7dd3fc" fontFamily="sans-serif">
        24px · 2px 圆头描边 · 选中态加底部圆点
      </text>
    </FigureCard>
  )
}

const IMAGE_FIGURES = {
  blueDrop: BlueDropFigure,
  travelHero: TravelHeroFigure,
  homeMockup: HomeMockupFigure,
  iconSet: IconSetFigure,
}

export function ImageFigure({ variant }) {
  const Fig = IMAGE_FIGURES[variant]
  return Fig ? <Fig /> : null
}

/* ---------- 图表演示组件 ---------- */

function BarChart({ data }) {
  const items = data.items ?? []
  const max = data.max ?? Math.max(...items.map((i) => i.value), 1)
  return (
    <FigureCard>
      <rect width={W} height={H} fill="#0c1220" />
      <text x="14" y="20" fontSize="10" fill="#a5b4fc" fontFamily="sans-serif">
        {data.unit ?? ''}（满分 {max}）
      </text>
      {items.map((it, i) => {
        const y = 34 + i * 21
        const barW = Math.max((it.value / max) * 196, 8)
        const hot = it.value >= 8.5
        const valueX = 98 + barW + 6
        return (
          <g key={it.label}>
            <text x="14" y={y + 10} fontSize="9" fill="#8b9bb4" fontFamily="sans-serif">
              {it.label}
            </text>
            <rect x="98" y={y} width="196" height="12" rx="6" fill="#1b2740" />
            <rect
              x="98"
              y={y}
              width={barW}
              height="12"
              rx="6"
              fill={hot ? '#818cf8' : '#38bdf8'}
              opacity={hot ? 1 : 0.75}
            />
            <text x={valueX} y={y + 9.5} fontSize="9" fontFamily="sans-serif" fontWeight="600" fill={hot ? '#c7d2fe' : '#94a3b8'}>
              {it.value}
            </text>
          </g>
        )
      })}
    </FigureCard>
  )
}

function LineChart({ data }) {
  const points = data.points ?? []
  const max = data.max ?? 40
  const w = W - 40
  const h = 110
  const x0 = 30
  const y0 = 34
  const xs = (i) => x0 + (i / Math.max(points.length - 1, 1)) * w
  const ys = (v) => y0 + h - (v / max) * h
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)} ${ys(p.value).toFixed(1)}`).join(' ')
  const area = `${line} L${xs(points.length - 1)} ${y0 + h} L${xs(0)} ${y0 + h} Z`
  const thresholdY = ys(15)
  const spikeIdx = points.findIndex((p) => p.value === Math.max(...points.map((q) => q.value)))
  return (
    <FigureCard>
      <defs>
        <linearGradient id="lc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#0c1220" />
      {/* 网格 */}
      {[0, 10, 20, 30, 40].map((v) => (
        <g key={v}>
          <line x1={x0} y1={ys(v)} x2={x0 + w} y2={ys(v)} stroke="#1b2740" strokeWidth="0.8" />
          <text x="6" y={ys(v) + 3} fontSize="8" fill="#64748b" fontFamily="sans-serif">
            {v}
          </text>
        </g>
      ))}
      {/* 15s 超时阈值 */}
      <line x1={x0} y1={thresholdY} x2={x0 + w} y2={thresholdY} stroke="#f87171" strokeWidth="1" strokeDasharray="4 4" opacity="0.8" />
      <text x={x0 + 4} y={thresholdY - 4} fontSize="8" fill="#f87171" fontFamily="sans-serif">
        15s 超时阈值
      </text>
      <path d={area} fill="url(#lc-area)" />
      <path d={line} fill="none" stroke="#818cf8" strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={i} cx={xs(i)} cy={ys(p.value)} r={i === spikeIdx ? 3.4 : 2.2} fill={i === spikeIdx ? '#f87171' : '#c7d2fe'} />
      ))}
      {spikeIdx >= 0 ? (
        <text x={Math.min(xs(spikeIdx) + 6, W - 60)} y={ys(points[spikeIdx].value) - 6} fontSize="9" fill="#f87171" fontFamily="sans-serif" fontWeight="600">
          {points[spikeIdx].value}s · 超时
        </text>
      ) : null}
      {points.map((p, i) =>
        i % 3 === 0 || i === points.length - 1 ? (
          <text key={i} x={xs(i)} y={y0 + h + 14} fontSize="8" fill="#64748b" textAnchor="middle" fontFamily="sans-serif">
            {p.label}
          </text>
        ) : null,
      )}
      <text x={x0 + w} y={y0 - 12} fontSize="9" fill="#a5b4fc" textAnchor="end" fontFamily="sans-serif">
        响应耗时（{data.unit}）
      </text>
    </FigureCard>
  )
}

function DonutChart({ data }) {
  const items = data.items ?? []
  const total = items.reduce((n, i) => n + i.value, 0) || 1
  const cx = 86
  const cy = 90
  const r = 48
  const C = 2 * Math.PI * r
  /* 组件体内预计算每段的弧长与偏移，渲染时纯读取 */
  const segs = []
  let acc = 0
  for (const it of items) {
    const len = (it.value / total) * C
    segs.push({ label: it.label, color: it.color, len, offset: -acc })
    acc += len
  }
  return (
    <FigureCard>
      <rect width={W} height={H} fill="#0c1220" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1b2740" strokeWidth="20" />
      {segs.map((seg) => (
        <circle
          key={seg.label}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={seg.color}
          strokeWidth="20"
          strokeDasharray={`${seg.len.toFixed(2)} ${(C - seg.len).toFixed(2)}`}
          strokeDashoffset={seg.offset.toFixed(2)}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fill="#e4e4e7" fontWeight="700" fontFamily="sans-serif">
        {data.center}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="#8b9bb4" fontFamily="sans-serif">
        月度估算
      </text>
      {items.map((it, i) => (
        <g key={it.label} transform={`translate(168 ${46 + i * 26})`}>
          <rect x="0" y="0" width="9" height="9" rx="2.5" fill={it.color} />
          <text x="16" y="7.5" fontSize="10" fill="#cbd5e1" fontFamily="sans-serif">
            {it.label}
          </text>
          <text x="16" y="19" fontSize="8.5" fill="#8b9bb4" fontFamily="sans-serif">
            ¥{it.value} · {Math.round((it.value / total) * 100)}%
          </text>
        </g>
      ))}
    </FigureCard>
  )
}

const CHART_FIGURES = {
  bar: BarChart,
  line: LineChart,
  donut: DonutChart,
}

export function ChartFigure({ kind, data }) {
  const Fig = CHART_FIGURES[kind]
  return Fig ? <Fig data={data} /> : null
}

/* ---------- 左栏索引缩略图 ---------- */

export function MediaThumb({ type, variant, kind }) {
  if (type === 'image') {
    const mini = {
      blueDrop: (
        <>
          <rect width="48" height="48" fill="#0b1220" />
          <path d="M24 8 C24 8 12 24 12 31 a12 12 0 0 0 24 0 C36 24 24 8 24 8 Z" fill="#2f9bff" />
          <path d="M18 28 a8 8 0 0 1 7 -8 c-2.6 4 -3.2 7 -2.6 9.6 c-2 -0.6 -3.6 -0.8 -4.4 -1.6 Z" fill="#fff" opacity="0.45" />
        </>
      ),
      travelHero: (
        <>
          <rect width="48" height="48" fill="#071a2e" />
          <circle cx="38" cy="10" r="5" fill="#fbbf24" />
          <path d="M0 34 L14 20 L24 30 L34 18 L48 34 Z" fill="#123f6b" />
          <path d="M6 24 C16 22 26 16 40 10" fill="none" stroke="#7dd3fc" strokeWidth="1.2" strokeDasharray="3 3" />
        </>
      ),
      homeMockup: (
        <>
          <rect width="48" height="48" fill="#0d1420" />
          <rect x="15" y="5" width="18" height="38" rx="4" fill="#f5f9ff" />
          <rect x="18" y="9" width="12" height="8" rx="1.6" fill="#2f9bff" />
          <rect x="18" y="20" width="12" height="4" rx="1.2" fill="#cbd5e1" />
          <rect x="18" y="26" width="12" height="4" rx="1.2" fill="#cbd5e1" />
          <circle cx="29" cy="36" r="3.4" fill="#1f6feb" />
        </>
      ),
      iconSet: (
        <>
          <rect width="48" height="48" fill="#0b1526" />
          <rect x="6" y="6" width="16" height="16" rx="4" fill="#12233d" />
          <rect x="26" y="6" width="16" height="16" rx="4" fill="#12233d" />
          <rect x="6" y="26" width="16" height="16" rx="4" fill="#12233d" />
          <rect x="26" y="26" width="16" height="16" rx="4" fill="#12233d" />
          <path d="M10 14 h8 M10 18 h5" stroke="#93c5fd" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="34" cy="14" r="3.4" fill="none" stroke="#93c5fd" strokeWidth="1.4" />
          <rect x="9.6" y="31" width="9" height="7" rx="1.6" fill="none" stroke="#93c5fd" strokeWidth="1.4" />
          <circle cx="34" cy="34" r="4.6" fill="none" stroke="#93c5fd" strokeWidth="1.4" />
        </>
      ),
    }
    return (
      <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0 rounded-lg">
        {mini[variant] ?? <rect width="48" height="48" fill="#1b2740" />}
      </svg>
    )
  }
  /* chart 缩略图：按 kind 画迷你示意 */
  const miniChart = {
    bar: (
      <>
        {[26, 38, 18, 32].map((h, i) => (
          <rect key={i} x={8 + i * 9} y={44 - h} width="5.5" height={h} rx="2.5" fill={i === 1 ? '#818cf8' : '#38bdf8'} opacity={i === 1 ? 1 : 0.7} />
        ))}
      </>
    ),
    line: (
      <path d="M6 36 L16 28 L24 32 L32 12 L42 20" fill="none" stroke="#818cf8" strokeWidth="2.4" strokeLinecap="round" />
    ),
    donut: (
      <>
        <circle cx="24" cy="24" r="15" fill="none" stroke="#1b2740" strokeWidth="6" />
        <circle cx="24" cy="24" r="15" fill="none" stroke="#818cf8" strokeWidth="6" strokeDasharray="48 46" transform="rotate(-90 24 24)" />
        <circle cx="24" cy="24" r="15" fill="none" stroke="#22d3ee" strokeWidth="6" strokeDasharray="14 80" strokeDashoffset="-48" transform="rotate(-90 24 24)" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0 rounded-lg">
      <rect width="48" height="48" fill="#0c1220" />
      {miniChart[kind] ?? <rect width="48" height="48" fill="#1b2740" />}
    </svg>
  )
}
