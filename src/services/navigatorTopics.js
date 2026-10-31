/* ============================================================
 * Conversation Navigator · 话题目录生成服务（阶段 1）
 * ------------------------------------------------------------
 * POST /api/navigator/generate-topics（SSE）：
 *   请求体：{ messages: [{id, role, blocks}] }
 *   事件流：stage loaded / analyzing / validating → done | error
 *
 * POST /api/navigator/maintain-topics（SSE，增量目录维护 Agent）：
 *   请求体：{ conversationId, userMessage, assistantMessage,
 *     directory(扁平), contextMessages, validMessageIds }
 *   事件流：stage analyzing / tool → done | error
 *
 * - onStage 回调透传真实阶段事件（驱动左侧 Agent 状态区）
 * - 支持外部 signal 取消（停止按钮）：fetch 中止 → 服务端
 *   res close → 终止上游付费请求
 * - 前端兜底超时 330s（覆盖后端 300s 硬上限 + 30s 余量），单次请求、无重试
 * ============================================================ */

const ENDPOINT = '/api/navigator/generate-topics'
const TIMEOUT_MS = 330_000

const MAINTAIN_ENDPOINT = '/api/navigator/maintain-topics'
const MAINTAIN_TIMEOUT_MS = 100_000 /* 覆盖后端 Agent Loop 总超时 90s */

/**
 * @param {{messages: Array<Object>}} payload
 * @param {{onStage?: (ev: {stage: string, messageCount?: number, promptChars?: number, model?: string, rawTopicCount?: number}) => void,
 *   signal?: AbortSignal}} [hooks]
 * @returns {Promise<{topics: Array<Object>, stats: Object}>}
 * @throws {Error} message 为面向用户的错误描述，e.code 为细分错误码
 */
export async function generateTopics({ messages }, { onStage, signal } = {}) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    })

    /* 流开始前的 JSON 错误响应（400 / 405 / 500） */
    if (!resp.ok) {
      const data = await resp.json().catch(() => null)
      throw new Error(data?.message || `请求失败（HTTP ${resp.status}）`)
    }
    if (!resp.body) throw new Error('响应无内容流')

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let doneEvent = null
    let errorEvent = null

    for (;;) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buf += decoder.decode(value, { stream: true })
      const frames = buf.split('\n\n')
      buf = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        let ev
        try {
          ev = JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
        if (ev.type === 'stage') onStage?.(ev)
        else if (ev.type === 'done') doneEvent = ev
        else if (ev.type === 'error') errorEvent = ev
      }
    }

    if (errorEvent) {
      const err = new Error(errorEvent.message || '目录生成失败')
      err.code = errorEvent.code
      throw err
    }
    if (!doneEvent) {
      if (controller.signal.aborted) {
        throw new Error(timedOut ? `请求超时（${TIMEOUT_MS / 1000}s），已终止` : '请求已取消')
      }
      throw new Error('连接中断：未收到生成结果')
    }
    return { topics: doneEvent.topics ?? [], stats: doneEvent.stats ?? {} }
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(
        signal?.aborted ? '请求已取消，已保留原有目录' : timedOut ? `请求超时（${TIMEOUT_MS / 1000}s），已保留原有目录` : '请求已中止，已保留原有目录',
      )
    }
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * 增量目录维护 Agent：每轮问答完成后自动触发（阶段 3）
 *
 * @param {{conversationId: string, userMessage: {id, text}, assistantMessage: {id, text},
 *   directory: Array<Object>, contextMessages: Array<{id, role, text}>,
 *   validMessageIds: string[]}} payload
 * @param {{onStage?: (ev: {stage: string, name?: string, detail?: string, model?: string}) => void,
 *   signal?: AbortSignal}} [hooks]
 * @returns {Promise<{topics: Array<Object>, stats: Object}>}
 * @throws {Error} message 为面向用户的错误描述，e.code 为细分错误码
 */
export async function maintainTopics(payload, { onStage, signal } = {}) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, MAINTAIN_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)

  try {
    const resp = await fetch(MAINTAIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const data = await resp.json().catch(() => null)
      const err = new Error(data?.message || `请求失败（HTTP ${resp.status}）`)
      err.code = data?.code || 'NETWORK'
      throw err
    }
    if (!resp.body) throw new Error('响应无内容流')

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let doneEvent = null
    let errorEvent = null

    for (;;) {
      const { done: streamDone, value } = await reader.read()
      if (streamDone) break
      buf += decoder.decode(value, { stream: true })
      const frames = buf.split('\n\n')
      buf = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        let ev
        try {
          ev = JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
        if (ev.type === 'stage') onStage?.(ev)
        else if (ev.type === 'done') doneEvent = ev
        else if (ev.type === 'error') errorEvent = ev
      }
    }

    if (errorEvent) {
      const err = new Error(errorEvent.message || '目录维护失败')
      err.code = errorEvent.code
      err.phase = errorEvent.phase /* 失败阶段（model_call / tool_args / validate / decision…） */
      throw err
    }
    if (!doneEvent) {
      if (controller.signal.aborted) {
        throw new Error(timedOut ? `增量维护超时（${MAINTAIN_TIMEOUT_MS / 1000}s）` : '增量维护已停止')
      }
      throw new Error('连接中断：未收到维护结果')
    }
    return { topics: doneEvent.topics ?? [], stats: doneEvent.stats ?? {} }
  } catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error(
        signal?.aborted
          ? '增量维护已停止，已保留原目录'
          : timedOut
            ? `增量维护超时（${MAINTAIN_TIMEOUT_MS / 1000}s），已保留原目录`
            : '增量维护已中止，已保留原目录',
      )
      throw err
    }
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
