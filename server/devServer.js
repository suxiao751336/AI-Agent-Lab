/* ============================================================
 * Vite dev server API 中间件（本地开发用）
 *
 * 路由：
 *  · POST /api/llm/generate —— 调用 Kimi K2.7 Code（核心逻辑 server/llmApi.js，保留不动）
 *  · POST /api/llm/agent    —— Visual Coding Agent（流式 FC + 工具调用，核心逻辑 server/agentLoop.js）
 *  · GET  /api/llm/events   —— SSE 实时日志流（服务端执行事件推送到网页调试控制台）
 *
 * SSE 机制：
 *  · 每个执行事件（RECEIVED/CONFIG/UPSTREAM_REQ/...）即时广播到所有连接
 *  · 新连接建立时回放最近 300 条缓冲（防止连接建立晚于事件而丢失）
 *  · 15s 心跳注释帧防止代理层断开空闲连接
 *  · 事件通过 requestId 与前端日志关联；前端按当前 requestId 过滤
 *
 * 安全：
 *  · API Key 仅在 Node 侧读取（process.env），不进入任何响应 / 事件 / 日志
 *  · 事件内容由 server/llmApi.js 的 sanitize() 脱敏（抹除可能出现的 Key 值）
 *  · 仅 POST + JSON，请求体上限 2MB
 * ============================================================ */

import { handleLLMGenerate, loadEnvFile } from './llmApi.js'
import { handleAgentRun } from './agentLoop.js'
import { runTopicGeneration } from './navigator.js'
import { runChatCompletion } from './navigatorChat.js'
import { runIncrementalMaintenance } from './navigatorIncremental.js'
import { runSearchAgent } from './navigatorSearch.js'

const MAX_BODY_SIZE = 2 * 1024 * 1024
const EVENT_BUFFER_LIMIT = 300
const SSE_HEARTBEAT_MS = 15_000

/* SSE 客户端连接 + 事件缓冲（模块级，dev server 生命周期内有效） */
const sseClients = new Set()
const eventBuffer = []

function broadcastEvent(event) {
  eventBuffer.push(event)
  if (eventBuffer.length > EVENT_BUFFER_LIMIT) eventBuffer.shift()
  const frame = `data: ${JSON.stringify(event)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(frame)
    } catch {
      sseClients.delete(res)
    }
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_SIZE) {
        reject(new Error('PAYLOAD_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

export function apiDevServer() {
  return {
    name: 'ai-agent-lab:llm-api',
    configureServer(server) {
      /* dev server 启动时加载 .env（生产/Serverless 由部署平台注入环境变量） */
      loadEnvFile(server.config.root)

      /* ── SSE：实时执行事件流 ── */
      server.middlewares.use('/api/llm/events', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.flushHeaders?.()
        /* 回放缓冲（前端按 requestId 过滤历史请求事件） */
        for (const ev of eventBuffer) {
          try {
            res.write(`data: ${JSON.stringify(ev)}\n\n`)
          } catch {
            break
          }
        }
        sseClients.add(res)
        const heartbeat = setInterval(() => {
          try {
            res.write(': ping\n\n')
          } catch {
            /* 连接已断开 */
          }
        }, SSE_HEARTBEAT_MS)
        req.on('close', () => {
          clearInterval(heartbeat)
          sseClients.delete(res)
        })
      })

      /* ── Agent 接口：流式 Function Calling + 工具调用循环（阶段 1） ── */
      server.middlewares.use('/api/llm/agent', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' })
          return
        }
        let payload = null
        try {
          const raw = await readBody(req)
          try {
            payload = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, code: 'BAD_JSON', message: '请求体不是有效 JSON' })
            return
          }
          if (typeof payload?.requirement !== 'string' || !payload.requirement.trim()) {
            sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '缺少开发需求描述（requirement）' })
            return
          }

          /* 用户取消：响应未结束时连接断开 → 中止当前上游请求（res close 在
             响应正常结束后也会触发，必须用 writableEnded 区分“提前断开”） */
          const userAbort = new AbortController()
          res.on('close', () => {
            if (!res.writableEnded) userAbort.abort()
          })

          /* 事件转发：日志型（level/stage/text）与类型化（type）统一广播 + 终端打印 */
          const onEvent = (ev) => {
            broadcastEvent(ev)
            if (ev.type) {
              /* 类型化 Agent 事件：打印摘要（file_update 不打印完整文件内容） */
              let info = ''
              if (ev.type === 'file_update') info = `path=${ev.path} size=${ev.size} turn=${ev.turn}`
              else if (ev.type === 'tool_call') info = `turn=${ev.turn} tool=${ev.tool}${ev.path ? ` path=${ev.path}` : ''} ${ev.ok ? 'ok' : 'ERROR'}`
              else if (ev.type === 'stream_progress') info = `turn=${ev.turn} phase=${ev.phase} tools=${ev.toolCalls} args=${ev.toolArgsChars} chars`
              else if (ev.type === 'image_start') info = `turn=${ev.turn} type=${ev.assetType} name=${ev.name}`
              else if (ev.type === 'image_generated') info = `turn=${ev.turn} path=${ev.path} ${ev.width}x${ev.height} size=${ev.sizeBytes}B model=${ev.model} ${ev.elapsedMs}ms`
              else if (ev.type === 'turn_end') info = `turn=${ev.turn} elapsed=${ev.elapsedMs}ms`
              else if (ev.type === 'turn_start') info = `turn=${ev.turn}/${ev.maxTurns}`
              else if (ev.type === 'agent_end') info = `ok=${ev.ok}${ev.code ? ` code=${ev.code}` : ''} turns=${ev.turns} elapsed=${ev.elapsedMs}ms`
              else if (ev.type === 'agent_start') info = `model=${ev.model} maxTurns=${ev.maxTurns}`
              console.log(`[LLM:${ev.requestId}] AGENT ${ev.type} ${info}`)
            } else {
              const tag = `[LLM:${ev.requestId}] ${ev.level} ${ev.stage}`
              const line = `${tag} ${ev.text}`
              if (ev.level === 'ERROR') console.error(line)
              else if (ev.level === 'WARNING') console.warn(line)
              else console.log(line)
            }
          }

          const result = await handleAgentRun(payload, { onEvent, signal: userAbort.signal })

          /* 客户端可能已断开：写响应失败时静默（结果已通过 SSE 广播） */
          try {
            const status = result.ok ? 200 : result.cancelled ? 499 : 422
            sendJson(res, status, result)
          } catch {
            /* 连接已关闭 */
          }
        } catch (e) {
          /* 兜底：仅未预期异常会到达此处（agentLoop 内部已分类超时/取消/网络/上游错误） */
          const message = e instanceof Error ? e.message : String(e)
          console.error('[LLM:agent] unexpected server error:', message)
          broadcastEvent({
            requestId: String(payload?.requestId || '-').slice(0, 40),
            level: 'ERROR',
            stage: 'SERVER',
            text: `Agent 服务端内部错误（未预期异常）：${message.slice(0, 200)} · 已保留当前版本，可重试`,
            t: Date.now(),
          })
          try {
            sendJson(res, 500, {
              ok: false,
              code: 'SERVER_ERROR',
              message: `服务端内部错误：${message.slice(0, 200)}`,
            })
          } catch {
            /* 连接已关闭 */
          }
        }
      })

      /* ── Conversation Navigator：话题目录生成（SSE 阶段事件流，阶段 1） ──
       * 请求体：{ messages: [{id, role, blocks}] }
       * 响应：text/event-stream，每帧 data: {type:'stage'|'done'|'error', ...}
       *  · stage loaded / analyzing / validating（真实阶段，非模拟进度）
       *  · done  { topics: 目录树, stats: 统计 }
       *  · error { code, message }（细分错误类型，见 server/navigator.js） */
      server.middlewares.use('/api/navigator/generate-topics', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' })
          return
        }
        let payload = null
        try {
          const raw = await readBody(req)
          try {
            payload = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, code: 'BAD_JSON', message: '请求体不是有效 JSON' })
            return
          }
          if (!Array.isArray(payload?.messages) || payload.messages.length === 0) {
            sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '缺少消息列表（messages）' })
            return
          }

          /* 切换为 SSE 响应：阶段事件实时推送（前端据此驱动真实状态） */
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          res.flushHeaders?.()
          const send = (obj) => {
            try {
              res.write(`data: ${JSON.stringify(obj)}\n\n`)
            } catch {
              /* 连接已断开：写入失败静默 */
            }
          }

          /* 用户取消：连接提前断开 → 终止上游请求 */
          const userAbort = new AbortController()
          res.on('close', () => {
            if (!res.writableEnded) userAbort.abort()
          })

          const result = await runTopicGeneration(payload, {
            signal: userAbort.signal,
            onStage: (stage, extra) => send({ type: 'stage', stage, ...extra }),
          })

          if (result.cancelled) {
            send({ type: 'error', code: 'CANCELLED', message: result.message })
          } else if (result.ok) {
            send({ type: 'done', topics: result.topics, stats: result.stats })
          } else {
            send({ type: 'error', code: result.code, message: result.message })
          }
          res.end()
        } catch (e) {
          /* 兜底：仅未预期异常会到达此处（navigator 内部已分类错误） */
          const message = e instanceof Error ? e.message : String(e)
          console.error('[NAV] unexpected server error:', message)
          try {
            if (!res.headersSent) {
              sendJson(res, 500, { ok: false, code: 'SERVER_ERROR', message: `服务端内部错误：${message.slice(0, 200)}` })
            } else {
              res.write(`data: ${JSON.stringify({ type: 'error', code: 'SERVER_ERROR', message: `服务端内部错误：${message.slice(0, 200)}` })}\n\n`)
              res.end()
            }
          } catch {
            /* 连接已关闭 */
          }
        }
      })

      /* ── Conversation Navigator：中间普通聊天（SSE 流式回复，阶段 2） ──
       * 请求体：{ messages: [{role:'user'|'assistant', content}] }
       * 响应：text/event-stream，每帧 data: {type:'delta'|'done'|'error', ...}
       *  · delta { text }    逐分片转发模型输出（SSE 实时逐字显示）
       *  · done  { usage, finishReason, model, elapsedMs }
       *  · error { code, message }（细分错误类型，见 server/navigatorChat.js）
       * 普通聊天无工具 / 无 Function Calling / 无 Agent Loop，单次请求不重试 */
      server.middlewares.use('/api/navigator/chat', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' })
          return
        }
        let payload = null
        try {
          const raw = await readBody(req)
          try {
            payload = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, code: 'BAD_JSON', message: '请求体不是有效 JSON' })
            return
          }
          if (!Array.isArray(payload?.messages) || payload.messages.length === 0) {
            sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '缺少聊天消息（messages）' })
            return
          }

          /* 切换为 SSE 响应：模型分片实时转发到前端 */
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          res.flushHeaders?.()
          const send = (obj) => {
            try {
              res.write(`data: ${JSON.stringify(obj)}\n\n`)
            } catch {
              /* 连接已断开：写入失败静默 */
            }
          }

          /* 用户取消：连接提前断开 → 终止上游请求 */
          const userAbort = new AbortController()
          res.on('close', () => {
            if (!res.writableEnded) userAbort.abort()
          })

          const result = await runChatCompletion(payload, {
            signal: userAbort.signal,
            onDelta: (text) => send({ type: 'delta', text }),
            onReasoning: (text) => send({ type: 'reasoning', text }),
          })

          if (result.ok) {
            send({
              type: 'done',
              usage: result.usage ?? null,
              finishReason: result.finishReason ?? null,
              model: result.model,
              elapsedMs: result.elapsedMs,
            })
          } else {
            send({ type: 'error', code: result.code, message: result.message })
          }
          res.end()
        } catch (e) {
          /* 兜底：仅未预期异常会到达此处（navigatorChat 内部已分类错误） */
          const message = e instanceof Error ? e.message : String(e)
          console.error('[NAVCHAT] unexpected server error:', message)
          try {
            if (!res.headersSent) {
              sendJson(res, 500, { ok: false, code: 'SERVER_ERROR', message: `服务端内部错误：${message.slice(0, 200)}` })
            } else {
              res.write(`data: ${JSON.stringify({ type: 'error', code: 'SERVER_ERROR', message: `服务端内部错误：${message.slice(0, 200)}` })}\n\n`)
              res.end()
            }
          } catch {
            /* 连接已关闭 */
          }
        }
      })

      /* ── Conversation Navigator：增量目录维护 Agent（SSE 阶段事件流） ──
       * 每轮问答完成后自动触发：模型基于 Function Calling 决策
       * create / update / link / no_change，服务端校验后返回新目录树。
       * 请求体：{ conversationId, userMessage, assistantMessage,
       *   directory(扁平), contextMessages, validMessageIds }
       * 响应帧：stage（analyzing / tool）→ done {topics, stats} | error */
      server.middlewares.use('/api/navigator/maintain-topics', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' })
          return
        }
        let payload = null
        try {
          const raw = await readBody(req)
          try {
            payload = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, code: 'BAD_JSON', message: '请求体不是有效 JSON' })
            return
          }
          if (!payload?.userMessage || !payload?.assistantMessage) {
            sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '缺少本轮问答内容' })
            return
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          res.flushHeaders?.()
          const send = (obj) => {
            try {
              res.write(`data: ${JSON.stringify(obj)}\n\n`)
            } catch {
              /* 连接已断开：写入失败静默 */
            }
          }

          const userAbort = new AbortController()
          res.on('close', () => {
            if (!res.writableEnded) userAbort.abort()
          })

          const result = await runIncrementalMaintenance(payload, {
            signal: userAbort.signal,
            onStage: (stage, extra) => send({ type: 'stage', stage, ...extra }),
          })

          if (result.ok) {
            send({ type: 'done', topics: result.topics, stats: result.stats })
          } else {
            send({ type: 'error', code: result.code, message: result.message, phase: result.phase })
          }
          res.end()
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          console.error('[NAVINC] unexpected server error:', message)
          try {
            if (!res.headersSent) {
              sendJson(res, 500, { ok: false, code: 'SERVER_ERROR', message: `服务端内部错误：${message.slice(0, 200)}` })
            } else {
              res.write(`data: ${JSON.stringify({ type: 'error', code: 'SERVER_ERROR', message: `服务端内部错误：${message.slice(0, 200)}` })}\n\n`)
              res.end()
            }
          } catch {
            /* 连接已关闭 */
          }
        }
      })

      /* ── Conversation Navigator：智能回溯 Search Agent（SSE 事件流） ──
       * 「AI 帮我找」：用户输入模糊自然语言描述，Agent 通过
       * Function Calling 自主检索当前会话快照（话题目录 + 原始消息），
       * 返回可点击、可验证的原始消息位置。
       * 请求体：{ conversationId, query, messages:[{id,role,text}], topics(扁平) }
       * 响应帧：stage（understanding / tool）→ done {found, note, results, stats}
       *        | error {code, message, phase}
       * 结果 messageId 均经服务端校验真实存在于当前会话快照 */
      server.middlewares.use('/api/navigator/search', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' })
          return
        }
        let payload = null
        try {
          const raw = await readBody(req)
          try {
            payload = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, code: 'BAD_JSON', message: '请求体不是有效 JSON' })
            return
          }
          if (typeof payload?.conversationId !== 'string' || !payload.conversationId.trim()) {
            sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '缺少会话 ID（conversationId）' })
            return
          }
          if (typeof payload?.query !== 'string' || !payload.query.trim()) {
            sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '缺少查找描述（query）' })
            return
          }
          if (!Array.isArray(payload?.messages) || payload.messages.length === 0) {
            sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '缺少会话消息快照（messages）' })
            return
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          res.flushHeaders?.()
          const send = (obj) => {
            try {
              res.write(`data: ${JSON.stringify(obj)}\n\n`)
            } catch {
              /* 连接已断开：写入失败静默 */
            }
          }

          /* 用户取消：连接提前断开 → 终止上游付费请求 */
          const userAbort = new AbortController()
          res.on('close', () => {
            if (!res.writableEnded) userAbort.abort()
          })

          const result = await runSearchAgent(payload, {
            signal: userAbort.signal,
            onStage: (stage, extra) => send({ type: 'stage', stage, ...extra }),
          })

          if (result.ok) {
            send({
              type: 'done',
              found: result.found,
              note: result.note ?? null,
              results: result.results,
              stats: result.stats,
            })
          } else if (result.cancelled) {
            send({ type: 'error', code: 'CANCELLED', message: '已停止检索' })
          } else {
            send({ type: 'error', code: result.code, message: result.message, phase: result.phase })
          }
          res.end()
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          console.error('[NAVS] unexpected server error:', message)
          try {
            if (!res.headersSent) {
              sendJson(res, 500, { ok: false, code: 'SERVER_ERROR', message: `服务端内部错误：${message.slice(0, 200)}` })
            } else {
              res.write(`data: ${JSON.stringify({ type: 'error', code: 'SERVER_ERROR', message: `服务端内部错误：${message.slice(0, 200)}` })}\n\n`)
              res.end()
            }
          } catch {
            /* 连接已关闭 */
          }
        }
      })

      /* ── 主接口：模型生成 / 修改 ── */
      server.middlewares.use('/api/llm/generate', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST' })
          return
        }
        let payload = null
        try {
          const raw = await readBody(req)
          try {
            payload = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, code: 'BAD_JSON', message: '请求体不是有效 JSON' })
            return
          }

          /* 服务端执行事件：SSE 实时广播 + 终端打印（均脱敏） */
          const onEvent = (ev) => {
            broadcastEvent(ev)
            const tag = `[LLM:${ev.requestId}] ${ev.level} ${ev.stage}`
            const line = `${tag} ${ev.text}`
            if (ev.level === 'ERROR') console.error(line)
            else if (ev.level === 'WARNING') console.warn(line)
            else console.log(line)
          }

          const result = await handleLLMGenerate(payload, { onEvent })
          sendJson(res, result.ok ? 200 : 422, result)
        } catch (e) {
          /* 兜底：仅未预期异常会到达此处（llmApi 内部已分类超时/网络/上游错误） */
          const message = e instanceof Error ? e.message : String(e)
          console.error('[LLM] unexpected server error:', message)
          broadcastEvent({
            requestId: String(payload?.requestId || '-').slice(0, 40),
            level: 'ERROR',
            stage: 'SERVER',
            text: `服务端内部错误（未预期异常）：${message.slice(0, 200)} · 已保留当前版本，可重试`,
            t: Date.now(),
          })
          sendJson(res, 500, {
            ok: false,
            code: 'SERVER_ERROR',
            message: `服务端内部错误：${message.slice(0, 200)}`,
          })
        }
      })
    },
  }
}
