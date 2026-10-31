/* 硅基流动 API 分级诊断脚本（独立 · 每次仅执行一项 · 单次请求 · 无自动重试）
 * 用法：
 *   npm run test:llm        基础连通性（max_tokens=32 · 无 response_format · 超时 30s）
 *   npm run test:llm:json   测试 A：JSON 结构化输出（response_format=json_object · max_tokens=256 · 超时 60s）
 *   npm run test:llm:code   测试 B：极简计数器应用代码 JSON（response_format=json_object · max_tokens=2048 · 超时 60s）
 *   直接调用：node scripts/test-llm.mjs [ping|json|code]（缺省 ping，未知参数直接报错、不发起请求）
 * 安全：仅从 .env 读取配置，不打印 API Key / Authorization 头 / 完整生成代码，错误信息经脱敏
 * 边界：不调用 Agent 业务逻辑，不触碰 Visual Coding Agent / Sales Agent / 后端生成逻辑
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const FALLBACK_MODEL = 'moonshotai/Kimi-K2.7-Code'

/* ---------- 测试模式（每项单独执行，单次请求，无重试） ---------- */
const MODES = {
  ping: {
    title: '基础连通性测试',
    timeoutMs: 30000,
    maxTokens: 32,
    jsonMode: false,
    messages: [{ role: 'user', content: '你好，请只回复 OK' }],
  },
  json: {
    title: '测试 A · JSON 结构化输出',
    timeoutMs: 60000,
    maxTokens: 256,
    jsonMode: true,
    messages: [
      {
        role: 'user',
        content: '请返回一个 JSON 对象：{"reply":"OK","lang":"zh"}。只返回该 JSON 对象，不要输出任何其他内容。',
      },
    ],
  },
  code: {
    title: '测试 B · 极简计数器应用代码生成',
    timeoutMs: 60000,
    maxTokens: 2048,
    jsonMode: true,
    messages: [
      {
        role: 'user',
        content:
          '请返回一个 JSON 对象，格式为 {"index.html":"...","style.css":"...","app.js":"..."}，三个字段分别是一个极简移动端计数器应用（含计数显示、+1 按钮、重置按钮）的完整 HTML / CSS / JS 代码。只返回该 JSON 对象，不要输出任何其他内容。',
      },
    ],
  },
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

function printUsage() {
  console.error('可用模式（每次仅执行一项，脚本不会自动连续发起请求）：')
  console.error('  ping（缺省）  npm run test:llm        基础连通性 · max_tokens=32 · 无 response_format · 超时 30s')
  console.error('  json          npm run test:llm:json   测试 A · response_format=json_object · max_tokens=256 · 超时 60s')
  console.error('  code          npm run test:llm:code   测试 B · 计数器应用 JSON · max_tokens=2048 · 超时 60s')
}

/* ---------- JSON 解析诊断（测试 A/B）：合法性与结构，不打印完整生成代码 ---------- */
function reportJsonDiagnosis(modeKey, content, finishReason) {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    console.error('✗ JSON 解析失败（HTTP 200，content 非合法 JSON）')
    console.error(`  解析错误（脱敏）：${sanitize(err?.message || String(err))}`)
    console.error(`  content 长度：${content.length} 字符 · 前 120 字符（脱敏）：${sanitize(content.slice(0, 120))}`)
    if (finishReason === 'length') {
      console.error('  finish_reason=length：输出被 max_tokens 截断，JSON 不完整')
    }
    return false
  }

  console.log('JSON 解析结果：成功（合法 JSON）')
  if (finishReason === 'length') {
    console.error('⚠ finish_reason=length：输出被 max_tokens 截断（结构虽完整但内容可能不完整）')
  }

  if (modeKey === 'json') {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed)
      console.log(`  解析后字段：${keys.join(', ') || '（空对象）'}`)
      console.log(`  内容预览（≤120 字符）：${JSON.stringify(content).slice(0, 120)}`)
    } else {
      console.log(
        `  注意：解析结果非对象（类型 ${Array.isArray(parsed) ? 'array' : typeof parsed}）：${JSON.stringify(parsed).slice(0, 60)}`,
      )
    }
  } else {
    const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    for (const field of ['index.html', 'style.css', 'app.js']) {
      const v = typeof obj[field] === 'string' ? obj[field] : ''
      console.log(`  ${field}：${v ? `${v.length} 字符` : '缺失或非字符串'}`)
    }
  }
  return true
}

async function main(modeKey) {
  const mode = MODES[modeKey]
  console.log(`=== 硅基流动 API ${mode.title}（单次 · 真实付费请求 · 无重试）===`)
  console.log(`目标    ：${API_URL}`)
  console.log(`模型    ：${MODEL}`)
  if (!API_KEY) {
    console.error('✗ 失败：未配置 SILICONFLOW_API_KEY（请在项目根目录 .env 填入；Key 不会被打印）')
    process.exitCode = 1
    return
  }
  console.log(`API Key：已配置（长度 ${API_KEY.length}，内容不打印）`)
  console.log(
    `参数    ：stream=false · max_tokens=${mode.maxTokens}${mode.jsonMode ? ' · response_format=json_object' : ''} · 超时 ${mode.timeoutMs / 1000}s`,
  )
  console.log('')

  const body = JSON.stringify({
    model: MODEL,
    stream: false,
    max_tokens: mode.maxTokens,
    messages: mode.messages,
    ...(mode.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), mode.timeoutMs)
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

    const content = data?.choices?.[0]?.message?.content ?? ''
    const finishReason = data?.choices?.[0]?.finish_reason ?? '-'
    const usage = data?.usage
    console.log(`finish_reason：${finishReason}`)
    if (usage) {
      console.log(
        `tokens    ：prompt ${usage.prompt_tokens ?? '-'} · completion ${usage.completion_tokens ?? '-'} · total ${usage.total_tokens ?? '-'}`,
      )
    }

    if (modeKey === 'ping') {
      console.log(`模型回复  ：${JSON.stringify(content)}`)
      console.log('')
      console.log(`✓ ${mode.title}成功（耗时 ${elapsed}ms · 单次执行 · 未重试）`)
    } else {
      const ok = reportJsonDiagnosis(modeKey, content, finishReason)
      console.log('')
      if (ok) {
        console.log(`✓ ${mode.title}成功（耗时 ${elapsed}ms · 单次执行 · 未重试）`)
      } else {
        process.exitCode = 1
      }
    }
  } catch (err) {
    const elapsed = Date.now() - startedAt
    const info = classifyFetchError(err)
    const causeText = describeCause(err?.cause) || err?.message || String(err)
    console.error(`✗ 请求失败 · 错误类型：${info.kind} · 已耗时 ${elapsed}ms`)
    console.error(`  Node 底层错误 code：${info.code}`)
    console.error(`  cause（脱敏）：${sanitize(causeText)}`)
    process.exitCode = 1
  } finally {
    clearTimeout(timer)
  }
}

const modeKey = process.argv[2] || 'ping'
if (modeKey in MODES) {
  await main(modeKey)
} else {
  console.error(`✗ 未知模式「${modeKey}」，未发起任何请求`)
  printUsage()
  process.exitCode = 1
}
