/* ============================================================
 * Conversation Navigator · 中间普通聊天（核心逻辑，零依赖）
 * ------------------------------------------------------------
 * 职责：
 *  1. 校验前端传入的历史消息（角色白名单 / 单条长度 / 总量上限）
 *  2. 上下文超限时采用明确的「保留最近 N 条」截取策略并记录日志
 *  3. 调用 /v1/chat/completions（stream=true），逐分片回调 onDelta
 *  4. 错误细分 + 脱敏（复用 navigator.js 的工具函数）
 *
 * 本模块为纯函数（payload → result），不绑定任何 HTTP 框架：
 *  · 本地开发：由 server/devServer.js 挂载到 Vite dev server
 *
 * 约束：普通聊天不提供工具 / Function Calling / Agent Loop，
 * 仅文字问答；单次请求无重试、无超时中断；用户取消时终止上游请求。
 * ============================================================ */

import { classifyHttpError, sanitize } from './navigator.js'

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const FALLBACK_MODEL = 'deepseek-ai/DeepSeek-V4-Flash'
/* 普通问答不设超时中断：流式回复期间数据持续到达（reasoning/正文分片），
 * 绝对超时会误杀正常生成；异常卡死由用户「停止生成」按钮中止（外部 signal） */
const MAX_TOKENS = 1024 /* 单次输出 Token 上限 */
const MAX_MESSAGES = 40 /* 上下文条数上限（服务端侧） */
const MAX_MESSAGE_CHARS = 8000 /* 单条消息字符上限 */
const MAX_TOTAL_CHARS = 40_000 /* 上下文总字符上限 */

const SYSTEM_PROMPT = `你是 Conversation Navigator 应用内的 AI 对话助手。

要求：
1. 用与用户一致的语言自然、简洁地回答问题。
2. 涉及代码时使用 Markdown 代码块。
3. 不虚构事实，不确定时如实说明。`

/* 校验 + 截取历史上下文：角色白名单（user/assistant）、内容非空、
 * 超限从最旧开始丢弃（保留最近的消息，策略明确且日志可查） */
function buildContextMessages(rawMessages) {
  const cleaned = []
  for (const m of rawMessages) {
    if (!m || typeof m !== 'object') continue
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null
    if (!role) continue
    const content = typeof m.content === 'string' ? m.content.trim() : ''
    if (!content) continue
    cleaned.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) })
  }
  let dropped = 0
  while (cleaned.length > MAX_MESSAGES) {
    cleaned.shift()
    dropped++
  }
  while (
    cleaned.length > 1 &&
    cleaned.reduce((n, m) => n + m.content.length, 0) > MAX_TOTAL_CHARS
  ) {
    cleaned.shift()
    dropped++
  }
  return { messages: cleaned, dropped }
}

/* ── 主入口 ── */

/**
 * @param {{messages: Array<{role:'user'|'assistant', content:string}>}} payload
 * @param {{onDelta?:(text:string)=>void, onReasoning?:(text:string)=>void, signal?:AbortSignal}} [hooks]
 * @returns {Promise<{ok:boolean, code?:string, message?:string, cancelled?:boolean,
 *   content?:string, finishReason?:string, usage?:Object, elapsedMs?:number, model?:string}>}
 */
export async function runChatCompletion(payload, { onDelta, onReasoning, signal } = {}) {
  const started = Date.now()
  const elapsed = () => Date.now() - started

  const apiKey = process.env.SILICONFLOW_API_KEY
  const model = process.env.NAVIGATOR_MODEL || FALLBACK_MODEL
  if (!apiKey) {
    return {
      ok: false,
      code: 'NO_API_KEY',
      message: '服务端未配置 SILICONFLOW_API_KEY：请在项目根目录 .env 文件中填入',
    }
  }

  const { messages: contextMessages, dropped } = buildContextMessages(payload?.messages)
  if (contextMessages.length === 0) {
    return { ok: false, code: 'BAD_REQUEST', message: '缺少有效的聊天消息（messages）' }
  }
  if (dropped > 0) {
    console.log(`[NAVCHAT] 上下文截取：丢弃最旧 ${dropped} 条消息（超出条数/字符上限，保留最近消息）`)
  }

  const body = {
    model,
    stream: true,
    max_tokens: MAX_TOKENS,
    stream_options: { include_usage: true },
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...contextMessages],
  }
  console.log(`[NAVCHAT] 发起流式聊天请求 · model=${model} · 上下文 ${contextMessages.length} 条 · max_tokens=${MAX_TOKENS}`)

  /* 单次请求：仅外部取消信号透传（用户停止），无超时中断、无重试 */
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)

  let content = ''
  let finishReason = null
  let usage = null
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      let errMessage = errText
      try {
        const j = JSON.parse(errText)
        errMessage = j?.message || j?.error?.message || errText
      } catch {
        /* 非 JSON 错误体 */
      }
      const classified = classifyHttpError(resp.status, sanitize(errMessage), elapsed())
      console.error(`[NAVCHAT] 上游错误 HTTP ${resp.status} code=${classified.code} elapsed=${elapsed()}ms`)
      return { ok: false, ...classified }
    }

    /* 流式接收：逐 chunk 解析上游 SSE，delta.content 逐分片回调
     * （reasoning_content 不转发，仅输出正文） */
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payloadStr = trimmed.slice(5).trim()
        if (!payloadStr || payloadStr === '[DONE]') continue
        let chunk
        try {
          chunk = JSON.parse(payloadStr)
        } catch {
          continue
        }
        if (chunk.usage) usage = chunk.usage
        const choice = chunk.choices?.[0]
        if (!choice) continue
        if (choice.finish_reason) finishReason = choice.finish_reason
        /* 思考流分片：实时透传（前端以浅色「思考中」展示，正文出现后隐藏） */
        const reasoningPiece = choice.delta?.reasoning_content
        if (typeof reasoningPiece === 'string' && reasoningPiece) {
          onReasoning?.(reasoningPiece)
        }
        const piece = choice.delta?.content
        if (typeof piece === 'string' && piece) {
          content += piece
          onDelta?.(piece)
        }
      }
    }
    /* 聊天输出达到 max_tokens：保留已生成内容（非致命），仅记录 */
    if (finishReason === 'length') {
      console.warn(`[NAVCHAT] 输出达到 max_tokens（${MAX_TOKENS}）被截断，返回已生成部分`)
    }
    console.log(`[NAVCHAT] 回复完成 · ${content.length} 字符 · finish=${finishReason ?? 'unknown'} · 耗时 ${elapsed()}ms`)
    const usageSummary = usage
      ? {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        }
      : null
    return { ok: true, content, finishReason, usage: usageSummary, elapsedMs: elapsed(), model }
  } catch (e) {
    if (signal?.aborted) {
      console.log(`[NAVCHAT] 用户停止 · 已终止上游请求（已生成 ${content.length} 字符）`)
      return { ok: false, cancelled: true, code: 'CANCELLED', message: '已停止生成' }
    }
    console.error(`[NAVCHAT] 网络错误：${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, code: 'NETWORK', message: '无法连接硅基流动 API（网络错误），请检查本机网络' }
  } finally {
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
