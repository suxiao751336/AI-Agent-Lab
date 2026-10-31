/* ============================================================
 * 增量目录 Agent · 无付费回归测试（纯本地，不调用模型 API）
 * ------------------------------------------------------------
 * 直接测试服务端合并原语：normalizeDirectory / applyChanges / buildTree
 * 覆盖：三轮增量场景（新增 / 关联旧话题 / no_change）、
 *       JSON 保存重载 roundtrip、非法 ID 防护、层级防护
 * 运行：node server/navigatorIncremental.regression.mjs
 * ============================================================ */
import { applyChanges, buildTree, normalizeDirectory } from './navigatorIncremental.js'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

/* 模拟前端 flattenTopicTree（树 → 扁平，与 NavigatorWorkbench 一致：
 * 每轮请求携带的 directory 即由该函数生成） */
function flattenTopicTree(topics, parentTopicId = null, out = []) {
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

/* 会话消息白名单与时间序（模拟 validMessageIds） */
const ALL_MESSAGE_IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']
const validOrder = new Map(ALL_MESSAGE_IDS.map((id, i) => [id, i]))
const byOrder = (a, b) => (validOrder.get(a) ?? Infinity) - (validOrder.get(b) ?? Infinity)
const validIdSet = new Set(ALL_MESSAGE_IDS)

/* 模拟一轮增量维护的服务端本地合并路径（模型决策 → 校验合并）。
 * currentTurnIds 模拟本轮两条新消息（主流程始终传 [userId, asstId]） */
function runTurn(flatDirectory, modelDecision, currentTurnIds = []) {
  return applyChanges(normalizeDirectory(flatDirectory), modelDecision, validIdSet, 'test', byOrder, currentTurnIds)
}

console.log('初始目录：需求分析（topic_1，关联 m1、m2）')
let flat = [{ topicId: 'topic_1', parentTopicId: null, title: '需求分析', summary: '', messageIds: ['m1', 'm2'] }]

console.log('\n[1] 第一次增量：create UI 设计（关联 m3、m4）')
const t1 = runTurn(flat, {
  changes: [{ op: 'create', title: 'UI 设计', summary: '界面设计讨论', messageIds: ['m3', 'm4'] }],
})
assert(t1.applied && !t1.noChange && t1.changeCount === 1, '提交成功，1 项修改')
const after1 = t1.directory
const titles1 = after1.map((t) => t.title)
assert(titles1.includes('需求分析') && titles1.includes('UI 设计'), '「需求分析」与「UI 设计」同时存在（旧目录完整保留）')
assert(after1.find((t) => t.title === '需求分析').messageIds.join(',') === 'm1,m2', '需求分析原有关联不变')
const uiTopic = after1.find((t) => t.title === 'UI 设计')
const newId = uiTopic.topicId
assert(newId && newId !== 'topic_1', `新话题分配了新 topicId（${newId}）`)
assert(uiTopic.messageIds.join(',') === 'm3,m4', 'UI 设计关联 m3、m4')
assert(
  t1.summary.length === 1 && t1.summary[0].includes('create「UI 设计」') && t1.summary[0].includes('关联 2 条消息'),
  `变更明细输出 create 操作（${t1.summary[0]}）`,
)

console.log('\n[2] 树化 → JSON 保存 → 刷新重新加载（roundtrip）')
const tree1 = buildTree(after1)
const saved = JSON.stringify(tree1) /* 模拟 localStorage 写入 */
const reloaded = JSON.parse(saved) /* 模拟 localStorage 读取 */
const flat2 = flattenTopicTree(reloaded)
assert(flat2.length === 2, '重载后话题数 = 2（保存 / 重新加载不丢目录）')
assert(flat2.find((t) => t.topicId === 'topic_1') && flat2.find((t) => t.topicId === newId), '重载后 topicId 全部保留')

console.log('\n[3] 第二次增量：link 新消息 m5、m6 到「需求分析」')
const t2 = runTurn(
  flat2,
  { changes: [{ op: 'link', topicId: 'topic_1', messageIds: ['m5', 'm6'] }] },
  ['m5', 'm6'],
)
const after2 = t2.directory
assert(after2.length === 2, '目录仍为 2 个话题（UI 设计保留）')
assert(after2.filter((t) => t.title === '需求分析').length === 1, '「需求分析」唯一（未重复创建）')
assert(
  after2.find((t) => t.topicId === 'topic_1').messageIds.join(',') === 'm1,m2,m5,m6',
  '需求分析关联 m1-m6（追加且按会话时间序排列）',
)
assert(after2.find((t) => t.topicId === newId).messageIds.join(',') === 'm3,m4', 'UI 设计关联不变')
assert(
  t2.summary.length === 1 && t2.summary[0].includes('link「需求分析」') && t2.summary[0].includes('新增 2 条消息关联'),
  `变更明细输出 link 操作（${t2.summary[0]}）`,
)

console.log('\n[4] 第三次增量：no_change')
const t3 = runTurn(after2, { noChange: true, note: '本轮无需修改' })
assert(t3.noChange, '返回 noChange')
assert(JSON.stringify(t3.directory) === JSON.stringify(after2), '目录完全保持不变')
assert(Array.isArray(t3.summary) && t3.summary.length === 0, 'noChange 时变更明细为空')

console.log('\n[5] 防护：非法 topicId / messageId')
const t4 = runTurn(after2, {
  changes: [
    { op: 'link', topicId: 'topic_999', messageIds: ['m5'] },
    { op: 'update', topicId: newId, messageIds: ['m_not_exist', 'm1'] },
  ],
})
assert(t4.warnings.some((w) => w.includes('topic_999')), '不存在的 topicId 被跳过并警告')
assert(!t4.directory.find((t) => t.topicId === newId).messageIds.includes('m_not_exist'), '编造的 messageId 被丢弃')
assert(t4.directory.find((t) => t.topicId === newId).messageIds.includes('m1'), '合法 messageId 正常追加')

console.log('\n[6] 防护：层级（二级挂载 / 孤儿父节点）')
const t5 = runTurn(after2, {
  changes: [{ op: 'create', title: '子话题', parentTopicId: newId, messageIds: ['m6'] }],
})
const tree5 = buildTree(t5.directory)
assert(tree5.length === 2, '一级话题数不变（新话题挂为二级）')
assert(tree5.find((t) => t.id === newId)?.children.length === 1, '子话题正确挂到一级父节点下')
const t6 = runTurn(after2, {
  changes: [{ op: 'create', title: '孤儿话题', parentTopicId: 'ghost', messageIds: [] }],
})
assert(t6.warnings.some((w) => w.includes('ghost')), '父话题不存在时警告并改为一级')

console.log('\n[7] 兜底：模型 update 只重传旧消息（遗漏本轮新消息）→ 自动补全')
/* 场景：从 after1（m5、m6 尚未关联任何话题）出发，模型 update「需求分析」
 * 但 messageIds 只给了已关联的 m1、m2 → 服务端自动追加本轮 m5、m6 */
const t7 = runTurn(
  after1,
  { changes: [{ op: 'update', topicId: 'topic_1', summary: '需求与范围', messageIds: ['m1', 'm2'] }] },
  ['m5', 'm6'],
)
assert(t7.warnings.some((w) => w.includes('已关联')), '重传的旧消息被丢弃并警告（区分已关联 / 无效）')
assert(t7.warnings.some((w) => w.includes('自动补全')), '触发本轮消息自动补全并记录警告')
assert(t7.summary.some((s) => s.includes('兜底补全 2 条消息到「需求分析」')), '兜底补全计入变更明细')
const after7 = t7.directory
assert(
  after7.find((t) => t.topicId === 'topic_1').messageIds.join(',') === 'm1,m2,m5,m6',
  '需求分析自动补全关联 m5、m6（本轮问答归属目录）',
)
assert(after7.find((t) => t.topicId === newId).messageIds.join(',') === 'm3,m4', 'UI 设计不受影响')
/* 已关联场景不重复触发兜底（防重复关联） */
const t7b = runTurn(
  after7,
  { changes: [{ op: 'update', topicId: 'topic_1', summary: '需求与范围', messageIds: ['m1'] }] },
  ['m5', 'm6'],
)
assert(!t7b.warnings.some((w) => w.includes('自动补全')), '本轮消息已关联时不重复触发兜底')

console.log('\n[8] 兜底：模型 create 新话题但漏关联本轮消息 → 自动补全到新话题')
/* 从 after1（m5、m6 尚未关联任何话题）出发，create 空关联的新话题 */
const t8 = runTurn(after1, { changes: [{ op: 'create', title: '技术选型', messageIds: [] }] }, ['m5', 'm6'])
const tech = t8.directory.find((t) => t.title === '技术选型')
assert(tech && tech.messageIds.join(',') === 'm5,m6', '新话题自动补全关联本轮 m5、m6')
assert(t8.directory.length === 3, '原有两个话题完整保留')
assert(
  t8.summary.some((s) => s.includes('create「技术选型」')) && t8.summary.some((s) => s.includes('兜底补全')),
  'create 漏关联时兜底补全计入变更明细',
)

console.log(`\n结论：${failures === 0 ? '全部通过 ✓' : `${failures} 项失败 ✗`}`)
process.exit(failures === 0 ? 0 : 1)
