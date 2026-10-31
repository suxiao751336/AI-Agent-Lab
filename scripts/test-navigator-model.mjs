/* ============================================================
 * 硅基流动 · Conversation Navigator Agent 模型连通性验证
 * （阶段 0 · 每个模式单次真实付费请求 · 无重试 · 无降级）
 *
 * 模型：NAVIGATOR_MODEL（默认 deepseek-ai/DeepSeek-V4-Flash），
 * 复用 SILICONFLOW_API_KEY，与 Vibe Coding Agent 的 Kimi 配置完全独立。
 *
 * 用法（Windows PowerShell 请使用 npm.cmd）：
 *   npm.cmd run test:nav:chat    验证 1：普通文字对话能否正常返回
 *   npm.cmd run test:nav:json    验证 2：结构化 JSON 输出（5 条示例消息 → 话题目录）
 *   npm.cmd run test:nav:tools   验证 3：Function Calling（search_messages 工具，非流式）
 *   npm.cmd run test:nav:stream  验证 4：流式 Tool Calling（delta.tool_calls 分片组装）
 *   npm.cmd run test:nav:all     依次执行以上 4 项（共 4 次付费请求）
 *   直接调用：node scripts/test-navigator-model.mjs <chat|json|tools|stream|all>
 *
 * 安全：仅从 .env 读取配置，不打印 API Key / Authorization 头；
 *       工具参数仅解析展示，不执行、不落盘
 * 边界：不调用 Agent 业务逻辑，不触碰 Visual Coding Agent 与后端生成逻辑
 * ============================================================ */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const FALLBACK_MODEL = 'deepseek-ai/DeepSeek-V4-Flash'
const TIMEOUT_MS = 60000

/* ---------- 受测工具定义：search_messages（阶段 1 回溯 Agent 的最小原型） ---------- */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_messages',
      description: '在当前会话的历史消息中检索与关键词相关的消息（仅测试，不会真正执行）',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '检索关键词' },
          limit: { type: 'integer', description: '最多返回的消息条数' },
        },
        required: ['keyword'],
      },
    },
  },
]

const TOOL_TEST_MESSAGE = {
  role: 'user',
  content:
    '请调用 search_messages 工具：keyword 为「活力橙」，limit 设为 3。不要直接回复文本，必须通过工具调用完成。',
}

/* ---------- 验证 2 的输入：5 条示例消息（独立于前端演示数据，仅用于本测试） ---------- */
const SAMPLE_MESSAGES = [
  { id: 'm001', role: 'user', content: '我想做一个个人健身打卡 App，先帮我梳理需要哪些核心功能。' },
  { id: 'm002', role: 'assistant', content: '建议从三块做起：每日打卡、数据统计图表、提醒通知。先做打卡主流程，再补统计。' },
  { id: 'm003', role: 'user', content: '界面我想用深色主题，强调色用活力橙，看起来有运动感。' },
  { id: 'm004', role: 'assistant', content: '深色底 + 活力橙可行，注意图表配色对比度，连续打卡天数可以用橙色渐变强调。' },
  { id: 'm005', role: 'user', content: '数据第一版先存本地 localStorage，云同步以后再说。' },
]

const JSON_SYSTEM_PROMPT = `你是对话导航智能体的话题目录分析模块。根据给定的对话消息生成话题目录。

输出要求（严格遵守）：
1. 只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块围栏。
2. JSON 结构固定为：{"topics": [{"title": "话题标题", "summary": "一句话说明", "messageIds": ["m001"]}]}
3. topics 为按对话内容划分的话题列表（1~3 个）。
4. messageIds 必须且只能引用输入中出现的消息 ID（m001~m005），不得虚构不存在的 ID。`

const JSON_USER_PROMPT = `以下是一段对话消息（JSON 数组）：

${JSON.stringify(SAMPLE_MESSAGES, null, 2)}

请生成这段对话的话题目录。`

/* ---------- .env 解析（与 server/llmApi.js 同规则：已有环境变量优先，不覆盖） ---------- */
function readEnvFile(root) {
  const map = {}
  let raw = ''
  try {
    raw = readFileSync(join(root, '.env'), 'utf8')
  } catch {
    return map
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    map[m[1]] = val
  }
  return map
}

const envFile = readEnvFile(ROOT)
const API_KEY = process.env.SILICONFLOW_API_KEY || envFile.SILICONFLOW_API_KEY || ''
const MODEL = process.env.NAVIGATOR_MODEL || envFile.NAVIGATOR_MODEL || FALLBACK_MODEL

/* ---------- 脱敏（防御性兜底：任何输出前替换可能出现的密钥形态） ---------- */
function sanitize(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-****')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ****')
}

/* ---------- 错误分类：DNS / 网络连接 / TLS / 超时 ---------- */
const CODE_KINDS = [
  { kind: 'DNS 解析失败', codes: ['ENOTFOUND', 'EAI_AGAIN'] },
  {
    kind: '网络连接错误',
    codes: ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED'],
  },
  {
    kind: 'TLS 证书错误',
    codes: [
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'ERR_SSL_WRONG_VERSION_NUMBER',
    ],
  },
]

function classifyFetchError(err) {
  const code = err?.cause?.code || err?.code || ''
  if (err?.name === 'AbortError' || code === 'ABORT_ERR') {
    return { kind: '请求超时（TIMEOUT）', code: 'ABORT_ERR' }
  }
  for (const group of CODE_KINDS) {
    if (group.codes.includes(code)) return { kind: group.kind, code }
  }
  if (err instanceof TypeError) {
    return { kind: '网络层错误（fetch TypeError，未触达上游或请求被拒）', code: code || '-' }
  }
  return { kind: '未知错误', code: code || '-' }
}

function describeCause(cause) {
  if (!cause) return ''
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

const HTTP_HINTS = {
  401: 'API Key 无效或未授权',
  402: '余额/额度不足',
  403: '权限不足或 Key 无权访问该模型',
  404: '模型不存在（检查 NAVIGATOR_MODEL 是否为硅基流动支持的模型 ID）',
  429: '请求频率限制',
}

/* ---------- 通用输出 ---------- */
function brief(text, n = 80) {
  const s = String(text)
  return s.length > n ? s.slice(0, n) + '…' : s
}

function checkKey() {
  if (!API_KEY) {
    console.error('✗ 失败：未配置 SILICONFLOW_API_KEY（请在项目根目录 .env 填入；Key 不会被打印）')
    process.exitCode = 1
    return false
  }
  return true
}

function printConfig(desc) {
  console.log(`目标    ：${API_URL}`)
  console.log(`模型    ：${MODEL}${MODEL === FALLBACK_MODEL ? '（NAVIGATOR_MODEL 未配置时的默认值）' : ''}`)
  console.log(`API Key：已配置（长度 ${API_KEY.length}，内容不打印）`)
  console.log(`参数    ：${desc} · 超时 ${TIMEOUT_MS / 1000}s`)
  console.log('')
}

function printUsage(usage) {
  console.log(
    `tokens    ：prompt ${usage.prompt_tokens ?? '-'} · completion ${usage.completion_tokens ?? '-'} · total ${usage.total_tokens ?? '-'}`,
  )
}

async function readHttpErrorDetail(resp) {
  const text = await resp.text().catch(() => '')
  let detail
  try {
    const j = JSON.parse(text)
    detail = j?.message || j?.error?.message || text
  } catch {
    detail = text
  }
  const hint = HTTP_HINTS[resp.status] ? ` · ${HTTP_HINTS[resp.status]}` : ''
  return `${sanitize(detail) || '（响应体为空或非 JSON）'}${hint}`
}

function reportFetchError(err, startedAt) {
  const elapsed = Date.now() - startedAt
  const info = classifyFetchError(err)
  const causeText = describeCause(err?.cause) || err?.message || String(err)
  console.error(`✗ 请求失败 · 错误类型：${info.kind} · 已耗时 ${elapsed}ms`)
  console.error(`  Node 底层错误 code：${info.code}`)
  console.error(`  cause（脱敏）：${sanitize(causeText)}`)
}

/* ---------- 请求发送（单次 · 无重试） ---------- */
async function postChat(body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    return { resp }
  } catch (err) {
    return { err }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------- 验证 1：普通文字对话 ---------- */
async function runChat() {
  console.log('=== 验证 1/4 · 普通文字对话（单次 · 真实付费请求 · 无重试）===')
  if (!checkKey()) return false
  printConfig('stream=false · max_tokens=256 · 无 response_format')

  const startedAt = Date.now()
  const { resp, err } = await postChat({
    model: MODEL,
    stream: false,
    max_tokens: 256,
    messages: [
      { role: 'user', content: '请用一句话说明你能进行中文对话，并给出 1+1 的结果。' },
    ],
  })
  if (err) {
    reportFetchError(err, startedAt)
    return false
  }

  console.log(`HTTP 状态码：${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
  if (resp.status !== 200) {
    console.error(`  错误详情（脱敏）：${brief(await readHttpErrorDetail(resp), 300)}`)
    return false
  }

  let data
  try {
    data = await resp.json()
  } catch (parseErr) {
    console.error('✗ JSON 解析错误：HTTP 200 但响应体不是合法 JSON')
    console.error(`  信息（脱敏）：${sanitize(parseErr?.message || String(parseErr))}`)
    return false
  }

  const choice = data?.choices?.[0]
  const content = choice?.message?.content ?? ''
  const finishReason = choice?.finish_reason ?? '-'
  const elapsed = Date.now() - startedAt
  console.log(`响应耗时  ：${elapsed}ms`)
  console.log(`finish_reason：${finishReason}`)
  console.log(`回复长度  ：${content.length} 字符`)
  console.log(`回复内容（脱敏）：${sanitize(brief(content, 160)) || '（空）'}`)
  if (data?.usage) printUsage(data.usage)

  if (!content.trim()) {
    console.error('✗ 验证未通过：content 为空')
    return false
  }
  if (finishReason === 'length') {
    console.error('✗ 验证未通过：输出被 max_tokens 截断（finish_reason=length）')
    return false
  }
  console.log('')
  console.log(`✓ 普通文字对话验证通过（耗时 ${elapsed}ms · 单次执行 · 未重试）`)
  return true
}

/* ---------- 验证 2：结构化 JSON 输出（话题目录生成） ---------- */
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

function validateTopics(parsed, validIds) {
  const topics = parsed?.topics
  if (!Array.isArray(topics) || topics.length === 0) {
    return { ok: false, error: 'topics 缺失、非数组或为空' }
  }
  const seen = new Set()
  const unknown = []
  for (const t of topics) {
    if (typeof t.title !== 'string' || !t.title.trim()) {
      return { ok: false, error: '存在 title 缺失或为空的话题' }
    }
    if (!Array.isArray(t.messageIds)) {
      return { ok: false, error: `话题「${t.title}」的 messageIds 非数组` }
    }
    for (const id of t.messageIds) {
      if (typeof id === 'string' && validIds.includes(id)) seen.add(id)
      else unknown.push(String(id))
    }
  }
  if (unknown.length) {
    return { ok: false, error: `出现输入之外或非法的消息 ID：${unknown.join(', ')}` }
  }
  return { ok: true, topicCount: topics.length, covered: seen.size }
}

async function runJson() {
  console.log('=== 验证 2/4 · 结构化 JSON 输出 · 5 条示例消息生成话题目录（单次 · 真实付费请求 · 无重试）===')
  if (!checkKey()) return false
  printConfig('stream=false · max_tokens=768 · response_format=json_object')

  const startedAt = Date.now()
  const { resp, err } = await postChat({
    model: MODEL,
    stream: false,
    max_tokens: 768,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: JSON_SYSTEM_PROMPT },
      { role: 'user', content: JSON_USER_PROMPT },
    ],
  })
  if (err) {
    reportFetchError(err, startedAt)
    return false
  }

  console.log(`HTTP 状态码：${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
  if (resp.status !== 200) {
    console.error(`  错误详情（脱敏）：${brief(await readHttpErrorDetail(resp), 300)}`)
    console.error('  提示：若为 response_format 不支持，说明该模型不支持 json_object 结构化输出')
    return false
  }

  let data
  try {
    data = await resp.json()
  } catch (parseErr) {
    console.error('✗ JSON 解析错误：HTTP 200 但响应体不是合法 JSON')
    console.error(`  信息（脱敏）：${sanitize(parseErr?.message || String(parseErr))}`)
    return false
  }

  const choice = data?.choices?.[0]
  const content = choice?.message?.content ?? ''
  const finishReason = choice?.finish_reason ?? '-'
  const elapsed = Date.now() - startedAt
  console.log(`响应耗时  ：${elapsed}ms`)
  console.log(`finish_reason：${finishReason}`)
  if (data?.usage) printUsage(data.usage)

  const parsed = extractJson(content)
  if (!parsed) {
    console.error('✗ 模型未返回可解析的 JSON 对象')
    console.error(`  content 前 160 字符（脱敏）：${sanitize(brief(content, 160)) || '（空）'}`)
    return false
  }
  console.log('JSON 解析：✓ 成功（含围栏剥离兜底）')

  const validIds = SAMPLE_MESSAGES.map((m) => m.id)
  const checked = validateTopics(parsed, validIds)
  if (!checked.ok) {
    console.error(`✗ 话题目录校验失败：${checked.error}`)
    return false
  }
  console.log(`话题目录  ：✓ ${checked.topicCount} 个话题 · 消息覆盖 ${checked.covered}/${validIds.length} 条`)
  for (const t of parsed.topics) {
    console.log(`  ─ ${t.title}（${t.messageIds.join(', ')}）${t.summary ? ` · ${brief(t.summary, 40)}` : ''}`)
  }
  if (checked.covered < validIds.length) {
    console.error(`⚠ 部分消息未被任何话题覆盖（${checked.covered}/${validIds.length}），不影响通过，但完整目录应尽量全覆盖`)
  }
  console.log('')
  console.log(`✓ 结构化 JSON 输出验证通过（耗时 ${elapsed}ms · 单次执行 · 未重试）`)
  return true
}

/* ---------- search_messages 工具调用结果报告 ---------- */
function reportSearchToolCall(name, argsRaw) {
  console.log(`  工具名称：${name || '（空）'}`)
  if (name !== 'search_messages') {
    console.error('  ✗ 工具名称与定义不符（期望 search_messages）')
  }
  let parsed
  try {
    parsed = JSON.parse(argsRaw)
  } catch (parseErr) {
    console.error('  参数解析：✗ 失败（arguments 非合法 JSON）')
    console.error(`    解析错误（脱敏）：${sanitize(parseErr?.message || String(parseErr))}`)
    console.error(`    arguments 原文（脱敏，≤120 字符）：${sanitize(brief(argsRaw, 120)) || '（空）'}`)
    return false
  }
  console.log('  参数解析：✓ 成功（合法 JSON）')
  const kw = parsed && typeof parsed === 'object' && typeof parsed.keyword === 'string' ? parsed.keyword : ''
  const limit = parsed && typeof parsed === 'object' ? parsed.limit : undefined
  console.log(`    keyword：${kw || '（缺失或非字符串）'}${kw === '活力橙' ? '' : ' · 与预期（活力橙）不一致'}`)
  console.log(
    `    limit  ：${limit ?? '（未提供）'}${Number(limit) === 3 ? '' : ' · 与预期（3）不一致'}`,
  )
  return name === 'search_messages' && kw.length > 0
}

/* ---------- 验证 3：Function Calling（非流式） ---------- */
async function runTools() {
  console.log('=== 验证 3/4 · Function Calling · search_messages（非流式）（单次 · 真实付费请求 · 无重试）===')
  if (!checkKey()) return false
  printConfig('stream=false · max_tokens=512 · tools=1（search_messages）· tool_choice=auto')

  const startedAt = Date.now()
  const { resp, err } = await postChat({
    model: MODEL,
    stream: false,
    max_tokens: 512,
    messages: [TOOL_TEST_MESSAGE],
    tools: TOOLS,
    tool_choice: 'auto',
  })
  if (err) {
    reportFetchError(err, startedAt)
    return false
  }

  console.log(`HTTP 状态码：${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
  if (resp.status !== 200) {
    console.error(`  错误详情（脱敏）：${brief(await readHttpErrorDetail(resp), 300)}`)
    return false
  }

  let data
  try {
    data = await resp.json()
  } catch (parseErr) {
    console.error('✗ JSON 解析错误：HTTP 200 但响应体不是合法 JSON')
    console.error(`  信息（脱敏）：${sanitize(parseErr?.message || String(parseErr))}`)
    return false
  }

  const choice = data?.choices?.[0]
  const finishReason = choice?.finish_reason ?? '-'
  const elapsed = Date.now() - startedAt
  console.log(`响应耗时  ：${elapsed}ms`)
  console.log(`finish_reason：${finishReason}`)
  if (data?.usage) printUsage(data.usage)

  const toolCalls = choice?.message?.tool_calls || []
  if (!toolCalls.length) {
    const content = choice?.message?.content ?? ''
    console.error('✗ 模型未发起工具调用（HTTP 200，无 tool_calls）')
    console.error(`  文本回复（脱敏，≤120 字符）：${sanitize(brief(content, 120)) || '（空）'}`)
    return false
  }

  console.log(`tool_calls：${toolCalls.length} 个`)
  let pass = true
  for (const tc of toolCalls) {
    console.log(`  ─ 调用 ${tc?.id || '（无 id）'}`)
    if (!reportSearchToolCall(tc?.function?.name || '', tc?.function?.arguments || '')) pass = false
  }

  console.log('')
  if (pass) {
    console.log(`✓ Function Calling 验证通过（非流式 · 耗时 ${elapsed}ms · 单次执行 · 未重试）`)
  } else {
    console.error('✗ Function Calling 验证未通过（详见上方诊断）')
  }
  return pass
}

/* ---------- 验证 4：流式 Tool Calling（SSE 分帧解析 + 分片组装） ---------- */
function parseSseLine(line, onChunk, stats) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return false
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return true
  try {
    onChunk(JSON.parse(payload))
  } catch {
    stats.skipped++
  }
  return false
}

async function readSseStream(resp, onChunk, stats) {
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
      if (parseSseLine(line, onChunk, stats)) return
    }
  }
  if (buf) parseSseLine(buf, onChunk, stats)
}

async function runStream() {
  console.log('=== 验证 4/4 · 流式 Tool Calling · search_messages（单次 · 真实付费请求 · 无重试）===')
  if (!checkKey()) return false
  printConfig('stream=true · max_tokens=512 · tools=1（search_messages）· tool_choice=auto')

  const startedAt = Date.now()
  const { resp, err } = await postChat({
    model: MODEL,
    stream: true,
    max_tokens: 512,
    messages: [TOOL_TEST_MESSAGE],
    tools: TOOLS,
    tool_choice: 'auto',
  })
  if (err) {
    reportFetchError(err, startedAt)
    return false
  }

  console.log(`HTTP 状态码：${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
  console.log(`响应头耗时：${Date.now() - startedAt}ms`)
  if (resp.status !== 200) {
    console.error(`  错误详情（脱敏）：${brief(await readHttpErrorDetail(resp), 300)}`)
    return false
  }
  if (!resp.body) {
    console.error('✗ 响应无 body 流（resp.body 为空）')
    return false
  }

  const stats = { skipped: 0 }
  let firstEventAt = null
  let firstToolCallAt = null
  let finishReason = '-'
  let content = ''
  let usage = null
  let dataChunks = 0
  const toolAcc = new Map()

  const onChunk = (j) => {
    const now = Date.now() - startedAt
    if (firstEventAt === null) firstEventAt = now
    dataChunks++
    if (j.usage) usage = j.usage
    const choice = j.choices?.[0]
    if (!choice) return
    const delta = choice.delta || {}
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
    }
    for (const tc of delta.tool_calls || []) {
      if (firstToolCallAt === null) firstToolCallAt = now
      const idx = typeof tc.index === 'number' ? tc.index : 0
      const acc = toolAcc.get(idx) || { id: '', name: '', args: '', fragments: 0 }
      if (tc.id) acc.id = tc.id
      if (tc.function?.name) acc.name = tc.function.name
      if (tc.function?.arguments) {
        acc.args += tc.function.arguments
        acc.fragments++
      }
      toolAcc.set(idx, acc)
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }

  await readSseStream(resp, onChunk, stats)
  const elapsed = Date.now() - startedAt
  console.log(`响应总耗时：${elapsed}ms`)
  console.log(`首个事件  ：${firstEventAt !== null ? `${firstEventAt}ms` : '（无）'}`)
  console.log(`首个工具分片：${firstToolCallAt !== null ? `${firstToolCallAt}ms` : '（无 tool_calls 增量）'}`)
  console.log(`SSE 数据块：${dataChunks} 个${stats.skipped ? ` · 跳过无法解析的行 ${stats.skipped} 个` : ''}`)
  console.log(`finish_reason：${finishReason}`)
  if (usage) printUsage(usage)
  else console.log('tokens    ：（本流未携带 usage）')

  if (!toolAcc.size) {
    console.error('✗ 模型未发起工具调用（流式中无 tool_calls 增量）')
    console.error(`  文本回复累计（脱敏，≤120 字符）：${sanitize(brief(content, 120)) || '（空）'}`)
    return false
  }

  console.log(`tool_calls 组装：${toolAcc.size} 个`)
  let pass = true
  for (const [idx, acc] of toolAcc) {
    console.log(`  ─ 调用[${idx}] ${acc.id || '（无 id）'} · 分片 ${acc.fragments} 段 · arguments ${acc.args.length} 字符`)
    if (!reportSearchToolCall(acc.name, acc.args)) pass = false
  }

  console.log('')
  if (pass) {
    console.log(`✓ 流式 Function Calling 验证通过（含分片参数组装 · 总耗时 ${elapsed}ms · 单次执行 · 未重试）`)
  } else {
    console.error('✗ 流式 Function Calling 验证未通过（详见上方诊断）')
  }
  return pass
}

/* ---------- 全量执行（依次 4 项，每项单次请求，无重试） ---------- */
async function runAll() {
  console.log('=== Conversation Navigator · 模型连通性全量验证（依次 4 项 · 各一次真实付费请求 · 无重试）===')
  console.log('')
  const results = []
  results.push(['普通文字对话', await runChat()])
  console.log('')
  results.push(['结构化 JSON 输出', await runJson()])
  console.log('')
  results.push(['Function Calling（非流式）', await runTools()])
  console.log('')
  results.push(['流式 Tool Calling', await runStream()])
  console.log('')
  console.log('── 阶段 0 汇总 ──')
  let allPass = true
  for (const [name, pass] of results) {
    console.log(`${pass ? '✓' : '✗'} ${name}`)
    if (!pass) allPass = false
  }
  console.log(
    allPass
      ? '✅ 全部通过：模型具备目录 Agent 与回溯 Agent 所需的基础能力（对话 / JSON / 工具调用 / 流式）'
      : '❌ 存在未通过项：请根据上方诊断判断是否需要更换模型或调整参数',
  )
  if (!allPass) process.exitCode = 1
}

/* ---------- 入口：未传模式时仅打印用法，不发起任何请求 ---------- */
function printUsageModes() {
  console.error('未指定测试模式，未发起任何请求。可用模式：')
  console.error('  chat          npm.cmd run test:nav:chat    验证 1：普通文字对话')
  console.error('  json          npm.cmd run test:nav:json    验证 2：结构化 JSON 输出（话题目录）')
  console.error('  tools         npm.cmd run test:nav:tools   验证 3：Function Calling（非流式）')
  console.error('  stream        npm.cmd run test:nav:stream  验证 4：流式 Tool Calling')
  console.error('  all           npm.cmd run test:nav:all     依次执行 4 项（共 4 次付费请求）')
  process.exitCode = 1
}

const mode = process.argv[2] || ''
if (mode === 'chat') {
  process.exitCode = (await runChat()) ? 0 : 1
} else if (mode === 'json') {
  process.exitCode = (await runJson()) ? 0 : 1
} else if (mode === 'tools') {
  process.exitCode = (await runTools()) ? 0 : 1
} else if (mode === 'stream') {
  process.exitCode = (await runStream()) ? 0 : 1
} else if (mode === 'all') {
  await runAll()
} else {
  printUsageModes()
}
