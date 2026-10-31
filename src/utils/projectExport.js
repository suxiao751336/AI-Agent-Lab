import { createZip, downloadBlob } from './zip'

/* 项目导出与预览构建
 * 预览（composePreview）：css/js 内联 + 存储降级 shim，供沙箱 iframe srcDoc 使用
 * 导出（composeStandalone）：index.html 外链 style.css / app.js，与预览同源同份代码
 */

/* 沙箱 iframe（无 allow-same-origin）中 localStorage 会抛异常，
 * 预览时注入内存降级层；导出的真实项目不含此段，浏览器直开可用真 localStorage */
const PREVIEW_SHIM = `<script>
(function () {
  try { window.localStorage.getItem("__probe__"); }
  catch (e) {
    var mem = {};
    var shim = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      clear: function () { mem = {}; },
      key: function (i) { return Object.keys(mem)[i] || null; }
    };
    Object.defineProperty(shim, "length", { get: function () { return Object.keys(mem).length; } });
    Object.defineProperty(window, "localStorage", { value: shim, configurable: true });
  }
})();
</script>`

/* 原生对话框拦截：沙箱已移除 allow-modals，alert/confirm/prompt 无法逃出模拟器；
 * 预览时替换为模拟器画面内的样式化弹窗（非阻塞），保证提示只出现在手机屏幕里；
 * 导出的真实项目不含此段，原生对话框行为不受影响 */
const DIALOG_SHIM = `<style>
.__dlg-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2147483647;padding:24px}
.__dlg-card{background:#fff;border-radius:14px;width:100%;max-width:85%;padding:18px 16px;font-size:15px;color:#111;line-height:1.6;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.25)}
.__dlg-row{margin-top:14px;display:flex;gap:10px}
.__dlg-row button{flex:1;border:none;border-radius:10px;font-size:15px;padding:9px 0}
.__dlg-ok{background:#1677ff;color:#fff}
.__dlg-cancel{background:#f2f3f5;color:#333}
</style>
<script>
(function () {
  function show(message, buttons) {
    var mask = document.createElement("div");
    mask.className = "__dlg-mask";
    var card = document.createElement("div");
    card.className = "__dlg-card";
    var body = document.createElement("div");
    body.textContent = String(message);
    card.appendChild(body);
    var row = document.createElement("div");
    row.className = "__dlg-row";
    var close = function () { if (mask.parentNode) mask.parentNode.removeChild(mask); };
    buttons.forEach(function (label) {
      var b = document.createElement("button");
      b.textContent = label;
      b.className = label === "取消" ? "__dlg-cancel" : "__dlg-ok";
      b.onclick = close;
      row.appendChild(b);
    });
    card.appendChild(row);
    mask.appendChild(card);
    mask.onclick = function (e) { if (e.target === mask) close(); };
    document.body.appendChild(mask);
  }
  window.alert = function (m) { show(m, ["好的"]); };
  window.confirm = function (m) { show(m, ["确定", "取消"]); return true; };
  window.prompt = function (m) { show(m, ["好的"]); return null; };
})();
</script>`

const VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">'

/* AI 图片素材内联（仅预览使用）：把项目相对路径（assets/…）替换为 data URL，
 * 沙箱 iframe（srcDoc，无同源资源）因此能显示真实图片；
 * 导出的 ZIP 保留 assets/ 相对路径 + 独立图片文件，解压后不依赖外部 URL 即可运行 */
function inlineAssets(text, aiAssets) {
  if (!Array.isArray(aiAssets) || !aiAssets.length) return String(text ?? '')
  let out = String(text ?? '')
  for (const a of aiAssets) {
    if (!a?.path || !a?.dataUrl) continue
    out = out.split(`"${a.path}"`).join(`"${a.dataUrl}"`)
    out = out.split(`'${a.path}'`).join(`'${a.dataUrl}'`)
    out = out.split(`url(${a.path})`).join(`url(${a.dataUrl})`)
  }
  return out
}

/* 沙箱预览文档（与导出代码同一份 files，仅资源引用方式不同） */
export function composePreview(files, aiAssets) {
  const html = inlineAssets(files.html, aiAssets)
  const css = inlineAssets(files.css, aiAssets)
  const js = inlineAssets(files.js, aiAssets)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
${VIEWPORT}
<style>${css}</style>
</head>
<body>
${PREVIEW_SHIM}
${DIALOG_SHIM}
${html}
<script>${js}</script>
</body>
</html>`
}

/* 独立项目 index.html（外链资源，ZIP 内可直开运行） */
export function composeStandalone(files, projectName) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
${VIEWPORT}
<title>${projectName}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
${files.html}
<script src="app.js"></script>
</body>
</html>`
}

function buildReadme(projectName, modeLabel, engine, aiAssetCount = 0) {
  const engineLine =
    engine === 'llm'
      ? '由真实模型（硅基流动 Kimi K2.7 Code）生成，经服务端 JSON 严格校验后采用'
      : '由本地模拟引擎生成（预设模板 + 规则式修改，未调用真实模型 API）'
  const assetLine = aiAssetCount
    ? `- assets/*.png|jpg|webp  AI 生成图片素材（${aiAssetCount} 张，由 Z-Image-Turbo 生成，代码中以相对路径引用）\n`
    : ''
  return `# ${projectName}

由 AI Agent Lab · 移动端 Vibe Coding Agent 生成的移动端 H5 项目。

## 运行方式

- 方式一：直接用浏览器打开 index.html
- 方式二：使用任意静态服务器（推荐）：

  npx serve .
  # 或
  python -m http.server 8000

## 文件说明

- index.html        页面结构（外链 style.css / app.js）
- style.css         样式（含已注入的视觉素材主题变量）
- app.js            业务逻辑（页面切换 / 状态管理 / localStorage 本地存储）
- assets/           视觉素材源文件（如有，供后续替换为图像模型产物）
${assetLine}
## 生成信息

- 生成模式：${modeLabel}
- 生成时间：${new Date().toLocaleString('zh-CN')}
- 引擎说明：${engineLine}
`
}

/**
 * 导出当前项目为 ZIP（代码 + 已应用素材 + AI 生成图片 + README）
 * @param {{html:string,css:string,js:string}} files 当前项目文件
 * @param {Array} usedAssets 已应用的预置素材列表（visualAssets 结构）
 * @param {{projectName:string, modeLabel:string, engine?:'llm'|'local'}} meta
 * @param {Array<{path:string, dataUrl:string, name?:string, model?:string}>} [aiAssets]
 *   AI 生成图片素材（真实二进制写入 assets/，与代码中的相对路径引用一一对应）
 */
export function exportProject(files, usedAssets, meta, aiAssets) {
  const entries = [
    { name: 'index.html', content: composeStandalone(files, meta.projectName) },
    { name: 'style.css', content: files.css },
    { name: 'app.js', content: files.js },
  ]

  const themeCss = usedAssets
    .filter((a) => a.type !== 'illustration' && a.css)
    .map((a) => `/* ===== 素材：${a.name}（${a.desc}） ===== */\n${a.css}`)
    .join('\n\n')
  if (themeCss) entries.push({ name: 'assets/theme.css', content: themeCss })

  const illu = usedAssets.find((a) => a.type === 'illustration')
  if (illu) {
    const svg = illu.html.match(/<svg[\s\S]*?<\/svg>/)
    if (svg) entries.push({ name: 'assets/hero-illustration.svg', content: svg[0] })
  }

  /* AI 生成图片：真实二进制文件（base64 → Uint8Array，store 方式打包） */
  if (Array.isArray(aiAssets)) {
    for (const a of aiAssets) {
      if (!a?.path || !a?.dataUrl) continue
      const commaIdx = a.dataUrl.indexOf(',')
      if (commaIdx < 0) continue
      const bin = Uint8Array.from(atob(a.dataUrl.slice(commaIdx + 1)), (c) => c.charCodeAt(0))
      entries.push({ name: a.path, content: bin })
    }
  }

  entries.push({
    name: 'README.md',
    content: buildReadme(meta.projectName, meta.modeLabel, meta.engine, Array.isArray(aiAssets) ? aiAssets.length : 0),
  })

  const blob = createZip(entries)
  const stamp = new Date().toISOString().slice(0, 10)
  downloadBlob(blob, `visual-agent-project-${stamp}.zip`)
}
