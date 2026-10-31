/* ============================================================
 * Conversation Navigator Agent · 目录 Agent 状态与接口契约
 * ------------------------------------------------------------
 * 本模块只定义「结构化状态」与「输入输出契约」：
 *   - 前端状态用 DirectoryAgentState 承载，事件经 applyAgentEvent
 *     纯函数更新（接入真实 LLM 后由 Agent 事件实时驱动）；
 *   - buildDirectoryAgentInput 组装增量分析输入；
 *   - Agent 返回 DirectoryAgentResult，前端据结构化结果渲染与定位。
 * 本阶段不包含任何模拟分析逻辑，不伪造 AI 执行过程。
 * ============================================================ */

/* ---------- 运行状态枚举 ---------- */

export const AGENT_STATUS = {
  DEMO: 'demo', // 示例目录（内置演示数据，非 AI 生成）
  PENDING: 'pending', // 目录待生成（新建会话尚未产生目录）
  IDLE: 'idle', // 待分析（存在未纳入目录的新消息）
  RUNNING: 'running', // 分析中
  DONE: 'done', // 已完成
  FAILED: 'failed', // 分析失败
}

/* 构造新建会话的初始状态：明确显示「目录待生成」 */
export function createPendingAgentState() {
  return {
    status: AGENT_STATUS.PENDING,
    analyzedCount: 0,
    topicCount: 0,
    lastUpdatedAt: null,
    activeStepId: null,
    steps: AGENT_STEPS,
  }
}

/* ---------- 阶段 1：全量目录分析（已有长对话 → AI 生成完整目录） ---------- */

/* 时间戳 → 展示字符串（与演示数据 MM-DD HH:MM 格式一致） */
function formatTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* 全量分析流程步骤：与后端 server/navigator.js 的真实阶段一一对应 */
export const FULL_ANALYSIS_STEPS = [
  { id: 'fa-1', title: '读取全部消息', desc: '压缩会话上下文并准备分析输入' },
  { id: 'fa-2', title: '正在分析消息', desc: '模型通读全部对话，识别主题与话题边界' },
  { id: 'fa-3', title: '正在构建话题目录', desc: '服务端校验层级关系与 messageId 关联' },
  { id: 'fa-4', title: '更新目录', desc: '写入会话目录树并刷新导航' },
]

/* 分析进行中（点击「重新生成目录」后立即进入）。
 * logs 由真实 SSE 阶段事件驱动追加（stream_progress 滚动更新），
 * 完成后随覆盖态清除自动隐藏 */
export function createRunningAgentState({ messageCount }) {
  return {
    status: AGENT_STATUS.RUNNING,
    analyzedCount: 0,
    topicCount: 0,
    lastUpdatedAt: formatTime(Date.now()),
    activeStepId: 'fa-1',
    steps: FULL_ANALYSIS_STEPS,
    messageCount,
    model: '',
    logs: [],
  }
}

/* 分析成功（目录已由真实模型生成并写入会话） */
export function createGeneratedAgentState({ messageCount, topicCount, footnote, lastUpdatedAt = null }) {
  return {
    status: AGENT_STATUS.DONE,
    analyzedCount: messageCount,
    topicCount,
    lastUpdatedAt: formatTime(lastUpdatedAt ?? Date.now()),
    activeStepId: null,
    steps: FULL_ANALYSIS_STEPS,
    footnote,
    messageCount,
  }
}

/* 分析失败 / 已取消（保留原有目录，不改动会话数据） */
export function createFailedAgentState({ messageCount = 0, footnote }) {
  return {
    status: AGENT_STATUS.FAILED,
    analyzedCount: 0,
    topicCount: 0,
    lastUpdatedAt: formatTime(Date.now()),
    activeStepId: null,
    steps: FULL_ANALYSIS_STEPS,
    footnote,
    messageCount,
  }
}

/* ---------- 阶段 3：增量目录维护 Agent（每轮问答完成后自动触发） ---------- */

/* 增量维护流程步骤：与服务端 Agent Loop 的真实事件对应 */
export const INCREMENTAL_STEPS = [
  { id: 'inc-1', title: '检测到新一轮问答', desc: '用户消息与 AI 回复均已保存' },
  { id: 'inc-2', title: '正在分析新增内容', desc: '结合现有目录与最近上下文理解本轮话题' },
  { id: 'inc-3', title: '正在判断话题归属', desc: 'Agent 按需读取目录 / 相关历史消息' },
  { id: 'inc-4', title: '正在更新话题目录', desc: '提交变更集并经服务端校验' },
]

/* 增量维护进行中：由真实工具事件驱动步骤与日志。
 * round 携带本轮问答的轮次号（第 N 轮），供状态条显示 */
export function createIncrementalRunningAgentState({ round = null } = {}) {
  return {
    status: AGENT_STATUS.RUNNING,
    mode: 'incremental', /* 区分于全量生成：执行期间保留已有目录树 */
    analyzedCount: 0,
    topicCount: 0,
    lastUpdatedAt: formatTime(Date.now()),
    activeStepId: 'inc-1',
    steps: INCREMENTAL_STEPS,
    round,
    logs: ['检测到新一轮问答。', ...(round ? [`正在分析第 ${round} 轮问答。`] : [])],
  }
}

/* 增量维护完成（目录已更新或确认无需修改） */
export function createIncrementalDoneAgentState({ topicCount = 0, footnote, lastUpdatedAt = null }) {
  return {
    status: AGENT_STATUS.DONE,
    analyzedCount: 0,
    topicCount,
    lastUpdatedAt: formatTime(lastUpdatedAt ?? Date.now()),
    activeStepId: null,
    steps: INCREMENTAL_STEPS,
    footnote,
  }
}

/* 增量维护失败（保留最后一次有效目录，不影响聊天）。
 * task 携带本轮问答定位（conversationId / userMessageId / assistantMessageId），
 * 供「重试本轮维护」仅针对未成功处理的消息重新入队，不触发全量重生成 */
export function createIncrementalFailedAgentState({ footnote, task = null }) {
  return {
    status: AGENT_STATUS.FAILED,
    analyzedCount: 0,
    topicCount: 0,
    lastUpdatedAt: formatTime(Date.now()),
    activeStepId: null,
    steps: INCREMENTAL_STEPS,
    footnote,
    task,
  }
}

/* ---------- 标准执行步骤（未来按事件驱动展示） ---------- */

export const AGENT_STEPS = [
  { id: 'as-1', title: '读取新增消息', desc: '拉取目录未覆盖的最新消息' },
  { id: 'as-2', title: '判断话题是否发生变化', desc: '对比上下文识别话题边界' },
  { id: 'as-3', title: '决策目录操作', desc: '决定创建、更新或合并话题' },
  { id: 'as-4', title: '调用目录管理工具', desc: '执行结构化目录变更' },
  { id: 'as-5', title: '建立消息索引', desc: '写入消息与话题的映射关系' },
  { id: 'as-6', title: '更新目录', desc: '刷新导航目录与内容索引' },
]

/**
 * 目录 Agent 结构化状态
 * @typedef {Object} DirectoryAgentState
 * @property {string} status                 AGENT_STATUS 之一
 * @property {number} analyzedCount          已纳入目录的消息数
 * @property {number} topicCount             当前目录话题总数（含二级）
 * @property {string|null} lastUpdatedAt     最近一次目录更新时间
 * @property {string|null} activeStepId      运行中正在执行的步骤 ID
 * @property {Array<{id:string,title:string,desc:string}>} steps 步骤快照
 */

/* 构造内置示例数据的初始状态：明确显示「示例目录」 */
export function createDemoAgentState({ messageCount, topicCount, lastTime }) {
  return {
    status: AGENT_STATUS.DEMO,
    analyzedCount: messageCount,
    topicCount,
    lastUpdatedAt: lastTime ?? null,
    activeStepId: null,
    steps: AGENT_STEPS,
  }
}

/* ---------- 事件契约：接收真实 Agent 事件并实时更新 ----------
 * 事件由后端 Agent Loop 通过 SSE / 回调推送（本阶段不产生任何事件）：
 *   { type: 'run_start',   stepId? }
 *   { type: 'step_update', stepId }
 *   { type: 'run_done',    topicCount, analyzedCount, at }
 *   { type: 'run_error',   message }
 *   { type: 'reset_demo',  messageCount, topicCount, lastTime }
 */
export function applyAgentEvent(state, event) {
  switch (event.type) {
    case 'run_start':
      return {
        ...state,
        status: AGENT_STATUS.RUNNING,
        activeStepId: event.stepId ?? state.steps[0]?.id ?? null,
      }
    case 'step_update':
      return { ...state, status: AGENT_STATUS.RUNNING, activeStepId: event.stepId }
    case 'run_done':
      return {
        ...state,
        status: AGENT_STATUS.DONE,
        activeStepId: null,
        analyzedCount: event.analyzedCount ?? state.analyzedCount,
        topicCount: event.topicCount ?? state.topicCount,
        lastUpdatedAt: event.at ?? state.lastUpdatedAt,
      }
    case 'run_error':
      return { ...state, status: AGENT_STATUS.FAILED, activeStepId: null }
    case 'reset_demo':
      return createDemoAgentState(event)
    default:
      return state
  }
}

/* ---------- 目录增量更新：Agent 输入 / 输出契约 ---------- */

/* Agent 的目录决策动作枚举 */
export const TOPIC_ACTIONS = {
  CREATE: 'create_topic',
  UPDATE: 'update_topic',
  MERGE: 'merge_topics',
  LINK: 'link_messages',
  NONE: 'no_change',
}

/**
 * 组装目录 Agent 的增量分析输入（纯数据拼装，不发起任何请求）
 *
 * @param {Object} params
 * @param {string} params.conversationId           对话 ID
 * @param {Array}  params.newMessages              新增消息（完整消息对象）
 * @param {Array}  params.topics                   当前目录结构（TOPICS 形状）
 * @param {Object|null} [params.relatedTopic]       最近相关话题上下文（可选）
 */
export function buildDirectoryAgentInput({
  conversationId,
  newMessages,
  topics,
  relatedTopic = null,
}) {
  return {
    conversationId,
    newMessages: (newMessages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      time: m.time,
      blocks: m.blocks,
    })),
    currentTopics: topics ?? [],
    relatedTopicContext: relatedTopic,
  }
}

/**
 * Agent 输出契约：Agent 负责决策，前端根据结构化结果渲染与定位
 * @typedef {Object} DirectoryAgentResult
 * @property {'create_topic'|'update_topic'|'merge_topics'|'link_messages'|'no_change'} action
 * @property {string|null} topicId        目标话题 ID（create_topic 时为 null，由前端生成稳定新 ID）
 * @property {Array<string>|null} mergeFromIds merge_topics 时被合并的话题 ID 列表
 * @property {string|null} title          create / update 时的话题标题
 * @property {string|null} summary        话题简短描述
 * @property {Array<string>} messageIds  与话题关联的消息 ID 列表
 * @property {string} reason             简短决策说明（展示给用户）
 */
