/* 视觉素材库（本地模拟数据，未接入真实图像生成 API）
 * 素材分三类：illustration 插画 / background 背景 / button 按钮
 * css 字段：视觉增强生成时注入到页面 style.css 末尾
 * html 字段：插画类素材，注入到页面 SLOT:HERO 插槽
 * previewStyle：素材面板预览用的内联样式
 */

export const ASSET_TYPES = {
  illustration: { label: '插画', emoji: '🖼️' },
  background: { label: '背景', emoji: '🎨' },
  button: { label: '按钮', emoji: '🔘' },
}

const HERO_CSS = `/* ── 素材注入：Hero 插画样式 ── */
.hero-visual { text-align: center; padding: 2px 0 4px; animation: heroFloat 3.2s ease-in-out infinite; }
@keyframes heroFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }`

export const ASSET_LIBRARY = [
  /* ---------- 插画 ---------- */
  {
    id: 'illu-coffee',
    type: 'illustration',
    name: '咖啡时光',
    desc: '渐变咖啡杯 · 悬浮动效',
    css: HERO_CSS,
    html: `<section class="hero-visual">
  <svg viewBox="0 0 220 130" width="150" height="89" fill="none">
    <ellipse cx="110" cy="112" rx="62" ry="9" fill="rgba(168,85,247,.2)"></ellipse>
    <path d="M72 50h76v34a28 28 0 0 1-28 28h-20a28 28 0 0 1-28-28Z" fill="url(#gCoffee)"></path>
    <path d="M148 58h8a15 15 0 0 1 0 30h-8" stroke="url(#gCoffee)" stroke-width="7"></path>
    <path d="M95 34c0-9 9-9 9-18M113 34c0-9 9-9 9-18" stroke="#c4b5fd" stroke-width="4.5" stroke-linecap="round"></path>
    <defs>
      <linearGradient id="gCoffee" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#818cf8"></stop>
        <stop offset="1" stop-color="#e879f9"></stop>
      </linearGradient>
    </defs>
  </svg>
</section>`,
  },
  {
    id: 'illu-dumbbell',
    type: 'illustration',
    name: '活力哑铃',
    desc: '蓝绿渐变 · 运动主题',
    css: HERO_CSS,
    html: `<section class="hero-visual">
  <svg viewBox="0 0 220 130" width="150" height="89" fill="none">
    <ellipse cx="110" cy="112" rx="62" ry="9" fill="rgba(56,189,248,.2)"></ellipse>
    <rect x="88" y="58" width="44" height="12" rx="6" fill="url(#gFit)"></rect>
    <rect x="70" y="44" width="16" height="40" rx="6" fill="url(#gFit)"></rect>
    <rect x="134" y="44" width="16" height="40" rx="6" fill="url(#gFit)"></rect>
    <rect x="56" y="52" width="10" height="24" rx="5" fill="#7dd3fc"></rect>
    <rect x="154" y="52" width="10" height="24" rx="5" fill="#7dd3fc"></rect>
    <path d="M96 34l10-10M124 24l10 10" stroke="#7dd3fc" stroke-width="4" stroke-linecap="round"></path>
    <defs>
      <linearGradient id="gFit" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#38bdf8"></stop>
        <stop offset="1" stop-color="#34d399"></stop>
      </linearGradient>
    </defs>
  </svg>
</section>`,
  },
  {
    id: 'illu-rocket',
    type: 'illustration',
    name: '启程火箭',
    desc: '暖橙渐变 · 通用场景',
    css: HERO_CSS,
    html: `<section class="hero-visual">
  <svg viewBox="0 0 220 130" width="150" height="89" fill="none">
    <ellipse cx="110" cy="112" rx="62" ry="9" fill="rgba(251,146,60,.2)"></ellipse>
    <path d="M110 22c16 10 22 28 22 48l-8 12h-28l-8-12c0-20 6-38 22-48Z" fill="url(#gRocket)"></path>
    <circle cx="110" cy="52" r="9" fill="#fff7ed" stroke="#fb923c" stroke-width="3"></circle>
    <path d="M96 82l-14 16 20-6M124 82l14 16-20-6" fill="#fdba74"></path>
    <path d="M110 98c-4 8-4 12 0 16 4-4 4-8 0-16Z" fill="#fb7185"></path>
    <defs>
      <linearGradient id="gRocket" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fb923c"></stop>
        <stop offset="1" stop-color="#f43f5e"></stop>
      </linearGradient>
    </defs>
  </svg>
</section>`,
  },

  /* ---------- 背景 ---------- */
  {
    id: 'bg-twilight',
    type: 'background',
    name: '暮光紫',
    desc: '深紫渐变 · 玻璃卡片',
    previewStyle: {
      background:
        'radial-gradient(circle at 30% 20%, rgba(139,92,246,.55), transparent 60%), radial-gradient(circle at 80% 90%, rgba(232,121,249,.4), transparent 55%), #0f0b1a',
    },
    css: `/* ── 素材注入：暮光紫 · 背景主题（:root 变量覆盖 + 暗色适配） ── */
:root {
  --accent: #8b5cf6;
  --accent-2: #e879f9;
  --page-bg: #0f0b1a;
  --card-bg: rgba(147,122,220,.09);
  --card-border: rgba(196,181,253,.16);
  --text: #e7e4f0;
  --muted: #9d92b8;
  --tabbar-bg: rgba(15,11,26,.94);
  --tab-inactive: #7d7298;
  --tag-bg: rgba(147,122,220,.1);
  --tag-border: rgba(196,181,253,.18);
}
body {
  background:
    radial-gradient(circle at 18% 0%, rgba(139,92,246,.28), transparent 55%),
    radial-gradient(circle at 92% 100%, rgba(232,121,249,.2), transparent 55%),
    var(--page-bg);
}
.card { box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.tabbar { backdrop-filter: blur(14px); }
.avatar { background: rgba(147,122,220,.16); }
.price { color: #f0abfc; }
.good-img { background: rgba(147,122,220,.12); }
.order-progress { background: rgba(196,181,253,.14); }
.order-item { color: #b4a9cf; }
.menu-item { border-bottom-color: rgba(196,181,253,.1); }
.menu-item span { color: #6d6485; }
.cart-row { border-bottom-color: rgba(196,181,253,.1); }
.chip { background: rgba(147,122,220,.16); }
.ring { background: conic-gradient(var(--accent) 64%, rgba(196,181,253,.14) 0); }
.field span { color: #b4a9cf; border-right-color: rgba(196,181,253,.14); }
.field input::placeholder { color: #6d6485; }
.btn-code:disabled { color: #6d6485; }
.toast { background: rgba(124,58,237,.95); }`,
  },
  {
    id: 'bg-ocean',
    type: 'background',
    name: '深海蓝',
    desc: '蓝青渐变 · 冷静科技',
    previewStyle: {
      background:
        'radial-gradient(circle at 30% 20%, rgba(56,189,248,.5), transparent 60%), radial-gradient(circle at 80% 90%, rgba(52,211,153,.35), transparent 55%), #081521',
    },
    css: `/* ── 素材注入：深海蓝 · 背景主题（:root 变量覆盖 + 暗色适配） ── */
:root {
  --accent: #38bdf8;
  --accent-2: #2dd4bf;
  --page-bg: #081521;
  --card-bg: rgba(56,189,248,.08);
  --card-border: rgba(125,211,252,.16);
  --text: #e2eef7;
  --muted: #8fa8bd;
  --tabbar-bg: rgba(8,21,33,.94);
  --tab-inactive: #647d90;
  --tag-bg: rgba(56,189,248,.1);
  --tag-border: rgba(125,211,252,.18);
}
body {
  background:
    radial-gradient(circle at 18% 0%, rgba(56,189,248,.26), transparent 55%),
    radial-gradient(circle at 92% 100%, rgba(45,212,191,.18), transparent 55%),
    var(--page-bg);
}
.card { box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.tabbar { backdrop-filter: blur(14px); }
.avatar { background: rgba(56,189,248,.14); }
.price { color: #7dd3fc; }
.good-img { background: rgba(56,189,248,.1); }
.order-progress { background: rgba(125,211,252,.14); }
.order-item { color: #8fa8bd; }
.menu-item { border-bottom-color: rgba(125,211,252,.1); }
.menu-item span { color: #526a7c; }
.cart-row { border-bottom-color: rgba(125,211,252,.1); }
.chip { background: rgba(56,189,248,.14); }
.ring { background: conic-gradient(var(--accent) 64%, rgba(125,211,252,.14) 0); }
.field span { color: #8fa8bd; border-right-color: rgba(125,211,252,.14); }
.field input::placeholder { color: #526a7c; }
.btn-code:disabled { color: #526a7c; }
.toast { background: rgba(14,165,233,.95); }`,
  },
  {
    id: 'bg-sunset',
    type: 'background',
    name: '暖沙橙',
    desc: '暖橙渐变 · 活力氛围',
    previewStyle: {
      background:
        'radial-gradient(circle at 30% 20%, rgba(251,146,60,.5), transparent 60%), radial-gradient(circle at 80% 90%, rgba(244,63,94,.35), transparent 55%), #1b1013',
    },
    css: `/* ── 素材注入：暖沙橙 · 背景主题（:root 变量覆盖 + 暗色适配） ── */
:root {
  --accent: #fb923c;
  --accent-2: #fb7185;
  --page-bg: #1b1013;
  --card-bg: rgba(251,146,60,.09);
  --card-border: rgba(253,186,116,.16);
  --text: #f5ebe6;
  --muted: #b39a92;
  --tabbar-bg: rgba(27,16,19,.94);
  --tab-inactive: #8c6f66;
  --tag-bg: rgba(251,146,60,.1);
  --tag-border: rgba(253,186,116,.18);
}
body {
  background:
    radial-gradient(circle at 18% 0%, rgba(251,146,60,.26), transparent 55%),
    radial-gradient(circle at 92% 100%, rgba(244,63,94,.18), transparent 55%),
    var(--page-bg);
}
.card { box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.tabbar { backdrop-filter: blur(14px); }
.avatar { background: rgba(251,146,60,.14); }
.price { color: #fdba74; }
.good-img { background: rgba(251,146,60,.1); }
.order-progress { background: rgba(253,186,116,.14); }
.order-item { color: #bd9a8c; }
.menu-item { border-bottom-color: rgba(253,186,116,.1); }
.menu-item span { color: #74564e; }
.cart-row { border-bottom-color: rgba(253,186,116,.1); }
.chip { background: rgba(251,146,60,.14); }
.ring { background: conic-gradient(var(--accent) 64%, rgba(253,186,116,.14) 0); }
.field span { color: #bd9a8c; border-right-color: rgba(253,186,116,.14); }
.field input::placeholder { color: #74564e; }
.btn-code:disabled { color: #74564e; }
.toast { background: rgba(234,88,12,.95); }`,
  },

  /* ---------- 按钮 ---------- */
  {
    id: 'btn-neon',
    type: 'button',
    name: '霓虹渐变',
    desc: '渐变底 · 辉光阴影',
    previewLabel: '立即开始',
    previewStyle: {
      background: 'linear-gradient(135deg,#8b5cf6,#ec4899)',
      color: '#fff',
      boxShadow: '0 6px 18px rgba(168,85,247,.45)',
    },
    css: `/* ── 素材注入：霓虹渐变 · 按钮 ── */
.btn, .btn-add, .btn-code, .order-again {
  background: linear-gradient(135deg,#8b5cf6,#ec4899);
  color: #fff;
  border: 0;
  box-shadow: 0 6px 18px rgba(168,85,247,.45);
}
.btn:active, .btn-add:active { transform: scale(.94); }
.btn-add { width: 28px; height: 28px; border-radius: 999px; font-size: 16px; line-height: 1; }
.order-again { color: #fff; }`,
  },
  {
    id: 'btn-glass',
    type: 'button',
    name: '玻璃拟态',
    desc: '半透明 · 毛玻璃',
    previewLabel: '立即开始',
    previewStyle: {
      background: 'rgba(255,255,255,.12)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,.3)',
      backdropFilter: 'blur(8px)',
    },
    css: `/* ── 素材注入：玻璃拟态 · 按钮 ── */
.btn, .btn-add, .btn-code, .order-again {
  background: rgba(255,255,255,.14);
  color: #fff;
  border: 1px solid rgba(255,255,255,.28);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.18);
  backdrop-filter: blur(8px);
}
.btn:active, .btn-add:active { transform: scale(.96); }
.btn-add { width: 28px; height: 28px; border-radius: 999px; font-size: 16px; line-height: 1; }`,
  },
  {
    id: 'btn-glow',
    type: 'button',
    name: '描边发光',
    desc: '青色描边 · 内外辉光',
    previewLabel: '立即开始',
    previewStyle: {
      background: 'transparent',
      color: '#67e8f9',
      border: '1.5px solid #22d3ee',
      boxShadow: '0 0 14px rgba(34,211,238,.4)',
    },
    css: `/* ── 素材注入：描边发光 · 按钮 ── */
.btn, .btn-add, .btn-code, .order-again {
  background: transparent;
  color: #67e8f9;
  border: 1.5px solid #22d3ee;
  box-shadow: 0 0 14px rgba(34,211,238,.35), inset 0 0 10px rgba(34,211,238,.12);
}
.btn:active, .btn-add:active { transform: scale(.94); }
.btn-add { width: 28px; height: 28px; border-radius: 999px; font-size: 16px; line-height: 1; }`,
  },
]
