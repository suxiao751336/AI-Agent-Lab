/* ============================================================
 * Conversation Navigator Agent · 消息内容块渲染
 * ------------------------------------------------------------
 * - MarkdownText：轻量 Markdown 渲染（标题 / 列表 / 加粗 / 行内代码）
 * - MessageBlocks：按 block.type 渲染文本 / 代码 / 图片 / 图表
 * 代码高亮复用 utils/highlight.js（html / css / js）
 * ============================================================ */

import { highlight } from '../../utils/highlight'
import { ImageFigure, ChartFigure } from './Figures'

/* ---------- 行内元素：**加粗** 与 `行内代码` ---------- */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`)/g

function renderInline(text, keyPrefix) {
  const parts = text.split(INLINE_RE)
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-zinc-50">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded border border-zinc-700/60 bg-zinc-800/70 px-1 py-0.5 font-mono text-[12px] text-amber-300"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={key}>{part}</span>
  })
}

/* ---------- 块级 Markdown：标题 / 列表 / 段落 ---------- */

function MarkdownText({ text }) {
  const lines = text.split('\n')
  const out = []
  let listBuf = [] // { ordered, items: [] }
  let paraBuf = []

  const flushList = (key) => {
    if (!listBuf.length) return
    const { ordered, items } = listBuf
    const Tag = ordered ? 'ol' : 'ul'
    out.push(
      <Tag
        key={key}
        className={`my-1.5 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-zinc-500`}
      >
        {items.map((item, i) => (
          <li key={i} className="leading-6 text-zinc-300">
            {renderInline(item, `${key}-i${i}`)}
          </li>
        ))}
      </Tag>,
    )
    listBuf = []
  }

  const flushPara = (key) => {
    if (!paraBuf.length) return
    out.push(
      <p key={key} className="my-1.5 leading-7 text-zinc-300">
        {renderInline(paraBuf.join(' '), key)}
      </p>,
    )
    paraBuf = []
  }

  lines.forEach((line, idx) => {
    const key = `md-${idx}`

    if (line.startsWith('### ')) {
      flushList(key + 'l')
      flushPara(key + 'p')
      out.push(
        <h4 key={key} className="mt-2.5 mb-1 text-[14px] font-semibold text-zinc-100">
          {renderInline(line.slice(4), key)}
        </h4>,
      )
      return
    }
    if (line.startsWith('## ')) {
      flushList(key + 'l')
      flushPara(key + 'p')
      out.push(
        <h3 key={key} className="mt-2.5 mb-1 text-[15px] font-semibold text-zinc-100">
          {renderInline(line.slice(3), key)}
        </h3>,
      )
      return
    }

    const olMatch = line.match(/^\d+\.\s+(.*)$/)
    const ulMatch = line.match(/^-\s+(.*)$/)
    if (olMatch) {
      flushPara(key + 'p')
      if (listBuf.length && !listBuf.ordered) flushList(key + 'l')
      if (!listBuf.length) listBuf = { ordered: true, items: [] }
      listBuf.items.push(olMatch[1])
      return
    }
    if (ulMatch) {
      flushPara(key + 'p')
      if (listBuf.length && listBuf.ordered) flushList(key + 'l')
      if (!listBuf.length) listBuf = { ordered: false, items: [] }
      listBuf.items.push(ulMatch[1])
      return
    }

    if (line.trim() === '') {
      flushList(key + 'l')
      flushPara(key + 'p')
      return
    }

    flushList(key + 'l')
    paraBuf.push(line)
  })

  flushList('md-last-l')
  flushPara('md-last-p')
  return <div className="text-[13.5px]">{out}</div>
}

/* ---------- 代码块 ---------- */

const LANG_BADGE = {
  js: { label: 'JS', cls: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' },
  css: { label: 'CSS', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
}

function CodeBlock({ block }) {
  const { title, language, code } = block
  const badge = LANG_BADGE[language] ?? {
    label: language.toUpperCase(),
    cls: 'border-zinc-700 bg-zinc-800 text-zinc-400',
  }
  /* highlight 仅支持 html/css/js，其余语言原样转义展示 */
  const langKey = language === 'css' ? 'css' : language === 'html' ? 'html' : 'js'
  const supported = language === 'js' || language === 'css' || language === 'html'
  const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = supported ? highlight(code, langKey) : escaped
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-zinc-800 bg-[#0b0b10]">
      <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/60 px-3 py-1.5">
        <span className="truncate text-xs font-medium text-zinc-300">{title}</span>
        <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-6 text-zinc-300">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}

/* ---------- 图片 / 图表 ---------- */

function ImageBlock({ block }) {
  return (
    <figure className="my-2.5">
      <ImageFigure variant={block.variant} />
      <figcaption className="mt-1.5 flex items-baseline gap-2 text-xs text-zinc-500">
        <span className="shrink-0 font-medium text-zinc-400">{block.title}</span>
        <span className="truncate">{block.caption}</span>
      </figcaption>
    </figure>
  )
}

function ChartBlock({ block }) {
  return (
    <figure className="my-2.5">
      <ChartFigure kind={block.kind} data={block.data} />
      <figcaption className="mt-1.5 flex items-baseline gap-2 text-xs text-zinc-500">
        <span className="shrink-0 font-medium text-zinc-400">{block.title}</span>
        <span className="truncate">{block.caption}</span>
      </figcaption>
    </figure>
  )
}

/* ---------- 思考流（流式期间展示，正文出现后由父级移除） ---------- */

function ReasoningBlock({ block }) {
  return (
    <div className="my-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
        思考中：
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-zinc-500">{block.text}</p>
    </div>
  )
}

/* ---------- 块分发 ---------- */

export default function MessageBlocks({ blocks }) {
  return (
    <>
      {(blocks ?? []).map((block, i) => {
        if (block.type === 'text') return <MarkdownText key={i} text={block.text} />
        if (block.type === 'code') return <CodeBlock key={i} block={block} />
        if (block.type === 'image') return <ImageBlock key={i} block={block} />
        if (block.type === 'chart') return <ChartBlock key={i} block={block} />
        if (block.type === 'reasoning') return <ReasoningBlock key={i} block={block} />
        return null
      })}
    </>
  )
}
