/* Agent Loop 集成测试（阶段 1 验收 · 通过本地 dev server 接口 · 单次执行 · 无重试）
 *
 * 用法（两步，缺一不可）：
 *   1. 终端 A 启动本地服务：npm run dev
 *   2. 终端 B 执行本测试：  npm run test:agent
 *   直接调用：node scripts/test-agent-loop.mjs [baseUrl]（缺省 http://localhost:5173）
 *
 * 测试内容：
 *   · POST /api/llm/agent 创建极简移动端计数器（需求文案引导模型分轮执行）
 *   · 先建立 SSE 连接（GET /api/llm/events），按 requestId 过滤事件，验证
 *     agent_start / turn_start / tool_call / file_update / turn_end / agent_end 链路
 *   · 验证多轮 Function Calling 循环：create_file 调用、工具结果回传
 *     （第 2 轮及以后的成功请求隐含 tool_call_id 对应正确——若 assistant 的
 *      tool_calls 与 tool 消息不匹配，上游会在下一轮直接返回 400）、finish 结束
 *   · 校验响应 files：三文件非空 + index.html 引用 style.css / app.js
 *   · 记录轮次、每轮工具调用、累计 Token、耗时、成功/失败原因
 *
 * 安全：
 *   · 本脚本不接触 API Key（Key 仅存服务端 .env，脚本不读取任何环境变量文件）
 *   · 不在终端打印完整生成代码（file_update 仅打印 path/size，最终文件仅打印大小）
 *   · 失败时不修改任何项目文件（纯 HTTP 验证，无磁盘写入）
 */

import { randomUUID } from 'node:crypto'

const DEFAULT_BASE_URL = 'http://localhost:5173'
const TOTAL_TIMEOUT_MS = 330_000 /* 服务端总时限 300s + 30s 缓冲，脚本侧兜底 */
const AGENT_END_WAIT_MS = 5_000 /* POST 返回后等待 SSE agent_end 事件到达 */

/* 需求文案：明确要求分轮执行，引导真实的多轮工具调用（而非单轮并行完成） */
const REQUIREMENT = `创建一个极简移动端计数器页面：屏幕中央显示数字 0，下方有「加一」和「清零」两个按钮；点击加一数字加 1，点击清零数字回到 0；页面垂直水平居中，适配 390px 视口。
执行方式（严格遵守）：先创建 index.html 并等待工具结果，再创建 style.css 并等待工具结果，再创建 app.js 并等待工具结果，最后调用 finish 提交总结。不要在同一轮里并行创建多个文件。`

/* ---------- 通用工具 ---------- */

function brief(text, n = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

async function waitFor(predicate, timeoutMs) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 100))
  }
  return true
}

/* ---------- SSE 客户端：按 requestId 过滤，实时打印关键事件 ---------- */

async function connectSse(baseUrl, requestId, onEvent) {
  let resp
  try {
    resp = await fetch(`${baseUrl}/api/llm/events`, { headers: { Accept: 'text/event-stream' } })
  } catch (e) {
    throw new Error(`无法连接 ${baseUrl}/api/llm/events（${e instanceof Error ? e.message : String(e)}）· 请确认已执行 npm run dev`)
  }
  if (!resp.ok || !resp.body) {
    throw new Error(`SSE 连接失败：HTTP ${resp.status}${resp.body ? '' : '（无响应体流）'}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
    ; (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue /* 心跳注释帧与空行跳过 */
            const payload = trimmed.slice(5).trim()
            if (!payload) continue
            try {
              const ev = JSON.parse(payload)
              if (ev && ev.requestId === requestId) onEvent(ev)
            } catch {
              /* 跳过无法解析的行 */
            }
          }
        }
      } catch {
        /* 连接断开：测试主流程有自身超时兜底 */
      }
    })()

  return { close: () => reader.cancel().catch(() => {}) }
}

/* ---------- SSE 事件实时打印（类型化事件全打；日志型只打 WARNING/ERROR） ---------- */

function printEvent(ev) {
  if (ev.type === 'agent_start') {
    console.log(`[SSE] agent_start · model=${ev.model} · maxTurns=${ev.maxTurns} · 总时限=${ev.totalTimeoutMs / 1000}s`)
  } else if (ev.type === 'turn_start') {
    console.log(`[SSE] ── 第 ${ev.turn}/${ev.maxTurns} 轮开始 · 单轮上限 ${Math.round(ev.turnTimeoutMs / 1000)}s`)
  } else if (ev.type === 'tool_call') {
    console.log(`[SSE]    工具[${ev.callIndex}] ${ev.tool} ${ev.ok ? '✓' : '✗'} · ${brief(ev.detail, 120)}`)
  } else if (ev.type === 'file_update') {
    console.log(`[SSE]    文件更新 ${ev.path} · ${ev.size} 字符（内容不打印）`)
  } else if (ev.type === 'turn_end') {
    const u = ev.usage ? ` · 本轮 tokens ${ev.usage.prompt_tokens}/${ev.usage.completion_tokens}` : ' · 本轮无 usage'
    console.log(`[SSE] ── 第 ${ev.turn} 轮结束 · ${ev.toolCalls} 个工具${u} · 累计 ${ev.cumulativeUsage ? `${ev.cumulativeUsage.prompt_tokens}/${ev.cumulativeUsage.completion_tokens}` : '-'}`)
  } else if (ev.type === 'agent_end') {
    console.log(`[SSE] agent_end · ok=${ev.ok}${ev.code ? ` · code=${ev.code}` : ''} · turns=${ev.turns} · elapsed=${ev.elapsedMs}ms${ev.filesCommitted ? ' · 已提交文件' : ''}`)
  } else if (ev.level === 'ERROR' || ev.level === 'WARNING') {
    console.log(`[SSE] [${ev.level}] ${ev.stage} · ${brief(ev.text, 120)}`)
  }
}

/* ---------- 主流程 ---------- */

async function main() {
  console.log('=== Agent Loop 集成测试 · 本地接口（单次 · 真实付费请求 · 无重试）===')
  console.log(`目标    ：${baseUrl}/api/llm/agent`)
  console.log(`事件流  ：${baseUrl}/api/llm/events`)
  console.log(`需求    ：极简移动端计数器（需求文案引导模型分轮创建文件）`)
  console.log(`超时    ：${TOTAL_TIMEOUT_MS / 1000}s（服务端总时限 300s + 30s 缓冲）`)
  console.log('')

  const requestId = randomUUID()
  const events = []
  console.log(`开始时间 ：${new Date().toLocaleString('zh-CN')}`)
  console.log(`requestId：${requestId}`)

  /* 1. 先建立 SSE 连接（确保后续事件不依赖回放缓冲） */
  let sse
  try {
    sse = await connectSse(baseUrl, requestId, (ev) => {
      events.push(ev)
      printEvent(ev)
    })
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
    return
  }
  console.log('[SSE] 已连接 /api/llm/events，等待 Agent 事件\n')

  /* 2. 发起一次 Agent 任务（不重试；脚本侧超时会断开连接，服务端将自动取消上游请求） */
  const startedAt = Date.now()
  let resp = null
  let data = null
  let fetchError = null
  try {
    resp = await fetch(`${baseUrl}/api/llm/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement: REQUIREMENT, requestId }),
      signal: AbortSignal.timeout(TOTAL_TIMEOUT_MS),
    })
    data = await resp.json().catch(() => null)
  } catch (e) {
    fetchError = e
  }
  const httpElapsed = Date.now() - startedAt

  /* 3. 等待 SSE 侧 agent_end 到齐（服务端在返回 HTTP 前发出，正常几乎同时到达） */
  const gotEnd = await waitFor(() => events.some((ev) => ev.type === 'agent_end'), AGENT_END_WAIT_MS)
  sse.close()

  /* ---------- 汇总统计 ---------- */
  const turnStarts = events.filter((ev) => ev.type === 'turn_start')
  const turnEnds = events.filter((ev) => ev.type === 'turn_end')
  const toolCalls = events.filter((ev) => ev.type === 'tool_call')
  const fileUpdates = events.filter((ev) => ev.type === 'file_update')
  const agentEnd = events.find((ev) => ev.type === 'agent_end') || null
  const createOk = toolCalls.filter((ev) => ev.tool === 'create_file' && ev.ok).length
  const updateOk = toolCalls.filter((ev) => ev.tool === 'update_file' && ev.ok).length
  const finishCall = toolCalls.find((ev) => ev.tool === 'finish') || null
  const fileToolOk = createOk + updateOk

  const byTurn = new Map()
  for (const tc of toolCalls) {
    if (!byTurn.has(tc.turn)) byTurn.set(tc.turn, [])
    byTurn.get(tc.turn).push(`${tc.tool}${tc.ok ? '✓' : '✗'}`)
  }

  console.log('\n── 每轮工具调用明细（SSE 事件汇总）──')
  if (!byTurn.size) {
    console.log('  （未收到任何 tool_call 事件）')
  }
  for (const [turn, list] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  第 ${turn} 轮：${list.join(' · ')}`)
  }

  console.log('\n── 验收结果 ──')
  const failed = []
  const warns = []

  /* ---- HTTP 层 ---- */
  if (fetchError) {
    const name = fetchError?.name || ''
    console.error(`✗ Agent 任务请求失败 · ${name === 'TimeoutError' || name === 'AbortError' ? '脚本侧总超时（连接已断开，服务端应已取消上游）' : `网络错误：${fetchError instanceof Error ? fetchError.message : String(fetchError)}`}`)
    console.error(`  已耗时 ${httpElapsed}ms · 收到 SSE 事件 ${events.length} 个${agentEnd ? '（含 agent_end）' : '（无 agent_end）'}`)
    process.exitCode = 1
    return
  }

  const httpStatus = resp?.status ?? 0
  console.log(`HTTP 响应：${httpStatus} · 耗时 ${httpElapsed}ms`)

  if (!data?.ok) {
    console.error(`✗ Agent 任务失败：HTTP ${httpStatus} · code=${data?.code || '（无）'} · ${brief(data?.message, 160) || '（无错误信息）'}`)
    console.error(`  轮次 ${data?.turns ?? '-'} · tokens ${fmtUsage(data?.usage)} · 服务端耗时 ${data?.elapsedMs ?? '-'}ms`)
    if (!gotEnd) console.error('  ⚠ SSE 侧未收到 agent_end 事件（事件链可能在失败路径上不完整）')
    else console.log('  SSE 侧 agent_end 事件：已收到（失败路径事件链完整）')
    process.exitCode = 1
    return
  }

  const turns = data.turns ?? 0
  const usageText = fmtUsage(data.usage)
  console.log(`✓ Agent 任务成功 · 轮次 ${turns} · tokens ${usageText} · 总耗时 ${data.elapsedMs}ms`)
  if (data.summary) console.log(`  summary：${brief(data.summary, 120)}`)
  if (!data.usage) warns.push('响应未携带累计 Token（上游流式未返回 usage，用量统计缺失）')

  /* ---- 文件完整性 ---- */
  const files = data.files || {}
  const sizes = {}
  let filesOk = true
  for (const name of ['index.html', 'style.css', 'app.js']) {
    const content = files[name]
    if (typeof content !== 'string' || !content.trim()) {
      console.error(`✗ 文件校验：${name} 缺失或为空`)
      filesOk = false
    } else {
      sizes[name] = content.length
    }
  }
  if (filesOk) {
    console.log(`✓ 文件完整性：index.html ${sizes['index.html']}B · style.css ${sizes['style.css']}B · app.js ${sizes['app.js']}B（均非空，内容不打印）`)
  } else {
    failed.push('文件完整性校验未通过')
  }

  const html = typeof files['index.html'] === 'string' ? files['index.html'] : ''
  const cssLinked = /<link[^>]+href=["']style\.css["']/i.test(html)
  const jsLinked = /<script[^>]+src=["']app\.js["']/i.test(html)
  if (cssLinked) console.log('✓ index.html 引用 style.css：<link href="style.css"> 已检测到')
  else {
    console.error('✗ index.html 未通过 <link href="style.css"> 引用样式表')
    failed.push('HTML 未引用 style.css')
  }
  if (jsLinked) console.log('✓ index.html 引用 app.js：<script src="app.js"> 已检测到')
  else {
    console.error('✗ index.html 未通过 <script src="app.js"> 引入脚本')
    failed.push('HTML 未引用 app.js')
  }

  /* ---- 工具调用链路 ---- */
  if (createOk > 0) {
    console.log(`✓ create_file 调用：${createOk} 次（成功）${updateOk ? ` · update_file ${updateOk} 次（成功）` : ''}`)
  } else {
    console.error(`✗ create_file 调用：0 次（本次任务未出现成功的 create_file）`)
    failed.push('未验证到 create_file')
  }

  if (finishCall && finishCall.ok) {
    console.log('✓ finish 工具调用：已调用且成功（Agent 通过 finish 正常收尾）')
  } else if (finishCall && !finishCall.ok) {
    console.error('✗ finish 工具调用：已调用但执行失败')
    failed.push('finish 工具执行失败')
  } else {
    warns.push('模型未调用 finish（走「无工具调用正常结束」路径收尾），finish 工具链路未验证')
  }

  /* ---- 轮次一致性（HTTP 响应 vs SSE 事件） ---- */
  const tsCount = turnStarts.length
  const teCount = turnEnds.length
  if (turns === tsCount && turns === teCount && tsCount > 0) {
    console.log(`✓ 事件轮次一致性：HTTP turns=${turns} · SSE turn_start=${tsCount} · turn_end=${teCount}`)
  } else {
    console.error(`✗ 事件轮次不一致：HTTP turns=${turns} · SSE turn_start=${tsCount} · turn_end=${teCount}`)
    failed.push('轮次事件不一致')
  }

  /* ---- 多轮循环（tool 结果回传链路） ---- */
  if (turns >= 2) {
    console.log(`✓ 多轮循环验证：共 ${turns} 轮（≥2）· 第 2 轮起的成功请求隐含 assistant.tool_calls 与 tool 消息的 tool_call_id 对应正确（不匹配会被上游 400 拒绝）、工具执行结果已回传模型`)
  } else {
    warns.push(`单轮（${turns} 轮）内完成全部工具调用：tool 结果回传与 tool_call_id 对应链路未经下一轮请求检验（模型行为，非服务端缺陷；可重跑测试观察）`)
  }

  /* ---- file_update 一致性 ---- */
  if (fileToolOk === fileUpdates.length && fileUpdates.length > 0) {
    console.log(`✓ file_update 一致性：${fileToolOk} 次成功文件工具 → ${fileUpdates.length} 次 file_update 事件`)
  } else {
    console.error(`✗ file_update 不一致：成功文件工具 ${fileToolOk} 次 · file_update 事件 ${fileUpdates.length} 次`)
    failed.push('file_update 事件与工具执行不一致')
  }

  /* ---- agent_end 事件 ---- */
  if (gotEnd && agentEnd?.ok === true) {
    console.log('✓ SSE agent_end 事件：已收到且 ok=true（终态事件链完整）')
  } else {
    console.error(`✗ SSE agent_end 事件：${gotEnd ? `ok=${agentEnd?.ok}` : '未收到（POST 返回后 5s 内）'}`)
    failed.push('agent_end 事件缺失或异常')
  }

  /* ---- 汇总 ---- */
  for (const w of warns) console.warn(`⚠ ${w}`)
  console.log('')
  if (failed.length) {
    console.error(`✗ 集成测试未通过（${failed.length} 项失败：${failed.join('；')}）· 单次执行 · 未重试 · 未修改任何项目文件`)
    process.exitCode = 1
  } else {
    console.log(`✓ Agent Loop 集成测试通过 · 单次执行 · 未重试 · 未修改任何项目文件${warns.length ? `（${warns.length} 项警告）` : ''}`)
  }
}

function fmtUsage(usage) {
  if (!usage) return '（无）'
  return `prompt=${usage.prompt_tokens ?? '?'} completion=${usage.completion_tokens ?? '?'} total=${usage.total_tokens ?? '?'}`
}

/* ---------- 参数解析与入口 ---------- */

const baseUrl = (process.argv[2] || DEFAULT_BASE_URL).replace(/\/+$/, '')
if (process.argv.length > 3) {
  console.error(`✗ 参数过多（仅允许一个可选 baseUrl，例如 node scripts/test-agent-loop.mjs http://localhost:5173）`)
  process.exit(1)
}

await main()
