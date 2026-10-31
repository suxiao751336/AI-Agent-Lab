/* ============================================================
 * 智能回溯 Search Agent · 无付费回归测试（纯本地，不调用模型 API）
 * ------------------------------------------------------------
 * 通过 callModel 注入脚本化假模型（不发任何网络请求），
 * 完整走 runSearchAgent 的 Agent Loop / 工具执行 / 服务端校验，
 * 覆盖七个核心场景 + 工具级单元防护：
 *   1. 精确关键词命中正确消息
 *   2. 模糊描述命中语义相关消息（同义改写）
 *   3. 首次检索无结果时调整检索策略
 *   4. 找不到内容时明确返回无结果
 *   5. 同一话题多段不连续问答分别定位
 *   6. 会话隔离（不返回其他会话的消息）
 *   7. 编造 messageId 被后端拒绝
 * 运行：node server/navigatorSearch.regression.mjs
 * ============================================================ */
import {
  runSearchAgent,
  normalizeSearchSnapshot,
  searchTopics,
  searchMessages,
  readContext,
  validateResults,
} from './navigatorSearch.js'

/* 假模型仅在本进程内使用，不产生任何付费请求 */
process.env.SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || 'test-key-local-only'

let failures = 0
let passed = 0
function assert(cond, msg) {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${msg}`)
  } else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

/* ---------- 脚本化假模型（按轮次返回预定 tool_calls） ---------- */

function fakeModel(script) {
  let calls = 0
  const fn = async () => {
    const step = script[Math.min(calls, script.length - 1)]
    calls += 1
    return {
      content: step.content ?? '',
      toolCalls: (step.tools ?? []).map((t, idx) => ({
        index: idx,
        name: t.name,
        args: JSON.stringify(t.args ?? {}),
      })),
      usage: step.usage ?? { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }
  }
  fn.callCount = () => calls
  return fn
}

/* ---------- 测试会话 ---------- */

/* 会话 A：模型成本主题，同一话题两段不连续讨论（m3/m4 与 m6/m7） */
const CONV_A_MESSAGES = [
  { id: 'm1', role: 'user', text: '我们用 DeepSeek 做行程规划助手吧' },
  { id: 'm2', role: 'assistant', text: '好的，先搭基本的对话流程' },
  { id: 'm3', role: 'user', text: 'API 调用成本超出预算了，每月要花九十多块' },
  { id: 'm4', role: 'assistant', text: '可以按城市热度分流：轻量模型承接热门城市，旗舰模型兜底冷门目的地，成本能压下来' },
  { id: 'm5', role: 'user', text: '好，先这样，谢谢' },
  { id: 'm6', role: 'user', text: '又超预算了，那个模型方案太烧钱，换个便宜的' },
  { id: 'm7', role: 'assistant', text: '按上次说的分流方案落地后，月成本从 92 压到 38，回到预算内了' },
]
const CONV_A_TOPICS = [
  { topicId: 't-cost', parentTopicId: null, title: '成本与预算', summary: 'API 成本超支与模型分流降本方案', messageIds: ['m3', 'm4', 'm6', 'm7'] },
  { topicId: 't-setup', parentTopicId: null, title: '项目启动', summary: '选型与基础流程搭建', messageIds: ['m1', 'm2', 'm5'] },
]
const payloadA = (query) => ({
  conversationId: 'conv-a',
  query,
  messages: CONV_A_MESSAGES,
  topics: CONV_A_TOPICS,
})

/* 会话 B：与 A 的消息 ID 前缀重叠但内容完全不同（验证隔离） */
const payloadB = (query) => ({
  conversationId: 'conv-b',
  query,
  messages: [
    { id: 'm1', role: 'user', text: 'Logo 用蓝色水滴造型' },
    { id: 'm2', role: 'assistant', text: '45° 渐变水滴加月牙高光，突出亲和力' },
    { id: 'm3', role: 'user', text: '主色定 #2f9bff，走海洋清新风' },
  ],
  topics: [],
})

const snapA = normalizeSearchSnapshot(payloadA('测试'))
const snapB = normalizeSearchSnapshot(payloadB('测试'))
assert(snapA.ok && snapB.ok, '快照构建成功')

/* ---------- 场景 1：精确关键词找到正确消息 ---------- */

console.log('\n场景 1：根据准确关键词找到正确消息')
{
  const stages = []
  const r = await runSearchAgent(payloadA('预算超支的讨论在哪里'), {
    callModel: fakeModel([
      { tools: [{ name: 'search_messages', args: { keywords: ['预算'], mode: 'any' } }] },
      { tools: [{ name: 'read_context', args: { messageId: 'm3' } }] },
      {
        tools: [
          {
            name: 'submit_results',
            args: {
              found: true,
              results: [
                { messageId: 'm3', topicId: 't-cost', title: '成本超预算', reason: '原文直接提到成本超预算', excerpt: 'API 调用成本超出预算了', relevance: 'high' },
              ],
            },
          },
        ],
      },
    ]),
    onStage: (stage, extra) => stages.push({ stage, ...extra }),
  })
  assert(r.ok && r.found === true, '检索成功并返回找到')
  assert(r.results.length === 1 && r.results[0].messageId === 'm3', '精确定位到包含「预算」的原始消息 m3')
  assert(r.results[0].topicId === 't-cost', '结果正确关联现有话题 t-cost')
  assert(r.results[0].excerpt === 'API 调用成本超出预算了', 'excerpt 摘自原文原文')
  assert(stages[0]?.stage === 'understanding', '首个事件为「正在理解查找意图」')
  assert(stages.some((s) => s.stage === 'tool' && s.name === 'search_messages'), '真实发出 search_messages 工具事件')
  assert(stages.some((s) => s.stage === 'tool' && s.name === 'read_context'), '真实发出 read_context 工具事件')
  assert(typeof stages[0]?.requestId === 'string' && stages[0].requestId.startsWith('srch'), '技术日志携带 requestId')
}

/* ---------- 场景 2：模糊描述命中语义相关消息 ---------- */

console.log('\n场景 2：模糊描述（「太烧钱」→ 成本/预算）命中语义相关消息')
{
  const r = await runSearchAgent(payloadA('找一下之前那个太烧钱的模型方案'), {
    callModel: fakeModel([
      { tools: [{ name: 'search_messages', args: { keywords: ['成本', '预算', '费用'], mode: 'any' } }] },
      { tools: [{ name: 'read_context', args: { messageId: 'm3', before: 1, after: 1 } }] },
      {
        tools: [
          {
            name: 'submit_results',
            args: {
              found: true,
              results: [
                { messageId: 'm3', topicId: 't-cost', title: '太烧钱的模型方案', reason: '用户说的「太烧钱」即成本超预算的模型调用', excerpt: 'API 调用成本超出预算了', relevance: 'high' },
              ],
            },
          },
        ],
      },
    ],
    ),
  })
  assert(r.ok && r.found === true, '模糊描述检索成功')
  assert(r.results[0].messageId === 'm3' && r.results[0].title === '太烧钱的模型方案', '定位到语义相关的原始消息（非字面匹配）')
}

/* ---------- 场景 3：首次检索无结果时调整检索策略 ---------- */

console.log('\n场景 3：第一次检索无结果时，Agent 能调整检索策略')
{
  const r = await runSearchAgent(payloadA('找一下之前那个太烧钱的模型方案'), {
    callModel: fakeModel([
      { tools: [{ name: 'search_messages', args: { keywords: ['烧钱'], mode: 'any' } }] },
      { tools: [{ name: 'search_messages', args: { keywords: ['成本', '预算'], mode: 'any' } }] },
      {
        tools: [
          {
            name: 'submit_results',
            args: {
              found: true,
              results: [
                { messageId: 'm3', title: '成本超预算', reason: '「烧钱」换词为成本/预算后命中', excerpt: 'API 调用成本超出预算了', relevance: 'high' },
              ],
            },
          },
        ],
      },
    ]),
  })
  assert(r.ok && r.found === true, '换关键词后成功命中')
  assert(r.stats.toolCalls.filter((n) => n === 'search_messages').length === 2, '第一次未命中后调整关键词重新检索（2 次 search_messages）')
  assert(r.stats.turns === 3, '共 3 轮模型调用后提交')
}

/* ---------- 场景 4：找不到内容时明确返回无结果 ---------- */

console.log('\n场景 4：找不到内容时明确返回无结果（不编造）')
{
  const r = await runSearchAgent(payloadA('之前讨论量子计算机的地方'), {
    callModel: fakeModel([
      { tools: [{ name: 'search_messages', args: { keywords: ['量子'], mode: 'any' } }] },
      { tools: [{ name: 'search_messages', args: { keywords: ['超导', '低温'], mode: 'any' } }] },
      { tools: [{ name: 'submit_results', args: { found: false, note: '已尝试：量子、超导、低温，当前会话无相关讨论' } }] },
    ]),
  })
  assert(r.ok && r.found === false, '如实返回未找到')
  assert(Array.isArray(r.results) && r.results.length === 0, '未编造任何定位结果')
  assert((r.note ?? '').includes('量子'), 'note 说明已尝试的检索方向')
}

/* ---------- 场景 5：同一话题多段不连续问答分别定位 ---------- */

console.log('\n场景 5：同一话题的多段不连续问答定位到不同消息')
{
  const r = await runSearchAgent(payloadA('预算问题都在哪些消息里讨论过'), {
    callModel: fakeModel([
      { tools: [{ name: 'search_topics', args: { keywords: ['预算', '成本'] } }] },
      {
        tools: [
          {
            name: 'submit_results',
            args: {
              found: true,
              results: [
                { messageId: 'm3', topicId: 't-cost', title: '第一次超预算', reason: '首次提出成本超预算', excerpt: 'API 调用成本超出预算了', relevance: 'high' },
                { messageId: 'm6', topicId: 't-cost', title: '再次超预算', reason: '话题被打断后再次出现', excerpt: '又超预算了', relevance: 'high' },
              ],
            },
          },
        ],
      },
    ]),
  })
  assert(r.ok && r.found === true && r.results.length === 2, '返回同一话题的两段讨论')
  assert(r.results[0].messageId === 'm3' && r.results[1].messageId === 'm6', '两段不连续问答（m3 / m6）分别提供定位入口')
  assert(r.results.every((x) => x.topicId === 't-cost'), '两段结果均关联同一话题')
}

/* ---------- 场景 6：会话隔离（不返回其他会话的消息） ---------- */

console.log('\n场景 6：切换会话后，不返回其他会话的消息')
{
  /* 工具级隔离：A 的关键词在 B 的快照中检索不到，反之亦然 */
  assert(searchMessages(snapB, ['成本'], 'any').hits.length === 0, '会话 B 中检索不到会话 A 的内容')
  assert(searchMessages(snapA, ['成本'], 'any').hits.length > 0, '会话 A 中可以检索到自己的内容')
  const rc = readContext(snapB, 'm7')
  assert(!rc.ok, '读取会话 A 独有的 m7 被拒绝（不在 B 的白名单中）')

  /* 提交级隔离：跨会话 ID（m7 仅存在于 A）被服务端拒绝 */
  const r = await runSearchAgent(payloadB('主色定在哪里'), {
    callModel: fakeModel([
      { tools: [{ name: 'search_messages', args: { keywords: ['#2f9bff', '海洋'], mode: 'any' } }] },
      {
        tools: [
          {
            name: 'submit_results',
            args: {
              found: true,
              results: [
                { messageId: 'm3', title: '主色定调', reason: 'B 会话中的主色讨论', excerpt: '主色定 #2f9bff', relevance: 'high' },
                { messageId: 'm7', title: '串台消息', reason: '试图引用其他会话的消息', excerpt: '不存在于 B', relevance: 'low' },
              ],
            },
          },
        ],
      },
    ]),
  })
  assert(r.ok && r.found === true && r.results.length === 1, '只保留当前会话的消息')
  assert(r.results[0].messageId === 'm3' && r.results[0].excerpt === '主色定 #2f9bff', '返回的是会话 B 的 m3 内容（非 A 的）')
  assert((r.stats.warnings ?? []).some((w) => w.includes('m7')), '会话 A 的 m7 被校验拒绝并记录警告')
}

/* ---------- 场景 7：编造 messageId 被后端拒绝 ---------- */

console.log('\n场景 7：返回不存在的 messageId 时，后端能够拒绝')
{
  /* 全部编造：提交被拒 → 模型修正为诚实返回未找到 */
  const stages = []
  const r = await runSearchAgent(payloadA('找成本讨论'), {
    callModel: fakeModel([
      {
        tools: [
          {
            name: 'submit_results',
            args: {
              found: true,
              results: [{ messageId: 'm999', title: '编造', reason: '编造的定位', excerpt: '不存在的消息', relevance: 'high' }],
            },
          },
        ],
      },
      { tools: [{ name: 'submit_results', args: { found: false, note: '修正：没有可靠匹配' } }] },
    ]),
    onStage: (stage, extra) => stages.push({ stage, ...extra }),
  })
  assert(r.ok && r.found === false, '编造提交被拒后最终如实返回未找到')
  assert(stages.some((s) => s.stage === 'tool' && s.name === 'submit_results' && String(s.detail ?? '').includes('校验')), '首次提交被服务端校验拒绝并要求修正')

  /* 部分编造：编造的被丢弃，真实的被保留 */
  const v = validateResults(snapA, [
    { messageId: 'm999', title: 'x', reason: 'y' },
    { messageId: 'm3', title: '成本超预算', reason: 'r', excerpt: 'API 调用成本超出预算了', relevance: 'high' },
  ])
  assert(v.results.length === 1 && v.results[0].messageId === 'm3', '编造的 m999 被丢弃，真实的 m3 被保留')
  assert(v.warnings.some((w) => w.includes('m999')), '编造 ID 记入校验警告')

  /* excerpt 编造：服务端用原文重新截取，不采用模型编造片段 */
  const v2 = validateResults(snapA, [{ messageId: 'm3', title: 't', reason: 'r', excerpt: '这句话原文里根本没有' }])
  assert(v2.results[0].excerpt.startsWith('API 调用成本超出预算'), 'excerpt 非原文时由服务端从原文截取')

  /* topicId 编造：移除不存在的关联 */
  const v3 = validateResults(snapA, [{ messageId: 'm3', topicId: 't-ghost', title: 't', reason: 'r' }])
  assert(v3.results[0].topicId === null && v3.warnings.some((w) => w.includes('t-ghost')), '编造的 topicId 被移除并警告')
}

/* ---------- 工具级单元防护 ---------- */

console.log('\n单元防护：工具行为与输入校验')
{
  /* search_messages：any / all 两种多关键词模式 */
  const any = searchMessages(snapA, ['模型', '成本'], 'any')
  const all = searchMessages(snapA, ['模型', '成本'], 'all')
  assert(any.hits.some((h) => h.messageId === 'm4') && any.hits.some((h) => h.messageId === 'm6'), 'any 模式命中任一关键词即召回（m4、m6）')
  assert(all.hits.length === 1 && all.hits[0].messageId === 'm4', 'all 模式要求全部命中（仅 m4）')
  assert(any.hits.every((h) => h.excerpt.length > 0), '命中结果携带原文片段')

  /* 空关键词被拒 */
  const bad = searchMessages(snapA, [], 'any')
  assert(!bad.ok, '空关键词列表被拒绝')

  /* search_topics：标题命中权重高于摘要 */
  const st = searchTopics(snapA, ['成本'])
  assert(st.hits[0]?.topicId === 't-cost', '话题标题命中「成本与预算」')
  const st2 = searchTopics(snapA, ['zzz'])
  assert(st2.hits.length === 0 && st2.total === 0, '无命中时如实返回空')

  /* read_context：半径钳制与边界 */
  const rc1 = readContext(snapA, 'm3', 99, 99)
  assert(
    rc1.ok &&
      rc1.before === 3 &&
      rc1.after === 3 &&
      rc1.messages.length === 6 &&
      rc1.messages.map((m) => m.messageId).join(',') === 'm1,m2,m3,m4,m5,m6',
    '前后文半径钳制到 0~3（m3 向前仅 2 条，按边界返回 m1~m6）',
  )
  const rc2 = readContext(snapA, 'm1', 2, 2)
  assert(rc2.ok && rc2.messages.length === 3 && rc2.messages.map((m) => m.messageId).join(',') === 'm1,m2,m3', '首条消息向前读取越界被正确钳制')
  assert(!readContext(snapA, 'm999').ok, '读取不存在的 messageId 被拒绝')

  /* 快照归一化：非法条目跳过、重复 ID 去重、超长截断 */
  const snap = normalizeSearchSnapshot({
    conversationId: 'conv-x',
    query: 'x',
    messages: [
      { id: 'a', role: 'user', text: '正常消息' },
      { id: 'a', role: 'assistant', text: '重复 ID 被跳过' },
      { id: 'b', role: 'system', text: '非法角色被跳过' },
      { id: '', role: 'user', text: '空 ID 被跳过' },
      { id: 'c', role: 'user', text: 'x'.repeat(5000) },
    ],
    topics: [{ topicId: 't1', parentTopicId: null, title: 'T', summary: '', messageIds: ['a', 'b', 'zz'] }],
  })
  assert(snap.ok && snap.messages.length === 2, '快照只保留合法消息（重复 / 非法角色 / 空 ID 跳过）')
  assert(snap.messages[1].text.length === 4000, '单条消息文本按上限截断')
  assert(snap.topics[0].messageIds.join(',') === 'a', '目录只保留白名单内的 messageId')

  /* 输入校验：缺 conversationId / query / messages */
  const noConv = await runSearchAgent({ ...payloadA('x'), conversationId: ' ' })
  assert(noConv.code === 'BAD_REQUEST', '缺少会话 ID 被拒绝')
  const noQuery = await runSearchAgent(payloadA('   '))
  assert(noQuery.code === 'BAD_REQUEST', '空查找描述被拒绝')
  const noMsgs = await runSearchAgent({ ...payloadA('x'), messages: [] })
  assert(noMsgs.code === 'BAD_REQUEST', '空消息快照被拒绝')

  /* 取消：请求开始前即中止，不产生任何模型调用 */
  const c = new AbortController()
  c.abort()
  const fmCancel = fakeModel([{ tools: [] }])
  const rCancel = await runSearchAgent(payloadA('x'), { signal: c.signal, callModel: fmCancel })
  assert(rCancel.cancelled && rCancel.code === 'CANCELLED', '已中止的请求直接返回 CANCELLED')
  assert(fmCancel.callCount() === 0, '未发起任何模型调用（不产生付费请求）')

  /* 轮次耗尽：始终不提交 → NO_DECISION */
  const fmLoop = fakeModel([{ tools: [{ name: 'search_messages', args: { keywords: ['模型'] } }] }])
  const rLoop = await runSearchAgent(payloadA('x'), { callModel: fmLoop })
  assert(!rLoop.ok && rLoop.code === 'NO_DECISION', '轮次耗尽且未提交时返回 NO_DECISION')
  assert(fmLoop.callCount() === 6, '模型调用次数被限制在最大 6 轮')

  /* Token 预算：累计超限后终止 */
  const fmBudget = fakeModel([{ tools: [{ name: 'search_messages', args: { keywords: ['模型'] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 15000 } }])
  const rBudget = await runSearchAgent(payloadA('x'), { callModel: fmBudget })
  assert(!rBudget.ok && rBudget.code === 'TOKEN_BUDGET_EXCEEDED', '累计 Token 超预算后终止')
  assert(fmBudget.callCount() === 2, '预算检查在第 3 轮前拦截（2 次调用后）')
}

console.log(`\n结论：${failures === 0 ? `全部通过 ✓ 共 ${passed} 项断言` : `${failures} 项失败 ✗（通过 ${passed} 项）`}`)
process.exit(failures === 0 ? 0 : 1)
