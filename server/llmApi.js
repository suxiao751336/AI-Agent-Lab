/* ============================================================
 * 硅基流动 Kimi K2.7 Code 服务端代理（核心逻辑，零依赖）
 *
 * 职责：
 *  1. 从服务端环境变量读取 API Key（绝不进入前端）
 *  2. 构建生成 / 修改两种提示词，调用 chat/completions
 *  3. response_format 降级：json_object → 纯提示词约束（各最多一次）
 *  4. 严格校验返回 JSON（文件白名单 / 非空字符串 / 大小上限）
 *  5. 错误细分（Key 缺失 / 鉴权 / 余额 / 限流 / 参数 / 上游 5xx /
 *     网络连接 / 超时 / 截断 / JSON 解析 / 文件校验），不再统一 SERVER_ERROR
 *  6. onEvent 执行事件流（真实阶段 + 真实耗时，供 SSE 实时转发到前端）
 *
 * 本模块为纯函数（payload → result），不绑定任何 HTTP 框架：
 *  · 本地开发：由 server/devServer.js 挂载到 Vite dev server
 *  · Serverless 部署：可直接在函数 handler 中包装调用
 *
 * 安全：所有对外事件与错误信息均经 sanitize() 脱敏（不包含
 * API Key / Authorization / .env 内容），不输出完整需求与模型响应。
 * ============================================================ */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const ALLOWED_FILES = ['index.html', 'style.css', 'app.js']
const MAX_FILE_SIZE = 512 * 1024 /* 单文件 512KB 上限 */
const REQUEST_TIMEOUT_MS = 180_000 /* 3 分钟 */
const MAX_TOKENS = 8192

/* ── 环境变量加载（.env → process.env，已有变量不覆盖，绝不打印值） ── */

export function loadEnvFile(root = process.cwd()) {
  const envPath = path.join(root, '.env')
  return readFile(envPath, 'utf-8')
    .then((text) => {
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (!m || line.trim().startsWith('#')) continue
        const key = m[1]
        let val = m[2]
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        if (!(key in process.env)) process.env[key] = val
      }
    })
    .catch(() => {
      /* .env 不存在时静默跳过（生产环境用真实环境变量） */
    })
}

/* ── 脱敏：抹掉可能意外出现的 API Key 值 ── */

function sanitize(text) {
  let out = String(text ?? '')
  const key = process.env.SILICONFLOW_API_KEY
  if (key && key.length > 8) out = out.split(key).join('sk-****')
  return out
}

/* ── 提示词构建（完整需求与代码仅进入模型请求，不进入日志） ── */

const SYSTEM_PROMPT = `你是专业的移动端应用开发智能体，负责生成真实可运行的 HTML、CSS 和 JavaScript 项目。

输出要求（严格遵守）：
1. 只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块围栏。
2. JSON 结构固定为：{"files": {"index.html": "完整HTML", "style.css": "完整CSS", "app.js": "完整JS"}, "summary": "一句话功能说明"}
3. 三个文件的代码必须完整可运行，严禁省略号、占位符、"此处省略"或"同上"。
4. index.html 必须通过 <link rel="stylesheet" href="style.css"> 与 <script src="app.js"></script> 外链另外两个文件。
5. 技术范围：纯 HTML / CSS / JavaScript 移动端 H5（视口约 390px 宽），不使用框架、构建工具或任何外部 CDN 资源。
6. 必须包含真实业务逻辑：按钮事件、表单输入、页面切换、状态管理；需要持久化的数据使用 localStorage。
7. 安全约束：不得访问任何 API 密钥或环境变量，不得发起需要鉴权的网络请求，不得尝试执行系统命令。`

function buildUserPrompt(kind, requirement, files) {
  if (kind === 'modify') {
    return `当前项目代码如下（请在现有代码基础上增量修改，不要重写为无关项目）：

【index.html】
${files.html}

【style.css】
${files.css}

【app.js】
${files.js}

修改需求：${requirement}

修改要求：
1. 尽量保留原有功能、页面结构与数据结构，localStorage 键名保持兼容，避免已有数据丢失。
2. 输出修改后的完整三文件（完整文件替换，不是 diff 片段）。
3. summary 用 2-3 句话说明本次修改了什么。`
  }
  return `开发需求：${requirement}

请生成完整的移动端 H5 项目（index.html / style.css / app.js）。`
}

/* 需求摘要（日志脱敏用：不写完整需求） */
function brief(text, n = 40) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/* ── 响应 JSON 提取与校验 ── */

function extractJson(content) {
  let text = String(content || '').trim()
  /* 剥离可能的 markdown 围栏 */
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

function validateFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    return { error: 'files 字段缺失或不是对象' }
  }
  const out = {}
  for (const name of ALLOWED_FILES) {
    const content = files[name]
    if (typeof content !== 'string' || !content.trim()) {
      return { error: `缺少有效文件：${name}（必须是非空字符串）` }
    }
    if (content.length > MAX_FILE_SIZE) {
      return { error: `文件 ${name} 超过大小上限（${MAX_FILE_SIZE / 1024}KB）` }
    }
    out[name] = content
  }
  return { files: out }
}

/* ── HTTP 状态分类（细分，不再笼统 SERVER_ERROR） ── */

function classifyHttpError(status, message, elapsedMs) {
  const base = { httpStatus: status, upstream: true, elapsedMs }
  if (status === 401) {
    return { ...base, code: 'UNAUTHORIZED', message: 'API Key 无效（401），请检查 .env 中的 SILICONFLOW_API_KEY' }
  }
  if (status === 403) {
    return { ...base, code: 'FORBIDDEN', message: '无权限访问该模型或 API（403）' }
  }
  if (status === 429) {
    return { ...base, code: 'RATE_LIMIT', message: '请求频率受限（429），请稍后再试' }
  }
  if (status === 402 || /余额|balance/i.test(message)) {
    return { ...base, code: 'INSUFFICIENT_BALANCE', message: '账户余额或额度不足，请前往硅基流动控制台充值' }
  }
  if (status === 404) {
    return { ...base, code: 'MODEL_NOT_FOUND', message: '模型不存在或无权访问（404），请检查 SILICONFLOW_MODEL 配置' }
  }
  if (status >= 500) {
    return { ...base, code: 'UPSTREAM_ERROR', message: `硅基流动上游服务错误（HTTP ${status}）：${sanitize(message) || '无详细信息'}` }
  }
  if (status === 400) {
    return { ...base, code: 'BAD_PARAMS', message: `请求参数错误（400）：${sanitize(message) || '请检查模型参数配置'}` }
  }
  return { ...base, code: 'UPSTREAM_ERROR', message: `硅基流动返回 HTTP ${status}：${sanitize(message) || '未知错误'}` }
}

/* 判断 400 是否由 response_format 参数引起（用于一次性降级，不会重复消耗 token） */
function isFormatUnsupported(message) {
  return /response_format|json_object|json_schema|unknown (parameter|field)/i.test(message)
}

/* ── 单次请求（含超时控制），fetch 异常在此分类而非冒泡为 SERVER_ERROR ── */

async function callModel(apiKey, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
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
    const data = await resp.json().catch(() => null)
    return { resp, data }
  } catch (e) {
    const aborted = controller.signal.aborted
    return {
      fetchError: aborted ? 'TIMEOUT' : 'NETWORK',
      fetchErrorMessage: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ── 主入口 ── */

/**
 * @param {{kind:'generate'|'modify', requirement:string, requestId?:string, files?:{html:string,css:string,js:string}}} payload
 * @param {{onEvent?:(ev:{requestId:string, level:string, stage:string, text:string, t:number})=>void}} [hooks]
 * @returns {Promise<{ok:boolean, code?:string, message?:string, httpStatus?:number, upstream?:boolean, timedOut?:boolean,
 *   traceId?:string, elapsedMs?:number, requestId?:string, files?:Object, summary?:string, usage?:Object, model?:string, fallbackNote?:string}>}
 */
export async function handleLLMGenerate(payload, { onEvent } = {}) {
  const started = Date.now()
  const requestId = String(payload?.requestId || '-').slice(0, 40)
  const elapsed = () => Date.now() - started
  const emit = (level, stage, text) => {
    try {
      onEvent?.({ requestId, level, stage, text: sanitize(text), t: Date.now() })
    } catch {
      /* 事件回调异常不影响主流程 */
    }
  }

  emit('INFO', 'RECEIVED', `服务端收到请求（kind=${payload?.kind === 'modify' ? 'modify' : 'generate'}）· 需求摘要：${brief(payload?.requirement)}`)

  const apiKey = process.env.SILICONFLOW_API_KEY
  const model = process.env.SILICONFLOW_MODEL || 'moonshotai/Kimi-K2.7-Code'
  emit('INFO', 'CONFIG', `服务端读取模型配置 · 模型：${model} · API Key：${apiKey ? `已配置（长度 ${apiKey.length}）` : '未配置'}`)
  if (!apiKey) {
    emit('ERROR', 'CONFIG', '服务端未配置 SILICONFLOW_API_KEY：请在项目根目录 .env 填入（Key 仅存服务端）')
    return {
      ok: false,
      code: 'NO_API_KEY',
      message: '服务端未配置 SILICONFLOW_API_KEY：请在项目根目录 .env 文件中填入',
      requestId,
      elapsedMs: elapsed(),
    }
  }

  const kind = payload?.kind === 'modify' ? 'modify' : 'generate'
  const requirement = String(payload?.requirement || '').trim()
  if (!requirement) {
    emit('ERROR', 'VALIDATE', '请求校验失败：缺少开发需求描述')
    return { ok: false, code: 'BAD_REQUEST', message: '缺少开发需求描述', requestId, elapsedMs: elapsed() }
  }
  if (kind === 'modify' && (!payload.files || !payload.files.html)) {
    emit('ERROR', 'VALIDATE', '请求校验失败：多轮修改缺少当前项目文件')
    return { ok: false, code: 'BAD_REQUEST', message: '多轮修改缺少当前项目文件', requestId, elapsedMs: elapsed() }
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(kind, requirement, payload.files) },
  ]
  emit('INFO', 'PROMPT', `提示词构建完成 · system ${SYSTEM_PROMPT.length} 字符 · user ${messages[1].content.length} 字符（内容不写入日志）`)

  /* 第一选择：json_object 结构化输出；若模型不支持则一次性降级为提示词约束 */
  const baseBody = { model, messages, stream: false, max_tokens: MAX_TOKENS }
  let body = { ...baseBody, response_format: { type: 'json_object' } }
  let fallbackNote = ''

  emit('INFO', 'UPSTREAM_REQ', `向硅基流动发起请求 · POST /v1/chat/completions · stream=false · max_tokens=${MAX_TOKENS} · response_format=json_object`)

  let { resp, data, fetchError, fetchErrorMessage } = await callModel(apiKey, body)

  if (fetchError === 'TIMEOUT') {
    emit('ERROR', 'UPSTREAM_ERR', `上游请求超时：${REQUEST_TIMEOUT_MS / 1000}s 内未收到响应（AbortController 已中止）· 已耗时 ${elapsed()}ms`)
    return {
      ok: false,
      code: 'TIMEOUT',
      message: `上游请求超时（${REQUEST_TIMEOUT_MS / 1000}s），本次未产生完整结果`,
      timedOut: true,
      requestId,
      elapsedMs: elapsed(),
    }
  }
  if (fetchError === 'NETWORK') {
    emit('ERROR', 'UPSTREAM_ERR', `网络连接错误：无法连接 api.siliconflow.cn（${sanitize(fetchErrorMessage)}）· 未触达上游`)
    return {
      ok: false,
      code: 'NETWORK',
      message: '无法连接硅基流动 API（网络错误），请检查本机网络',
      upstream: false,
      requestId,
      elapsedMs: elapsed(),
    }
  }

  const traceId = resp.headers.get('x-request-id') || resp.headers.get('trace-id') || ''
  emit('INFO', 'UPSTREAM_RESP', `硅基流动返回 HTTP ${resp.status} · 耗时 ${elapsed()}ms${traceId ? ` · 追踪ID ${traceId}` : ''}`)

  /* response_format 不支持 → 一次性降级重试（失败请求未生成 token） */
  if (resp.status === 400 && isFormatUnsupported(data?.message || data?.error?.message || '')) {
    fallbackNote = '（模型不支持 response_format，已降级为提示词约束 JSON）'
    emit('WARNING', 'UPSTREAM_REQ', `response_format 参数不被上游支持，降级为提示词约束后重试（不重复消耗 token）`)
    body = { ...baseBody }
    ;({ resp, data, fetchError, fetchErrorMessage } = await callModel(apiKey, body))
    if (fetchError === 'TIMEOUT') {
      emit('ERROR', 'UPSTREAM_ERR', `降级重试后上游请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`)
      return {
        ok: false,
        code: 'TIMEOUT',
        message: `上游请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`,
        timedOut: true,
        requestId,
        elapsedMs: elapsed(),
      }
    }
    if (fetchError === 'NETWORK') {
      emit('ERROR', 'UPSTREAM_ERR', `降级重试网络错误：${sanitize(fetchErrorMessage)}`)
      return { ok: false, code: 'NETWORK', message: '无法连接硅基流动 API（网络错误）', upstream: false, requestId, elapsedMs: elapsed() }
    }
    emit('INFO', 'UPSTREAM_RESP', `降级重试返回 HTTP ${resp.status} · 耗时 ${elapsed()}ms`)
  }

  if (!resp.ok) {
    const errMessage = sanitize(data?.message || data?.error?.message || '')
    const classified = classifyHttpError(resp.status, errMessage, elapsed())
    emit(
      'ERROR',
      'UPSTREAM_ERR',
      `上游错误 · 阶段=模型调用 HTTP=${resp.status} 类型=${classified.code} 上游=是${traceId ? ` 追踪ID=${traceId}` : ''} 耗时=${elapsed()}ms · ${classified.message}`,
    )
    console.error(`[LLM:${requestId}] http=${resp.status} code=${classified.code} elapsed=${elapsed()}ms`)
    return { ok: false, ...classified, traceId: traceId || undefined, requestId, elapsedMs: elapsed() }
  }

  const choice = data?.choices?.[0]
  const content = choice?.message?.content || ''
  const finishReason = choice?.finish_reason || 'unknown'

  emit('INFO', 'PARSE', `模型响应接收完成 · content ${content.length} 字符 · finish_reason=${finishReason}`)

  /* 截断检测：不应覆盖项目 */
  if (finishReason === 'length') {
    emit('ERROR', 'VALIDATE', `模型输出被 max_tokens（${MAX_TOKENS}）截断（finish_reason=length）· 结果不完整，未采用`)
    console.error(`[LLM:${requestId}] truncated finish_reason=length elapsed=${elapsed()}ms`)
    return {
      ok: false,
      code: 'TRUNCATED',
      message: `输出被 max_tokens（${MAX_TOKENS}）截断，结果不完整，未采用。可简化需求后重试`,
      upstream: true,
      requestId,
      elapsedMs: elapsed(),
    }
  }

  const parsed = extractJson(content)
  if (!parsed) {
    emit('ERROR', 'PARSE', `JSON 解析失败：content 前 120 字符为「${brief(content, 120)}」`)
    console.error(`[LLM:${requestId}] invalid-json elapsed=${elapsed()}ms`)
    return {
      ok: false,
      code: 'INVALID_JSON',
      message: '模型未返回可解析的 JSON（可能被围栏或说明文字包裹），本次未采用',
      upstream: true,
      requestId,
      elapsedMs: elapsed(),
    }
  }
  emit('INFO', 'PARSE', 'JSON 解析成功（files + summary 结构）')

  const checked = validateFiles(parsed.files)
  if (checked.error) {
    emit('ERROR', 'VALIDATE', `项目文件校验失败：${checked.error}`)
    console.error(`[LLM:${requestId}] invalid-files elapsed=${elapsed()}ms`)
    return { ok: false, code: 'INVALID_FILES', message: `文件校验失败：${checked.error}`, upstream: true, requestId, elapsedMs: elapsed() }
  }
  emit(
    'SUCCESS',
    'VALIDATE',
    `文件校验通过 · index.html ${checked.files['index.html'].length}B / style.css ${checked.files['style.css'].length}B / app.js ${checked.files['app.js'].length}B`,
  )

  const usage = data?.usage
    ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      }
    : null

  emit(
    'SUCCESS',
    'DONE',
    `任务完成 · tokens ${usage?.prompt_tokens ?? '?'}/${usage?.completion_tokens ?? '?'} · 总耗时 ${elapsed()}ms${fallbackNote}`,
  )
  console.log(
    `[LLM:${requestId}] kind=${kind} model=${model} tokens=${usage?.prompt_tokens ?? '?'}/${usage?.completion_tokens ?? '?'} elapsed=${elapsed()}ms${fallbackNote}`,
  )

  return {
    ok: true,
    model,
    files: checked.files,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 200) : '',
    usage,
    elapsedMs: elapsed(),
    requestId,
    traceId: traceId || undefined,
    fallbackNote,
  }
}
