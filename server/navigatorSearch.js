/* ============================================================
 * Conversation Navigator · 智能回溯 Search Agent（「AI 帮我找」核心逻辑）
 * ------------------------------------------------------------
 * 用户输入模糊自然语言描述 → Function Calling Agent Loop 自主
 * 检索当前会话的数据快照（话题目录 + 原始消息），返回可点击、
 * 可验证的原始消息位置：
 *   1. 工具：search_topics / search_messages / read_context（只读）
 *           submit_results（提交最终结果并结束检索）
 *   2. 模糊语义理解由 DeepSeek 完成：同义改写、多组关键词、
 *      一次未命中自动换表达重搜，不依赖字面匹配
 *   3. 服务端严格校验：只能引用快照内真实存在的 messageId /
 *      topicId，excerpt 必须摘自原文（不符时服务端重新截取），
 *      不接受模型编造的定位结果
 *   4. 数据安全：只在请求携带的当前会话快照内检索，模型无权
 *      访问其他会话、文件或外部网站
 *
 * 上限：最多 6 轮模型调用、单轮 60s、总 150s、Token 预算
 * 24000、max_tokens 2048/轮；单次请求无重试。
 * ============================================================ */

import { classifyHttpError, sanitize } from './navigator.js'
import { normalizeDirectory } from './navigatorIncremental.js'

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const FALLBACK_MODEL = 'deepseek-ai/DeepSeek-V4-Flash'
const TURN_TIMEOUT_MS = 60_000 /* 单轮请求超时 */
const TOTAL_TIMEOUT_MS = 150_000 /* 整个 Agent Loop 超时 */
const MAX_TURNS = 6
const MAX_TOKENS = 2048
const MAX_TOTAL_TOKENS = 24_000 /* Token 预算（累计，超出即终止） */
const MAX_MESSAGES = 500 /* 快照消息条数上限 */
const MAX_MESSAGE_CHARS = 4000 /* 单条消息文本上限 */
const MAX_QUERY_CHARS = 200 /* 查找描述上限 */
const MAX_KEYWORDS = 8 /* 单次检索关键词数上限 */
const MAX_KEYWORD_CHARS = 24
const MAX_TOPIC_HITS = 8 /* search_topics 返回上限 */
const MAX_MESSAGE_HITS = 20 /* search_messages 返回上限 */
const EXCERPT_CHARS = 120 /* 命中片段长度 */
const MAX_READ_CHARS = 500 /* read_context 单条文本上限 */
const READ_RADIUS = 3 /* read_context 前后文最大条数 */
const MAX_RESULTS = 5 /* 最终结果条数上限 */
const MAX_TITLE_CHARS = 24
const MAX_REASON_CHARS = 120
const MAX_NOTE_CHARS = 120

/* ---------- 工具定义（Function Calling） ---------- */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_topics',
      description:
        '在当前会话的话题目录中按关键词查找相关主题，返回 topicId、标题、摘要与关联消息位置。适合先缩小讨论范围。',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '关键词列表（1~8 个，近义表达可一起传）',
          },
        },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_messages',
      description:
        '在当前会话的全部原始消息中按关键词检索候选内容（支持多关键词）。mode="any" 命中任一关键词即召回（宽召回），mode="all" 须全部命中（精筛）。返回真实 messageId、角色、原文片段与命中词；可多次调用。',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: '关键词列表（1~8 个），建议传同义 / 近义词提高召回',
          },
          mode: {
            type: 'string',
            enum: ['any', 'all'],
            description: '多关键词匹配模式，默认 any',
          },
        },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_context',
      description:
        '按真实 messageId 读取候选消息及其前后各最多 3 条消息的原文，用于验证候选是否真正符合用户的模糊描述。',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: '候选消息 ID（必须来自工具返回结果）' },
          before: { type: 'integer', description: '向前读取条数（0~3，默认 2）' },
          after: { type: 'integer', description: '向后读取条数（0~3，默认 2）' },
        },
        required: ['messageId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_results',
      description:
        '提交最终检索结果并结束本次查找。找到可靠匹配时 found=true 并给出 1~5 个按相关性从高到低排列的结果；没有可靠证据时必须 found=false，并在 note 说明已尝试的检索方向，绝不编造定位。',
      parameters: {
        type: 'object',
        properties: {
          found: { type: 'boolean', description: '是否找到可靠匹配' },
          note: { type: 'string', description: '一句话结论（未找到时说明已尝试的检索词）' },
          results: {
            type: 'array',
            description: '定位结果（found=true 时 1~5 个）',
            items: {
              type: 'object',
              properties: {
                messageId: { type: 'string', description: '原始消息 ID（必须真实存在）' },
                topicId: { type: 'string', description: '能关联到现有话题时填写' },
                title: { type: 'string', description: '该段讨论的简短标题（12 字内）' },
                reason: { type: 'string', description: '为什么认为这条消息符合用户描述' },
                excerpt: { type: 'string', description: '摘自原文的简短片段（不超过 100 字）' },
                relevance: { type: 'string', enum: ['high', 'medium', 'low'], description: '相关性等级' },
              },
              required: ['messageId', 'title', 'reason'],
            },
          },
        },
        required: ['found'],
      },
    },
  },
]

const SYSTEM_PROMPT = `你是 Conversation Navigator 的历史消息检索智能体。用户会用模糊、口语化的记忆描述，寻找当前会话历史消息中的一段讨论。你的任务：通过工具在给定的会话数据中检索，定位真实存在的原始消息，并提交可验证的定位结果。

可用工具（自主决定调用顺序与次数，不要求全部调用）：
- search_topics(keywords)：按关键词查话题目录，返回话题标题 / 摘要 / 关联消息位置。
- search_messages(keywords, mode)：按关键词检索原始消息。mode='any' 命中任一关键词即返回（宽召回），mode='all' 须全部命中（精筛）。
- read_context(messageId)：读取候选消息及前后文原文，验证是否真的符合。
- submit_results(...)：提交最终结果，结束检索。

模糊语义检索策略（最重要的能力）：
- 用户的措辞往往与原文完全不同（例：原文「API 调用成本超出预算」⇔ 用户「找一下之前那个太烧钱的模型方案」）。
- 先推断真实意图，为同一意图准备多组表达：同义词、近义词、相关事件词（如 烧钱→成本/预算/费用/开销/花钱）。
- 一组关键词没有命中很正常：立即换另一组表达重新 search_messages，或先用 search_topics 从话题目录缩小范围再定位消息。
- 目录为空或话题未命中时，直接 search_messages 检索原始消息，不要放弃。

提交前必须验证：
- 用 read_context 确认候选消息（含前后文）确实与用户描述相符，excerpt 必须摘自原文。
- 只能提交工具结果中出现过的 messageId / topicId，绝不编造。
- 结果按相关性从高到低排列，最多 5 条；同一话题的多段不连续讨论应拆成多个结果，分别指向各段消息。

诚实性（最高优先级）：
- 只依据工具返回的会话内容判断，不允许用自己的知识猜测、补充历史细节。
- 找不到可靠证据时，调用 submit_results 提交 found=false，并在 note 中简要说明已尝试的检索方向；宁可无结果，绝不编造定位。`

/* ---------- 输入校验与快照构建 ---------- */

function normStr(v, max) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : ''
}

function briefText(text, n = 60) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/**
 * 构建会话快照：消息白名单（会话时间序）+ 扁平目录。
 * 服务端不信任前端：messageId 白名单从 messages 本身派生，
 * 目录 messageIds 只保留白名单内的 ID。
 * 导出供无付费回归测试使用。
 * @returns {{ok:true, conversationId, query, messages:Array, order:Map, topics:Array}
 *   | {ok:false, code:'BAD_REQUEST', message:string}}
 */
export function normalizeSearchSnapshot(payload) {
  const conversationId = normStr(payload?.conversationId, 64)
  const query = normStr(payload?.query, MAX_QUERY_CHARS)
  if (!conversationId) return { ok: false, code: 'BAD_REQUEST', message: '缺少会话 ID（conversationId）' }
  if (!query) return { ok: false, code: 'BAD_REQUEST', message: '缺少查找描述（query）' }
  const rawMessages = Array.isArray(payload?.messages) ? payload.messages : []
  if (!rawMessages.length) return { ok: false, code: 'BAD_REQUEST', message: '当前会话没有可检索的消息' }
  const messages = []
  const order = new Map()
  for (const m of rawMessages) {
    if (!m || typeof m !== 'object') continue
    const id = normStr(m.id, 64)
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null
    const text = typeof m.text === 'string' ? m.text.slice(0, MAX_MESSAGE_CHARS) : ''
    if (!id || !role || !text.trim() || order.has(id)) continue
    order.set(id, messages.length)
    messages.push({ id, role, text })
    if (messages.length >= MAX_MESSAGES) break
  }
  if (!messages.length) {
    return { ok: false, code: 'BAD_REQUEST', message: '消息缺少有效的 id / role / text' }
  }
  const topics = normalizeDirectory(payload?.topics).map((t) => ({
    ...t,
    messageIds: t.messageIds.filter((id) => order.has(id)),
  }))
  return { ok: true, conversationId, query, messages, order, topics }
}

/* ---------- 工具实现（纯函数，导出供回归测试） ---------- */

function normalizeKeywords(raw) {
  const out = []
  const seen = new Set()
  for (const k of Array.isArray(raw) ? raw : []) {
    const s = normStr(k, MAX_KEYWORD_CHARS).toLowerCase()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= MAX_KEYWORDS) break
  }
  return out
}

function makeExcerpt(text, aroundIndex) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  const start = Math.max(0, aroundIndex - 40)
  const slice = flat.slice(start, start + EXCERPT_CHARS)
  return (start > 0 ? '…' : '') + slice + (start + EXCERPT_CHARS < flat.length ? '…' : '')
}

/** search_topics：目录标题 / 摘要关键词匹配（标题命中权重更高） */
export function searchTopics(snapshot, rawKeywords) {
  const keywords = normalizeKeywords(rawKeywords)
  if (!keywords.length) return { ok: false, error: 'keywords 不能为空（1~8 个）' }
  const hits = []
  for (const t of snapshot.topics) {
    const title = t.title.toLowerCase()
    const summary = (t.summary ?? '').toLowerCase()
    const hitInTitle = keywords.filter((k) => title.includes(k))
    const hitInSummary = keywords.filter((k) => summary.includes(k))
    const matched = [...new Set([...hitInTitle, ...hitInSummary])]
    if (!matched.length) continue
    hits.push({
      topicId: t.topicId,
      parentTopicId: t.parentTopicId,
      title: t.title,
      summary: t.summary,
      matchedKeywords: matched,
      score: hitInTitle.length * 2 + hitInSummary.length,
      messageCount: t.messageIds.length,
      messageIds:
        t.messageIds.length > 20
          ? [...t.messageIds.slice(0, 20), `…共${t.messageIds.length}条`]
          : t.messageIds,
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return { ok: true, keywords, hits: hits.slice(0, MAX_TOPIC_HITS), total: hits.length }
}

/** search_messages：原始消息全文关键词检索，支持 any / all 两种模式 */
export function searchMessages(snapshot, rawKeywords, mode = 'any') {
  const keywords = normalizeKeywords(rawKeywords)
  if (!keywords.length) return { ok: false, error: 'keywords 不能为空（1~8 个）' }
  const all = mode === 'all'
  const hits = []
  for (const m of snapshot.messages) {
    const lower = m.text.toLowerCase()
    const matched = keywords.filter((k) => lower.includes(k))
    if (!matched.length) continue
    if (all && matched.length < keywords.length) continue
    hits.push({
      messageId: m.id,
      role: m.role,
      excerpt: makeExcerpt(m.text, lower.indexOf(matched[0])),
      matchedKeywords: matched,
    })
  }
  return {
    ok: true,
    keywords,
    mode: all ? 'all' : 'any',
    hits: hits.slice(0, MAX_MESSAGE_HITS),
    total: hits.length,
  }
}

/** read_context：按白名单 messageId 读取候选消息及前后文（半径钳制 0~3） */
export function readContext(snapshot, messageId, before = 2, after = 2) {
  const id = normStr(messageId, 64)
  const idx = id ? snapshot.order.get(id) : undefined
  if (idx === undefined) {
    return { ok: false, error: `消息 ${id || '(空)'} 不在当前会话中，只能读取工具结果里出现过的 messageId` }
  }
  const b = Math.max(0, Math.min(READ_RADIUS, Number.isInteger(before) ? before : 2))
  const a = Math.max(0, Math.min(READ_RADIUS, Number.isInteger(after) ? after : 2))
  const from = Math.max(0, idx - b)
  const to = Math.min(snapshot.messages.length, idx + a + 1)
  const messages = []
  for (let i = from; i < to; i++) {
    const m = snapshot.messages[i]
    messages.push({
      messageId: m.id,
      role: m.role,
      position: i - idx,
      text: m.text.slice(0, MAX_READ_CHARS),
    })
  }
  return { ok: true, target: id, before: b, after: a, messages }
}

/* ---------- submit_results：服务端校验（拒绝编造定位） ---------- */

/**
 * 校验模型提交的结果：messageId 必须在白名单、topicId 必须存在、
 * excerpt 必须摘自原文（不符时由服务端从原文重新截取）、最多 5 条、
 * 去重。返回通过校验的结果与拒因警告。
 */
export function validateResults(snapshot, rawResults) {
  const warnings = []
  const results = []
  const seen = new Set()
  for (const r of Array.isArray(rawResults) ? rawResults : []) {
    if (!r || typeof r !== 'object') continue
    if (results.length >= MAX_RESULTS) {
      warnings.push(`结果超过 ${MAX_RESULTS} 条，仅保留最相关的前 ${MAX_RESULTS} 条`)
      break
    }
    const messageId = normStr(r.messageId, 64)
    if (!messageId || !snapshot.order.has(messageId)) {
      warnings.push(`丢弃编造的 messageId：${messageId || '(空)'}`)
      continue
    }
    if (seen.has(messageId)) {
      warnings.push(`丢弃重复的 messageId：${messageId}`)
      continue
    }
    seen.add(messageId)
    const msg = snapshot.messages[snapshot.order.get(messageId)]
    let topicId = normStr(r.topicId, 64)
    if (topicId && !snapshot.topics.some((t) => t.topicId === topicId)) {
      warnings.push(`topicId ${topicId} 不在当前目录中，已移除该关联`)
      topicId = ''
    }
    let excerpt = normStr(r.excerpt, 100)
    const flat = String(msg.text ?? '').replace(/\s+/g, ' ').trim()
    /* excerpt 必须来自原文：模型编造或改写时不采用，改为原文截取 */
    if (!excerpt || !flat.includes(excerpt.replace(/\s+/g, ' ').trim())) {
      excerpt = flat.slice(0, 100) + (flat.length > 100 ? '…' : '')
    }
    results.push({
      messageId,
      topicId: topicId || null,
      title: normStr(r.title, MAX_TITLE_CHARS) || '相关讨论',
      reason: normStr(r.reason, MAX_REASON_CHARS) || '与查找描述相关的历史消息',
      excerpt,
      relevance: ['high', 'medium', 'low'].includes(r.relevance) ? r.relevance : 'medium',
    })
  }
  return { results, warnings }
}

/* ---------- 流式单轮请求：累计 content + 按 index 拼接 tool_calls ---------- */

async function callModelStream(apiKey, body, { signal, requestId, turn }) {
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TURN_TIMEOUT_MS)
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
      return { error: { phase: 'model_call', ...classifyHttpError(resp.status, sanitize(errMessage), 0) } }
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let content = ''
    let finishReason = null
    let usage = null
    const toolAcc = new Map() /* index -> {name, args} */
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
        const piece = choice.delta?.content
        if (typeof piece === 'string' && piece) content += piece
        for (const tc of choice.delta?.tool_calls ?? []) {
          const idx = typeof tc.index === 'number' ? tc.index : 0
          const cur = toolAcc.get(idx) ?? { name: '', args: '' }
          if (tc.function?.name) cur.name += tc.function.name
          if (tc.function?.arguments) cur.args += tc.function.arguments
          toolAcc.set(idx, cur)
        }
      }
    }
    const toolCalls = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, t]) => ({ index, name: t.name, args: t.args }))
    console.log(
      `[NAVS:${requestId}] 第 ${turn} 轮完成 · content=${content.length} 字符 · tools=${toolCalls.map((t) => t.name).join(',') || '无'} · finish=${finishReason ?? 'unknown'}`,
    )
    return { content, toolCalls, finishReason, usage }
  } catch (e) {
    if (signal?.aborted) return { error: { code: 'CANCELLED', message: '已停止' } }
    if (timedOut) {
      return {
        error: {
          code: 'TIMEOUT',
          message: `第 ${turn} 轮模型请求超时（${TURN_TIMEOUT_MS / 1000}s）`,
          timedOut: true,
          phase: 'model_call',
        },
      }
    }
    return { error: { code: 'UPSTREAM_ERROR', message: sanitize(e?.message ?? '模型流式请求失败'), phase: 'model_call' } }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

/* ---------- 主入口：Agent Loop ---------- */

/**
 * @param {{conversationId:string, query:string, messages:Array<{id,role,text}>, topics:Array}} payload
 * @param {{onStage?:(stage:string, extra:Object)=>void, signal?:AbortSignal,
 *   callModel?:(apiKey:string, body:Object, ctx:Object)=>Promise<Object>}} [hooks]
 *   callModel 可注入（回归测试用假模型，不产生付费请求）
 * @returns {Promise<{ok:boolean, cancelled?:boolean, code?:string, message?:string, phase?:string,
 *   found?:boolean, note?:string, results?:Array, stats?:Object}>}
 */
export async function runSearchAgent(payload, { onStage, signal, callModel } = {}) {
  const started = Date.now()
  const requestId = `srch${started.toString(36)}`
  const elapsed = () => Date.now() - started
  const emit = (stage, extra = {}) => {
    try {
      onStage?.(stage, { requestId, ...extra })
    } catch {
      /* 事件回调异常不影响主流程 */
    }
  }

  const apiKey = process.env.SILICONFLOW_API_KEY
  const model = process.env.NAVIGATOR_MODEL || FALLBACK_MODEL
  if (!apiKey) {
    return { ok: false, code: 'NO_API_KEY', message: '服务端未配置 SILICONFLOW_API_KEY：请在项目根目录 .env 文件中填入', phase: 'config' }
  }
  if (signal?.aborted) {
    return { ok: false, cancelled: true, code: 'CANCELLED', message: '已停止检索', phase: 'abort' }
  }

  /* 快照校验：只检索本次请求携带的当前会话数据 */
  const snap = normalizeSearchSnapshot(payload)
  if (!snap.ok) return { ok: false, code: snap.code, message: snap.message, phase: 'input' }

  const directoryBrief = snap.topics.length
    ? JSON.stringify(
        snap.topics.map((t) => ({
          topicId: t.topicId,
          parentTopicId: t.parentTopicId,
          title: t.title,
          ...(t.summary ? { summary: t.summary } : {}),
          messageCount: t.messageIds.length,
        })),
      )
    : '（当前会话暂无话题目录，可直接用 search_messages 检索原始消息）'

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `【会话概览】当前会话共 ${snap.messages.length} 条消息，已建立本次检索的数据快照。

【话题目录】（扁平结构，parentTopicId 为空表示一级）
${directoryBrief}

【用户想找的内容】（模糊描述，措辞可能与原文完全不同）
${snap.query}

请开始检索：按需调用 search_topics / search_messages / read_context，确认后调用 submit_results 提交结果。`,
    },
  ]

  emit('understanding', { model, messageCount: snap.messages.length, topicCount: snap.topics.length })
  console.log(
    `[NAVS:${requestId}] 检索启动 · conv=${snap.conversationId} · ${snap.messages.length} 条消息 · 目录 ${snap.topics.length} 话题 · query=${briefText(snap.query)}`,
  )

  const totalController = new AbortController()
  const onExternalAbort = () => totalController.abort()
  signal?.addEventListener('abort', onExternalAbort)
  const totalTimer = setTimeout(() => totalController.abort(), TOTAL_TIMEOUT_MS)

  const callTurn = callModel ?? callModelStream
  let usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  const toolCallLog = []
  let turnsUsed = 0
  let submitted = null
  let rejectedBy = null
  try {
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      if (totalController.signal.aborted) break
      if (usageTotal.total_tokens > MAX_TOTAL_TOKENS) {
        console.warn(`[NAVS:${requestId}] Token 预算耗尽 · 累计 ${usageTotal.total_tokens}`)
        return {
          ok: false,
          code: 'TOKEN_BUDGET_EXCEEDED',
          message: `检索 Token 预算耗尽（> ${MAX_TOTAL_TOKENS}），已终止`,
          phase: 'budget',
        }
      }
      const result = await callTurn(
        apiKey,
        {
          model,
          stream: true,
          max_tokens: MAX_TOKENS,
          stream_options: { include_usage: true },
          tools: TOOLS,
          messages,
        },
        { signal: totalController.signal, requestId, turn },
      )
      turnsUsed = turn

      if (result.error) {
        if (signal?.aborted) {
          return { ok: false, cancelled: true, code: 'CANCELLED', message: '已停止检索', phase: 'abort' }
        }
        if (totalController.signal.aborted) {
          return {
            ok: false,
            code: 'TIMEOUT',
            message: `检索总耗时超上限（${TOTAL_TIMEOUT_MS / 1000}s）`,
            timedOut: true,
            phase: 'timeout',
          }
        }
        return { ok: false, ...result.error }
      }
      if (result.usage) {
        usageTotal = {
          prompt_tokens: usageTotal.prompt_tokens + (result.usage.prompt_tokens ?? 0),
          completion_tokens: usageTotal.completion_tokens + (result.usage.completion_tokens ?? 0),
          total_tokens: usageTotal.total_tokens + (result.usage.total_tokens ?? 0),
        }
      }

      const { toolCalls, content } = result
      if (!toolCalls.length) {
        /* 纯文本回复：回填提醒走工具（受轮次 / 超时限制，不额外重试） */
        console.warn(`[NAVS:${requestId}] 模型纯文本回复，回填提醒 · phase=decision`)
        messages.push({ role: 'assistant', content: content || '' })
        messages.push({
          role: 'user',
          content:
            '请通过工具完成检索：需要更多证据就调用 search_topics / search_messages / read_context，有结论就调用 submit_results 提交（无可靠匹配则 found=false）。',
        })
        continue
      }

      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map((t) => ({
          id: `call_${requestId}_${turn}_${t.index}`,
          type: 'function',
          function: { name: t.name, arguments: t.args || '{}' },
        })),
      })

      for (const tc of toolCalls) {
        const toolCallId = `call_${requestId}_${turn}_${tc.index}`
        let args = null
        try {
          args = JSON.parse(tc.args || '{}')
        } catch {
          args = null
        }
        if (args === null) {
          console.warn(`[NAVS:${requestId}] 工具参数 JSON 解析失败 · tool=${tc.name} · phase=tool_args`)
          rejectedBy = rejectedBy ?? 'TOOL_ARGS_INVALID'
          toolCallLog.push(`${tc.name}(参数无效)`)
          emit('tool', { name: tc.name, turn, elapsedMs: elapsed(), detail: '参数 JSON 解析失败，已要求模型重新提交' })
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify({
              ok: false,
              code: 'TOOL_ARGS_INVALID',
              error: '工具参数不是有效 JSON，请重新调用该工具并输出完整合法的 JSON 参数',
            }),
          })
          continue
        }

        if (tc.name === 'search_topics') {
          const out = searchTopics(snap, args.keywords)
          if (!out.ok) {
            toolCallLog.push('search_topics(参数无效)')
            emit('tool', { name: 'search_topics', turn, elapsedMs: elapsed(), detail: 'keywords 参数无效', params: { keywords: args.keywords } })
            messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify({ ok: false, error: out.error }) })
            continue
          }
          const detail = out.hits.length ? `命中 ${out.total} 个相关话题` : '没有命中相关话题，可换关键词或直接 search_messages'
          emit('tool', { name: 'search_topics', turn, elapsedMs: elapsed(), detail, params: { keywords: out.keywords } })
          toolCallLog.push('search_topics')
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify({ ok: true, keywords: out.keywords, total: out.total, hits: out.hits }),
          })
        } else if (tc.name === 'search_messages') {
          const out = searchMessages(snap, args.keywords, args.mode)
          if (!out.ok) {
            toolCallLog.push('search_messages(参数无效)')
            emit('tool', { name: 'search_messages', turn, elapsedMs: elapsed(), detail: 'keywords 参数无效', params: { keywords: args.keywords, mode: args.mode } })
            messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify({ ok: false, error: out.error }) })
            continue
          }
          const detail = out.hits.length
            ? `命中 ${out.total} 条消息${out.total > MAX_MESSAGE_HITS ? `（返回前 ${MAX_MESSAGE_HITS} 条）` : ''}`
            : '没有命中消息，请换一组同义 / 近义关键词重试'
          emit('tool', { name: 'search_messages', turn, elapsedMs: elapsed(), detail, params: { keywords: out.keywords, mode: out.mode } })
          toolCallLog.push('search_messages')
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify({
              ok: true,
              keywords: out.keywords,
              mode: out.mode,
              total: out.total,
              hits: out.hits,
              ...(out.hits.length ? {} : { hint: '本次关键词未命中。请推断用户意图后换用其他表达（同义词 / 相关事件词）重新检索。' }),
            }),
          })
        } else if (tc.name === 'read_context') {
          const out = readContext(snap, args.messageId, args.before, args.after)
          if (!out.ok) {
            toolCallLog.push('read_context(被拒)')
            emit('tool', { name: 'read_context', turn, elapsedMs: elapsed(), detail: 'messageId 不在当前会话中，已拒绝读取', params: { messageId: args.messageId } })
            messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify({ ok: false, error: out.error }) })
            continue
          }
          emit('tool', { name: 'read_context', turn, elapsedMs: elapsed(), detail: `读取 ${out.target} 前后文（${out.messages.length} 条）`, params: { messageId: out.target, before: out.before, after: out.after } })
          toolCallLog.push('read_context')
          messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(out) })
        } else if (tc.name === 'submit_results') {
          const found = args?.found === true
          const note = normStr(args?.note, MAX_NOTE_CHARS)
          if (args?.found !== true && args?.found !== false) {
            console.warn(`[NAVS:${requestId}] submit_results 缺少 found 布尔值 · phase=validate`)
            rejectedBy = rejectedBy ?? 'VALIDATION_REJECTED'
            toolCallLog.push('submit_results(被拒)')
            emit('tool', { name: 'submit_results', turn, elapsedMs: elapsed(), detail: '缺少 found 字段，已要求模型重新提交' })
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({
                ok: false,
                code: 'VALIDATION_REJECTED',
                error: 'found 必须为布尔值：找到可靠匹配为 true，没有则为 false',
              }),
            })
            continue
          }
          if (!found) {
            /* 未找到：合法终态，如实返回（note 说明已尝试的检索方向） */
            submitted = { found: false, note, results: [], warnings: [] }
            emit('tool', { name: 'submit_results', turn, elapsedMs: elapsed(), detail: '确认未找到可靠匹配' })
            toolCallLog.push('submit_results')
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({ ok: true, found: false, results: [] }),
            })
            continue
          }
          const parsed = validateResults(snap, args.results)
          if (!parsed.results.length) {
            /* 提交无效（全部被校验拒绝 / 空）：不落地，回填拒因让模型修正 */
            const reason = Array.isArray(args?.results) && args.results.length
              ? `全部 ${args.results.length} 项结果未通过校验：${parsed.warnings.join('；')}`
              : 'found=true 时必须提供 1~5 个结果（messageId 必须来自工具返回）'
            console.warn(`[NAVS:${requestId}] 结果全部被拒 · code=VALIDATION_REJECTED · phase=validate · ${reason}`)
            rejectedBy = rejectedBy ?? 'VALIDATION_REJECTED'
            toolCallLog.push('submit_results(被拒)')
            emit('tool', { name: 'submit_results', turn, elapsedMs: elapsed(), detail: '结果未通过校验，已要求模型修正' })
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({
                ok: false,
                code: 'VALIDATION_REJECTED',
                error: `${reason}。请修正后重新提交；确实没有可靠匹配请提交 found=false`,
              }),
            })
          } else {
            submitted = { found: true, note, results: parsed.results, warnings: parsed.warnings }
            emit('tool', { name: 'submit_results', turn, elapsedMs: elapsed(), detail: '提交定位结果' })
            toolCallLog.push('submit_results')
            if (parsed.warnings.length) {
              console.warn(`[NAVS:${requestId}] 结果校验警告：${parsed.warnings.join('；')}`)
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({
                ok: true,
                found: true,
                count: parsed.results.length,
                warnings: parsed.warnings,
              }),
            })
          }
        } else {
          emit('tool', { name: tc.name, turn, elapsedMs: elapsed(), detail: '未知工具，已拒绝' })
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify({ ok: false, error: `未知工具 ${tc.name}` }),
          })
        }
      }

      if (submitted) break /* submit 是终态：提交后结束本次检索 */
    }

    if (!submitted) {
      if (signal?.aborted) {
        return { ok: false, cancelled: true, code: 'CANCELLED', message: '已停止检索', phase: 'abort' }
      }
      if (totalController.signal.aborted) {
        return {
          ok: false,
          code: 'TIMEOUT',
          message: `检索总耗时超上限（${TOTAL_TIMEOUT_MS / 1000}s）`,
          timedOut: true,
          phase: 'timeout',
        }
      }
      const code = rejectedBy ?? 'NO_DECISION'
      const phase = code === 'NO_DECISION' ? 'decision' : code === 'TOOL_ARGS_INVALID' ? 'tool_args' : 'validate'
      const message =
        code === 'VALIDATION_REJECTED'
          ? '模型提交的定位结果未通过服务端校验（messageId 编造或不在当前会话），可重新发起查找'
          : code === 'TOOL_ARGS_INVALID'
            ? '模型工具调用参数解析失败，可重新发起查找'
            : '模型未能提交有效的检索结果，可重新发起查找'
      console.warn(`[NAVS:${requestId}] 检索失败 · code=${code} · phase=${phase} · 轮次耗尽`)
      return { ok: false, code, message, phase }
    }

    const stats = {
      model,
      requestId,
      elapsedMs: elapsed(),
      usage: usageTotal,
      turns: turnsUsed,
      toolCalls: toolCallLog,
      found: submitted.found,
      warnings: submitted.warnings,
    }
    console.log(
      `[NAVS:${requestId}] 检索完成 · ${submitted.found ? `${submitted.results.length} 条结果` : '未找到'} · tokens ${usageTotal.total_tokens} · 耗时 ${elapsed()}ms`,
    )
    return { ok: true, found: submitted.found, note: submitted.note || null, results: submitted.results, stats }
  } finally {
    clearTimeout(totalTimer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
