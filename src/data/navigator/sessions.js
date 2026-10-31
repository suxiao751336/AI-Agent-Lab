/* ============================================================
 * Conversation Navigator Agent · 用户会话本地持久化
 * ------------------------------------------------------------
 * - 用户会话与内置 TravelMate 演示数据完全分离，仅用户会话
 *   写入 localStorage，刷新后不丢失；
 * - 会话结构：{ id, title, subtitle, messages, topics }
 *   与演示会话保持同一形状，便于三栏组件统一消费；
 * - 本阶段 AI 未接入：新消息仅用户消息，topics 恒为空数组
 *   （目录待生成），不虚构任何 AI 生成的目录。
 * ============================================================ */

const STORAGE_KEY = 'navigator.userSessions.v1'

/* 用户消息自增序号（进程内唯一即可，配合时间戳避免碰撞） */
let uidSeq = 0

function nowLabel() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* 创建一条用户消息（块结构与演示消息一致） */
export function createUserMessage(text) {
  return {
    id: `u${(++uidSeq).toString(36)}${Date.now().toString(36)}`,
    role: 'user',
    time: nowLabel(),
    blocks: [{ type: 'text', text }],
  }
}

/* 创建一条 AI 回复消息：流式期间先创建空消息占位（稳定唯一 id），
 * 前端随分片逐字更新 blocks[0].text，完成后定型为正式消息 */
export function createAssistantMessage(text = '') {
  return {
    id: `a${(++uidSeq).toString(36)}${Date.now().toString(36)}`,
    role: 'assistant',
    time: nowLabel(),
    blocks: text ? [{ type: 'text', text }] : [],
  }
}

/* 从首条消息派生会话标题（取前 18 字符，去掉 Markdown 记号） */
function deriveTitle(text) {
  const clean = String(text).replace(/[#*`>~-]/g, '').replace(/\s+/g, ' ').trim()
  const t = clean.length > 0 ? clean : '新聊天'
  return t.length > 18 ? `${t.slice(0, 18)}…` : t
}

/* 以首条用户消息创建新会话 */
export function createUserSession(firstMessage) {
  return {
    id: `uc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: deriveTitle(firstMessage.blocks[0]?.text ?? ''),
    subtitle: '用户会话 · 本地保存',
    messages: [firstMessage],
    topics: [],
  }
}

/* ---------- localStorage 读写（系统边界，做异常防御） ---------- */

export function loadUserSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(
      (s) => s && typeof s.id === 'string' && Array.isArray(s.messages) && Array.isArray(s.topics),
    )
  } catch {
    return []
  }
}

export function saveUserSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    /* 存储失败（隐私模式 / 配额满）时静默降级为内存态 */
  }
}
