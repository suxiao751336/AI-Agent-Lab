/* ============================================================
 * Conversation Navigator Agent · 话题目录生成（阶段 1 · 全量分析）
 *
 * 职责：
 *  1. 读取 NAVIGATOR_MODEL（默认 deepseek-ai/DeepSeek-V4-Flash），
 *     复用 SILICONFLOW_API_KEY，与 Vibe Coding 的 Kimi 配置完全独立
 *  2. 压缩会话消息为分析上下文（文本截断 / 代码与媒体占位）
 *  3. 单次流式请求模型输出结构化 JSON（兼容扁平 parentTopicId
 *     与嵌套 children 两种层级形状，归一化后统一校验），
 *     不使用逐话题 Function Calling；真实接收进度经
 *     stream_start / stream_progress 事件实时上报
 *  4. 服务端严格校验：JSON 结构 / 层级关系 / messageId 必须真实存在，
 *     校验通过后才构建目录树返回前端
 *  5. 真实阶段事件（loaded/analyzing/validating）经 onStage 回调
 *     转发，由 devServer 以 SSE 推送到前端
 *
 * 本模块为纯函数（payload → result），不绑定 HTTP 框架，
 * 不触碰 Visual Coding Agent（llmApi.js / agentLoop.js）。
 *
 * 安全：API Key 仅在服务端读取；所有对外事件与错误信息经 sanitize
 * 脱敏。单次请求、无重试、无降级（付费请求不自动重复）。
 * ============================================================ */

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const FALLBACK_MODEL = 'deepseek-ai/DeepSeek-V4-Flash'
/* 双层超时（与 agentLoop.js 同模式）：长会话（如 TravelMate 92 条消息）的
 * 推理 + 大 JSON 输出可能持续数分钟，绝对 120s 会误杀仍在正常输出的流 */
const HARD_TIMEOUT_MS = 300_000 /* 硬上限：总耗时达到即中止，即使数据仍在输出 */
const NO_PROGRESS_TIMEOUT_MS = 60_000 /* 无进度超时：连续 60s 未收到任何流式数据（含响应头未到达） */
const MAX_TOKENS = 8192 /* 两级目录（一级 + 二级）输出空间 */
const MAX_MESSAGES = 500
const MAX_MESSAGE_CHARS = 600 /* 单条消息压缩上限 */
const MAX_TOPICS = 40 /* 话题总数上限（超出视为模型输出异常） */
const MAX_TITLE_LEN = 60
const MAX_SUMMARY_LEN = 200
const MAX_DEPTH = 2 /* 仅支持一级 / 二级目录 */

/* ── 脱敏：抹掉可能意外出现的 API Key 值 ── */

export function sanitize(text) {
  let out = String(text ?? '')
  const key = process.env.SILICONFLOW_API_KEY
  if (key && key.length > 8) out = out.split(key).join('sk-****')
  return out
}

function brief(text, n = 40) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

function extractJson(content) {
  let text = String(content || '').trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
  }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last <= first) return null
  try {
    return JSON.parse(text.slice(first, last + 1))
  } catch {
    return null
  }
}

/* ── HTTP 状态分类（细分错误类型，沿用 llmApi 的分类口径） ── */

export function classifyHttpError(status, message, elapsedMs) {
  const base = { httpStatus: status, upstream: true, elapsedMs }
  if (status === 401) return { ...base, code: 'UNAUTHORIZED', message: 'API Key 无效（401），请检查 .env 中的 SILICONFLOW_API_KEY' }
  if (status === 403) return { ...base, code: 'FORBIDDEN', message: '无权限访问该模型或 API（403）' }
  if (status === 429) return { ...base, code: 'RATE_LIMIT', message: '请求频率受限（429），请稍后再试' }
  if (status === 402 || /余额|balance/i.test(message)) return { ...base, code: 'INSUFFICIENT_BALANCE', message: '账户余额或额度不足，请前往硅基流动控制台充值' }
  if (status === 404) return { ...base, code: 'MODEL_NOT_FOUND', message: '模型不存在或无权访问（404），请检查 NAVIGATOR_MODEL 配置' }
  if (status >= 500) return { ...base, code: 'UPSTREAM_ERROR', message: `硅基流动上游服务错误（HTTP ${status}）：${sanitize(message) || '无详细信息'}` }
  if (status === 400) return { ...base, code: 'BAD_PARAMS', message: `请求参数错误（400）：${sanitize(message) || '请检查模型参数配置'}` }
  return { ...base, code: 'UPSTREAM_ERROR', message: `硅基流动返回 HTTP ${status}：${sanitize(message) || '未知错误'}` }
}

/* ── 消息压缩：文本截断、代码 / 媒体块转占位描述 ── */

function flattenBlocks(blocks) {
  const parts = []
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text)
    } else if (b.type === 'code') {
      const lines = String(b.code || '').split('\n').length
      parts.push(`[代码片段·${b.language || 'text'}${b.title ? `·${b.title}` : ''}，约 ${lines} 行]`)
    } else if (b.type === 'image') {
      parts.push(`[图片${b.title ? `·${b.title}` : ''}]`)
    } else if (b.type === 'chart') {
      parts.push(`[图表${b.title ? `·${b.title}` : ''}]`)
    }
  }
  return parts.join('\n').trim()
}

function compressMessages(messages) {
  const lines = []
  for (const m of messages) {
    const role = m?.role === 'user' ? '用户' : 'AI'
    const text = flattenBlocks(m?.blocks).slice(0, MAX_MESSAGE_CHARS)
    lines.push(`${m?.id ?? '?'}｜${role}｜${text || '（无文本内容）'}`)
  }
  return lines.join('\n')
}

/* ── 提示词 ── */

const SYSTEM_PROMPT = `你是对话导航智能体的话题目录分析模块，负责分析一段完整的长对话并生成两级话题目录。

请分两步分析（先通读后细分，两步缺一不可）：
第一步：通读全部消息，识别对话的主要话题（一级话题，通常 5~12 个）。注意同一话题可能在不连续的消息位置多次出现（被打断后重新讨论），必须合并为同一个话题，允许 messageIds 不连续。
第二步：对每个一级话题执行细分检查——重新审视该话题关联的消息，若内容较多且确实包含 2~4 个不同的讨论方向（不同的子需求、方案对比、设计→实现→排错的阶段、同一主题的不同侧面），必须输出对应的二级子话题（parentTopicId 指向该一级话题）；仅当话题内容单薄、只有单一讨论方向时才允许无子话题。关联 8 条以上消息的一级话题通常都存在可细分的讨论方向，不要遗漏第二步。

输出要求（严格遵守）：
1. 只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块围栏。
2. JSON 结构固定为：{"topics": [{"topicId": "t1", "parentTopicId": null, "title": "话题标题", "summary": "一句话摘要", "messageIds": ["m001", "m002"]}]}
3. topics 为扁平列表：一级话题的 parentTopicId 为 null；二级话题的 parentTopicId 填写其父话题的 topicId；最多两级，禁止输出第三级及更深。
4. 层级与粒度要求：
   - 一级话题按讨论内容划分主要主题（例如需求讨论、UI 设计、技术选型、Bug 排查、成本总结等），保持粒度稳定，不要把每一轮对话都拆成独立话题。
   - 只有内容较多、确实存在多个讨论方向的一级话题才拆分二级子话题；每个一级话题的二级子话题通常 2~4 个。
   - 父话题的 messageIds 覆盖该话题的全部消息；二级子话题的 messageIds 取自父话题讨论范围内、对应某个讨论方向的消息子集。
   - 避免过度碎片化与重复分类：话题总数（一级 + 二级）通常在 8~24 个之间，语义相近的子话题应合并。
5. messageIds 必须且只能引用输入对话中真实出现的消息 ID，禁止编造不存在的 ID；每条消息至少归属一个话题，也允许一条消息同时归属多个话题。
6. title 不超过 20 个字，summary 不超过 40 个字，均使用中文。

输出示例（仅结构参考，内容必须基于实际对话）：
{"topics": [
  {"topicId": "t1", "parentTopicId": null, "title": "行程规划需求讨论", "summary": "确定五日游的总体框架", "messageIds": ["m001", "m003", "m005"]},
  {"topicId": "t1-1", "parentTopicId": "t1", "title": "市区路线取舍", "summary": "讨论市区三日路线安排", "messageIds": ["m001", "m003"]},
  {"topicId": "t1-2", "parentTopicId": "t1", "title": "周边一日游选择", "summary": "镰仓与箱根方案对比", "messageIds": ["m005"]},
  {"topicId": "t2", "parentTopicId": null, "title": "预算与交通卡", "summary": "交通卡选择与预算上限", "messageIds": ["m010", "m012"]}
]}`

function buildUserPrompt(transcript) {
  return `以下是一段完整的长对话记录（每行格式：消息ID｜角色｜内容，过长的内容已截断）：

${transcript}

请按系统要求分两步分析这段对话：先完整识别一级主要话题，再对每个内容较多的一级话题执行细分检查，输出带二级子话题的两级目录 JSON（内容单薄的话题保持无子话题）。`
}

/* ── 目录归一化 + 校验与树构建 ── */

/**
 * 归一化模型输出：兼容扁平 parentTopicId 与嵌套 children 两种层级形状。
 * 嵌套 children 递归展开为扁平结构（缺失 topicId 时自动补齐），
 * 确保模型用任一形状表达的二级结构都不丢失。
 */
function flattenTopics(raw) {
  const out = []
  let autoSeq = 0
  const walk = (arr, parentId) => {
    for (const t of arr) {
      if (!t || typeof t !== 'object') continue
      let topicId = typeof t.topicId === 'string' && t.topicId.trim() ? t.topicId.trim() : ''
      if (!topicId) topicId = `auto-${++autoSeq}`
      const parentTopicId =
        parentId ??
        (typeof t.parentTopicId === 'string' && t.parentTopicId.trim() ? t.parentTopicId.trim() : null)
      out.push({ topicId, parentTopicId, title: t.title, summary: t.summary, messageIds: t.messageIds })
      if (Array.isArray(t.children) && t.children.length) walk(t.children, topicId)
    }
  }
  if (Array.isArray(raw)) walk(raw, null)
  return out
}

/**
 * 校验归一化后的扁平 topics 并构建目录树。
 * @returns {{ok:true, topics:Array, topicCount:number, subTopicCount:number, linkedCount:number, warnings:Object}
 *   | {ok:false, error:string}}
 */
function validateAndBuildTopics(flatTopics, validIdSet) {
  const raw = flatTopics
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'topics 缺失或为空' }
  if (raw.length > MAX_TOPICS) return { ok: false, error: `话题数量异常（${raw.length} > ${MAX_TOPICS}）` }

  const warnings = { droppedTopics: 0, unknownMessageIds: 0, depthAdjusted: 0, mismatchedSubTopics: 0 }

  /* 1. 规范化：丢弃无标题或无有效消息关联的话题；统计无效 messageId */
  const items = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    if (Array.isArray(t.messageIds)) {
      for (const id of t.messageIds) {
        if (typeof id === 'string' && !validIdSet.has(id)) warnings.unknownMessageIds++
      }
    }
    const title = typeof t.title === 'string' ? t.title.trim().slice(0, MAX_TITLE_LEN) : ''
    const summary = typeof t.summary === 'string' ? t.summary.trim().slice(0, MAX_SUMMARY_LEN) : ''
    const ids = Array.isArray(t.messageIds)
      ? [...new Set(t.messageIds.filter((id) => typeof id === 'string' && validIdSet.has(id)))]
      : []
    if (!title || ids.length === 0) {
      warnings.droppedTopics++
      continue
    }
    items.push({
      modelId: typeof t.topicId === 'string' ? t.topicId : '',
      parentModelId: typeof t.parentTopicId === 'string' ? t.parentTopicId : '',
      title,
      summary,
      ids,
      id: '',
      parentId: '',
    })
  }
  if (!items.length) return { ok: false, error: '没有同时具备标题与有效消息关联的话题' }

  /* 2. 分配服务端 topicId（at-N，避免与预置目录 / 其他会话冲突） */
  const idMap = new Map()
  items.forEach((it, i) => {
    it.id = `at-${i + 1}`
    if (it.modelId) idMap.set(it.modelId, it.id)
  })
  const indexById = new Map(items.map((it) => [it.id, it]))

  /* 3. 解析父子关系：未知 / 自引用父节点 → 根；环 → 断开为根 */
  for (const it of items) {
    let parent = it.parentModelId ? idMap.get(it.parentModelId) ?? '' : ''
    if (parent === it.id) parent = ''
    it.parentId = parent
  }
  for (const it of items) {
    const seen = new Set([it.id])
    let cur = it
    for (;;) {
      if (!cur.parentId) break
      if (seen.has(cur.parentId)) {
        it.parentId = ''
        warnings.depthAdjusted++
        break
      }
      seen.add(cur.parentId)
      const next = indexById.get(cur.parentId)
      if (!next) break
      cur = next
    }
  }

  /* 4. 层级上限：深于两级的话题上提到根祖先的直接子节点 */
  const rootAncestor = (it) => {
    const guard = new Set([it.id])
    let cur = it
    while (cur.parentId && !guard.has(cur.parentId)) {
      guard.add(cur.parentId)
      const next = indexById.get(cur.parentId)
      if (!next) break
      cur = next
    }
    return cur
  }
  const depthOf = (it) => {
    let d = 1
    let cur = it
    const guard = new Set([it.id])
    while (cur.parentId && !guard.has(cur.parentId)) {
      guard.add(cur.parentId)
      const next = indexById.get(cur.parentId)
      if (!next) break
      cur = next
      d++
    }
    return d
  }
  for (const it of items) {
    if (depthOf(it) > MAX_DEPTH) {
      const root = rootAncestor(it)
      it.parentId = root.id !== it.id ? root.id : ''
      warnings.depthAdjusted++
    }
  }

  /* 5. 构建树（保持模型输出顺序） */
  const childrenOf = new Map()
  const roots = []
  for (const it of items) {
    if (it.parentId && indexById.has(it.parentId) && it.parentId !== it.id) {
      if (!childrenOf.has(it.parentId)) childrenOf.set(it.parentId, [])
      childrenOf.get(it.parentId).push(it)
    } else {
      roots.push(it)
    }
  }
  const toNode = (it) => ({
    id: it.id,
    title: it.title,
    desc: it.summary,
    messageIds: it.ids,
    children: (childrenOf.get(it.id) ?? []).map(toNode),
  })
  const topics = roots.map(toNode)
  if (!topics.length) return { ok: false, error: '目录树构建失败（无根话题）' }

  /* 6. 统计（含软校验：二级话题与父话题消息完全无重叠的数量，仅计入 warnings 不丢弃） */
  let topicCount = 0
  let subTopicCount = 0
  const linked = new Set()
  const walk = (arr, depth, parentIds) => {
    for (const n of arr) {
      if (depth === 1) topicCount++
      else {
        subTopicCount++
        if (parentIds && !n.messageIds.some((id) => parentIds.includes(id))) warnings.mismatchedSubTopics++
      }
      for (const id of n.messageIds) linked.add(id)
      walk(n.children ?? [], depth + 1, n.messageIds)
    }
  }
  walk(topics, 1, null)
  if (!linked.size) return { ok: false, error: '所有话题均未关联有效消息' }

  return { ok: true, topics, topicCount, subTopicCount, linkedCount: linked.size, warnings }
}

/* ── 主入口 ── */

/**
 * @param {{messages: Array<{id:string, role:string, blocks:Array}>}} payload
 * @param {{onStage?:(stage:string, extra:Object)=>void, signal?:AbortSignal}} [hooks]
 * @returns {Promise<{ok:boolean, cancelled?:boolean, code?:string, message?:string, topics?:Array,
 *   stats?:{model:string, elapsedMs:number, usage?:Object, messageCount:number, topicCount:number,
 *   subTopicCount:number, linkedMessageCount:number, warnings:Object}}>}
 */
export async function runTopicGeneration(payload, { onStage, signal } = {}) {
  const started = Date.now()
  const requestId = `nav-${started.toString(36)}`
  const elapsed = () => Date.now() - started
  const emitStage = (stage, extra = {}) => {
    try {
      onStage?.(stage, extra)
    } catch {
      /* 事件回调异常不影响主流程 */
    }
  }

  const apiKey = process.env.SILICONFLOW_API_KEY
  const model = process.env.NAVIGATOR_MODEL || FALLBACK_MODEL
  if (!apiKey) {
    return { ok: false, code: 'NO_API_KEY', message: '服务端未配置 SILICONFLOW_API_KEY：请在项目根目录 .env 填入' }
  }

  const messages = Array.isArray(payload?.messages) ? payload.messages : null
  if (!messages || messages.length === 0) {
    return { ok: false, code: 'BAD_REQUEST', message: '缺少消息列表（messages）' }
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, code: 'BAD_REQUEST', message: `消息数超过上限（${MAX_MESSAGES}）` }
  }

  /* 真实消息 ID 集合（用于校验模型输出不编造 ID） */
  const validIdSet = new Set()
  for (const m of messages) {
    if (typeof m?.id === 'string' && m.id) validIdSet.add(m.id)
  }
  if (!validIdSet.size) {
    return { ok: false, code: 'BAD_REQUEST', message: '消息缺少有效 id 字段' }
  }

  const transcript = compressMessages(messages)
  console.log(`[NAV:${requestId}] 收到请求 · ${validIdSet.size} 条消息 · 压缩后 ${transcript.length} 字符 · 模型 ${model}`)
  emitStage('loaded', { messageCount: validIdSet.size, promptChars: transcript.length })

  const body = {
    model,
    stream: true,
    max_tokens: MAX_TOKENS,
    response_format: { type: 'json_object' },
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(transcript) },
    ],
  }

  emitStage('analyzing', { model })
  console.log(
    `[NAV:${requestId}] 发起流式模型请求 · max_tokens=${MAX_TOKENS} · response_format=json_object · 硬上限 ${HARD_TIMEOUT_MS / 1000}s · 无进度超时 ${NO_PROGRESS_TIMEOUT_MS / 1000}s`,
  )

  /* 单次请求：外部取消信号透传 + 双层超时看门狗（每 500ms 判定，先触发者生效），无重试
   * · 无进度：连续 NO_PROGRESS_TIMEOUT_MS 未收到任何流式数据（含响应头未到达）即中止
   * · 硬上限：总耗时达到 HARD_TIMEOUT_MS，即使数据仍在输出也中止 */
  const controller = new AbortController()
  let timeoutKind = null /* 'HARD' | 'NO_PROGRESS' */
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)
  let lastDataAt = Date.now()
  const watchdog = setInterval(() => {
    const now = Date.now()
    if (now - started >= HARD_TIMEOUT_MS) timeoutKind = 'HARD'
    else if (now - lastDataAt >= NO_PROGRESS_TIMEOUT_MS) timeoutKind = 'NO_PROGRESS'
    if (timeoutKind) controller.abort()
  }, 500)

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
      const classified = classifyHttpError(resp.status, errMessage, elapsed())
      console.error(`[NAV:${requestId}] 上游错误 HTTP ${resp.status} code=${classified.code} elapsed=${elapsed()}ms`)
      return { ok: false, ...classified }
    }

    /* 流式接收：逐 chunk 解析上游 SSE，分别累计 reasoning_content 与
     * content（只报真实字符数，不透出原文）；计时埋点用于定位首字
     * 等待发生在响应头 / reasoning / content 哪个阶段 */
    const headerMs = elapsed()
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let streamStarted = false
    let lastProgressAt = 0
    let reasoningStarted = false
    let reasoningChars = 0
    let lastReasoningAt = 0
    let firstChunkMs = null
    let firstReasoningMs = null
    let firstContentMs = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      lastDataAt = Date.now() /* 任意网络字节到达即视为有进度（重置无进度计时） */
      if (firstChunkMs === null) firstChunkMs = elapsed()
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
        /* 推理分片：首个分片立即上报（消除前端首字等待），
         * 后续按真实接收字符数节流上报 */
        const reasoningPiece = choice.delta?.reasoning_content
        if (typeof reasoningPiece === 'string' && reasoningPiece) {
          if (!reasoningStarted) {
            reasoningStarted = true
            firstReasoningMs = elapsed()
            emitStage('reasoning_start', { model })
          }
          reasoningChars += reasoningPiece.length
          const now = Date.now()
          if (now - lastReasoningAt >= 400) {
            lastReasoningAt = now
            emitStage('reasoning_progress', { chars: reasoningChars })
          }
        }
        const piece = choice.delta?.content
        if (typeof piece === 'string' && piece) {
          if (!streamStarted) {
            streamStarted = true
            firstContentMs = elapsed()
            emitStage('stream_start', { model })
          }
          content += piece
          const now = Date.now()
          if (now - lastProgressAt >= 400) {
            lastProgressAt = now
            emitStage('stream_progress', { chars: content.length })
          }
        }
      }
    }
    if (reasoningChars) emitStage('reasoning_progress', { chars: reasoningChars })
    if (content.length) emitStage('stream_progress', { chars: content.length })
    console.log(
      `[NAV:${requestId}] 流式计时 · 响应头 ${headerMs}ms · 首分片 ${firstChunkMs ?? '-'}ms · 首reasoning ${firstReasoningMs ?? '-'}ms · 首content ${firstContentMs ?? '-'}ms · reasoning ${reasoningChars} 字符 · content ${content.length} 字符 · finish=${finishReason ?? 'unknown'} · 总耗时 ${elapsed()}ms`,
    )
  } catch (e) {
    if (signal?.aborted) {
      console.log(`[NAV:${requestId}] 用户取消 · 已终止上游请求 · 耗时 ${elapsed()}ms`)
      return { ok: false, cancelled: true, code: 'CANCELLED', message: '已取消：上游请求已终止' }
    }
    if (timeoutKind) {
      const isHard = timeoutKind === 'HARD'
      const limit = isHard ? HARD_TIMEOUT_MS : NO_PROGRESS_TIMEOUT_MS
      console.error(
        `[NAV:${requestId}] 超时（${isHard ? '硬上限' : '无进度'} ${limit / 1000}s）· 总耗时 ${elapsed()}ms · 已接收 content ${content.length} 字符`,
      )
      return {
        ok: false,
        code: 'TIMEOUT',
        message: isHard
          ? `上游请求超时（总耗时超过 ${HARD_TIMEOUT_MS / 1000}s），本次未产生完整结果`
          : `上游请求无进度超时（连续 ${NO_PROGRESS_TIMEOUT_MS / 1000}s 未收到任何数据），本次未产生完整结果`,
        timedOut: true,
      }
    }
    console.error(`[NAV:${requestId}] 网络错误：${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, code: 'NETWORK', message: '无法连接硅基流动 API（网络错误），请检查本机网络', upstream: false }
  } finally {
    clearInterval(watchdog)
    signal?.removeEventListener('abort', onExternalAbort)
  }

  if (finishReason === 'length') {
    console.error(`[NAV:${requestId}] 输出被 max_tokens 截断（已接收 ${content.length} 字符）`)
    return {
      ok: false,
      code: 'TRUNCATED',
      message: `模型输出被 max_tokens（${MAX_TOKENS}）截断，结果不完整，未采用`,
      upstream: true,
    }
  }

  const parsed = extractJson(content)
  if (!parsed) {
    console.error(`[NAV:${requestId}] JSON 解析失败 · content 前 120 字符：${brief(content, 120)}`)
    return {
      ok: false,
      code: 'INVALID_JSON',
      message: '模型未返回可解析的 JSON，本次结果未采用',
      upstream: true,
    }
  }

  /* 归一化（扁平 / 嵌套两种形状统一为扁平），诊断原始输出层级 */
  const flattenedRaw = flattenTopics(parsed.topics)
  const rawSubTopicCount = flattenedRaw.filter((t) => t.parentTopicId).length
  emitStage('validating', {
    rawTopicCount: flattenedRaw.length,
    rawSubTopicCount,
    outputChars: content.length,
  })
  console.log(
    `[NAV:${requestId}] 模型原始输出归一化 · ${flattenedRaw.length} 条 · 其中二级 ${rawSubTopicCount} 条 · 输出 ${content.length} 字符`,
  )

  const checked = validateAndBuildTopics(flattenedRaw, validIdSet)
  if (!checked.ok) {
    console.error(`[NAV:${requestId}] 目录校验失败：${checked.error}`)
    return { ok: false, code: 'INVALID_TOPICS', message: `目录校验失败：${checked.error}`, upstream: true }
  }

  /* 流式请求的 usage 由 include_usage 的最后一个 chunk 捕获（无则 null） */
  const usageSummary = usage
    ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      }
    : null

  const stats = {
    model,
    elapsedMs: elapsed(),
    usage: usageSummary,
    messageCount: validIdSet.size,
    topicCount: checked.topicCount,
    subTopicCount: checked.subTopicCount,
    linkedMessageCount: checked.linkedCount,
    warnings: checked.warnings,
  }

  console.log(
    `[NAV:${requestId}] 完成 · 一级话题 ${checked.topicCount} · 二级 ${checked.subTopicCount} · 消息覆盖 ${checked.linkedCount}/${validIdSet.size} · tokens ${usage?.prompt_tokens ?? '?'}/${usage?.completion_tokens ?? '?'} · 耗时 ${elapsed()}ms`,
  )

  return { ok: true, topics: checked.topics, stats }
}
