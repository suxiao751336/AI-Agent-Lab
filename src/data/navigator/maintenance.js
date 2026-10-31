/* ============================================================
 * Conversation Navigator Agent · 增量目录任务持久化
 * ------------------------------------------------------------
 * 待处理 / 失败 / 被中断的任务写入 localStorage，页面刷新后
 * 恢复继续处理；已完成的任务不落盘（刷新后绝不重复处理、
 * 不重复调用付费 API）。
 * ============================================================ */

const STORAGE_KEY = 'navigator.maintenanceQueue.v1'

export function loadMaintenanceTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(
      (t) =>
        t &&
        typeof t.conversationId === 'string' &&
        typeof t.userMessageId === 'string' &&
        typeof t.assistantMessageId === 'string',
    )
  } catch {
    return []
  }
}

export function saveMaintenanceTasks(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  } catch {
    /* 存储失败（隐私模式 / 配额满）时静默降级为内存态 */
  }
}
