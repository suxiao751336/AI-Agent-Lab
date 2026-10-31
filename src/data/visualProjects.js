/* 移动端项目模板（本地模拟引擎生成，未接入真实模型）
 * 真实代码项目：HTML(结构)/CSS(样式)/JS(逻辑) 三文件，统一类名规范
 * CSS 采用 :root 主题变量，支持规则式增量改色（services/codeEditor.js）
 * <!-- SLOT:HERO --> 为插画素材注入插槽
 */

export const VISUAL_GREETING =
  '你好！我是移动端 Vibe Coding Agent 📱\n基于真实代码的移动端应用开发智能体：\n· 真实模型引擎（Kimi K2.7 Code · 硅基流动）：任意需求生成 HTML / CSS / JS 完整项目\n· 支持任意自然语言多轮增量修改（携带现有代码发给模型）\n· 手机模拟器沙箱运行同一份代码，可导出 ZIP 完整项目\n· AI 视觉增强（LLM + 图像生成模型协同）即将支持\n\n⚠️ 真实模型需在项目根目录 .env 填入 SILICONFLOW_API_KEY（Key 仅存服务端，不会进入前端）。\n用下方快捷指令或直接输入任意需求开始 →'

export const VISUAL_QUICK_PROMPTS = [
  {
    label: '💧 喝水记录 App',
    prompt:
      '创建一个移动端喝水记录 App，采用清爽的蓝白色风格。首页展示今日饮水总量、每日目标和圆形进度条，提供 100ml、200ml、250ml、500ml 快捷添加按钮。支持自定义饮水量、查看今日饮水记录、删除记录、修改每日目标。采用首页、历史、设置三个页面，通过底部导航切换。使用 localStorage 保存数据，刷新后记录不丢失。所有按钮必须能点击并执行真实的前端交互。使用 HTML、CSS、JavaScript 实现，不需要后端。',
  },
  { label: '☕ 咖啡点单 App', prompt: '做一个咖啡点单小程序，带底部导航' },
  {
    label: '🔐 登录注册页面',
    prompt:
      '生成移动端登录注册界面，支持登录/注册切换、手机号格式校验、密码显示切换、表单错误提示和本地模拟登录成功反馈。不接入真实短信、账号系统或后端服务。',
  },
]

export const VISUAL_MODES = {
  standard: { key: 'standard', label: '⚡ 标准生成', desc: '纯代码快速生成' },
  enhanced: { key: 'enhanced', label: '🎨 视觉增强', desc: '注入插画 · 背景 · 按钮素材' },
}

/* Agent 执行步骤定义（五阶段，模拟流程） */
export const STEP_DEFS = [
  { key: 'analyze', title: '需求分析', tip: '解析意图与目标平台' },
  { key: 'codegen', title: '页面生成', tip: '生成 HTML / CSS / JS' },
  { key: 'asset', title: '素材生成', tip: '插画 · 背景 · 按钮素材' },
  { key: 'integrate', title: '代码整合', tip: '合并素材与页面代码' },
  { key: 'verify', title: '预览验证', tip: '布局与交互自检' },
]

export function initSteps() {
  return STEP_DEFS.map((d) => ({ ...d, status: 'pending', detail: '' }))
}

/* ============ 通用简化样式（starter / default 共用） ============ */

const SIMPLE_CSS = `:root {
  --accent: #6d28d9;
  --accent-2: #a855f7;
  --page-bg: #f6f5f3;
  --card-bg: #ffffff;
  --card-border: #efece9;
  --text: #27272a;
  --muted: #a1a1aa;
  --tabbar-bg: #ffffff;
  --tab-inactive: #b6b2b8;
  --tag-bg: #ffffff;
  --tag-border: #eceae7;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  height: 100vh; overflow: hidden;
  display: flex; flex-direction: column;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--page-bg); color: var(--text);
}
.phone-page { flex: 1; overflow-y: auto; padding: 20px 18px 96px; display: none; }
.phone-page.active { display: block; animation: pageIn .28s ease both; }
@keyframes pageIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.hello { font-size: 13px; color: var(--muted); margin-bottom: 2px; }
.topbar h1 { font-size: 22px; }
.avatar { width: 40px; height: 40px; display: grid; place-items: center; background: #efe9ff; border-radius: 14px; font-size: 19px; }
.card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 18px; padding: 16px; }
.banner { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg,var(--accent),var(--accent-2)); border: 0; color: #fff; margin-bottom: 14px; }
.banner h3 { font-size: 16px; margin-top: 4px; }
.banner-tag { font-size: 11px; opacity: .85; background: rgba(255,255,255,.18); display: inline-block; padding: 2px 8px; border-radius: 999px; }
.banner-emoji { font-size: 34px; }
.list-item { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.li-emoji { font-size: 24px; }
.li-title { font-size: 14px; font-weight: 600; }
.li-sub { font-size: 12px; color: var(--muted); margin-top: 3px; }
.flex-1 { flex: 1; }
.btn { width: 100%; padding: 14px; margin-top: 6px; border: 0; border-radius: 14px; background: var(--accent); color: #fff; font-size: 15px; cursor: pointer; }
.menu-item { display: flex; justify-content: space-between; align-items: center; padding: 13px 2px; font-size: 14px; border-bottom: 1px solid #f4f2f0; }
.menu-item:last-child { border-bottom: 0; }
.menu-item span { color: #c4c0c6; }
.page-title { font-size: 22px; margin-bottom: 16px; }
.tabbar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; height: 76px; padding-bottom: 14px; background: var(--tabbar-bg); border-top: 1px solid var(--card-border); }
.tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; background: none; border: 0; font-size: 19px; color: var(--tab-inactive); cursor: pointer; }
.tab span { font-size: 11px; }
.tab.active { color: var(--accent); }
.toast { position: fixed; left: 50%; bottom: 100px; transform: translateX(-50%) translateY(8px); background: rgba(24,24,32,.92); color: #fff; padding: 9px 18px; border-radius: 999px; font-size: 13px; opacity: 0; pointer-events: none; transition: all .25s; }
.toast.show { opacity: 1; transform: translateX(-50%); }`

const SIMPLE_JS = `function switchTab(idx, pageId) {
  var pages = document.querySelectorAll(".phone-page");
  for (var i = 0; i < pages.length; i++) pages[i].classList.remove("active");
  document.getElementById(pageId).classList.add("active");
  var tabs = document.querySelectorAll(".tab");
  for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle("active", j === idx);
}
var toastTimer = null;
function showToast(text) {
  var t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1500);
}
var HIT_KEY = "va-hits";
function hi(btn) {
  var n = 1;
  try {
    n = parseInt(localStorage.getItem(HIT_KEY) || "0", 10) + 1;
    localStorage.setItem(HIT_KEY, String(n));
  } catch (e) { n = 1; }
  btn.textContent = "开始体验（已体验 " + n + " 次）";
  showToast("交互正常 ✓ 本地存储已生效");
}`

export const VISUAL_STARTER = {
  html: `<div class="phone-page active" id="page-home">
  <header class="topbar">
    <div>
      <p class="hello">欢迎体验</p>
      <h1>Vibe Agent</h1>
    </div>
    <div class="avatar">📱</div>
  </header>

  <div class="card banner">
    <div>
      <p class="banner-tag">READY</p>
      <h3>真实代码 · 沙箱预览</h3>
    </div>
    <span class="banner-emoji">📲</span>
  </div>

  <div class="card list-item">
    <span class="li-emoji">💬</span>
    <div class="flex-1">
      <p class="li-title">左侧对话描述需求</p>
      <p class="li-sub">生成真实 HTML / CSS / JS 项目</p>
    </div>
  </div>
  <div class="card list-item">
    <span class="li-emoji">🎨</span>
    <div class="flex-1">
      <p class="li-title">生成后可继续修改与导出</p>
      <p class="li-sub">支持增量改色 / 改标题 / 素材注入</p>
    </div>
  </div>

  <button class="btn" onclick="hi(this)">体验交互</button>
</div>

<div class="toast" id="toast"></div>`,
  css: SIMPLE_CSS,
  js: SIMPLE_JS,
}

/* ============ 项目一：Cloud Coffee 咖啡点单 ============ */

const COFFEE = {
  key: 'coffee',
  name: 'Cloud Coffee 咖啡点单',
  analyzeText: '意图：餐饮点单 · 场景：咖啡小程序 · 端：移动 H5',
  reply:
    '收到！为你构建「Cloud Coffee · 咖啡点单」移动端应用 ☕\n\n真实代码项目：\n· 3 个页面：点单 / 订单 / 我的（底部导航切换）\n· 购物袋数据写入 localStorage，跨页面持久保存\n· 加购 Toast、订单进度、再来一单交互\n\n代码马上就来 →',
  enhancedNote: '\n\n🎨 视觉增强模式已开启：将注入「暮光紫」背景、咖啡插画与霓虹渐变按钮。',
  assetPick: ['bg-twilight', 'illu-coffee', 'btn-neon'],
  html: `<div class="phone-page active" id="page-home">
  <!-- SLOT:HERO -->
  <header class="topbar">
    <div>
      <p class="hello">早安，咖啡星人 ☀️</p>
      <h1>Cloud Coffee</h1>
    </div>
    <div class="avatar">☕</div>
  </header>

  <div class="search">🔍 搜索咖啡 / 茶饮 / 烘焙</div>

  <div class="card banner">
    <div>
      <p class="banner-tag">新品尝鲜</p>
      <h3>燕麦拿铁 买一送一</h3>
    </div>
    <span class="banner-emoji">🥤</span>
  </div>

  <div class="cats">
    <span class="tag active">推荐</span>
    <span class="tag">经典咖啡</span>
    <span class="tag">清爽茶饮</span>
    <span class="tag">烘焙甜点</span>
    <span class="tag">周边</span>
  </div>

  <h3 class="sec-title">为你推荐</h3>
  <div class="goods">
    <div class="card good">
      <div class="good-img">☕</div>
      <p class="good-name">燕麦拿铁</p>
      <p class="good-desc">深度烘焙 · 丝滑燕麦</p>
      <div class="good-row">
        <span class="price">¥28</span>
        <button class="btn-add" onclick="addCart('燕麦拿铁')">+</button>
      </div>
    </div>
    <div class="card good">
      <div class="good-img">🥥</div>
      <p class="good-name">生椰拿铁</p>
      <p class="good-desc">厚椰乳 · 清甜不腻</p>
      <div class="good-row">
        <span class="price">¥32</span>
        <button class="btn-add" onclick="addCart('生椰拿铁')">+</button>
      </div>
    </div>
    <div class="card good">
      <div class="good-img">🍵</div>
      <p class="good-name">茉莉青提茶</p>
      <p class="good-desc">真果肉 · 茉莉茶底</p>
      <div class="good-row">
        <span class="price">¥22</span>
        <button class="btn-add" onclick="addCart('茉莉青提茶')">+</button>
      </div>
    </div>
    <div class="card good">
      <div class="good-img">🥐</div>
      <p class="good-name">黄油可颂</p>
      <p class="good-desc">32 层起酥 · 现烤</p>
      <div class="good-row">
        <span class="price">¥15</span>
        <button class="btn-add" onclick="addCart('黄油可颂')">+</button>
      </div>
    </div>
  </div>
</div>

<div class="phone-page" id="page-orders">
  <h1 class="page-title">订单</h1>

  <h3 class="sec-title">购物袋（localStorage 持久化）</h3>
  <div class="card" id="cart-list"></div>
  <button class="btn-clear" onclick="clearCart()">清空购物袋</button>

  <h3 class="sec-title">进行中</h3>
  <div class="card">
    <div class="order-status"><span class="dot-pulse"></span>制作中 · 约 8 分钟</div>
    <div class="order-item">1× 燕麦拿铁（大杯 / 少冰）</div>
    <div class="order-progress"><i></i></div>
  </div>

  <h3 class="sec-title">历史订单</h3>
  <div class="card history">
    <div>
      <p class="li-title">生椰拿铁 × 2</p>
      <p class="muted">10.24 · 已完成</p>
    </div>
    <div class="history-right">
      <p class="price-sm">¥64</p>
      <button class="order-again" onclick="orderAgain('生椰拿铁')">再来一单</button>
    </div>
  </div>
</div>

<div class="phone-page" id="page-me">
  <h1 class="page-title">我的</h1>
  <div class="card me-card">
    <div class="avatar lg">☕</div>
    <div>
      <b>咖啡星人</b>
      <p>积分 1,280 · 银卡会员</p>
    </div>
  </div>
  <div class="card menu">
    <div class="menu-item">📍 我的地址 <span>›</span></div>
    <div class="menu-item">💳 优惠券 <span>3 张 ›</span></div>
    <div class="menu-item">⚙️ 设置 <span>›</span></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<nav class="tabbar">
  <button class="tab active" onclick="switchTab(0,'page-home')">☕<span>点单</span></button>
  <button class="tab" onclick="switchTab(1,'page-orders')">🧾<span>订单</span><em class="badge" id="cart-badge">0</em></button>
  <button class="tab" onclick="switchTab(2,'page-me')">👤<span>我的</span></button>
</nav>`,
  css: `:root {
  --accent: #6d28d9;
  --accent-2: #a855f7;
  --page-bg: #f6f5f3;
  --card-bg: #ffffff;
  --card-border: #efece9;
  --text: #27272a;
  --muted: #a1a1aa;
  --tabbar-bg: #ffffff;
  --tab-inactive: #b6b2b8;
  --tag-bg: #ffffff;
  --tag-border: #eceae7;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  height: 100vh; overflow: hidden;
  display: flex; flex-direction: column;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--page-bg); color: var(--text);
}
.phone-page { flex: 1; overflow-y: auto; padding: 20px 18px 96px; display: none; }
.phone-page.active { display: block; animation: pageIn .28s ease both; }
@keyframes pageIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

.topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.hello { font-size: 13px; color: var(--muted); margin-bottom: 2px; }
.topbar h1 { font-size: 22px; }
.avatar { width: 40px; height: 40px; display: grid; place-items: center; background: #efe9ff; border-radius: 14px; font-size: 19px; }
.avatar.lg { width: 52px; height: 52px; font-size: 24px; }

.search { background: var(--card-bg); border: 1px solid var(--tag-border); border-radius: 14px; padding: 11px 14px; font-size: 13px; color: var(--muted); margin-bottom: 14px; }

.card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 18px; padding: 16px; }
.banner { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg,var(--accent),var(--accent-2)); border: 0; color: #fff; margin-bottom: 16px; }
.banner h3 { font-size: 16px; margin-top: 4px; }
.banner-tag { font-size: 11px; opacity: .85; background: rgba(255,255,255,.18); display: inline-block; padding: 2px 8px; border-radius: 999px; }
.banner-emoji { font-size: 34px; }

.cats { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 6px; scrollbar-width: none; }
.cats::-webkit-scrollbar { display: none; }
.tag { flex-shrink: 0; padding: 7px 14px; border-radius: 999px; background: var(--tag-bg); border: 1px solid var(--tag-border); font-size: 12px; color: var(--muted); }
.tag.active { background: var(--accent); border-color: var(--accent); color: #fff; }

.sec-title { font-size: 15px; margin: 18px 0 12px; }
.page-title { font-size: 22px; margin-bottom: 4px; }

.goods { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.good { padding: 12px; }
.good-img { height: 84px; display: grid; place-items: center; font-size: 34px; background: #faf8f5; border-radius: 12px; margin-bottom: 10px; }
.good-name { font-size: 14px; font-weight: 600; }
.good-desc { font-size: 11px; color: var(--muted); margin: 4px 0 10px; }
.good-row { display: flex; align-items: center; justify-content: space-between; }
.price { font-weight: 700; color: #9a3412; }

.cart-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 7px 0; border-bottom: 1px solid #f4f2f0; }
.cart-row:last-child { border-bottom: 0; }
.btn-clear { display: block; margin: 10px auto 0; padding: 6px 16px; border: 1px solid var(--card-border); background: var(--card-bg); color: var(--muted); border-radius: 999px; font-size: 12px; cursor: pointer; }

.order-status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--accent); }
.dot-pulse { width: 8px; height: 8px; border-radius: 99px; background: var(--accent); animation: pulse 1.2s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.order-item { font-size: 13px; color: #52525b; margin: 10px 0 14px; }
.order-progress { height: 6px; background: #f0eafd; border-radius: 99px; overflow: hidden; }
.order-progress i { display: block; width: 62%; height: 100%; background: linear-gradient(90deg,var(--accent),var(--accent-2)); border-radius: 99px; animation: grow 1.6s ease both; }
@keyframes grow { from { width: 0; } }

.history { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.muted { font-size: 12px; color: var(--muted); margin-top: 3px; }
.history-right { text-align: right; }
.price-sm { font-size: 13px; font-weight: 700; }
.order-again { margin-top: 6px; padding: 6px 12px; border: 1px solid var(--accent); background: var(--card-bg); color: var(--accent); border-radius: 999px; font-size: 12px; cursor: pointer; }

.me-card { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.me-card p { font-size: 12px; color: var(--muted); margin-top: 3px; }
.menu-item { display: flex; justify-content: space-between; align-items: center; padding: 13px 2px; font-size: 14px; border-bottom: 1px solid #f4f2f0; }
.menu-item:last-child { border-bottom: 0; }
.menu-item span { color: #c4c0c6; }

.tabbar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; height: 76px; padding-bottom: 14px; background: var(--tabbar-bg); border-top: 1px solid var(--card-border); }
.tab { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; background: none; border: 0; font-size: 19px; color: var(--tab-inactive); cursor: pointer; }
.tab span { font-size: 11px; }
.tab.active { color: var(--accent); }
.badge { position: absolute; top: 4px; right: calc(50% - 24px); min-width: 17px; height: 17px; padding: 0 4px; display: none; place-items: center; border-radius: 999px; background: #e11d48; color: #fff; font-size: 10px; font-style: normal; }

.toast { position: fixed; left: 50%; bottom: 100px; transform: translateX(-50%) translateY(8px); background: rgba(24,24,32,.92); color: #fff; padding: 9px 18px; border-radius: 999px; font-size: 13px; opacity: 0; pointer-events: none; transition: all .25s; }
.toast.show { opacity: 1; transform: translateX(-50%); }`,
  js: `/* Cloud Coffee 业务逻辑：页面切换 + localStorage 购物袋 */
var CART_KEY = "cc-cart";

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "{}"); }
  catch (e) { return {}; }
}
function saveCart(cart) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
}
function cartTotal(cart) {
  var n = 0;
  for (var k in cart) n += cart[k];
  return n;
}

function renderBadge() {
  var n = cartTotal(loadCart());
  var b = document.getElementById("cart-badge");
  b.textContent = n;
  b.style.display = n > 0 ? "grid" : "none";
}
function renderCart() {
  var box = document.getElementById("cart-list");
  var cart = loadCart();
  var keys = Object.keys(cart);
  var html = "";
  for (var i = 0; i < keys.length; i++) {
    html += '<div class="cart-row"><span>' + keys[i] + ' × ' + cart[keys[i]] + '</span><span class="muted">待结算</span></div>';
  }
  box.innerHTML = keys.length ? html : '<p class="muted">购物袋是空的，去点单页加一杯吧 ☕</p>';
}

function addCart(name) {
  var cart = loadCart();
  cart[name] = (cart[name] || 0) + 1;
  saveCart(cart);
  renderBadge();
  showToast("已加入购物袋：" + name);
}
function clearCart() {
  saveCart({});
  renderBadge();
  renderCart();
  showToast("购物袋已清空");
}
function orderAgain(name) {
  var cart = loadCart();
  cart[name] = (cart[name] || 0) + 1;
  saveCart(cart);
  renderBadge();
  renderCart();
  showToast("已重新下单：" + name);
}

function switchTab(idx, pageId) {
  var pages = document.querySelectorAll(".phone-page");
  for (var i = 0; i < pages.length; i++) pages[i].classList.remove("active");
  document.getElementById(pageId).classList.add("active");
  var tabs = document.querySelectorAll(".tab");
  for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle("active", j === idx);
  if (pageId === "page-orders") renderCart();
}

var toastTimer = null;
function showToast(text) {
  var t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1500);
}

renderBadge();`,
}

/* ============ 项目二：FitPulse 健身打卡 ============ */

const FIT = {
  key: 'fit',
  name: 'FitPulse 健身打卡',
  analyzeText: '意图：健身打卡 · 场景：训练 App · 端：移动 H5',
  reply:
    '收到！为你构建「FitPulse · 健身打卡」App 界面 💪\n\n真实代码项目：\n· 今日目标进度环 + 周训练柱状图\n· 课程列表点击进入详情页（页面切换动画）\n· 开始训练按钮状态流转\n\n代码马上就来 →',
  enhancedNote: '\n\n🎨 视觉增强模式已开启：将注入「深海蓝」背景、哑铃插画与描边发光按钮。',
  assetPick: ['bg-ocean', 'illu-dumbbell', 'btn-glow'],
  html: `<div class="phone-page active" id="page-home">
  <!-- SLOT:HERO -->
  <header class="topbar">
    <div>
      <p class="hello">周四 · 练胸日</p>
      <h1>FitPulse</h1>
    </div>
    <div class="avatar">🔥</div>
  </header>

  <div class="card ring-card">
    <div class="ring"><i></i></div>
    <div>
      <h3 class="ring-title">今日目标</h3>
      <p class="ring-num">320 / 500 千卡</p>
      <p class="muted">再坚持 180 千卡达成 🎯</p>
    </div>
  </div>

  <h3 class="sec-title">本周训练量</h3>
  <div class="card chart">
    <div class="bar-col"><i style="height:45%"></i><span>一</span></div>
    <div class="bar-col"><i style="height:70%"></i><span>二</span></div>
    <div class="bar-col"><i style="height:35%"></i><span>三</span></div>
    <div class="bar-col"><i style="height:85%"></i><span>四</span></div>
    <div class="bar-col"><i style="height:20%"></i><span>五</span></div>
    <div class="bar-col"><i style="height:60%"></i><span>六</span></div>
    <div class="bar-col"><i style="height:10%"></i><span>日</span></div>
  </div>

  <h3 class="sec-title">今日课程</h3>
  <div class="card list-item" onclick="goDetail()">
    <span class="li-emoji">🏋️</span>
    <div class="flex-1">
      <p class="li-title">上肢力量 · 核心</p>
      <p class="li-sub">45 分钟 · 中等强度</p>
    </div>
    <span class="chip">开始</span>
  </div>
  <div class="card list-item" onclick="goDetail()">
    <span class="li-emoji">🧘</span>
    <div class="flex-1">
      <p class="li-title">拉伸放松</p>
      <p class="li-sub">20 分钟 · 低强度</p>
    </div>
    <span class="chip">放松</span>
  </div>
</div>

<div class="phone-page" id="page-detail">
  <button class="back" onclick="goBack()">‹ 返回</button>
  <h1 class="page-title">上肢力量训练</h1>
  <p class="muted" style="margin-bottom:16px">45 分钟 · 中等强度 · 器械可选</p>
  <div class="card step">
    <b>01</b>
    <div><p class="li-title">俯卧撑</p><p class="muted">4 组 × 15 次</p></div>
  </div>
  <div class="card step">
    <b>02</b>
    <div><p class="li-title">哑铃推举</p><p class="muted">4 组 × 12 次</p></div>
  </div>
  <div class="card step">
    <b>03</b>
    <div><p class="li-title">平板支撑</p><p class="muted">3 组 × 60 秒</p></div>
  </div>
  <button class="btn" onclick="startTrain(this)">开始训练</button>
</div>

<div class="toast" id="toast"></div>`,
  css: `:root {
  --accent: #e11d48;
  --accent-2: #fb7185;
  --page-bg: #fdf4f4;
  --card-bg: #ffffff;
  --card-border: #f7e9ec;
  --text: #1f2937;
  --muted: #a1a1aa;
  --tabbar-bg: #ffffff;
  --tab-inactive: #b6b2b8;
  --tag-bg: #ffffff;
  --tag-border: #f7e9ec;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  height: 100vh; overflow: hidden;
  display: flex; flex-direction: column;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--page-bg); color: var(--text);
}
.phone-page { flex: 1; overflow-y: auto; padding: 20px 18px 40px; display: none; }
.phone-page.active { display: block; animation: pageIn .3s ease both; }
@keyframes pageIn { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }

.topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.hello { font-size: 13px; color: var(--muted); margin-bottom: 2px; }
.topbar h1 { font-size: 22px; }
.avatar { width: 40px; height: 40px; display: grid; place-items: center; background: #fde8ec; border-radius: 14px; font-size: 19px; }

.card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 18px; padding: 16px; }
.ring-card { display: flex; align-items: center; gap: 16px; }
.ring { position: relative; width: 78px; height: 78px; border-radius: 50%; background: conic-gradient(var(--accent) 64%, #fce7ec 0); display: grid; place-items: center; }
.ring i { width: 60px; height: 60px; border-radius: 50%; background: var(--card-bg); }
.ring::after { content: "64%"; position: absolute; font-size: 14px; font-weight: 700; color: var(--accent); }
.ring-title { font-size: 15px; }
.ring-num { font-size: 13px; color: #52525b; margin: 4px 0 2px; }
.muted { font-size: 12px; color: var(--muted); }

.sec-title { font-size: 15px; margin: 18px 0 12px; }
.page-title { font-size: 22px; margin-bottom: 8px; }

.chart { display: flex; align-items: flex-end; gap: 10px; height: 110px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; height: 100%; }
.bar-col i { width: 100%; border-radius: 6px 6px 3px 3px; background: linear-gradient(180deg,var(--accent),var(--accent-2)); min-height: 5px; transform-origin: bottom; animation: barUp .8s ease both; }
@keyframes barUp { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.bar-col span { font-size: 10px; color: var(--muted); }

.list-item { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; cursor: pointer; }
.li-emoji { font-size: 24px; }
.li-title { font-size: 14px; font-weight: 600; }
.li-sub { font-size: 12px; color: var(--muted); margin-top: 3px; }
.flex-1 { flex: 1; }
.chip { font-size: 11px; color: var(--accent); background: #fde8ec; padding: 4px 10px; border-radius: 999px; }

.back { background: none; border: 0; color: #9ca3af; font-size: 15px; margin-bottom: 14px; cursor: pointer; }
.step { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
.step b { font-size: 13px; color: var(--accent-2); }

.btn { width: 100%; padding: 14px; margin-top: 10px; border: 0; border-radius: 14px; background: linear-gradient(135deg,var(--accent),var(--accent-2)); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; box-shadow: 0 8px 20px rgba(244,63,94,.3); }

.toast { position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%) translateY(8px); background: rgba(24,24,32,.92); color: #fff; padding: 9px 18px; border-radius: 999px; font-size: 13px; opacity: 0; pointer-events: none; transition: all .25s; }
.toast.show { opacity: 1; transform: translateX(-50%); }`,
  js: `/* FitPulse 业务逻辑：页面切换 + 训练状态流转 */
function goDetail() {
  document.getElementById("page-home").classList.remove("active");
  document.getElementById("page-detail").classList.add("active");
}
function goBack() {
  document.getElementById("page-detail").classList.remove("active");
  document.getElementById("page-home").classList.add("active");
}
var toastTimer = null;
function showToast(text) {
  var t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1500);
}
function startTrain(btn) {
  btn.textContent = "训练中…";
  btn.disabled = true;
  showToast("训练已开始，加油 💪");
}`,
}

/* ============ 项目三：验证码登录页 ============ */

const LOGIN = {
  key: 'login',
  name: '手机验证码登录',
  analyzeText: '意图：账号登录 · 场景：验证码登录页 · 端：移动 H5',
  reply:
    '收到！为你生成「手机验证码登录」页 📱\n\n真实代码项目：\n· 手机号 / 验证码输入与校验\n· 60 秒重发倒计时（定时器状态）\n· 登录态写入 localStorage\n\n代码马上就来 →',
  enhancedNote: '\n\n🎨 视觉增强模式已开启：将注入「暖沙橙」背景、火箭插画与玻璃拟态按钮。',
  assetPick: ['bg-sunset', 'illu-rocket', 'btn-glass'],
  html: `<div class="phone-page active login-page">
  <div class="login-logo">📲</div>
  <h1>手机号登录</h1>
  <p class="muted">未注册的号码将自动创建账号</p>

  <div class="field">
    <span>+86</span>
    <input id="phone" placeholder="请输入手机号" inputmode="numeric" maxlength="11">
  </div>
  <div class="field">
    <input id="code" placeholder="验证码" inputmode="numeric" maxlength="6">
    <button class="btn-code" onclick="sendCode(this)">获取验证码</button>
  </div>

  <button class="btn" onclick="doLogin()">登 录</button>
  <p class="protocol">登录即同意 <a>《用户协议》</a> 与 <a>《隐私政策》</a></p>
</div>

<div class="toast" id="toast"></div>`,
  css: `:root {
  --accent: #f59e0b;
  --accent-2: #f97316;
  --page-bg: #fffaf5;
  --card-bg: #ffffff;
  --card-border: #f3e6d8;
  --text: #27272a;
  --muted: #a1a1aa;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  height: 100vh; overflow: hidden;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--page-bg); color: var(--text);
}
.phone-page { height: 100vh; overflow-y: auto; padding: 20px 22px; }
.login-page { padding-top: 72px; }
.login-logo { width: 64px; height: 64px; margin: 0 auto 18px; display: grid; place-items: center; font-size: 30px; background: linear-gradient(135deg,var(--accent),var(--accent-2)); border-radius: 20px; box-shadow: 0 10px 24px rgba(249,115,22,.3); }
h1 { font-size: 24px; }
.muted { font-size: 13px; color: var(--muted); margin: 8px 0 28px; }

.field { display: flex; align-items: center; gap: 10px; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 0 14px; margin-bottom: 14px; }
.field span { font-size: 14px; color: #52525b; border-right: 1px solid #f5ebe0; padding: 13px 10px 13px 0; }
.field input { flex: 1; border: 0; background: none; padding: 13px 0; font-size: 14px; outline: none; color: var(--text); }
.field input::placeholder { color: #c9b8a5; }
.btn-code { border: 0; background: none; color: var(--accent); font-size: 13px; cursor: pointer; white-space: nowrap; }
.btn-code:disabled { color: #c9b8a5; cursor: default; }

.btn { width: 100%; padding: 14px; margin-top: 8px; border: 0; border-radius: 14px; background: linear-gradient(135deg,var(--accent),var(--accent-2)); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; box-shadow: 0 8px 20px rgba(249,115,22,.3); }
.protocol { font-size: 11px; color: var(--muted); text-align: center; margin-top: 18px; }
.protocol a { color: var(--accent); }

.toast { position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%) translateY(8px); background: rgba(24,24,32,.92); color: #fff; padding: 9px 18px; border-radius: 999px; font-size: 13px; opacity: 0; pointer-events: none; transition: all .25s; }
.toast.show { opacity: 1; transform: translateX(-50%); }`,
  js: `/* 验证码登录业务逻辑：倒计时 + 校验 + 登录态本地存储 */
var codeTimer = null;
function sendCode(btn) {
  if (codeTimer) return;
  var s = 60;
  btn.disabled = true;
  btn.textContent = s + "s 后重发";
  codeTimer = setInterval(function () {
    s--;
    if (s <= 0) {
      clearInterval(codeTimer);
      codeTimer = null;
      btn.disabled = false;
      btn.textContent = "重新获取";
      return;
    }
    btn.textContent = s + "s 后重发";
  }, 1000);
  showToast("验证码已发送（模拟）");
}

var toastTimer = null;
function showToast(text) {
  var t = document.getElementById("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1500);
}

function doLogin() {
  var phone = document.getElementById("phone").value.trim();
  var code = document.getElementById("code").value.trim();
  if (!phone || !code) { showToast("请输入手机号和验证码"); return; }
  try { localStorage.setItem("va-login", JSON.stringify({ phone: phone, time: Date.now() })); } catch (e) {}
  showToast("登录成功，正在进入…");
}`,
}

/* ============ 默认项目（自定义需求） ============ */

function defaultProject(prompt) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const title = esc(prompt.length > 16 ? prompt.slice(0, 16) + '…' : prompt)
  return {
    key: 'custom',
    name: '自定义移动页面',
    analyzeText: '意图：自定义页面 · 端：移动 H5',
    reply: `收到你的需求：「${prompt}」\n\n为你生成一个移动端演示项目：\n· 需求标题 Banner\n· 功能列表 + 点击计数（localStorage）\n· 底部导航切换\n\n开始生成 →`,
    enhancedNote: '\n\n🎨 视觉增强模式已开启：将注入通用视觉素材包（背景 / 插画 / 按钮）。',
    assetPick: ['bg-twilight', 'illu-rocket', 'btn-neon'],
    html: `<div class="phone-page active" id="page-home">
  <!-- SLOT:HERO -->
  <header class="topbar">
    <div>
      <p class="hello">按需生成</p>
      <h1>自定义页面</h1>
    </div>
    <div class="avatar">✨</div>
  </header>

  <div class="card banner">
    <div>
      <p class="banner-tag">VIBE AGENT</p>
      <h3>${title}</h3>
    </div>
    <span class="banner-emoji">🚀</span>
  </div>

  <div class="card list-item">
    <span class="li-emoji">📱</span>
    <div class="flex-1">
      <p class="li-title">响应式移动布局</p>
      <p class="li-sub">适配 390px 视口</p>
    </div>
  </div>
  <div class="card list-item">
    <span class="li-emoji">👆</span>
    <div class="flex-1">
      <p class="li-title">点击交互 + 本地存储</p>
      <p class="li-sub">计数持久化保存</p>
    </div>
  </div>

  <button class="btn" onclick="hi(this)">开始体验</button>
</div>

<div class="phone-page" id="page-me">
  <h1 class="page-title">关于</h1>
  <div class="card menu-wrap">
    <div class="menu-item">ℹ️ 项目说明 <span>›</span></div>
    <div class="menu-item">🎨 素材工坊 <span>›</span></div>
    <div class="menu-item">⚙️ 设置 <span>›</span></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<nav class="tabbar">
  <button class="tab active" onclick="switchTab(0,'page-home')">🏠<span>首页</span></button>
  <button class="tab" onclick="switchTab(1,'page-me')">👤<span>关于</span></button>
</nav>`,
    css: SIMPLE_CSS + `\n.menu-wrap { padding: 4px 16px; }`,
    js: SIMPLE_JS,
  }
}

/* ============ 匹配入口 ============ */

export function matchVisualProject(prompt) {
  const p = prompt.toLowerCase()
  if (/咖啡|点单|小程序|奶茶|茶饮|外卖|餐饮/.test(p)) return COFFEE
  if (/健身|运动|打卡|训练|体育|跑步/.test(p)) return FIT
  if (/登录|登陆|注册|验证码|login/.test(p)) return LOGIN
  return defaultProject(prompt.trim() || '自定义页面')
}

export function getVisualSummary(mode) {
  if (mode === 'enhanced') {
    return '✅ 视觉增强版生成完毕（本地模拟引擎）！\n已注入视觉素材并整合进真实代码，可在「素材库」标签查看。\n项目可继续增量修改，或点「导出」下载 ZIP 完整项目。'
  }
  return '✅ 项目生成完毕（本地模拟引擎）！\n模拟器中运行的就是当前代码文件：可体验页面切换与本地存储交互。\n接下来可：继续发指令增量修改 · 点「导出」下载 ZIP 项目。'
}
