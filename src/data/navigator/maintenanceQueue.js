/* ============================================================
 * Conversation Navigator Agent · 增量目录任务队列管理器
 * ------------------------------------------------------------
 * 按 conversationId 隔离的轻量级 FIFO 队列（无额外基础设施）：
 *   1. 每轮完整问答产生一个维护任务，conversationId + 消息 ID 去重
 *   2. 同一会话同时最多执行一个任务（严格串行，不并发写目录）
 *   3. 任务开始执行时由 runTask 回调实时读取最新目录（队列不缓存快照）
 *   4. 失败：任务回队首标记 failed 并暂停该会话队列，重试后继续；
 *      失败轮次保持「未分析」，不谎称完成、不自动全量重生成、
 *      不无限自动重试付费请求
 *   5. pending / failed / 中断的 running 任务经持久化跨刷新恢复
 *   6. 不同会话之间数据严格隔离，互不阻塞
 *
 * IO 全部通过依赖注入（runTask / loadTasks / saveTasks /
 * isConversationBusy / onChange），组件与回归测试共用同一实现。
 * ============================================================ */

export function createMaintenanceQueueManager({
  runTask,
  loadTasks,
  saveTasks,
  isConversationBusy,
  onChange,
}) {
  const queues = new Map() /* conversationId -> { tasks, running, paused, done } */
  /* 本次运行中已完成任务的 key（运行时防重：已分析轮次不再入队）。
   * 刷新恢复的防重由持久化保证——已完成任务不落盘 */
  const doneKeys = new Set()
  const taskKey = (t) => `${t.conversationId}:${t.userMessageId}:${t.assistantMessageId}`

  /* 可注入回调的统一持有点：支持构造期注入（回归测试）与运行期
   * bind 替换（组件在 effect 中绑定，渲染期不创建读取 ref 的闭包） */
  const hooks = { runTask, isConversationBusy, onChange }

  /* 运行期绑定 / 替换回调：组件挂载 effect 中调用 */
  function bind(next) {
    if (typeof next?.runTask === 'function') hooks.runTask = next.runTask
    if (typeof next?.isConversationBusy === 'function') hooks.isConversationBusy = next.isConversationBusy
    if (typeof next?.onChange === 'function') hooks.onChange = next.onChange
  }

  const queueOf = (convId) => {
    let q = queues.get(convId)
    if (!q) {
      q = { tasks: [], running: null, paused: false, done: 0 }
      queues.set(convId, q)
    }
    return q
  }

  const sameTurn = (a, b) =>
    a.conversationId === b.conversationId &&
    a.userMessageId === b.userMessageId &&
    a.assistantMessageId === b.assistantMessageId

  /* 持久化：running 任务中断后以 pending 身份恢复重跑（未完成即未分析） */
  const persist = () => {
    const out = []
    for (const q of queues.values()) {
      if (q.running) out.push({ ...q.running, status: 'pending' })
      for (const t of q.tasks) out.push(t)
    }
    saveTasks(out)
  }

  /* 通知 UI：携带最新队列快照（快照在管理器内计算，调用方无需自取） */
  const notify = () => {
    try {
      hooks.onChange?.(getSnapshot())
    } catch {
      /* UI 回调异常不影响队列主流程 */
    }
  }

  /* 入队（含去重）：同一轮问答已在队列或正在执行时不重复入队，
   * 不产生重复付费调用 */
  function enqueue(task) {
    if (!task?.conversationId || !task?.userMessageId || !task?.assistantMessageId) return false
    if (doneKeys.has(taskKey(task))) return false
    const q = queueOf(task.conversationId)
    if (q.running && sameTurn(q.running, task)) return false
    if (q.tasks.some((t) => sameTurn(t, task))) return false
    q.tasks.push({
      conversationId: task.conversationId,
      userMessageId: task.userMessageId,
      assistantMessageId: task.assistantMessageId,
      status: 'pending',
    })
    persist()
    notify()
    kick(task.conversationId)
    return true
  }

  /* 调度：取队首任务执行。会话全量生成进行中（isConversationBusy）
   * 则延后重试；failed 任务卡在队首（暂停态）等待用户重试 */
  async function kick(convId) {
    const q = queues.get(convId)
    if (!q || q.running || q.paused) return
    const task = q.tasks[0]
    if (!task) return
    if (task.status === 'failed') return
    if (hooks.isConversationBusy?.(convId)) {
      setTimeout(() => kick(convId), 800)
      return
    }
    q.running = task
    q.tasks = q.tasks.slice(1)
    persist()
    notify()
    /* runTask 约定：返回 true = 成功；返回 Error / false / 其他 = 失败
     * （Error.message 记录为失败原因，随任务持久化供刷新后展示） */
    let ret = false
    try {
      ret = await hooks.runTask?.(task)
    } catch (e) {
      ret = e ?? false
    }
    const qNow = queues.get(convId)
    if (!qNow || qNow.running !== task) return /* 会话队列已被清空 */
    qNow.running = null
    if (ret === true) {
      qNow.done += 1
      doneKeys.add(taskKey(task))
      persist()
      notify()
      kick(convId)
    } else {
      /* 失败：任务回队首标记 failed 并暂停该会话队列（失败轮次
       * 保持未分析；后续任务等待重试，避免目录归属错乱） */
      const errMsg = ret && typeof ret.message === 'string' ? ret.message : null
      qNow.tasks = [
        { ...task, status: 'failed', ...(errMsg ? { error: errMsg } : {}) },
        ...qNow.tasks,
      ]
      qNow.paused = true
      persist()
      notify()
    }
  }

  /* 重试失败任务：恢复队首 failed 任务并解除暂停（只重跑该轮，
   * 不触发全量重生成、不重发全部历史） */
  function retry(convId) {
    const q = queues.get(convId)
    if (!q || q.running) return false
    const first = q.tasks[0]
    if (!first || first.status !== 'failed') return false
    q.tasks = [{ ...first, status: 'pending' }, ...q.tasks.slice(1)]
    q.paused = false
    persist()
    notify()
    kick(convId)
    return true
  }

  /* 删除会话：清空该会话队列（进行中的上游请求由外部 abort） */
  function dropConversation(convId) {
    if (!queues.has(convId)) return
    queues.delete(convId)
    persist()
    notify()
  }

  /* UI 快照：真实队列状态（无伪造进度） */
  function getSnapshot() {
    const out = {}
    for (const [convId, q] of queues) {
      const failedTask = q.tasks.find((t) => t.status === 'failed') ?? null
      out[convId] = {
        running: q.running ? { ...q.running } : null,
        pending: q.tasks.filter((t) => t.status === 'pending').length,
        failed: q.tasks.filter((t) => t.status === 'failed').length,
        done: q.done,
        paused: q.paused,
        failedTask,
      }
    }
    return out
  }

  function isRunning(convId) {
    return !!queues.get(convId)?.running
  }

  /* 挂载恢复：持久化的 pending / failed 任务重新入列（顺序保留）。
   * 已完成任务不在持久化中，刷新后不重复处理 */
  for (const t of loadTasks()) {
    const q = queueOf(t.conversationId)
    q.tasks.push({
      conversationId: t.conversationId,
      userMessageId: t.userMessageId,
      assistantMessageId: t.assistantMessageId,
      status: t.status === 'failed' ? 'failed' : 'pending',
    })
    if (t.status === 'failed') q.paused = true
  }

  /* 启动（幂等）：组件挂载后调用，恢复的队列继续处理 */
  function start() {
    notify()
    for (const convId of [...queues.keys()]) kick(convId)
  }

  return { enqueue, retry, dropConversation, getSnapshot, isRunning, start, bind }
}
