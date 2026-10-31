/* ============================================================
 * Visual Coding Agent 执行引擎（阶段 1 · Agent Loop）
 *
 * 流程：模型决策（流式 Function Calling）→ 工具调用 → 执行工具
 *       → tool 结果追加到 messages → 再次请求模型 → …
 * 退出条件：模型调用 finish 工具，或模型不再发起工具调用（正常结束）
 *
 * 执行保护（双层超时看门狗：无进度超时与硬上限同时独立生效，非无限重置计时器）：
 *  · 最大模型轮次 MAX_TURNS（12）
 *  · 整个任务硬上限 TOTAL_TIMEOUT_MS（600s）
 *  · 单轮硬上限 TURN_HARD_TIMEOUT_MS（240s，数据持续输出也不再延长）
 *  · 无进度超时 NO_PROGRESS_TIMEOUT_MS（60s 未收到任何流式数据即中止）
 *  · 累计 Token 用量统计（stream_options.include_usage）
 *  · 外部 signal（用户取消）实时中止当前上游流式请求，不进入下一轮
 *  · 工具失败以 ERROR 文本返回给模型，允许其纠正后重试
 *  · 任务失败（超时/取消/超轮次/上游错误）不提交 VFS 修改
 *
 * 事件：复用现有 onEvent → SSE 基础设施
 *  · 日志型事件 {requestId, level, stage, text, t}（与 generate 一致）
 *  · 类型化事件 {requestId, type, ...}：agent_start / turn_start /
 *    stream_progress（流式阶段结构化进度：phase 首达 + 10s 心跳，含 toolName/
 *    toolPath 提示，供前端通俗文案与动态步骤驱动）/ tool_call（含 path）/
 *    file_update（含完整文件内容，供前端实时预览）/ turn_end / agent_end
 *
 * 安全：所有对外事件与错误信息均经 sanitize() 脱敏；
 *  API Key 仅从 process.env 读取，绝不进入事件 / 响应 / 日志。
 * ============================================================ */

import {
  AGENT_TOOL_DEFS,
  GENERATE_IMAGE_TOOL_DEF,
  validateImageArgs,
  createVfs,
} from './agentTools.js'
import {
  FALLBACK_IMAGE_MODEL,
  MAX_IMAGE_BYTES,
  analyzeImage,
  downloadImage,
  requestImageGeneration,
} from './imageApi.js'

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const FALLBACK_MODEL = 'moonshotai/Kimi-K2.7-Code'

const MAX_TURNS = 12 /* 最大模型轮次 */
const TOTAL_TIMEOUT_MS = 600_000 /* 整个 Agent 任务硬上限 600s */
const TURN_HARD_TIMEOUT_MS = 240_000 /* 单轮硬上限 240s（无论数据是否仍在流动） */
const NO_PROGRESS_TIMEOUT_MS = 60_000 /* 无进度超时：连续 60s 未收到任何流式数据 */
const MAX_TOKENS = 8192 /* 单轮输出上限（流式，分段送达，不会一次性阻塞；不含思维链） */
/* 思考流限制：Kimi K2.7 Code 思考始终开启无法禁用，只能用 thinking_budget 限制思维链 token 上限
 * （硅基流动 max_tokens 不含思维链，两者相互独立；环境变量 SILICONFLOW_THINKING_BUDGET 可覆盖，有效范围 128~32768） */
const THINKING_BUDGET = (() => {
  const n = Number(process.env.SILICONFLOW_THINKING_BUDGET)
  if (!Number.isFinite(n) || n <= 0) return 4096
  return Math.min(32768, Math.max(128, Math.round(n)))
})()
const MAX_IMAGES_PER_TASK = 2 /* 视觉增强：单次任务最多生成的图片数量（成本护栏，禁止自动重试付费请求） */

/* ── 脱敏：抹掉可能意外出现的 API Key 值 ── */

function sanitize(text) {
  let out = String(text ?? '')
  const key = process.env.SILICONFLOW_API_KEY
  if (key && key.length > 8) out = out.split(key).join('sk-****')
  return out
}

/* 摘要（日志用：不写入完整需求 / 代码） */
function brief(text, n = 40) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/* ── 提示词构建（完整需求与代码仅进入模型请求，不进入日志） ── */

const AGENT_SYSTEM_PROMPT = `你是专业的移动端应用开发智能体，在虚拟项目中通过工具调用逐步完成开发任务。虚拟项目仅包含三个文件：index.html、style.css、app.js。

可用工具：
- create_file(path, content)：创建或完整覆写一个文件。新项目创建或大范围重写时使用。
- read_file(path)：读取文件当前完整内容。需要确认现状时使用。
- update_file(path, old_str, new_str)：局部修改。old_str 必须与文件现有内容完全一致（含缩进），且在全文中唯一匹配。
- finish(summary)：全部工作完成后调用，提交任务并给出总结。

工作规范（严格遵守）：
1. 收到需求后先规划页面结构、样式与交互逻辑，再按固定顺序逐个创建文件：先 index.html，再 style.css，然后 app.js，全部完成后调用 finish 提交总结。
2. 每轮只调用一个 create_file 工具，完整生成该文件的全部内容后，下一轮再生成下一个文件；严禁在一轮中并行调用多个 create_file 生成多个大型文件（read_file、update_file、finish 不受此限制）。
3. index.html 必须通过 <link rel="stylesheet" href="style.css"> 引入样式，通过 <script src="app.js"></script> 引入脚本。
4. 技术范围：纯 HTML / CSS / JavaScript 移动端 H5（视口约 390px 宽），不使用框架、构建工具或任何外部 CDN 资源。
5. 代码必须完整可运行，包含真实业务逻辑（按钮事件、表单、页面切换、状态管理、数据持久化使用 localStorage）；禁止为缩短输出而生成交互逻辑的空壳、占位符、"TODO"注释或模拟数据。
6. 修改现有项目时优先使用 update_file 做精准局部修改，避免不必要地重写整个文件；大范围重构才使用 create_file。
7. 工具执行失败时会返回 ERROR 说明，请根据错误信息修正参数后重试。
8. 所有文件就绪后必须调用 finish 结束任务，不要以纯文本回复替代工具调用。
9. 安全约束：不得访问任何 API 密钥或环境变量，不得发起需要鉴权的网络请求，不得尝试执行系统命令。
10. 界面交互约束：代码运行在页面内嵌的手机模拟器沙箱中，禁止使用 alert / confirm / prompt 等浏览器原生对话框（会逃出模拟器被拦截）；所有提示、确认、输入一律用页面内自定义 UI 实现（如 toast 提示条、模态卡片、内联表单），保证交互只在模拟器画面内完成。`

/* 视觉增强模式附加规范：仅在开关开启时拼入 system prompt（工具权限由后端控制，
 * 开关关闭时 generate_image 不在工具列表中，模型无从调用） */
const AGENT_VISUAL_PROMPT = `
11. 视觉增强模式已开启：你可以调用 generate_image(prompt, asset_name, asset_type, target_description) 生成真实图片素材（后端图像模型，每次任务最多 ${MAX_IMAGES_PER_TASK} 张）。严格遵守：
- 先用 read_file 阅读现有 HTML/CSS/JS，理解目标元素的结构与事件绑定，再决定生成什么素材；无法可靠定位目标元素时保留原页面并在总结中说明，不要随意替换。
- 替换按钮等可交互元素的外观：必须保留原元素（如 <button>）及其 id、class、事件监听器、业务逻辑与文字，通过在元素内部嵌 <img> 或 CSS background-image 应用图片；严禁把按钮替换为纯 <img>（会丢失点击事件）。
- 图片为不透明方形图（含平台水印）：按钮类素材应生成完整按钮外观，用 background-size / object-fit / aspect-ratio 合理裁切适配，不得拉伸变形；插画保持原始宽高比；背景需保证文字可读性与对比度。
- 引用图片必须使用工具返回的相对路径（assets/…），与项目文件同级。
- 需求中的素材清单若已提供，能复用则不再生成；普通文字、数据、布局、配色修改直接用代码完成，不要调用 generate_image。
- 图片生成失败会返回 ERROR 说明，可调整提示词重试一次或改用代码实现，不得反复生图。`

function buildUserPrompt(requirement, files, assets) {
  const hasProject = Boolean(files?.html || files?.css || files?.js)
  const assetLines =
    Array.isArray(assets) && assets.length
      ? `\n\n【已生成图片素材】（已存在于项目中，可直接引用，不必重新生成）\n${assets
          .map(
            (a) =>
              `- ${a.path}（${a.type || '素材'}${a.width && a.height ? ` · ${a.width}×${a.height}` : ''}）`,
          )
          .join('\n')}`
      : ''
  if (hasProject) {
    return `当前项目代码如下：

【index.html】
${files.html || '（空）'}

【style.css】
${files.css || '（空）'}

【app.js】
${files.js || '（空）'}
${assetLines}

修改需求：${requirement}

修改要求：尽量保留原有功能、页面结构与数据结构，localStorage 键名保持兼容；优先使用 update_file 做局部修改；全部修改完成后调用 finish 提交总结。`
  }
  return `开发需求：${requirement}

当前虚拟项目为空。请使用工具创建 index.html、style.css、app.js 三个文件，全部完成后调用 finish 提交总结。`
}

/* ── SSE 流解析（移植自阶段 0 已验证的 scripts/test-llm-tools.mjs） ── */

function parseSseLine(line, onChunk, diag) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return false
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return true
  try {
    onChunk(JSON.parse(payload))
  } catch {
    /* 解析失败计数（诊断：区分「有数据但帧格式异常」） */
    if (diag) diag.parseFailures++
  }
  return false
}

async function readSseStream(resp, onChunk, diag) {
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    /* 网络字节层统计：区分「上游无任何数据到达」与「有数据但解析不出内容」 */
    if (diag) {
      diag.bytes += value.length
      diag.lastDataMs = Date.now() - diag.turnStart
    }
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (parseSseLine(line, onChunk, diag)) return
    }
  }
  if (buf) parseSseLine(buf, onChunk, diag)
}

/* ── 单轮流式模型调用（含超时 + 外部取消联动 + 分层诊断） ── */

/* 流式诊断统计：区分 上游迟迟无响应 / 模型长时间推理 / 工具参数生成中 / 流式解析异常 */
function createStreamDiag(turnStart) {
  return {
    turnStart,
    headersMs: null,
    status: null,
    bytes: 0,
    firstSseMs: null,
    firstContentMs: null,
    firstReasoningMs: null,
    firstToolCallMs: null,
    lastDataMs: null,
    events: 0,
    parseFailures: 0,
  }
}

/* 诊断摘要：仅时间戳 / 计数 / 状态码，不含代码内容、提示词或任何认证信息 */
function diagSummary(diag, acc) {
  const ms = (v) => (v == null ? '未收到' : `${v}ms`)
  const toolCallChars = [...acc.toolCalls.values()].reduce((n, t) => n + t.args.length, 0)
  return (
    `响应头 ${diag.status ?? '未到达'}（${ms(diag.headersMs)}）· 首 SSE 事件 ${ms(diag.firstSseMs)} · ` +
    `首 content ${ms(diag.firstContentMs)} · 首 reasoning ${ms(diag.firstReasoningMs)} · 首 tool_calls ${ms(diag.firstToolCallMs)} · ` +
    `网络字节 ${diag.bytes}B · SSE 事件 ${diag.events}（解析失败 ${diag.parseFailures}）· ` +
    `content ${acc.content.length} 字符 · reasoning ${acc.reasoning.length} 字符 · ` +
    `tool_calls ${acc.toolCalls.size} 个 / 参数 ${toolCallChars} 字符 · ` +
    `最后数据 ${ms(diag.lastDataMs)} · finish_reason=${acc.finishReason || '未收到'}`
  )
}

/**
 * @param {string} apiKey
 * @param {Object} body 请求体（messages / tools 等）
 * @param {{hardLimitMs:number, noProgressMs:number, totalDeadlineMs:number, turnNo?:number, maxTurns?:number,
 *   externalSignal?:AbortSignal, onDiag?:(text:string, level?:string)=>void,
 *   onProgress?:(info:Object)=>void}} opts
 *   onProgress：流式阶段结构化进度（phase 首达 + 每 10s 心跳），供前端通俗文案展示，
 *   仅统计数字与工具名/路径提示，不含代码内容与任何认证信息
 * @returns {Promise<Object>} 归一化结果：
 *   成功 { ok:true, content, reasoning, toolCalls:[{index,id,name,args}], finishReason, usage, chunks }
 *   HTTP 错误 { httpStatus, httpMessage }
 *   超时 { fetchError: 'TURN_TIMEOUT'（单轮硬上限）| 'NO_PROGRESS_TIMEOUT'（无进度）| 'TOTAL_TIMEOUT'（任务总上限） }
 *   异常 { fetchError: 'CANCELLED'|'NETWORK', message? }
 */
async function callModelStream(
  apiKey,
  body,
  { hardLimitMs, noProgressMs, totalDeadlineMs, turnNo = 0, maxTurns = 0, externalSignal, onDiag, onProgress, onReasoning },
) {
  const controller = new AbortController()
  let timeoutKind = null /* 'HARD' | 'NO_PROGRESS' | 'TOTAL'：三种超时独立判定，先触发者生效 */
  const onExternalAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

  const t0 = Date.now()
  const diag = createStreamDiag(t0)
  /* 流式聚合：content / reasoning_content / tool_calls（按 index 组装）/ finish_reason / usage */
  const acc = { content: '', reasoning: '', toolCalls: new Map(), finishReason: '', usage: null, chunks: 0 }
  const toolCallChars = () => [...acc.toolCalls.values()].reduce((n, t) => n + t.args.length, 0)
  const idleMs = () => Date.now() - t0 - (diag.lastDataMs ?? 0)

  /* 思考流转发：600ms 节流批量（避免逐 token 事件洪泛），收尾统一 flush */
  let reasoningBuf = ''
  let reasoningFlushTimer = null
  const flushReasoning = () => {
    if (reasoningBuf) {
      const out = reasoningBuf
      reasoningBuf = ''
      onReasoning?.(out)
    }
  }

  /* 流式阶段结构化快照（阶段判定优先级：工具参数 > 正文 > 思考 > 等待响应） */
  const progressSnapshot = () => {
    const first = [...acc.toolCalls.entries()].sort((a, b) => a[0] - b[0])[0]?.[1]
    let toolName = null
    let toolPath = null
    if (first) {
      if (first.name) toolName = first.name
      /* 从部分参数中提前提取 path（路径值完整闭合才匹配，不会截断误报） */
      const m = /"path"\s*:\s*"([^"]*)"/.exec(first.args)
      if (m) toolPath = m[1]
    }
    return {
      phase: acc.toolCalls.size > 0 ? 'tools' : acc.content ? 'content' : acc.reasoning ? 'reasoning' : 'waiting',
      contentChars: acc.content.length,
      reasoningChars: acc.reasoning.length,
      toolCalls: acc.toolCalls.size,
      toolArgsChars: toolCallChars(),
      toolName,
      toolPath,
      elapsedMs: Date.now() - t0,
    }
  }

  /* 双层超时看门狗（每 500ms 判定一次，三个条件同时生效、独立触发，非无限重置计时器）：
   *  · 无进度：连续 noProgressMs 未收到任何流式数据（含响应头未到达场景）
   *  · 单轮硬上限：本轮已耗时达到 hardLimitMs，即使数据仍在输出也中止
   *  · 任务总上限：达到 totalDeadlineMs（handleAgentRun 传入 started + TOTAL_TIMEOUT_MS） */
  const watchdog = setInterval(() => {
    const now = Date.now()
    if (now >= totalDeadlineMs) timeoutKind = 'TOTAL'
    else if (now - t0 >= hardLimitMs) timeoutKind = 'HARD'
    else if (idleMs() >= noProgressMs) timeoutKind = 'NO_PROGRESS'
    if (timeoutKind) controller.abort()
  }, 500)

  /* 每 10s 输出一次流式进度（等待响应头期间同样计时；仅轮次/计数/字符数，不含代码内容） */
  const diagTimer = onDiag
    ? setInterval(() => {
        onProgress?.(progressSnapshot())
        onDiag(
          `第 ${turnNo}/${maxTurns} 轮流式进度 · 已耗时 ${Date.now() - t0}ms · ` +
            `响应头 ${diag.status ?? '未到达'}${diag.headersMs != null ? `（${diag.headersMs}ms）` : ''} · ` +
            `SSE 事件 ${diag.events} · 工具调用 ${acc.toolCalls.size} 个 · 参数累计 ${toolCallChars()} 字符 · ` +
            `content ${acc.content.length} 字符 · reasoning ${acc.reasoning.length} 字符 · ` +
            `最近数据 ${diag.lastDataMs == null ? '未收到' : `${diag.lastDataMs}ms（空闲 ${idleMs()}ms）`}`,
        )
      }, 10_000)
    : null

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    diag.headersMs = Date.now() - t0
    diag.status = resp.status

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      let message = text
      try {
        const j = JSON.parse(text)
        message = j?.message || j?.error?.message || text
      } catch {
        /* 非 JSON 错误体 */
      }
      onDiag?.(`HTTP ${resp.status} 诊断 · 已耗时 ${Date.now() - t0}ms · ${diagSummary(diag, acc)}`, 'WARNING')
      return { httpStatus: resp.status, httpMessage: sanitize(message || '（响应体为空）') }
    }
    if (!resp.body) {
      onDiag?.(`无响应体诊断 · 已耗时 ${Date.now() - t0}ms · ${diagSummary(diag, acc)}`, 'WARNING')
      return { fetchError: 'NETWORK', message: '上游返回 200 但无响应体流' }
    }

    await readSseStream(resp, (j) => {
      acc.chunks++
      diag.events++
      const now = Date.now() - t0
      if (diag.firstSseMs == null) diag.firstSseMs = now
      diag.lastDataMs = now
      if (j.usage) acc.usage = j.usage
      const choice = j.choices?.[0]
      if (!choice) return
      const delta = choice.delta || {}
      if (typeof delta.content === 'string' && delta.content) {
        acc.content += delta.content
        if (diag.firstContentMs == null) {
          diag.firstContentMs = now
          onProgress?.(progressSnapshot())
        }
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        acc.reasoning += delta.reasoning_content
        reasoningBuf += delta.reasoning_content
        if (!reasoningFlushTimer) {
          reasoningFlushTimer = setTimeout(() => {
            reasoningFlushTimer = null
            flushReasoning()
          }, 600)
        }
        if (diag.firstReasoningMs == null) {
          diag.firstReasoningMs = now
          onProgress?.(progressSnapshot())
        }
      }
      for (const tc of delta.tool_calls || []) {
        if (diag.firstToolCallMs == null) diag.firstToolCallMs = now
        const idx = typeof tc.index === 'number' ? tc.index : 0
        const t = acc.toolCalls.get(idx) || { id: '', name: '', args: '' }
        if (tc.id) t.id = tc.id
        if (tc.function?.name) t.name = tc.function.name
        if (tc.function?.arguments) t.args += tc.function.arguments
        acc.toolCalls.set(idx, t)
        if (diag.firstToolCallMs === now) onProgress?.(progressSnapshot())
      }
      if (choice.finish_reason) acc.finishReason = choice.finish_reason
    }, diag)

    onDiag?.(`流式完成 · 总耗时 ${Date.now() - t0}ms · ${diagSummary(diag, acc)}`)

    const toolCalls = [...acc.toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, t]) => ({ index, id: t.id, name: t.name, args: t.args }))

    return {
      ok: true,
      content: acc.content,
      reasoning: acc.reasoning,
      toolCalls,
      finishReason: acc.finishReason || 'unknown',
      usage: acc.usage,
      chunks: acc.chunks,
    }
  } catch (e) {
    if (externalSignal?.aborted) return { fetchError: 'CANCELLED' }
    if (timeoutKind) {
      const trigger =
        timeoutKind === 'HARD'
          ? `单轮硬上限 ${Math.round(hardLimitMs / 1000)}s`
          : timeoutKind === 'NO_PROGRESS'
            ? `无进度超时 ${Math.round(noProgressMs / 1000)}s 未收到数据`
            : `任务总时间上限 ${TOTAL_TIMEOUT_MS / 1000}s`
      onDiag?.(`超时诊断摘要 · 触发=${trigger} · 总耗时 ${Date.now() - t0}ms · ${diagSummary(diag, acc)}`, 'ERROR')
      if (timeoutKind === 'HARD') return { fetchError: 'TURN_TIMEOUT' }
      if (timeoutKind === 'NO_PROGRESS') return { fetchError: 'NO_PROGRESS_TIMEOUT' }
      return { fetchError: 'TOTAL_TIMEOUT' }
    }
    onDiag?.(`网络错误诊断 · 总耗时 ${Date.now() - t0}ms · ${diagSummary(diag, acc)}`, 'ERROR')
    return { fetchError: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  } finally {
    clearInterval(watchdog)
    if (diagTimer) clearInterval(diagTimer)
    if (reasoningFlushTimer) clearTimeout(reasoningFlushTimer)
    flushReasoning() /* 收尾：补发残余思考片段 */
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

/* ── HTTP 状态分类（与 generate 接口同规则，错误细分不笼统） ── */

function classifyHttpError(status, message) {
  if (status === 401) return { code: 'UNAUTHORIZED', message: 'API Key 无效（401），请检查 .env 中的 SILICONFLOW_API_KEY' }
  if (status === 403) return { code: 'FORBIDDEN', message: '无权限访问该模型或 API（403）' }
  if (status === 429) return { code: 'RATE_LIMIT', message: '请求频率受限（429），请稍后再试' }
  if (status === 402 || /余额|balance/i.test(message)) {
    return { code: 'INSUFFICIENT_BALANCE', message: '账户余额或额度不足，请前往硅基流动控制台充值' }
  }
  if (status === 404) return { code: 'MODEL_NOT_FOUND', message: '模型不存在或无权访问（404），请检查 SILICONFLOW_MODEL 配置' }
  if (status >= 500) return { code: 'UPSTREAM_ERROR', message: `硅基流动上游服务错误（HTTP ${status}）：${sanitize(message)}` }
  if (status === 400) return { code: 'BAD_PARAMS', message: `请求参数错误（400）：${sanitize(message)}` }
  return { code: 'UPSTREAM_ERROR', message: `硅基流动返回 HTTP ${status}：${sanitize(message) || '未知错误'}` }
}

/* ── 主入口 ── */

/**
 * @param {{requirement:string, files?:{html:string,css:string,js:string}, requestId?:string}} payload
 * @param {{onEvent?:(ev:Object)=>void, signal?:AbortSignal}} [hooks]
 * @returns {Promise<{ok:boolean, code?:string, message?:string, cancelled?:boolean, model?:string,
 *   files?:Object, summary?:string, turns:number, usage?:Object|null, elapsedMs:number, requestId:string}>}
 */
export async function handleAgentRun(payload, { onEvent, signal } = {}) {
  const started = Date.now()
  const requestId = String(payload?.requestId || '-').slice(0, 40)
  const elapsed = () => Date.now() - started

  /* 日志型事件（与 generate 接口同结构） */
  const emit = (level, stage, text) => {
    try {
      onEvent?.({ requestId, level, stage, text: sanitize(text), t: Date.now() })
    } catch {
      /* 事件回调异常不影响主流程 */
    }
  }
  /* 类型化事件（阶段 2 前端接入：tool_call / file_update / turn_end 等） */
  const emitEvent = (obj) => {
    try {
      onEvent?.({ requestId, ...obj, t: Date.now() })
    } catch {
      /* 同上 */
    }
  }

  emit(
    'INFO',
    'RECEIVED',
    `Agent 收到请求 · 需求摘要：${brief(payload?.requirement)}${payload?.files?.html ? ' · 携带当前项目文件（增量修改模式）' : ' · 无当前项目（全新创建模式）'}`,
  )

  const apiKey = process.env.SILICONFLOW_API_KEY
  const model = process.env.SILICONFLOW_MODEL || FALLBACK_MODEL
  emit('INFO', 'CONFIG', `服务端读取模型配置 · 模型：${model} · API Key：${apiKey ? `已配置（长度 ${apiKey.length}）` : '未配置'}`)
  if (!apiKey) {
    emit('ERROR', 'CONFIG', '服务端未配置 SILICONFLOW_API_KEY：请在项目根目录 .env 填入（Key 仅存服务端）')
    return { ok: false, code: 'NO_API_KEY', message: '服务端未配置 SILICONFLOW_API_KEY：请在项目根目录 .env 文件中填入', turns: 0, usage: null, elapsedMs: elapsed(), requestId }
  }

  const requirement = String(payload?.requirement || '').trim()
  if (!requirement) {
    emit('ERROR', 'VALIDATE', '请求校验失败：缺少开发需求描述')
    return { ok: false, code: 'BAD_REQUEST', message: '缺少开发需求描述', turns: 0, usage: null, elapsedMs: elapsed(), requestId }
  }

  /* 视觉增强开关：随请求传入，任务开始后固定本次模式，全程不再变化 */
  const visualEnhance = payload?.visualEnhance === true
  const imageModel = process.env.SILICONFLOW_IMAGE_MODEL || FALLBACK_IMAGE_MODEL
  /* 工具权限：开关关闭时 generate_image 不在工具列表中（模型无从调用，绝不产生生图费用） */
  const tools = visualEnhance ? [...AGENT_TOOL_DEFS, GENERATE_IMAGE_TOOL_DEF] : AGENT_TOOL_DEFS
  const systemPrompt = visualEnhance ? AGENT_SYSTEM_PROMPT + AGENT_VISUAL_PROMPT : AGENT_SYSTEM_PROMPT

  const vfs = createVfs(payload?.files, payload?.assets)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserPrompt(requirement, payload?.files, vfs.listAssets()) },
  ]
  emit(
    'INFO',
    'PROMPT',
    `提示词构建完成 · system ${systemPrompt.length} 字符 · user ${messages[1].content.length} 字符 · 工具 ${tools.length} 个${visualEnhance ? `（含 generate_image · 单任务限 ${MAX_IMAGES_PER_TASK} 张）` : ''}${vfs.listAssets().length ? ` · 已有素材 ${vfs.listAssets().length} 个` : ''}（内容不写入日志）`,
  )

  /* 任务类型（结构化事件字段：前端通俗文案区分「生成 / 增量修改」） */
  const kind = payload?.files?.html || payload?.files?.css || payload?.files?.js ? 'modify' : 'generate'

  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  let usageKnown = false
  let turns = 0
  let imageCount = 0 /* 本次任务已生成图片数（成本护栏：上限 MAX_IMAGES_PER_TASK） */

  emitEvent({ type: 'agent_start', kind, model, maxTurns: MAX_TURNS, totalTimeoutMs: TOTAL_TIMEOUT_MS, visual: visualEnhance, imageModel: visualEnhance ? imageModel : null })

  /* 统一失败出口：不提交 VFS 修改（代码与图片素材一并丢弃，前端回滚到任务前状态） */
  const fail = (code, message, extra = {}) => {
    emit('ERROR', 'DONE', `任务失败 · 类型=${code} · 轮次=${turns}/${MAX_TURNS} · 已耗时 ${elapsed()}ms · 未提交任何文件修改 · ${message}`)
    emitEvent({ type: 'agent_end', ok: false, kind, code, turns, usage: usageKnown ? { ...usage } : null, elapsedMs: elapsed(), images: imageCount })
    return { ok: false, code, message, turns, usage: usageKnown ? { ...usage } : null, elapsedMs: elapsed(), requestId, ...extra }
  }

  /* ---- generate_image 工具执行：请求图像 API → 立即下载（URL 仅 1 小时有效） →
   * 二进制校验（格式 / 尺寸 / 大小）→ 写入 VFS 素材区。单次请求无重试（成本护栏：
   * 达到 MAX_IMAGES_PER_TASK 上限直接拒绝，不发起付费请求）。---- */
  const runGenerateImage = async (argsRaw, turnNo, callIndex) => {
    let parsed = null
    try {
      parsed = JSON.parse(typeof argsRaw === 'string' ? argsRaw : '{}')
    } catch {
      return { ok: false, text: 'ERROR: 参数不是合法 JSON 对象' }
    }
    const checked = validateImageArgs(parsed)
    if (checked.error) return { ok: false, text: checked.error }
    const { prompt, assetName, assetType, target } = checked

    if (imageCount >= MAX_IMAGES_PER_TASK) {
      return { ok: false, text: `ERROR: 已达本次任务图片生成上限（${MAX_IMAGES_PER_TASK} 张）。请基于已有素材与代码完成剩余工作` }
    }

    emitEvent({ type: 'image_start', turn: turnNo, callIndex, name: assetName, assetType, target })
    emit('INFO', 'IMAGE_REQ', `图片生成请求发起 · 第 ${turnNo} 轮 · 类型 ${assetType} · 素材名 ${assetName} · 模型 ${imageModel} · prompt ${brief(prompt, 80)}`)

    const t0 = Date.now()
    const gen = await requestImageGeneration({ apiKey, model: imageModel, prompt, signal })
    if (!gen.ok) {
      emit('WARNING', 'IMAGE_ERR', `图片生成失败 · 类型=${gen.kind}${gen.httpStatus ? ` HTTP=${gen.httpStatus}` : ''} · ${gen.message} · 耗时 ${Date.now() - t0}ms`)
      return {
        ok: false,
        text: `ERROR: 图片生成失败（${gen.kind}${gen.httpStatus ? ` HTTP ${gen.httpStatus}` : ''}）：${gen.message}。可调整提示词后重试一次，或改用代码实现视觉`,
      }
    }
    if (signal?.aborted) return { ok: false, text: 'ERROR: 用户已取消任务，图片未保存' }

    const dl = await downloadImage({ url: gen.url, signal })
    if (!dl.ok) {
      emit('WARNING', 'IMAGE_ERR', `${dl.message} · 耗时 ${Date.now() - t0}ms`)
      return { ok: false, text: `ERROR: ${dl.message}` }
    }
    const info = analyzeImage(dl.buffer)
    if (info.format === '未知') {
      return { ok: false, text: `ERROR: 图片格式不受支持（仅支持 PNG / JPEG / WebP），已放弃保存` }
    }
    if (dl.buffer.length > MAX_IMAGE_BYTES) {
      return { ok: false, text: `ERROR: 图片超过大小上限（${Math.round(dl.buffer.length / 1024)}KB > ${Math.round(MAX_IMAGE_BYTES / 1024)}KB），已放弃保存` }
    }

    const path = `assets/${assetName}.${info.ext}`
    const added = vfs.addImageAsset(path, {
      buffer: dl.buffer,
      mime: info.mime,
      width: info.width,
      height: info.height,
      model: imageModel,
      type: assetType,
      name: assetName,
    })
    if (added.error) return { ok: false, text: added.error }
    imageCount++
    const imageMs = Date.now() - t0

    /* 图片二进制以 dataUrl 随事件下发（前端实时入素材库 + 预览内联；
     * 不进入模型上下文，避免 Token 浪费） */
    emitEvent({
      type: 'image_generated',
      turn: turnNo,
      callIndex,
      path,
      name: assetName,
      assetType,
      target,
      mime: info.mime,
      width: info.width,
      height: info.height,
      sizeBytes: dl.buffer.length,
      model: imageModel,
      inference: gen.inference,
      elapsedMs: imageMs,
      dataUrl: `data:${info.mime};base64,${dl.buffer.toString('base64')}`,
    })
    emit(
      'SUCCESS',
      'IMAGE_DONE',
      `图片生成成功 · ${path} · ${info.format} ${info.width}×${info.height} ${info.alpha ? '（含 Alpha 通道）' : '（不透明）'} · ${Math.round(dl.buffer.length / 1024)}KB · 推理 ${gen.inference ?? '?'}s · 总耗时 ${imageMs}ms · 模型 ${imageModel}（本任务 ${imageCount}/${MAX_IMAGES_PER_TASK} 张）`,
    )
    return {
      ok: true,
      imagePath: path,
      text: `图片已生成并保存：${path}（${info.format}，${info.width}×${info.height}，${Math.round(dl.buffer.length / 1024)}KB，不透明背景）。请用相对路径 ${path} 在 HTML/CSS 中引用完成集成：保留目标元素（如 <button>）的 id、事件绑定与文字，通过内嵌 <img> 或 CSS background-image 应用图片，用 object-fit / background-size 控制比例不变形`,
    }
  }

  while (turns < MAX_TURNS) {
    /* 用户取消：立即退出，不再发起下一轮 */
    if (signal?.aborted) {
      return fail('USER_CANCELLED', '用户已取消任务，当前上游请求已中止', { cancelled: true })
    }
    /* 剩余总时间检查：不足时不再进入下一轮 */
    const remaining = TOTAL_TIMEOUT_MS - elapsed()
    if (remaining <= 1_000) {
      return fail('TOTAL_TIMEOUT', `总执行时间已达上限（${TOTAL_TIMEOUT_MS / 1000}s）`)
    }
    /* 单轮硬上限：不超过 240s 且不超过任务总时间；无进度超时固定 60s（双层看门狗在 callModelStream 内判定） */
    const turnHardMs = Math.min(TURN_HARD_TIMEOUT_MS, remaining)

    turns++
    emitEvent({ type: 'turn_start', turn: turns, maxTurns: MAX_TURNS, turnTimeoutMs: turnHardMs, noProgressMs: NO_PROGRESS_TIMEOUT_MS })
    emit('INFO', 'TURN_START', `第 ${turns}/${MAX_TURNS} 轮开始 · 单轮硬上限 ${Math.round(turnHardMs / 1000)}s · 无进度超时 ${NO_PROGRESS_TIMEOUT_MS / 1000}s · 剩余总时间 ${Math.round(remaining / 1000)}s`)
    emit('INFO', 'UPSTREAM_REQ', `第 ${turns} 轮请求发起 · POST /v1/chat/completions · stream=true · tools=${tools.length} · max_tokens=${MAX_TOKENS} · thinking_budget=${THINKING_BUDGET}`)

    const result = await callModelStream(
      apiKey,
      {
        model,
        stream: true,
        max_tokens: MAX_TOKENS,
        thinking_budget: THINKING_BUDGET,
        messages,
        tools,
        tool_choice: 'auto',
        stream_options: { include_usage: true },
      },
      {
        hardLimitMs: turnHardMs,
        noProgressMs: NO_PROGRESS_TIMEOUT_MS,
        totalDeadlineMs: started + TOTAL_TIMEOUT_MS,
        turnNo: turns,
        maxTurns: MAX_TURNS,
        externalSignal: signal,
        /* 流式诊断：接入现有 Agent 运行日志（携带 requestId，仅统计数字，不含敏感内容） */
        onDiag: (text, level) => emit(level || 'INFO', 'STREAM', text),
        /* 流式阶段结构化进度事件（前端通俗文案 + 动态步骤驱动用） */
        onProgress: (info) => emitEvent({ type: 'stream_progress', turn: turns, ...info }),
        /* 思考流片段（600ms 节流批量转发：前端简洁模式实时展示思考内容） */
        onReasoning: (text) => emitEvent({ type: 'reasoning_delta', turn: turns, text: sanitize(text) }),
      },
    )

    /* ---- 请求层错误 ---- */
    if (result.fetchError === 'CANCELLED') {
      return fail('USER_CANCELLED', '用户取消：当前上游流式请求已中止，未进入下一轮', { cancelled: true })
    }
    if (result.fetchError === 'TOTAL_TIMEOUT') {
      return fail('TOTAL_TIMEOUT', `总执行时间已达上限（${TOTAL_TIMEOUT_MS / 1000}s），任务终止`)
    }
    if (result.fetchError === 'NO_PROGRESS_TIMEOUT') {
      return fail('NO_PROGRESS_TIMEOUT', `第 ${turns} 轮连续 ${NO_PROGRESS_TIMEOUT_MS / 1000}s 未收到任何流式数据（上游停止输出），任务终止`)
    }
    if (result.fetchError === 'TURN_TIMEOUT') {
      return fail('TURN_TIMEOUT', `第 ${turns} 轮达到单轮硬上限（${Math.round(turnHardMs / 1000)}s，数据仍在输出但未完成），任务终止`)
    }
    if (result.fetchError === 'NETWORK') {
      return fail('NETWORK', `无法连接硅基流动 API（网络错误）：${sanitize(result.message || '')}`)
    }
    if (result.httpStatus !== undefined) {
      const classified = classifyHttpError(result.httpStatus, result.httpMessage)
      emit('ERROR', 'UPSTREAM_ERR', `上游错误 · 阶段=第 ${turns} 轮模型调用 HTTP=${result.httpStatus} 类型=${classified.code} · ${classified.message}`)
      return fail(classified.code, classified.message, { httpStatus: result.httpStatus, upstream: true })
    }

    /* ---- Token 用量累计 ---- */
    const turnUsage = result.usage
      ? {
          prompt_tokens: result.usage.prompt_tokens ?? 0,
          completion_tokens: result.usage.completion_tokens ?? 0,
          total_tokens: result.usage.total_tokens ?? 0,
        }
      : null
    if (turnUsage) {
      usageKnown = true
      usage.prompt_tokens += turnUsage.prompt_tokens
      usage.completion_tokens += turnUsage.completion_tokens
      usage.total_tokens += turnUsage.total_tokens
    }

    emit(
      'INFO',
      'UPSTREAM_RESP',
      `第 ${turns} 轮响应完成 · ${result.chunks} 个 SSE 块 · content ${result.content.length} 字符${result.reasoning ? ` · reasoning ${result.reasoning.length} 字符` : ''} · tool_calls ${result.toolCalls.length} 个 · finish_reason=${result.finishReason}${turnUsage ? ` · 本轮 tokens ${turnUsage.prompt_tokens}/${turnUsage.completion_tokens}` : ' · 本轮未携带 usage'}`,
    )

    /* ---- 模型不再调用工具：正常结束 ---- */
    if (!result.toolCalls.length) {
      if (vfs.hasChanges()) {
        /* 模型以纯文本收尾但已有文件修改：按成功提交，summary 取文本 */
        const committed = vfs.commit()
        const summary = brief(result.content, 200) || '任务完成'
        emit('SUCCESS', 'DONE', `模型正常结束（无工具调用）· 提交 ${committed.updates} 次文件修改 · tokens 累计 ${usage.prompt_tokens}/${usage.completion_tokens} · 总耗时 ${elapsed()}ms`)
        emitEvent({ type: 'turn_end', turn: turns, toolCalls: 0, elapsedMs: elapsed(), usage: turnUsage, cumulativeUsage: { ...usage } })
        emitEvent({ type: 'agent_end', ok: true, kind, turns, summary, usage: { ...usage }, elapsedMs: elapsed(), filesCommitted: true, images: imageCount })
        return { ok: true, model, files: committed.files, assets: committed.assets, summary, turns, usage: { ...usage }, elapsedMs: elapsed(), requestId }
      }
      return fail('NO_CHANGES', '模型未调用任何文件工具，也未产生修改')
    }

    /* ---- 保留 assistant 的 tool_calls 消息（含 tool_call_id，供下一轮上下文） ---- */
    const assistantToolCalls = result.toolCalls.map((tc, i) => ({
      id: tc.id || `call_${turns}_${i}`,
      type: 'function',
      function: { name: tc.name, arguments: tc.args },
    }))
    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: assistantToolCalls,
    })

    /* ---- 逐个执行工具：成功与失败结果都作为 tool 消息回传模型（允许自纠） ---- */
    let finished = null
    for (let i = 0; i < result.toolCalls.length; i++) {
      const tc = result.toolCalls[i]
      const toolName = tc.name || '（空）'
      /* generate_image 由本层执行（需要 API 调用 / 事件 / 取消联动）；
       * 其余工具走 VFS。开关关闭时即便模型误调用也直接拒绝（工具本就不在列表中） */
      const exec =
        toolName === 'generate_image'
          ? visualEnhance
            ? await runGenerateImage(tc.args, turns, i)
            : { ok: false, text: 'ERROR: 本次任务未开启视觉增强，generate_image 工具不可用' }
          : vfs.execute(tc.name, tc.args)

      /* 工具目标文件（结构化字段：read_file 无 fileEvent 时从已解析参数提取） */
      let toolPath = exec.fileEvent?.path || exec.imagePath
      if (!toolPath) {
        try {
          const parsed = JSON.parse(tc.args)
          if (typeof parsed?.path === 'string') toolPath = parsed.path
        } catch {
          /* 参数非合法 JSON 时 execute 已返回失败，path 缺省 */
        }
      }

      emitEvent({
        type: 'tool_call',
        turn: turns,
        callIndex: i,
        tool: toolName,
        path: toolPath,
        ok: exec.ok,
        detail: brief(exec.text, 160),
      })
      emit(exec.ok ? 'INFO' : 'WARNING', 'TOOL_EXEC', `第 ${turns} 轮 · 工具[${i}] ${toolName} ${exec.ok ? '成功' : '失败'}：${brief(exec.text, 120)}`)

      /* file_update 事件携带完整文件内容：阶段 2 前端实时刷新编辑器与 iframe 预览 */
      if (exec.fileEvent) {
        emitEvent({
          type: 'file_update',
          turn: turns,
          tool: toolName,
          path: exec.fileEvent.path,
          size: exec.fileEvent.size,
          content: sanitize(exec.fileEvent.content),
        })
      }

      messages.push({
        role: 'tool',
        tool_call_id: assistantToolCalls[i].id,
        content: exec.text,
      })

      if (exec.finished) finished = exec
    }

    emitEvent({
      type: 'turn_end',
      turn: turns,
      toolCalls: result.toolCalls.length,
      elapsedMs: elapsed(),
      usage: turnUsage,
      cumulativeUsage: { ...usage },
    })
    emit('INFO', 'TURN_END', `第 ${turns} 轮结束 · 执行 ${result.toolCalls.length} 个工具 · 文件修改累计 ${vfs.updates} 次 · tokens 累计 ${usage.prompt_tokens}/${usage.completion_tokens} · 已耗时 ${elapsed()}ms`)

    /* ---- finish 工具：任务成功，提交 VFS ---- */
    if (finished) {
      const committed = vfs.commit()
      emit('SUCCESS', 'DONE', `任务完成 · 轮次 ${turns} · 文件修改 ${committed.updates} 次${committed.assets.length ? ` · 生成图片 ${committed.assets.length} 张` : ''} · tokens 累计 ${usage.prompt_tokens}/${usage.completion_tokens} · 总耗时 ${elapsed()}ms`)
      emitEvent({ type: 'agent_end', ok: true, kind, turns, summary: finished.summary, usage: { ...usage }, elapsedMs: elapsed(), filesCommitted: true, images: imageCount })
      return {
        ok: true,
        model,
        files: committed.files,
        assets: committed.assets,
        summary: finished.summary,
        turns,
        usage: { ...usage },
        elapsedMs: elapsed(),
        requestId,
      }
    }
    /* 未 finish：进入下一轮（模型继续决策） */
  }

  /* 达到最大轮次：已有文件修改则提交并标记可续跑（前端保留文件并提供「继续执行」入口），
     仅在无任何修改时才视为失败回滚 */
  if (vfs.hasChanges()) {
    const committed = vfs.commit()
    emit(
      'WARNING',
      'DONE',
      `已达最大模型轮次（${MAX_TURNS}）· 已提交 ${committed.updates} 次文件修改（可续跑：文件已保留，前端可发起继续执行）`,
    )
    emitEvent({
      type: 'agent_end',
      ok: false,
      kind,
      code: 'MAX_TURNS_EXCEEDED',
      turns,
      usage: usageKnown ? { ...usage } : null,
      elapsedMs: elapsed(),
      filesCommitted: true,
      images: imageCount,
    })
    return {
      ok: false,
      code: 'MAX_TURNS_EXCEEDED',
      resumable: true,
      message: `已达最大模型轮次（${MAX_TURNS}），已完成的文件修改已提交保留，可继续执行`,
      files: committed.files,
      assets: committed.assets,
      summary: `已执行 ${turns} 轮，已完成的修改已保存（可继续执行）`,
      turns,
      usage: usageKnown ? { ...usage } : null,
      elapsedMs: elapsed(),
      requestId,
    }
  }
  return fail('MAX_TURNS_EXCEEDED', `已达最大模型轮次（${MAX_TURNS}），任务未完成，未提交任何修改`)
}
