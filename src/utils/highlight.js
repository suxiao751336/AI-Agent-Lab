const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* 每种语言的模式列表：按顺序匹配，单趟扫描（内部只能用非捕获分组） */
const PATTERNS = {
  html: [
    { re: /<!--[\s\S]*?-->/y.source, cls: 'text-zinc-500 italic' },
    { re: /"[^"\n]*"|'[^'\n]*'/y.source, cls: 'text-amber-300' },
    { re: /<\/?[a-zA-Z][\w-]*|\/?>/y.source, cls: 'text-violet-400' },
    { re: /[a-zA-Z-]+(?==)/y.source, cls: 'text-sky-300' },
  ],
  css: [
    { re: /\/\*[\s\S]*?\*\//y.source, cls: 'text-zinc-500 italic' },
    { re: /"[^"\n]*"|'[^'\n]*'/y.source, cls: 'text-amber-300' },
    { re: /#[0-9a-fA-F]{3,8}\b/y.source, cls: 'text-emerald-400' },
    { re: /@[\w-]+/y.source, cls: 'text-rose-400' },
    { re: /[-a-zA-Z]+(?=\s*:)/y.source, cls: 'text-sky-300' },
    { re: /\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?\b/y.source, cls: 'text-orange-300' },
    { re: /[.#:][\w-]+/y.source, cls: 'text-violet-400' },
  ],
  js: [
    { re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y.source, cls: 'text-zinc-500 italic' },
    { re: /"[^"\n]*"|'[^'\n]*'|`[^`]*`/y.source, cls: 'text-amber-300' },
    { re: /\b(?:const|let|var|function|return|if|else|for|while|new|typeof|delete|true|false|null|undefined|this)\b/y.source, cls: 'text-violet-400' },
    { re: /\b(?:document|window|setInterval|setTimeout|Math|String|Number|Date)\b/y.source, cls: 'text-sky-300' },
    { re: /\b\w+(?=\s*\()/y.source, cls: 'text-emerald-300' },
    { re: /\b\d+(?:\.\d+)?\b/y.source, cls: 'text-orange-300' },
    { re: /=>/y.source, cls: 'text-rose-400' },
  ],
}

export function langOf(file) {
  if (file === 'html') return 'html'
  if (file === 'css') return 'css'
  return 'js'
}

export function highlight(code, lang) {
  const pats = PATTERNS[lang]
  if (!pats || !code) return escapeHtml(code || '')
  const master = new RegExp(pats.map((p) => `(${p.re})`).join('|'), 'g')
  let out = ''
  let last = 0
  let m
  while ((m = master.exec(code)) !== null) {
    if (m[0].length === 0) {
      master.lastIndex++
      continue
    }
    out += escapeHtml(code.slice(last, m.index))
    const gi = m.slice(1).findIndex((g) => g !== undefined)
    out += `<span class="${pats[gi].cls}">${escapeHtml(m[0])}</span>`
    last = m.index + m[0].length
  }
  return out + escapeHtml(code.slice(last))
}
