/* 硅基流动 Function Calling 能力验证（阶段 0 · 单次请求 · 无重试）
 * 用法：
 *   npm run test:llm:tools          非流式：验证 tools 参数被接受、模型返回 tool_calls
 *   npm run test:llm:tools:stream   流式：验证 delta.tool_calls 分片组装（阶段 1 服务端实现原型）
 *   直接调用：node scripts/test-llm-tools.mjs [once|stream]（缺省 once，未知参数直接报错、不发起请求）
 * 安全：仅从 .env 读取配置，不打印 API Key / Authorization 头；工具参数仅解析展示，不执行、不落盘
 * 边界：不调用 Agent 业务逻辑，不触碰 Visual Coding Agent / Sales Agent / 后端生成逻辑
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const FALLBACK_MODEL = 'moonshotai/Kimi-K2.7-Code'
const TIMEOUT_MS = 60000
const MAX_TOKENS = 512

/* ---------- 受测工具定义（path 白名单约束在 schema 层，与架构方案一致） ---------- */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: '在虚拟项目中创建一个文件（仅测试，不会真正写入磁盘）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: ['index.html', 'style.css', 'app.js'] },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
]

const TEST_MESSAGE = {
  role: 'user',
  content: '请调用 create_file 工具：path 为 "index.html"，content 为 "<h1>OK</h1>"。不要直接回复文本，必须通过工具调用完成。',
}

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
const MODEL = process.env.SILICONFLOW_MODEL || envFile.SILICONFLOW_MODEL || FALLBACK_MODEL

/* ---------- 脱敏（防御性兜底：任何错误输出前替换可能出现的密钥形态） ---------- */
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
  404: '模型不存在（检查 SILICONFLOW_MODEL）',
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

function printConfig(stream) {
  console.log(`目标    ：${API_URL}`)
  console.log(`模型    ：${MODEL}`)
  console.log(`API Key：已配置（长度 ${API_KEY.length}，内容不打印）`)
  console.log(
    `参数    ：stream=${stream} · max_tokens=${MAX_TOKENS} · tools=1（create_file）· tool_choice=auto · 超时 ${TIMEOUT_MS / 1000}s`,
  )
  console.log('')
}

function printUsage(usage) {
  console.log(
    `tokens    ：prompt ${usage.prompt_tokens ?? '-'} · completion ${usage.completion_tokens ?? '-'} · total ${usage.total_tokens ?? '-'}`,
  )
}

async function reportHttpError(resp) {
  const text = await resp.text().catch(() => '')
  let detail = text
  try {
    const parsedText = JSON.parse(text)
    detail = parsedText?.message || parsedText?.error?.message || text
  } catch {
    detail = text || '（响应体为空或非 JSON）'
  }
  const hint = HTTP_HINTS[resp.status] ? ` · ${HTTP_HINTS[resp.status]}` : ''
  console.error(`✗ HTTP 错误：上游返回 ${resp.status}${hint}`)
  console.error(`  错误详情（脱敏）：${sanitize(detail).slice(0, 300)}`)
}

function reportFetchError(err, startedAt) {
  const elapsed = Date.now() - startedAt
  const info = classifyFetchError(err)
  const causeText = describeCause(err?.cause) || err?.message || String(err)
  console.error(`✗ 请求失败 · 错误类型：${info.kind} · 已耗时 ${elapsed}ms`)
  console.error(`  Node 底层错误 code：${info.code}`)
  console.error(`  cause（脱敏）：${sanitize(causeText)}`)
}

/* ---------- 工具调用结果报告：返回验证是否通过（名称正确且参数解析成功） ---------- */
function reportToolCall(name, argsRaw) {
  console.log(`  工具名称：${name || '（空）'}`)
  if (name !== 'create_file') {
    console.error('  ✗ 工具名称与定义不符（期望 create_file）')
  }
  let parsed
  try {
    parsed = JSON.parse(argsRaw)
  } catch (err) {
    console.error('  参数解析：✗ 失败（arguments 非合法 JSON）')
    console.error(`    解析错误（脱敏）：${sanitize(err?.message || String(err))}`)
    console.error(`    arguments 原文（脱敏，≤120 字符）：${sanitize(brief(argsRaw, 120)) || '（空）'}`)
    return false
  }
  console.log('  参数解析：✓ 成功（合法 JSON）')
  const pathStr = parsed && typeof parsed === 'object' && typeof parsed.path === 'string' ? parsed.path : ''
  const contentStr =
    parsed && typeof parsed === 'object' && typeof parsed.content === 'string' ? parsed.content : ''
  console.log(`    path    ：${pathStr || '（缺失或非字符串）'}${pathStr === 'index.html' ? '' : ' · 与预期（index.html）不一致'}`)
  console.log(
    `    content ：${contentStr ? `${contentStr.length} 字符 · ${brief(sanitize(contentStr))}` : '（缺失或非字符串）'}${
      contentStr === '<h1>OK</h1>' ? '' : ' · 与预期（<h1>OK</h1>）不一致'
    }`,
  )
  return name === 'create_file'
}

/* ---------- 非流式验证 ---------- */
async function runOnce() {
  console.log('=== 硅基流动 Function Calling 验证 · 非流式（单次 · 真实付费请求 · 无重试）===')
  if (!checkKey()) return
  printConfig(false)

  const body = JSON.stringify({
    model: MODEL,
    stream: false,
    max_tokens: MAX_TOKENS,
    messages: [TEST_MESSAGE],
    tools: TOOLS,
    tool_choice: 'auto',
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    console.log(`开始时间：${new Date(startedAt).toLocaleString('zh-CN')}`)
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body,
      signal: controller.signal,
    })
    const elapsed = Date.now() - startedAt
    console.log(`HTTP 状态码：${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
    console.log(`响应耗时  ：${elapsed}ms`)

    if (resp.status !== 200) {
      await reportHttpError(resp)
      process.exitCode = 1
      return
    }

    let data
    try {
      data = await resp.json()
    } catch (err) {
      console.error('✗ JSON 解析错误：HTTP 200 但响应体不是合法 JSON')
      console.error(`  信息（脱敏）：${sanitize(err?.message || String(err))}`)
      process.exitCode = 1
      return
    }

    const choice = data?.choices?.[0]
    const finishReason = choice?.finish_reason ?? '-'
    console.log(`finish_reason：${finishReason}`)
    if (data?.usage) printUsage(data.usage)

    const toolCalls = choice?.message?.tool_calls || []
    if (!toolCalls.length) {
      const content = choice?.message?.content ?? ''
      console.error('✗ 模型未发起工具调用（HTTP 200，无 tool_calls）')
      console.error(`  文本回复（脱敏，≤120 字符）：${sanitize(brief(content, 120)) || '（空）'}`)
      process.exitCode = 1
      return
    }

    console.log(`tool_calls：${toolCalls.length} 个`)
    let pass = true
    for (const tc of toolCalls) {
      console.log(`  ─ 调用 ${tc?.id || '（无 id）'}`)
      const ok = reportToolCall(tc?.function?.name || '', tc?.function?.arguments || '')
      if (!ok) pass = false
    }

    console.log('')
    if (pass) {
      console.log(`✓ Function Calling 验证通过（非流式 · 耗时 ${elapsed}ms · 单次执行 · 未重试）`)
    } else {
      console.error('✗ Function Calling 验证未通过（详见上方诊断）')
      process.exitCode = 1
    }
  } catch (err) {
    reportFetchError(err, startedAt)
    process.exitCode = 1
  } finally {
    clearTimeout(timer)
  }
}

/* ---------- 流式验证：SSE 分帧解析 + tool_calls 分片组装（阶段 1 服务端实现原型） ---------- */
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
  console.log('=== 硅基流动 Function Calling 验证 · 流式（单次 · 真实付费请求 · 无重试）===')
  if (!checkKey()) return
  printConfig(true)

  const body = JSON.stringify({
    model: MODEL,
    stream: true,
    max_tokens: MAX_TOKENS,
    messages: [TEST_MESSAGE],
    tools: TOOLS,
    tool_choice: 'auto',
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    console.log(`开始时间：${new Date(startedAt).toLocaleString('zh-CN')}`)
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body,
      signal: controller.signal,
    })
    console.log(`HTTP 状态码：${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}`)
    console.log(`响应头耗时：${Date.now() - startedAt}ms`)

    if (resp.status !== 200) {
      await reportHttpError(resp)
      process.exitCode = 1
      return
    }
    if (!resp.body) {
      console.error('✗ 响应无 body 流（resp.body 为空）')
      process.exitCode = 1
      return
    }

    const stats = { skipped: 0 }
    let firstEventAt = null
    let firstContentAt = null
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
        if (firstContentAt === null) firstContentAt = now
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
    console.log(`首条文本  ：${firstContentAt !== null ? `${firstContentAt}ms` : '（无 content 增量）'}`)
    console.log(`首个工具分片：${firstToolCallAt !== null ? `${firstToolCallAt}ms` : '（无 tool_calls 增量）'}`)
    console.log(`SSE 数据块：${dataChunks} 个${stats.skipped ? ` · 跳过无法解析的行 ${stats.skipped} 个` : ''}`)
    console.log(`finish_reason：${finishReason}`)
    if (usage) printUsage(usage)
    else console.log('tokens    ：（本流未携带 usage）')

    if (!toolAcc.size) {
      console.error('✗ 模型未发起工具调用（流式中无 tool_calls 增量）')
      console.error(`  文本回复累计（脱敏，≤120 字符）：${sanitize(brief(content, 120)) || '（空）'}`)
      process.exitCode = 1
      return
    }

    console.log(`tool_calls 组装：${toolAcc.size} 个`)
    let pass = true
    for (const [idx, acc] of toolAcc) {
      console.log(`  ─ 调用[${idx}] ${acc.id || '（无 id）'} · 分片 ${acc.fragments} 段 · arguments ${acc.args.length} 字符`)
      const ok = reportToolCall(acc.name, acc.args)
      if (!ok) pass = false
    }

    console.log('')
    if (pass) {
      console.log(`✓ 流式 Function Calling 验证通过（含分片组装 · 总耗时 ${elapsed}ms · 单次执行 · 未重试）`)
    } else {
      console.error('✗ 流式 Function Calling 验证未通过（详见上方诊断）')
      process.exitCode = 1
    }
  } catch (err) {
    reportFetchError(err, startedAt)
    process.exitCode = 1
  } finally {
    clearTimeout(timer)
  }
}

const mode = process.argv[2] || 'once'
if (mode === 'once') {
  await runOnce()
} else if (mode === 'stream') {
  await runStream()
} else {
  console.error(`✗ 未知模式「${mode}」，未发起任何请求`)
  console.error('可用模式：once（缺省，npm run test:llm:tools）/ stream（npm run test:llm:tools:stream）')
  process.exitCode = 1
}
