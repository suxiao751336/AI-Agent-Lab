/* ============================================================
 * Conversation Navigator Agent · 数据聚合与索引派生
 * ------------------------------------------------------------
 * 媒体索引与代码索引均从消息 blocks 派生（单一数据源，
 * 不在组件中重复硬编码），assetId 与 messageId 建立真实映射。
 * ============================================================ */

export { CONVERSATION } from './conversation'
export { TOPICS } from './topics'
export { DEMO_QUERIES } from './search'
export * from './agent'
export * from './sessions'
export * from './segments'
export * from './maintenance'
export * from './maintenanceQueue'

/* 消息块 → 文本（代码块保留围栏，图片 / 图表转占位标记）。
 * 聊天上下文构建与「AI 帮我找」检索快照共用，单一实现 */
export function blockToText(block) {
  if (block?.type === 'text') return block.text ?? ''
  if (block?.type === 'code') return '```' + (block.lang ?? '') + '\n' + (block.code ?? '') + '\n```'
  if (block?.type === 'image') return '[图片]'
  if (block?.type === 'chart') return '[图表]'
  return ''
}

/* 树形目录 → 扁平结构（保留 topicId / parentTopicId / messageIds），
 * 供增量维护 Agent 与检索 Agent 请求携带；服务端原样保留已有 ID 与层级 */
export function flattenTopicTree(topics, parentTopicId = null, out = []) {
  for (const t of topics ?? []) {
    out.push({
      topicId: t.id,
      parentTopicId,
      title: t.title,
      summary: t.desc ?? '',
      messageIds: t.messageIds ?? [],
    })
    if (t.children?.length) flattenTopicTree(t.children, t.id, out)
  }
  return out
}

/* 从消息中派生图片 / 图表索引 */
export function deriveMediaIndex(messages) {
  const index = []
  for (const msg of messages) {
    for (const block of msg.blocks ?? []) {
      if (block.type === 'image' || block.type === 'chart') {
        index.push({
          assetId: block.assetId,
          type: block.type,
          title: block.title,
          variant: block.variant,
          kind: block.kind,
          messageId: msg.id,
          time: msg.time,
        })
      }
    }
  }
  return index
}

/* 从消息中派生代码片段索引 */
export function deriveCodeIndex(messages) {
  const index = []
  for (const msg of messages) {
    for (const block of msg.blocks ?? []) {
      if (block.type === 'code') {
        index.push({
          assetId: block.assetId,
          title: block.title,
          language: block.language,
          messageId: msg.id,
          time: msg.time,
        })
      }
    }
  }
  return index
}

/* 顶层话题 + 子话题的总数统计 */
export function countTopics(topics) {
  return topics.reduce((n, t) => n + 1 + (t.children?.length ?? 0), 0)
}
