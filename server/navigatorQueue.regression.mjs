/* ============================================================
 * Conversation Navigator Agent · 无付费回归测试（片段定位 + 任务队列）
 * ------------------------------------------------------------
 * 覆盖四类场景（全部本地纯逻辑验证，不调用任何付费 API）：
 *   A. 同一话题关联第 1、2、4 轮 → 独立片段入口分别定位到对应轮次
 *   B. 第 1 轮分析较慢、第 2/3 轮已入队 → 严格串行、不丢失、不覆盖
 *   C. 任务失败 → 旧目录保留（失败原因记录）、队列暂停、单独重试后
 *      继续后续任务，不触发全量重生成
 *   D. 刷新（重建队列管理器）→ 未完成任务恢复执行、已完成任务
 *      不持久化不重复处理、重复入队被拒绝
 * 运行：node server/navigatorQueue.regression.mjs
 * ============================================================ */

import { deriveTopicSegments } from '../src/data/navigator/segments.js'
import { createMaintenanceQueueManager } from '../src/data/navigator/maintenanceQueue.js'

let passed = 0
function ok(cond, label) {
  if (!cond) throw new Error(`断言失败：${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, label, timeout = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (fn()) return
    await sleep(10)
  }
  throw new Error(`waitFor 超时：${label}`)
}

/* 构造会话消息（每轮 = 一条用户消息 + 其后的 AI 回复） */
function makeMessages(rounds) {
  const out = []
  for (let i = 1; i <= rounds; i += 1) {
    out.push({
      id: `u${i}`,
      role: 'user',
      blocks: [{ type: 'text', text: `第 ${i} 轮问题：关于功能 ${i} 的讨论` }],
    })
    out.push({
      id: `a${i}`,
      role: 'assistant',
      blocks: [{ type: 'text', text: `第 ${i} 轮回答：围绕功能 ${i} 的分析展开` }],
    })
  }
  return out
}

console.log('\n场景 A：话题讨论片段（同一话题多轮分别定位）')

{
  /* 4 轮消息；话题关联第 1、2、4 轮（第 3 轮属于其他话题） */
  const messages = makeMessages(4)
  const topic = { id: 't1', messageIds: ['u1', 'a1', 'u2', 'a2', 'u4', 'a4'] }
  const segs = deriveTopicSegments(topic, messages)
  ok(segs.length === 3, '关联第 1、2、4 轮 → 派生 3 个片段（第 3 轮不属于本话题）')
  ok(
    segs[0].round === 1 && segs[0].firstMessageId === 'u1' && segs[0].messageIds.join(',') === 'u1,a1',
    '片段 1 定位第 1 轮（轮内 user+assistant 合并为一个入口）',
  )
  ok(
    segs[1].round === 2 && segs[1].firstMessageId === 'u2' && segs[1].messageIds.join(',') === 'u2,a2',
    '片段 2 定位第 2 轮',
  )
  ok(
    segs[2].round === 4 && segs[2].firstMessageId === 'u4' && segs[2].messageIds.join(',') === 'u4,a4',
    '片段 3 定位第 4 轮（话题被打断后再次出现，独立定位入口）',
  )
  ok(
    segs.every((s) => typeof s.preview === 'string' && s.preview.startsWith('第')),
    '片段预览取该轮用户消息文本',
  )
}

{
  /* 关联顺序乱序（模拟模型返回顺序不可信）：派生前必须按会话序排列 */
  const messages = makeMessages(3)
  const topic = { id: 't2', messageIds: ['a2', 'u3', 'a3', 'u1', 'a1', 'u2'] }
  const segs = deriveTopicSegments(topic, messages)
  ok(
    segs.length === 3 &&
      segs.map((s) => s.round).join(',') === '1,2,3' &&
      segs[0].firstMessageId === 'u1',
    '乱序 messageIds 派生前按会话时间序排列',
  )
}

{
  /* 仅关联单轮：不生成片段入口（标题默认跳转即第一次讨论） */
  const messages = makeMessages(3)
  const segs = deriveTopicSegments({ id: 't3', messageIds: ['u2', 'a2'] }, messages)
  ok(segs.length === 1, '单轮关联仅 1 个片段（不显示片段列表）')
  /* 只关联 AI 回复（用户消息未关联）：预览回退到首条消息文本 */
  const segs2 = deriveTopicSegments({ id: 't4', messageIds: ['a3'] }, messages)
  ok(segs2.length === 1 && segs2[0].round === 3 && segs2[0].preview.startsWith('第'), '仅 AI 消息关联时轮次与预览回退正确')
}

{
  /* 一轮内 AI 连续多条消息（流式追加场景）：同轮合并为一段 */
  const messages = [
    ...makeMessages(1),
    { id: 'a1b', role: 'assistant', blocks: [{ type: 'text', text: '补充说明' }] },
  ]
  const segs = deriveTopicSegments({ id: 't5', messageIds: ['u1', 'a1', 'a1b'] }, messages)
  ok(segs.length === 1 && segs[0].messageIds.length === 3, '同一轮内连续消息合并为一个定位入口')
}

console.log('\n场景 B：串行任务队列（慢任务期间新轮次入队）')

{
  const calls = []
  let release1 = null
  const gate1 = new Promise((r) => {
    release1 = r
  })
  let persisted = []
  const m = createMaintenanceQueueManager({
    runTask: async (task) => {
      calls.push(task.userMessageId)
      if (task.userMessageId === 'u1') await gate1 /* 第 1 轮分析较慢 */
      return true
    },
    loadTasks: () => persisted,
    saveTasks: (t) => {
      persisted = t
    },
    isConversationBusy: () => false,
  })
  m.start()
  m.enqueue({ conversationId: 'c1', userMessageId: 'u1', assistantMessageId: 'a1' })
  await waitFor(() => !!m.getSnapshot().c1?.running, '第 1 轮任务开始执行')
  m.enqueue({ conversationId: 'c1', userMessageId: 'u2', assistantMessageId: 'a2' })
  m.enqueue({ conversationId: 'c1', userMessageId: 'u3', assistantMessageId: 'a3' })
  const snapB = m.getSnapshot().c1
  ok(!!snapB.running && snapB.running.userMessageId === 'u1', '第 1 轮执行中（running）')
  ok(snapB.pending === 2, '第 2、3 轮进入等待队列（pending=2）')
  await sleep(40)
  ok(calls.join(',') === 'u1', '同一会话串行：慢任务未完成时后续任务不执行（不并发写目录）')
  release1()
  await waitFor(() => m.getSnapshot().c1?.done === 3, '三个任务全部完成')
  ok(calls.join(',') === 'u1,u2,u3', '按 FIFO 顺序执行，不丢失')
}

{
  /* 不同会话隔离：cA 慢任务不阻塞 cB 执行 */
  const callsI = []
  let releaseA = null
  const gateA = new Promise((r) => {
    releaseA = r
  })
  const mI = createMaintenanceQueueManager({
    runTask: async (task) => {
      callsI.push(`${task.conversationId}/${task.userMessageId}`)
      if (task.conversationId === 'cA') await gateA
      return true
    },
    loadTasks: () => [],
    saveTasks: () => {},
    isConversationBusy: () => false,
  })
  mI.start()
  mI.enqueue({ conversationId: 'cA', userMessageId: 'i1', assistantMessageId: 'i2' })
  await waitFor(() => !!mI.getSnapshot().cA?.running, 'cA 任务开始执行')
  mI.enqueue({ conversationId: 'cB', userMessageId: 'i3', assistantMessageId: 'i4' })
  await waitFor(() => mI.getSnapshot().cB?.done === 1, 'cB 任务完成')
  ok(callsI.includes('cB/i3'), '不同会话之间互不阻塞（数据严格隔离）')
  releaseA()
  await waitFor(() => mI.getSnapshot().cA?.done === 1, 'cA 任务完成')
}

console.log('\n场景 C：失败处理（保留旧目录语义 + 单独重试 + 队列暂停）')

{
  const calls = []
  let failFirst = true
  let persisted = []
  const m = createMaintenanceQueueManager({
    /* 模拟 runTask：失败时返回 Error（错误原因随任务记录） */
    runTask: async (task) => {
      calls.push(task.userMessageId)
      if (task.userMessageId === 'u1' && failFirst) return new Error('模型响应超时')
      return true
    },
    loadTasks: () => persisted,
    saveTasks: (t) => {
      persisted = t
    },
    isConversationBusy: () => false,
  })
  m.start()
  m.enqueue({ conversationId: 'c9', userMessageId: 'u1', assistantMessageId: 'a1' })
  m.enqueue({ conversationId: 'c9', userMessageId: 'u2', assistantMessageId: 'a2' })
  await waitFor(() => m.getSnapshot().c9?.paused === true, '第 1 轮失败后队列暂停')
  const s = m.getSnapshot().c9
  ok(s.failed === 1 && s.pending === 1, '失败轮次保持「未分析」，后续任务等待（不谎称完成）')
  ok(s.failedTask?.error === '模型响应超时', '失败轮次与错误原因明确记录')
  ok(persisted.some((t) => t.status === 'failed' && t.error === '模型响应超时'), '失败状态随任务持久化')
  await sleep(40)
  ok(calls.join(',') === 'u1', '队列暂停：失败后的后续任务不自动执行、不自动重试付费请求')
  failFirst = false
  ok(m.retry('c9') === true, '失败任务可单独重试')
  await waitFor(() => m.getSnapshot().c9?.done === 2, '重试成功后继续处理后续任务')
  ok(calls.join(',') === 'u1,u1,u2', '仅重跑失败轮次（不触发全量重生成、不重发全部历史）')
  ok(m.getSnapshot().c9.paused === false && m.getSnapshot().c9.failed === 0, '重试成功后队列解除暂停')
}

console.log('\n场景 D：刷新恢复（未完成恢复执行，已完成不重复处理）')

{
  /* 阶段 1：uD1 执行中（慢，永不完成）+ uD2 等待 → 模拟页面刷新 */
  let persisted = []
  const gateD = new Promise(() => {})
  const mD1 = createMaintenanceQueueManager({
    runTask: async () => {
      await gateD
      return true
    },
    loadTasks: () => persisted,
    saveTasks: (t) => {
      persisted = t
    },
    isConversationBusy: () => false,
  })
  mD1.start()
  mD1.enqueue({ conversationId: 'c7', userMessageId: 'uD1', assistantMessageId: 'aD1' })
  await waitFor(() => !!mD1.getSnapshot().c7?.running, 'uD1 开始执行')
  mD1.enqueue({ conversationId: 'c7', userMessageId: 'uD2', assistantMessageId: 'aD2' })
  ok(
    persisted.length === 2 &&
      persisted[0].userMessageId === 'uD1' &&
      persisted[0].status === 'pending' &&
      persisted[1].userMessageId === 'uD2' &&
      persisted[1].status === 'pending',
    '持久化包含中断的 running（→pending）与等待任务',
  )

  /* 阶段 2：模拟刷新 → 用持久化数据重建队列管理器（旧实例弃用） */
  const callsD2 = []
  let persisted2 = persisted
  const mD2 = createMaintenanceQueueManager({
    runTask: async (task) => {
      callsD2.push(task.userMessageId)
      return true
    },
    loadTasks: () => persisted2,
    saveTasks: (t) => {
      persisted2 = t
    },
    isConversationBusy: () => false,
  })
  mD2.start()
  await waitFor(() => mD2.getSnapshot().c7?.done === 2, '刷新后恢复的两个任务全部完成')
  ok(callsD2.join(',') === 'uD1,uD2', '刷新后未分析消息按序恢复执行（不因组件卸载丢失）')

  /* 重复入队已完成轮次 → 拒绝（不重复付费调用） */
  const dup = mD2.enqueue({ conversationId: 'c7', userMessageId: 'uD1', assistantMessageId: 'aD1' })
  ok(dup === false, '重复入队已完成任务被拒绝（不重复处理 / 不重复付费）')

  /* 已完成任务不落盘：队列清空后持久化为空 */
  ok(persisted2.length === 0, '已完成任务不持久化：再次刷新不会重复处理')

  /* 全量重生成期间：增量任务等待（isConversationBusy → 延后调度） */
  const callsBusy = []
  const mBusy = createMaintenanceQueueManager({
    runTask: async (task) => {
      callsBusy.push(task.userMessageId)
      return true
    },
    loadTasks: () => [],
    saveTasks: () => {},
    isConversationBusy: () => true, /* 模拟全量生成进行中 */
  })
  mBusy.start()
  mBusy.enqueue({ conversationId: 'cB2', userMessageId: 'b1', assistantMessageId: 'b2' })
  await sleep(60)
  ok(callsBusy.length === 0, '全量生成进行中：增量任务延后调度（避免并发写同一目录）')
}

console.log(`\n全部通过：共 ${passed} 项断言\n`)
