/* ============================================================
 * Vibe Coding Agent 真实模型请求封装
 *
 * 请求经本地服务端代理（Vite dev 中间件 /api/llm/generate，
 * 部署后由 Serverless 函数承接同一路由）：
 *  · API Key 只存在于服务端环境变量，不进入前端代码与浏览器
 *  · 服务端负责调用硅基流动 Kimi K2.7 Code 并做 JSON 严格校验
 *
 * 本地模拟引擎与真实模型引擎在 VibeWorkbench 中明确区分切换。
 * ============================================================ */

const ENDPOINT = '/api/llm/generate'
const TIMEOUT_MS = 200_000 /* 前端 200s 超时（服务端 180s 先触发） */

/* 服务端当前配置的模型 ID（由 /api/llm/generate 响应带回，仅用于 UI 展示） */

/**
 * 请求真实模型生成 / 修改项目
 * @param {{kind:'generate'|'modify', requirement:string, files?:{html:string,css:string,js:string}}} payload
 * @param {{signal?:AbortSignal}} [options] 可传入外部取消信号（用户点「停止」）
 * @returns {Promise<{ok:boolean, code?:string, message?:string, files?:Object, summary?:string, usage?:Object, elapsed?:number, model?:string, fallbackNote?:string}>}
 */
export async function requestProjectGeneration(payload, { signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  /* 组合外部取消信号（用户停止）与超时信号 */
  const onOuterAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onOuterAbort, { once: true })
  }

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const data = await resp.json().catch(() => null)
    if (!data) {
      return { ok: false, code: 'BAD_RESPONSE', message: '服务端返回了无法解析的响应' }
    }
    if (!resp.ok || !data.ok) {
      /* 透传服务端完整诊断字段（httpStatus / upstream / timedOut / traceId / elapsedMs 等） */
      return {
        ok: false,
        ...(data || {}),
        code: (data && data.code) || `HTTP_${resp.status}`,
        message: (data && data.message) || `请求失败（HTTP ${resp.status}）`,
      }
    }
    return data
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (signal?.aborted) {
        return { ok: false, code: 'ABORTED', message: '已停止本次请求' }
      }
      return {
        ok: false,
        code: 'TIMEOUT',
        message: `请求超时（${TIMEOUT_MS / 1000}s）。长任务建议简化需求后重试`,
      }
    }
    return {
      ok: false,
      code: 'NETWORK',
      message: '无法连接本地服务端，请确认 Vite dev server 正在运行（npm run dev）',
    }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onOuterAbort)
  }
}

/* ── Agent Loop 接口（阶段 2：Visual Coding Agent 主通道） ── */

const AGENT_ENDPOINT = '/api/llm/agent'
const AGENT_TIMEOUT_MS = 630_000 /* 前端 630s 超时（覆盖服务端 Agent 600s 任务硬上限） */

/**
 * 请求 Agent Loop 执行（流式 Function Calling + 工具调用循环）
 * @param {{kind:'generate'|'modify', requirement:string, files?:{html:string,css:string,js:string}, requestId:string}} payload
 * @param {{signal?:AbortSignal}} [options] 外部取消信号（用户点「停止」→ 真中止请求，服务端随连接断开取消上游）
 * @returns {Promise<{ok:boolean, code?:string, message?:string, cancelled?:boolean, model?:string,
 *   files?:Object, summary?:string, turns?:number, usage?:Object, elapsedMs?:number, requestId?:string}>}
 */
export async function requestAgentRun(payload, { signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onOuterAbort, { once: true })
  }

  try {
    const resp = await fetch(AGENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    /* Agent 路由不存在（旧版后端未部署新接口）：明确标记，供上层一次性回退旧接口 */
    if (resp.status === 404) {
      return {
        ok: false,
        code: 'AGENT_ENDPOINT_NOT_FOUND',
        httpStatus: 404,
        message: '当前后端未提供 /api/llm/agent 接口',
      }
    }
    const data = await resp.json().catch(() => null)
    if (!data) {
      return {
        ok: false,
        code: 'BAD_RESPONSE',
        httpStatus: resp.status,
        message: '服务端返回了无法解析的响应',
      }
    }
    if (!resp.ok || !data.ok) {
      return {
        ok: false,
        ...(data || {}),
        httpStatus: resp.status,
        code: (data && data.code) || `HTTP_${resp.status}`,
        message: (data && data.message) || `请求失败（HTTP ${resp.status}）`,
      }
    }
    return data
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (signal?.aborted) {
        return { ok: false, code: 'ABORTED', message: '已停止本次请求' }
      }
      return {
        ok: false,
        code: 'TIMEOUT',
        message: `请求超时（${AGENT_TIMEOUT_MS / 1000}s，服务端 Agent 执行上限 600s）`,
      }
    }
    return {
      ok: false,
      code: 'NETWORK',
      message: '无法连接本地服务端，请确认 Vite dev server 正在运行（npm run dev）',
    }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onOuterAbort)
  }
}


