/* ============================================================
 * Conversation Navigator · 「AI 帮我找」智能回溯前端服务（SSE）
 * ------------------------------------------------------------
 * POST /api/navigator/search（EventStream）：
 *   请求体：{ conversationId, query, messages:[{id,role,text}], topics }
 *   事件流：stage（understanding / tool，真实 Agent 执行事件）
 *          → done { found, note, results, stats } | error { code, message }
 * - buildSearchPayload：点击查找时从当前会话构建数据快照，
 *   查询期间服务端只用该快照，切换会话不会串台
 * - onStage 透传真实阶段事件（驱动右栏检索过程 / 技术日志）
 * - 外部 signal 取消（停止按钮）；170s 兜底超时覆盖后端
 *   Agent Loop 总上限 150s；单次请求、无自动重试
 * ============================================================ */

import { blockToText, flattenTopicTree } from '../data/navigator'

const ENDPOINT = '/api/navigator/search'
const TIMEOUT_MS = 170_000

/* 会话 → 检索快照（点击查找时构建，保证查询期间数据一致） */
export function buildSearchPayload(conversation) {
  const messages = (conversation?.messages ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    text: (m.blocks ?? []).map(blockToText).join('\n').trim().slice(0, 1500),
  }))
  return {
    conversationId: conversation?.id ?? '',
    messages,
    topics: flattenTopicTree(conversation?.topics ?? []),
  }
}

/**
 * @param {{conversationId:string, query:string, messages:Array, topics:Array}} payload
 * @param {{onStage?:(ev:{stage:string, requestId?:string, name?:string, detail?:string,
 *   params?:Object, turn?:number, elapsedMs?:number, model?:string,
 *   messageCount?:number, topicCount?:number}) => void, signal?:AbortSignal}} [hooks]
 * @returns {Promise<{found:boolean, note:string|null, results:Array, stats:Object}>}
 * @throws {Error} message 为面向用户的错误描述，e.code 为细分错误码
 */
export async function streamSearch(payload, { onStage, signal } = {}) {
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
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    /* 流开始前的 JSON 错误响应（400 / 405 / 500） */
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
      const err = new Error(errorEvent.message || '检索失败')
      err.code = errorEvent.code || 'UPSTREAM_ERROR'
      err.phase = errorEvent.phase
      throw err
    }
    if (!doneEvent) {
      if (controller.signal.aborted) {
        const err = new Error(timedOut ? `检索超时（${TIMEOUT_MS / 1000}s），已终止` : '已停止检索')
        err.code = timedOut ? 'TIMEOUT' : 'CANCELLED'
        throw err
      }
      throw new Error('连接中断：未收到检索结果')
    }
    return {
      found: doneEvent.found === true,
      note: doneEvent.note ?? null,
      results: doneEvent.results ?? [],
      stats: doneEvent.stats ?? {},
    }
  } catch (e) {
    if (e?.name === 'AbortError' || controller.signal.aborted) {
      const err = new Error(
        signal?.aborted ? '已停止检索' : timedOut ? `检索超时（${TIMEOUT_MS / 1000}s），已终止` : '检索连接已中止',
      )
      err.code = signal?.aborted ? 'CANCELLED' : timedOut ? 'TIMEOUT' : 'NETWORK'
      throw err
    }
    if (e?.code) throw e
    const err = new Error('网络错误，请稍后重试')
    err.code = 'NETWORK'
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
