/* ============================================================
 * Conversation Navigator · 增量目录维护 Agent（核心逻辑，零依赖）
 * ------------------------------------------------------------
 * 每轮问答完成后，基于 Function Calling 的轻量 Agent Loop：
 *   1. 模型结合「本轮问答 + 现有目录 + 最近上下文」决策
 *   2. 工具：get_directory / read_context（只读）
 *           apply_directory_changes（一次性提交变更集并结束）
 *   3. 服务端严格校验（topicId / parentTopicId / messageId 白名单、
 *      层级、重复关联），拒绝非法引用，不信任模型参数
 *   4. 校验通过后一次性返回新目录树（保留原 topicId 与结构）
 *
 * 上限：最多 4 轮模型调用、单轮 60s、总 90s、max_tokens 2048/轮，
 * 单次请求无重试；上下文只带本轮 + 最近 12 条（不携带全量历史）。
 * ============================================================ */

import { classifyHttpError, sanitize } from './navigator.js'

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const FALLBACK_MODEL = 'deepseek-ai/DeepSeek-V4-Flash'
const TURN_TIMEOUT_MS = 60_000 /* 单轮请求超时 */
const TOTAL_TIMEOUT_MS = 90_000 /* 整个 Agent Loop 超时 */
const MAX_TURNS = 4
const MAX_TOKENS = 2048
const MAX_READ_CONTEXT = 12 /* read_context 单次最多读取条数 */
const MAX_TITLE_CHARS = 40
const MAX_SUMMARY_CHARS = 120

/* ---------- 工具定义（Function Calling） ---------- */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_directory',
      description: '获取当前会话的话题目录（含话题 ID、层级、标题、摘要与关联消息 ID）。不确定目录现状时先调用。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_context',
      description: '按消息 ID 读取本轮携带范围内的历史消息内容（最多 12 条）。用于回顾某个已有话题关联的历史消息。',
      parameters: {
        type: 'object',
        properties: {
          messageIds: { type: 'array', items: { type: 'string' }, description: '要读取的消息 ID 列表' },
        },
        required: ['messageIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_directory_changes',
      description:
        '提交一组目录修改操作并结束本次维护。无修改时提交 noChange=true。changes 中 create 新增话题、update 修改已有话题标题/摘要并追加关联、link 仅将消息关联到已有话题。',
      parameters: {
        type: 'object',
        properties: {
          noChange: { type: 'boolean', description: '本轮内容不足以改变目录时为 true（寒暄、确认、简单追问等）' },
          note: { type: 'string', description: '一句话决策理由' },
          changes: {
            type: 'array',
            description: '目录修改操作列表（可混合多种操作，按顺序执行）',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['create', 'update', 'link'], description: '操作类型' },
                topicId: { type: 'string', description: 'update / link 必填：目标已有话题 ID' },
                title: { type: 'string', description: 'create 必填 / update 可选：话题标题（简短）' },
                summary: { type: 'string', description: 'create / update 可选：话题一句话摘要' },
                parentTopicId: { type: 'string', description: 'create 可选：父话题 ID（生成二级目录）；省略为一级' },
                messageIds: { type: 'array', items: { type: 'string' }, description: '关联的消息 ID（须真实存在，允许不连续）' },
              },
              required: ['op'],
            },
          },
        },
      },
    },
  },
]

const SYSTEM_PROMPT = `你是 Conversation Navigator 的增量目录维护智能体。用户刚完成一轮新的问答，你需要在现有话题目录上做最小化的增量维护，而不是重新分析全部历史。

决策原则（严格遵守）：
1. 延续话题才 update：本轮主题与某已有话题的标题/摘要所指为同一主题（继续深入、追问细节、补充信息）时，用 update（更新摘要 / 追加关联消息），不要新建话题。
2. 用户回到很久以前的话题时，link 或 update 该原话题，不要重复创建。
3. 本轮主题在现有目录所有话题的标题与摘要中找不到归属（讨论的是新领域、新任务、新问题）时必须 create，不要为减少操作把不同主题并入已有话题；新话题是一级还是二级（parentTopicId）由语义决定，父话题必须是一级话题。
4. 简短寒暄、确认、感谢、与话题无关的内容：提交 noChange=true。
5. 禁止编造 messageId / topicId：只能引用现有目录与消息中出现过的 ID。
6. update 不改变层级（不修改 parentTopicId），保持已有目录结构稳定。
7. 同一话题可以关联不连续的消息 ID。
8. 每轮问答最多创建一个新话题，避免目录碎片化。
9. update / link / create 的 messageIds 必须包含本轮新消息的 ID（上方【本轮新增问答】中的 用户消息 ID 和 AI 消息 ID），使本轮问答归属于对应话题；已关联的旧消息不要重传。

执行流程：
- 先 get_directory 查看当前目录（若尚未提供结构化目录时）。
- 需要回顾某话题的历史消息时用 read_context（按消息 ID 读取，最多 12 条）。
- 最终必须调用 apply_directory_changes 提交决策（无修改则 noChange=true），这是本次维护的结束。`

/* 纯文本回复中识别「无需修改」意图的宽正则（模型措辞多样，
 * 未命中且未调工具时会回填提醒走工具提交，而不是直接判失败） */
const NO_CHANGE_RE =
  /no[_\s-]?change|无需(修改|更新|变更|调整)|(保持|维持)(现状|不变|原样)|没有(变化|需要修改)|目录.{0,6}(不变|无需)/i

/* ---------- 输入校验与规范化 ---------- */

function normStr(v, max) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : ''
}

/* 规范化请求内的目录：保留原 topicId，过滤非法结构。
 * 导出供无付费回归测试（server/navigatorIncremental.regression.mjs）使用 */
export function normalizeDirectory(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const topicId = normStr(t.topicId, 64)
    const title = normStr(t.title, MAX_TITLE_CHARS)
    if (!topicId || !title) continue
    out.push({
      topicId,
      parentTopicId: normStr(t.parentTopicId, 64) || null,
      title,
      summary: normStr(t.summary, MAX_SUMMARY_CHARS),
      messageIds: Array.isArray(t.messageIds) ? t.messageIds.filter((id) => typeof id === 'string') : [],
    })
  }
  /* 父节点不存在时挂为一级（防孤儿） */
  const idSet = new Set(out.map((t) => t.topicId))
  for (const t of out) {
    if (t.parentTopicId && !idSet.has(t.parentTopicId)) t.parentTopicId = null
  }
  return out
}

function normMessageList(raw, max) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const id = normStr(m.id, 64)
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null
    const text = typeof m.text === 'string' ? m.text.slice(0, 4000) : ''
    if (!id || !role || !text.trim()) continue
    out.push({ id, role, text })
    if (out.length >= max) break
  }
  return out
}

/* ---------- apply_directory_changes：服务端校验与执行 ---------- */

/* 新话题 topicId 的模块级单调序号：仅用 Date.now()+局部 seq 时，
 * 同一毫秒内的多次 create 会生成重复 topicId（buildTree 节点覆盖丢失） */
let globalTopicSeq = 0

/**
 * @returns {{applied: boolean, noChange: boolean, directory: Array,
 *   changeCount: number, warnings: string[], note: string, summary: string[]}}
 */
export function applyChanges(directory, args, validIdSet, requestId, byOrder, currentTurnIds = []) {
  const warnings = []
  const summary = []
  const note = normStr(args?.note, 80)
  const noChange = args?.noChange === true
  const changes = Array.isArray(args?.changes) ? args.changes : []

  if (noChange) {
    return { applied: true, noChange: true, directory, changeCount: 0, warnings, note, summary }
  }

  /* 可变副本：全部操作在副本上执行，成功后一次性返回 */
  const next = directory.map((t) => ({ ...t, messageIds: [...t.messageIds] }))
  const byId = new Map(next.map((t) => [t.topicId, t]))
  /* 一级话题集合：create 的 parent 必须是一级（新节点成为二级） */
  const rootIds = new Set(next.filter((t) => !t.parentTopicId).map((t) => t.topicId))

  const filterValidIds = (ids) => {
    if (!Array.isArray(ids)) return []
    const seen = new Set()
    const out = []
    for (const id of ids) {
      if (typeof id !== 'string' || !validIdSet.has(id) || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }

  let changeCount = 0
  /* 本轮触达的话题（create 新话题 / update 与 link 的目标），
   * 供「模型遗漏本轮消息关联」时兜底 */
  const touched = []
  for (const c of changes) {
    if (!c || typeof c !== 'object') continue
    if (c.op === 'create') {
      const title = normStr(c.title, MAX_TITLE_CHARS)
      if (!title) {
        warnings.push('create 操作缺少标题，已跳过')
        continue
      }
      let parentTopicId = normStr(c.parentTopicId, 64) || null
      if (parentTopicId) {
        if (!byId.has(parentTopicId)) {
          warnings.push(`create 的父话题 ${parentTopicId} 不存在，改为一级`)
          parentTopicId = null
        } else if (!rootIds.has(parentTopicId)) {
          warnings.push(`create 的父话题 ${parentTopicId} 已是二级，新话题改为一级（避免三级目录）`)
          parentTopicId = null
        }
      }
      const ids = filterValidIds(c.messageIds)
      const unknown = Array.isArray(c.messageIds) ? c.messageIds.length - ids.length : 0
      if (unknown > 0) warnings.push(`create 丢弃 ${unknown} 个无效 messageId`)
      /* 话题内消息按会话时间序排列（模型返回顺序不可信，保证定位目标稳定） */
      if (byOrder) ids.sort(byOrder)
      globalTopicSeq += 1
      const topicId = `it${Date.now().toString(36)}${globalTopicSeq.toString(36)}`
      next.push({
        topicId,
        parentTopicId,
        title,
        summary: normStr(c.summary, MAX_SUMMARY_CHARS),
        messageIds: ids,
      })
      byId.set(topicId, next[next.length - 1])
      if (!parentTopicId) rootIds.add(topicId)
      touched.push(topicId)
      summary.push(`create「${title}」（${parentTopicId ? '二级' : '一级'} · 关联 ${ids.length} 条消息）`)
      changeCount += 1
    } else if (c.op === 'update' || c.op === 'link') {
      const topicId = normStr(c.topicId, 64)
      const target = topicId ? byId.get(topicId) : null
      if (!target) {
        warnings.push(`${c.op} 目标话题 ${topicId || '(空)'} 不存在，已跳过`)
        continue
      }
      if (c.op === 'update') {
        const title = normStr(c.title, MAX_TITLE_CHARS)
        if (title) target.title = title
        const summary = normStr(c.summary, MAX_SUMMARY_CHARS)
        if (summary) target.summary = summary
      }
      const raw = Array.isArray(c.messageIds) ? c.messageIds : []
      const ids = filterValidIds(raw)
      /* 分别计数：白名单外（编造/跨会话）与已关联（模型重传旧消息） */
      const invalid = raw.filter((id) => !validIdSet.has(id)).length
      if (invalid > 0) warnings.push(`${c.op} 丢弃 ${invalid} 个无效 messageId`)
      const added = ids.filter((id) => !target.messageIds.includes(id))
      const dup = ids.length - added.length
      if (dup > 0) warnings.push(`${c.op} 丢弃 ${dup} 个已关联 messageId（旧消息无需重传）`)
      target.messageIds.push(...added)
      /* 追加后整体保持会话时间序（link 旧消息时落到正确时间位置） */
      if (byOrder) target.messageIds.sort(byOrder)
      touched.push(topicId)
      summary.push(`${c.op}「${target.title}」（新增 ${added.length} 条消息关联）`)
      changeCount += 1
    } else {
      warnings.push(`未知操作类型 ${String(c.op)}，已跳过`)
    }
  }

  /* 防呆兜底：本轮新消息（用户 + AI 两条）若未被任何话题关联 ——
   * 模型常见遗漏是 update 只重传已关联的旧消息 —— 自动追加到本轮
   * 最后触达的话题（create / update / link），保证增量维护的核心
   * 语义（本轮问答归属目录）不落空 */
  const turnIds = currentTurnIds.filter((id) => id && validIdSet.has(id))
  if (turnIds.length && changeCount > 0) {
    const anyLinked = turnIds.some((id) => next.some((t) => t.messageIds.includes(id)))
    if (!anyLinked && touched.length) {
      const target = byId.get(touched[touched.length - 1])
      let added = 0
      if (target) {
        for (const id of turnIds) {
          if (!target.messageIds.includes(id)) {
            target.messageIds.push(id)
            added += 1
          }
        }
        if (byOrder) target.messageIds.sort(byOrder)
      }
      if (added > 0) {
        warnings.push(`模型未关联本轮新消息，已自动补全 ${added} 条到「${target.title}」`)
        summary.push(`兜底补全 ${added} 条消息到「${target.title}」`)
        console.warn(`[NAVINC:${requestId}] ${warnings[warnings.length - 1]}`)
      }
    }
  }

  if (changeCount === 0 && warnings.length > 0) {
    console.warn(`[NAVINC:${requestId}] 全部变更被跳过：${warnings.join('；')}`)
  }
  return { applied: true, noChange: false, directory: next, changeCount, warnings, note, summary }
}

/* 扁平目录 → 树（保留 topicId；孤儿挂根） */
export function buildTree(directory) {
  const nodes = new Map()
  for (const t of directory) {
    nodes.set(t.topicId, {
      id: t.topicId,
      title: t.title,
      desc: t.summary,
      messageIds: [...t.messageIds],
      children: [],
    })
  }
  const roots = []
  for (const t of directory) {
    const node = nodes.get(t.topicId)
    const parent = t.parentTopicId ? nodes.get(t.parentTopicId) : null
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
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
        /* tool_calls 分片按 index 拼接（流式 Function Calling） */
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
      `[NAVINC:${requestId}] 第 ${turn} 轮完成 · content=${content.length} 字符 · tools=${toolCalls.map((t) => t.name).join(',') || '无'} · finish=${finishReason ?? 'unknown'}`,
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
    /* 其他错误（网络中断 / 流损坏等）如实透传，不统一包装 */
    return { error: { code: 'UPSTREAM_ERROR', message: sanitize(e?.message ?? '模型流式请求失败'), phase: 'model_call' } }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

/* ---------- 主入口：Agent Loop ---------- */

/**
 * @param {{conversationId:string, userMessage:{id,text}, assistantMessage:{id,text},
 *   directory:Array, contextMessages:Array<{id,role,text}>, validMessageIds:string[]}} payload
 * @param {{onStage?:(stage:string, extra:Object)=>void, signal?:AbortSignal}} [hooks]
 */
export async function runIncrementalMaintenance(payload, { onStage, signal } = {}) {
  const started = Date.now()
  const requestId = `inc${started.toString(36)}`
  const elapsed = () => Date.now() - started
  const emit = (stage, extra = {}) => {
    try {
      onStage?.(stage, extra)
    } catch {
      /* 事件回调异常不影响主流程 */
    }
  }

  const apiKey = process.env.SILICONFLOW_API_KEY
  const model = process.env.NAVIGATOR_MODEL || FALLBACK_MODEL
  if (!apiKey) {
    return { ok: false, code: 'NO_API_KEY', message: '服务端未配置 SILICONFLOW_API_KEY：请在项目根目录 .env 文件中填入', phase: 'config' }
  }

  /* 输入校验（不信任前端）：本轮两条消息 + 目录 + 上下文 + ID 白名单 */
  const userMessage = payload?.userMessage
  const assistantMessage = payload?.assistantMessage
  const userText = typeof userMessage?.text === 'string' ? userMessage.text.slice(0, 8000) : ''
  const asstText = typeof assistantMessage?.text === 'string' ? assistantMessage.text.slice(0, 8000) : ''
  const userId = normStr(userMessage?.id, 64)
  const asstId = normStr(assistantMessage?.id, 64)
  if (!userText.trim() || !asstText.trim() || !userId || !asstId) {
    return { ok: false, code: 'BAD_REQUEST', message: '缺少本轮问答内容（userMessage / assistantMessage）', phase: 'input' }
  }
  const directory = normalizeDirectory(payload?.directory)
  const contextMessages = normMessageList(payload?.contextMessages, 12)
  /* messageId 白名单 + 会话内序号（前端按时间序提供 validMessageIds，
   * 用于话题内消息排序；本轮两条与目录已关联消息兜底追加在末尾） */
  const validOrder = new Map()
  for (const id of Array.isArray(payload?.validMessageIds) ? payload.validMessageIds : []) {
    if (typeof id === 'string' && id && !validOrder.has(id)) validOrder.set(id, validOrder.size)
  }
  for (const id of [userId, asstId, ...directory.flatMap((t) => t.messageIds)]) {
    if (id && !validOrder.has(id)) validOrder.set(id, validOrder.size)
  }
  const validIdSet = new Set(validOrder.keys())
  const byOrder = (a, b) => (validOrder.get(a) ?? Infinity) - (validOrder.get(b) ?? Infinity)
  /* 存量话题消息统一按会话时间序排列（定位目标稳定，不改变关联集合） */
  for (const t of directory) t.messageIds.sort(byOrder)

  /* 本轮与目录摘要组装（不携带全量历史） */
  const directoryBrief = directory.length
    ? JSON.stringify(
        directory.map((t) => ({
          topicId: t.topicId,
          parentTopicId: t.parentTopicId,
          title: t.title,
          summary: t.summary || undefined,
          messageCount: t.messageIds.length,
          messageIds: t.messageIds.length > 20 ? [...t.messageIds.slice(0, 20), `…共${t.messageIds.length}条`] : t.messageIds,
        })),
      )
    : '（当前会话还没有话题目录，可创建第一个话题）'
  const contextBrief = contextMessages.length
    ? contextMessages.map((m) => `${m.id}｜${m.role}｜${m.text.slice(0, 300)}`).join('\n')
    : '（无更多上下文）'

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `【本轮新增问答】
用户（${userId}）：${userText}
AI 回复（${asstId}）：${asstText}

【当前话题目录】（扁平结构，parentTopicId 为 null 表示一级）
${directoryBrief}

【最近对话上下文】（按时间顺序，用于判断话题延续性）
${contextBrief}

请维护话题目录：先按需调用 get_directory / read_context，最后调用 apply_directory_changes 提交决策。`,
    },
  ]

  emit('analyzing', { model, turn: 1 })
  console.log(
    `[NAVINC:${requestId}] 增量维护启动 · model=${model} · 目录 ${directory.length} 个话题 · 本轮 ${userId}/${asstId} · 上下文 ${contextMessages.length} 条`,
  )

  const totalController = new AbortController()
  const onExternalAbort = () => totalController.abort()
  signal?.addEventListener('abort', onExternalAbort)
  const totalTimer = setTimeout(() => totalController.abort(), TOTAL_TIMEOUT_MS)

  let usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  const toolCallLog = []
  let applied = null
  let rejectedBy = null /* 首次被拒原因（TOOL_ARGS_INVALID / VALIDATION_REJECTED） */
  try {
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      if (totalController.signal.aborted) break
      const result = await callModelStream(
        apiKey,
        {
          model,
          stream: true,
          max_tokens: MAX_TOKENS,
          stream_options: { include_usage: true },
          tools: TOOLS,
          /* 必须原样携带完整消息（含 assistant.tool_calls 与 tool.tool_call_id），
           * 压扁成 role+content 会导致多轮工具调用时上游 400 Field required */
          messages,
        },
        { signal: totalController.signal, requestId, turn },
      )

      if (result.error) {
        if (signal?.aborted) return { ok: false, cancelled: true, code: 'CANCELLED', message: '已停止', phase: 'abort' }
        if (totalController.signal.aborted) {
          return {
            ok: false,
            code: 'TIMEOUT',
            message: `增量维护总耗时超上限（${TOTAL_TIMEOUT_MS / 1000}s）`,
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

      const { toolCalls } = result
      if (!toolCalls.length) {
        /* 纯文本回复：宽正则识别 no_change 意图；未命中则回填提醒走工具
         * 提交（后续轮次内纠正），不再直接判失败 */
        const text = result.content || ''
        if (NO_CHANGE_RE.test(text)) {
          applied = { noChange: true, directory, changeCount: 0, warnings: [], note: normStr(text, 80), summary: [] }
          break
        }
        console.warn(`[NAVINC:${requestId}] 模型纯文本回复且无决策意图，回填提醒 · phase=decision`)
        messages.push({ role: 'assistant', content: text || '' })
        messages.push({
          role: 'user',
          content: '请直接调用 apply_directory_changes 工具提交决策（无修改则 noChange=true），不要用文字回答。',
        })
        continue
      }

      /* 逐个执行工具调用，并把结果作为 tool 消息回填 */
      const assistantMsg = {
        role: 'assistant',
        content: result.content || null,
        tool_calls: toolCalls.map((t) => ({
          id: `call_${requestId}_${turn}_${t.index}`,
          type: 'function',
          function: { name: t.name, arguments: t.args || '{}' },
        })),
      }
      messages.push(assistantMsg)

      for (const tc of toolCalls) {
        const toolCallId = `call_${requestId}_${turn}_${tc.index}`
        let args = null
        try {
          args = JSON.parse(tc.args || '{}')
        } catch {
          args = null
        }
        if (args === null) {
          /* 工具参数 JSON 解析错误：不执行该工具，回填错误让模型在后续
           * 轮次内重新提交（受 MAX_TURNS / 总超时限制，不额外自动重试） */
          console.warn(
            `[NAVINC:${requestId}] 工具参数 JSON 解析失败 · tool=${tc.name} · code=TOOL_ARGS_INVALID · phase=tool_args`,
          )
          rejectedBy = rejectedBy ?? 'TOOL_ARGS_INVALID'
          toolCallLog.push(`${tc.name}(参数无效)`)
          emit('tool', { name: tc.name, detail: '参数 JSON 解析失败，已要求模型重新提交' })
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
        if (tc.name === 'get_directory') {
          emit('tool', { name: 'get_directory', detail: '读取当前话题目录' })
          toolCallLog.push('get_directory')
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify(directory),
          })
        } else if (tc.name === 'read_context') {
          const ids = Array.isArray(args.messageIds)
            ? args.messageIds.filter((id) => typeof id === 'string').slice(0, MAX_READ_CONTEXT)
            : []
          const ctxMap = new Map(contextMessages.map((m) => [m.id, m]))
          ctxMap.set(userId, { id: userId, role: 'user', text: userText })
          ctxMap.set(asstId, { id: asstId, role: 'assistant', text: asstText })
          const found = []
          const missing = []
          for (const id of ids) {
            const m = ctxMap.get(id)
            if (m) found.push(`${m.id}｜${m.role}｜${m.text.slice(0, 400)}`)
            else missing.push(id)
          }
          emit('tool', { name: 'read_context', detail: `读取 ${found.length} 条相关消息${missing.length ? `（${missing.length} 条不在携带范围）` : ''}` })
          toolCallLog.push('read_context')
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify({
              messages: found,
              missing: missing.length ? `以下消息不在本次携带范围内：${missing.join('、')}` : undefined,
            }),
          })
        } else if (tc.name === 'apply_directory_changes') {
          const parsed = applyChanges(directory, args, validIdSet, requestId, byOrder, [userId, asstId])
          const submitted = Array.isArray(args?.changes) ? args.changes.length : 0
          if (!parsed.noChange && parsed.changeCount === 0) {
            /* 提交无效（全部变更被校验拒绝 / 空提交）：不落地，回填拒因
             * 让模型修正；轮次耗尽仍无效则按校验失败返回，保留原目录 */
            const reason = submitted
              ? `全部 ${submitted} 项变更未通过服务端校验：${parsed.warnings.join('；')}`
              : '提交内容为空：无修改请设 noChange=true，有修改请提供 changes 数组'
            console.warn(
              `[NAVINC:${requestId}] 变更全部被拒 · code=VALIDATION_REJECTED · phase=validate · ${reason}`,
            )
            rejectedBy = rejectedBy ?? 'VALIDATION_REJECTED'
            toolCallLog.push('apply_directory_changes(被拒)')
            emit('tool', { name: 'apply_directory_changes', detail: '变更未通过校验，已要求模型修正' })
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({
                ok: false,
                code: 'VALIDATION_REJECTED',
                error: `${reason}。请修正后重新提交`,
              }),
            })
          } else {
            applied = parsed
            const detail = applied.noChange
              ? '本轮无需修改目录'
              : `提交 ${applied.changeCount} 项修改${applied.warnings.length ? `（${applied.warnings.length} 项警告）` : ''}`
            emit('tool', { name: 'apply_directory_changes', detail })
            toolCallLog.push('apply_directory_changes')
            if (applied.warnings.length) {
              console.warn(`[NAVINC:${requestId}] 校验警告：${applied.warnings.join('；')}`)
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: JSON.stringify({
                ok: true,
                noChange: applied.noChange,
                changeCount: applied.changeCount,
                warnings: applied.warnings,
                note: applied.note || undefined,
              }),
            })
          }
        } else {
          emit('tool', { name: tc.name, detail: '未知工具，已拒绝' })
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify({ ok: false, error: `未知工具 ${tc.name}` }),
          })
        }
      }

      if (applied) break /* apply 是终态：提交后结束本次维护 */
    }

    if (!applied) {
      const code = rejectedBy ?? 'NO_DECISION'
      const phase = code === 'NO_DECISION' ? 'decision' : code === 'TOOL_ARGS_INVALID' ? 'tool_args' : 'validate'
      const message =
        code === 'VALIDATION_REJECTED'
          ? '模型提交的目录变更未通过服务端校验（已保留原目录，可重试本轮维护）'
          : code === 'TOOL_ARGS_INVALID'
            ? '模型工具调用参数解析失败（已保留原目录，可重试本轮维护）'
            : '模型未能给出有效的目录决策（已保留原目录，可重试本轮维护）'
      console.warn(`[NAVINC:${requestId}] 增量维护失败 · code=${code} · phase=${phase} · 轮次耗尽`)
      return { ok: false, code, message, phase }
    }

    const topics = buildTree(applied.directory)
    const stats = {
      model,
      elapsedMs: elapsed(),
      usage: usageTotal,
      turns: toolCallLog.length,
      toolCalls: toolCallLog,
      noChange: applied.noChange,
      changeCount: applied.changeCount,
      warnings: applied.warnings,
      note: applied.note,
      summary: applied.summary ?? [],
    }
    console.log(
      `[NAVINC:${requestId}] 增量维护完成 · ${applied.noChange ? '无需修改' : `${applied.changeCount} 项修改`} · 话题 ${applied.directory.length} 个 · tokens ${usageTotal.total_tokens} · 耗时 ${elapsed()}ms`,
    )
    if (!applied.noChange && stats.summary.length) {
      console.log(`[NAVINC:${requestId}] 变更明细：${stats.summary.join('；')}`)
    }
    return { ok: true, topics, stats }
  } finally {
    clearTimeout(totalTimer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
