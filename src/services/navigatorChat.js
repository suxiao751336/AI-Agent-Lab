/* ============================================================
 * Conversation Navigator · 中间普通聊天前端服务（SSE 流式）
 * ------------------------------------------------------------
 * POST /api/navigator/chat（EventStream）
 *  · delta 事件 → onDelta(text) 逐分片回调（实时逐字显示）
 *  · done  事件 → resolve（回复完成，正式定型）
 *  · error 事件 → throw（细分错误类型，绝不伪造 AI 回复）
 * 外部 AbortSignal 用于用户「停止生成」（异常卡死的唯一中止途径）。
 * 不设超时中断：流式回复期间数据持续到达，绝对超时会误杀正常生成。
 * 单次请求，无自动重试。
 * ============================================================ */

const ENDPOINT = '/api/navigator/chat'

export async function streamChatReply({ messages }, { onDelta, onReasoning, signal } = {}) {
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)
  if (signal?.aborted) controller.abort()

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => null)
      const err = new Error(data?.message || `请求失败（HTTP ${resp.status}）`)
      err.code = data?.code || 'NETWORK'
      throw err
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
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
        if (ev.type === 'reasoning' && typeof ev.text === 'string') {
          /* 思考流分片：实时透传（浅色「思考中」展示，正文出现后隐藏） */
          onReasoning?.(ev.text)
        } else if (ev.type === 'delta' && typeof ev.text === 'string') {
          onDelta?.(ev.text)
        } else if (ev.type === 'done') {
          return {
            usage: ev.usage ?? null,
            finishReason: ev.finishReason ?? null,
            model: ev.model ?? null,
          }
        } else if (ev.type === 'error') {
          const err = new Error(ev.message || 'AI 回复失败')
          err.code = ev.code || 'UPSTREAM_ERROR'
          throw err
        }
      }
    }
    /* 流意外结束且未收到 done 帧 */
    const err = new Error('连接中断，回复未完成')
    err.code = 'NETWORK'
    throw err
  } catch (e) {
    if (signal?.aborted) {
      const err = new Error('已停止生成')
      err.code = 'CANCELLED'
      throw err
    }
    if (e?.code) throw e
    const err = new Error('网络错误，请稍后重试')
    err.code = 'NETWORK'
    throw err
  } finally {
    signal?.removeEventListener('abort', onExternalAbort)
  }
}
