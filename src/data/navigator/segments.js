/* ============================================================
 * Conversation Navigator Agent · 话题讨论片段派生
 * ------------------------------------------------------------
 * 纯本地推导（不调用大模型）：复用话题已有 messageIds 关联数据，
 * 按「问答轮次」把同一话题关联的多轮讨论切分为可独立定位的片段：
 *   - 一轮 = 一条用户消息 + 其后的 AI 回复（按会话时间序）
 *   - 同一轮内的消息合并为一个片段（一个定位入口，不逐条拆分）
 *   - 话题中途被打断后再次出现时，新一轮独立成段（独立定位入口）
 * 片段 ≠ AI 子话题：仅作为「关联问答」定位入口，不改变目录结构，
 * 不为每轮问答生成新子话题。
 * ============================================================ */

/* 消息所属轮次：其之前（含自身）出现的用户消息总数。
 * 每轮以用户消息开头，其后的 AI 回复同属该轮 */
export function roundOfMessage(messages, messageId) {
  let round = 0
  for (const m of messages) {
    if (m.role === 'user') round += 1
    if (m.id === messageId) return round
  }
  return null
}

/* 片段预览文本：优先取该片段内的用户消息（通常为轮次开头），
 * 无用户消息时退回首条消息；仅取文本块并压缩空白 */
function textPreview(messages, max = 22) {
  const text = (messages[0]?.blocks ?? [])
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? (text.length > max ? `${text.slice(0, max)}…` : text) : ''
}

/**
 * 话题 → 讨论片段列表
 * @param {{messageIds?: string[]}} topic 话题节点（含关联消息 ID）
 * @param {Array<{id:string,role:string,blocks?:Array}>} messages 会话消息（会话时间序）
 * @returns {Array<{round:number, messageIds:string[], firstMessageId:string,
 *   preview:string, key:string}>} 片段列表（按轮次升序）
 */
export function deriveTopicSegments(topic, messages) {
  const order = new Map(messages.map((m, i) => [m.id, i]))
  const byId = new Map(messages.map((m) => [m.id, m]))
  /* 只取真实存在于会话中的关联消息，按会话时间序排列 */
  const ids = (topic.messageIds ?? []).filter((id) => order.has(id))
  ids.sort((a, b) => order.get(a) - order.get(b))

  /* 按轮次分组：同一轮的消息合并为一段；轮次切换即新段 */
  const segments = []
  let cur = null
  for (const id of ids) {
    const round = roundOfMessage(messages, id)
    if (!cur || cur.round !== round) {
      cur = { round, messageIds: [] }
      segments.push(cur)
    }
    cur.messageIds.push(id)
  }

  for (const seg of segments) {
    /* 定位入口：片段内会话时间序最早的消息（通常为该轮用户消息） */
    seg.firstMessageId = seg.messageIds[0]
    const segMessages = seg.messageIds.map((id) => byId.get(id))
    const firstUser = segMessages.find((m) => m.role === 'user')
    seg.preview = textPreview(firstUser ? [firstUser] : segMessages)
    seg.key = `${topic.id ?? 'topic'}-r${seg.round}-${seg.firstMessageId}`
  }
  return segments
}
