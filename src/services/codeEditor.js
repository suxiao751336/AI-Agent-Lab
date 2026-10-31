/* 规则式增量修改引擎（第一阶段：本地确定性规则，非 AI）
 * 作用于当前项目文件，仅做增量替换，保留其余代码与功能
 * 接入硅基流动 LLM 后，此模块将被 requestLLMCompletion 的真实改写替代
 */

export const EDIT_HINTS = [
  { label: '💙 换蓝色主题', prompt: '把主色改成蓝色' },
  { label: '✏️ 修改主标题', prompt: '把标题改成我的云端小店' },
  { label: '✨ 视觉增强', prompt: '给页面加视觉增强素材' },
]

const COLOR_MAP = {
  红: ['#e11d48', '#f43f5e'],
  蓝: ['#2563eb', '#3b82f6'],
  绿: ['#059669', '#10b981'],
  紫: ['#7c3aed', '#a855f7'],
  粉: ['#ec4899', '#f472b6'],
  橙: ['#ea580c', '#f97316'],
  青: ['#0891b2', '#06b6d4'],
  黑: ['#18181b', '#3f3f46'],
  金: ['#ca8a04', '#eab308'],
}

export const EDIT_CAPABILITIES =
  '已支持的修改指令（本地规则引擎）：\n· 改主色调：红 / 蓝 / 绿 / 紫 / 粉 / 橙 / 青 / 黑 / 金\n· 改主标题：如「把标题改成 XX」\n· 视觉增强：注入插画 / 背景 / 按钮素材\n\n接入硅基流动 LLM 后将支持任意自然语言修改（services/api.js 已预留接入位）。'

/**
 * 识别修改意图
 * @returns {{type:'color',label:string,c1:string,c2:string,name:string}
 *          |{type:'title',label:string,title:string}
 *          |{type:'enhance',label:string}
 *          |null}
 */
export function matchEditIntent(prompt) {
  const p = prompt.trim()

  const titleMatch = p.match(/(?:标题|h1).{0,6}(?:改成|改为|换成|改为|叫)\s*["「']?([^"」'?！!。.]+)["」']?/)
  if (titleMatch && titleMatch[1].trim()) {
    return { type: 'title', label: '修改主标题', title: titleMatch[1].trim() }
  }

  const colorKey = Object.keys(COLOR_MAP).find((c) => p.includes(c))
  if (colorKey && /(改|换|变|调|主色|主题|配色|颜色|色调|色系)/.test(p)) {
    const [c1, c2] = COLOR_MAP[colorKey]
    return { type: 'color', label: `切换主色调为「${colorKey}」`, c1, c2, name: colorKey }
  }

  if (/视觉增强|素材|插画|美化|装饰/.test(p)) {
    return { type: 'enhance', label: '视觉增强素材注入' }
  }

  return null
}

/**
 * 对当前项目文件应用增量修改
 * @returns {{files:Object, tab:string, detail:string, changes:string[], unchanged?:boolean}}
 */
export function applyEdit(intent, files) {
  if (intent.type === 'color') {
    let n1 = 0
    let n2 = 0
    const css = files.css
      .replace(/--accent:\s*[^;]+;/g, () => {
        n1++
        return `--accent: ${intent.c1};`
      })
      .replace(/--accent-2:\s*[^;]+;/g, () => {
        n2++
        return `--accent-2: ${intent.c2};`
      })
    if (n1 + n2 === 0) {
      return {
        files,
        tab: 'css',
        detail: '未找到主题变量',
        changes: [],
        unchanged: true,
      }
    }
    return {
      files: { ...files, css },
      tab: 'css',
      detail: `更新 style.css：--accent ×${n1}、--accent-2 ×${n2}`,
      changes: [`主色 → ${intent.c1}（${intent.name}）`, `辅色 → ${intent.c2}`],
    }
  }

  if (intent.type === 'title') {
    const esc = intent.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    let done = false
    const html = files.html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, (m) => {
      done = true
      return m.replace(/>[\s\S]*?</, `>${esc}<`)
    })
    if (!done) {
      return {
        files,
        tab: 'html',
        detail: '未找到 <h1> 主标题',
        changes: [],
        unchanged: true,
      }
    }
    return {
      files: { ...files, html },
      tab: 'html',
      detail: '更新 index 片段：主标题文案',
      changes: [`主标题 → 「${intent.title}」`],
    }
  }

  return { files, tab: 'html', detail: '', changes: [], unchanged: true }
}
