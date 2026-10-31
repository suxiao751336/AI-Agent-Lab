/* ============================================================
 * AI 工作记录 · 事件文案映射层（统一映射，避免组件内硬编码）
 *
 * 职责：把 Agent Loop 的类型化 SSE 事件 / 失败结果映射为通俗中文，
 * 供底部「AI 工作记录」简洁模式与左侧动态步骤共用。
 *
 * 原则：
 *  · 仅做文案映射，不伪造状态 —— 所有输入均来自真实事件字段
 *    （path / turn / elapsedMs / 字符数等），无预设动画、不推测内容
 *  · stream_progress 心跳返回 group 字段，简洁模式同组原地合并更新
 * ============================================================ */

/* 三个文件的中文解释（步骤标题与日志共用） */
const FILE_META = {
  'index.html': { label: '页面结构', createTitle: '创建页面' },
  'style.css': { label: '界面样式', createTitle: '设计样式' },
  'app.js': { label: '交互功能', createTitle: '实现功能' },
}

export function fileMeta(path) {
  return FILE_META[path] || { label: path, createTitle: `创建 ${path}` }
}

/* create_file 成功文案（简洁模式） */
const CREATE_DONE_TEXT = {
  'index.html': '已创建页面结构（index.html）。',
  'style.css': '已完成页面样式（style.css）。',
  'app.js': '已实现页面交互功能（app.js）。',
}

/* 任务失败文案（agent_end 失败 / 请求失败共用映射） */
export function friendlyAgentFail(code) {
  switch (code) {
    case 'TURN_TIMEOUT':
      return 'AI 本次开发耗时过长（单轮达到时间上限），请重试或简化需求。'
    case 'NO_PROGRESS_TIMEOUT':
      return 'AI 响应中断（长时间无输出），请重试。'
    case 'TOTAL_TIMEOUT':
      return '任务超出总时间限制，请尝试简化需求。'
    case 'MAX_TURNS_EXCEEDED':
      return '本次修改步骤过多，任务未完成；可继续发指令让 AI 接着完成。'
    case 'USER_CANCELLED':
    case 'ABORTED':
      return '任务已取消。'
    case 'NO_CHANGES':
      return 'AI 本次未对文件做出修改。'
    case 'NO_API_KEY':
      return 'AI 服务未配置（缺少 API Key），请联系管理员。'
    case 'UNAUTHORIZED':
      return 'API Key 无效（401），请检查配置。'
    case 'RATE_LIMIT':
      return '请求频率受限（429），请稍后再试。'
    case 'INSUFFICIENT_BALANCE':
      return '账户额度不足，请充值后重试。'
    case 'MODEL_NOT_FOUND':
      return '模型不存在或无权访问，请检查配置。'
    case 'NETWORK':
      return '无法连接 AI 服务（网络错误），请重试。'
    case 'UPSTREAM_ERROR':
      return 'AI 服务暂时不可用，请稍后重试。'
    default:
      return null
  }
}

/* 请求层失败（未产生 agent_end 事件的失败路径） */
export function friendlyRequestError(code, message) {
  return friendlyAgentFail(code) || `任务未完成（${code || '未知错误'}）：${message || '请重试'}。`
}

/* AI 图片素材类型中文标签（视觉增强） */
const IMAGE_TYPE_LABEL = { button: '按钮素材', illustration: '插画素材', background: '背景素材' }

/**
 * 类型化 SSE 事件 → 简洁模式日志文案
 * @param {Object} ev 服务端类型化事件（agent_start / turn_start / stream_progress /
 *   reasoning_delta / image_start / image_generated / tool_call / file_update /
 *   turn_end / agent_end）
 * @param {{reasoningTail?:string}} [ctx] 调用方维护的思考流尾段（当前轮次已累积的最近片段），
 *   存在时思考类日志直接展示思考内容而非字符计数
 * @returns {{level:'INFO'|'SUCCESS'|'WARNING'|'ERROR', text:string, group?:string} | null}
 *   返回 null 表示该事件在简洁模式不展示（如 file_update / turn_end，避免重复）
 */
export function friendlyForTypedEvent(ev, ctx) {
  const reasoningText = ctx?.reasoningTail
    ? `AI 正在思考：${ctx.reasoningTail.replace(/\s+/g, ' ')}`
    : null
  switch (ev.type) {
    case 'agent_start':
      if (ev.visual) {
        return {
          level: 'INFO',
          text:
            ev.kind === 'modify'
              ? '已收到视觉增强修改需求，AI 开始分析现有界面。'
              : '已收到视觉增强需求，AI 开始设计视觉方案。',
        }
      }
      return {
        level: 'INFO',
        text: ev.kind === 'modify' ? '已收到修改需求，AI 开始更新当前应用。' : '已收到需求，开始开发应用。',
      }
    case 'turn_start':
      return {
        level: 'INFO',
        text: ev.turn > 1 ? `AI 正在分析下一步开发任务（总第 ${ev.turn} 步）。` : 'AI 正在分析开发需求。',
      }
    case 'reasoning_delta':
      /* 思考流实时打印：同一轮次同组日志原地合并，只保留最近片段 */
      return reasoningText ? { level: 'INFO', text: reasoningText, group: `sp:${ev.turn}:reasoning` } : null
    case 'image_start':
      /* 视觉增强：图片生成请求发起（成功文案由 image_generated 事件覆盖） */
      return {
        level: 'INFO',
        text: `正在生成专属图片素材（${IMAGE_TYPE_LABEL[ev.assetType] || '素材'} · ${ev.name || ''}）…`,
      }
    case 'image_generated':
      return {
        level: 'SUCCESS',
        text: `图片生成成功（${ev.path} · ${ev.width}×${ev.height} · ${Math.max(1, Math.round((ev.sizeBytes || 0) / 1024))}KB · ${Math.round((ev.elapsedMs || 0) / 1000)} 秒）。`,
      }
    case 'stream_progress': {
      const group = `sp:${ev.turn}:${ev.phase}`
      if (ev.phase === 'reasoning') {
        /* 有思考流尾段时直接展示思考内容（ctx 由前端按轮次累积） */
        if (reasoningText) return { level: 'INFO', text: reasoningText, group }
        return { level: 'INFO', text: `AI 正在规划实现方式（已思考 ${ev.reasoningChars} 字符）`, group }
      }
      if (ev.phase === 'tools') {
        if (ev.toolName === 'generate_image') {
          return { level: 'INFO', text: '正在生成专属图片素材…', group }
        }
        if ((ev.toolName === 'create_file' || ev.toolName === 'update_file') && ev.toolPath) {
          const m = fileMeta(ev.toolPath)
          return {
            level: 'INFO',
            text:
              ev.toolName === 'update_file'
                ? `AI 正在修改 ${ev.toolPath}（${m.label} · 已修改代码）。`
                : `AI 正在编写 ${ev.toolPath}（${m.label} · 已输出 ${ev.toolArgsChars} 字符）。`,
            group,
          }
        }
        if (ev.toolName === 'read_file') {
          return { level: 'INFO', text: `AI 正在查看现有代码${ev.toolPath ? `（${ev.toolPath}）` : ''}。`, group }
        }
        if (ev.toolName === 'finish') {
          return { level: 'INFO', text: 'AI 正在整理开发总结。', group }
        }
        return { level: 'INFO', text: `AI 正在编写代码（已输出 ${ev.toolArgsChars} 字符）。`, group }
      }
      if (ev.phase === 'content') {
        return { level: 'INFO', text: 'AI 正在整理文字说明。', group }
      }
      return { level: 'INFO', text: `等待 AI 响应（已等待 ${Math.round((ev.elapsedMs || 0) / 1000)} 秒）…`, group }
    }
    case 'tool_call': {
      const path = ev.path
      if (ev.tool === 'create_file' && path) {
        if (ev.ok) return { level: 'SUCCESS', text: CREATE_DONE_TEXT[path] || `已创建文件 ${path}。` }
        return { level: 'WARNING', text: `创建 ${path} 未成功，失败原因已反馈给 AI 处理。` }
      }
      if (ev.tool === 'update_file' && path) {
        if (ev.ok) return { level: 'SUCCESS', text: `已更新文件（${path} · ${fileMeta(path).label}）。` }
        return { level: 'WARNING', text: `修改 ${path} 未成功，失败原因已反馈给 AI 处理。` }
      }
      if (ev.tool === 'read_file') {
        if (ev.ok) return { level: 'INFO', text: `AI 查看了现有代码${path ? `（${path}）` : ''}。` }
        return { level: 'WARNING', text: '读取文件未成功，失败原因已反馈给 AI 处理。' }
      }
      if (ev.tool === 'generate_image') {
        /* 成功文案由 image_generated 事件覆盖；此处仅覆盖失败 */
        return ev.ok
          ? null
          : { level: 'WARNING', text: '图片生成未成功，失败原因已反馈给 AI 处理（可改用代码实现）。' }
      }
      if (ev.tool === 'finish') {
        if (ev.ok) return { level: 'SUCCESS', text: 'AI 已完成本次开发任务。' }
        return { level: 'WARNING', text: '任务提交未成功，失败原因已反馈给 AI 处理。' }
      }
      return ev.ok ? null : { level: 'WARNING', text: '工具执行未成功，失败原因已反馈给 AI 处理。' }
    }
    case 'file_update':
      /* 文件写入已由 create_file / update_file 文案覆盖，简洁模式不重复展示 */
      return null
    case 'turn_end':
      /* 轮次统计属技术信息，简洁模式不展示（技术模式可见服务端原始日志） */
      return null
    case 'agent_end': {
      if (ev.ok) {
        const secs = ev.elapsedMs != null ? Math.round(ev.elapsedMs / 1000) : null
        const stat = `（共 ${ev.turns ?? '?'} 轮${secs != null ? ` · 耗时 ${secs} 秒` : ''}）`
        if (ev.images > 0) {
          return {
            level: 'SUCCESS',
            text:
              ev.kind === 'modify'
                ? `视觉增强完成，已生成 ${ev.images} 张图片素材并应用到界面${stat}。`
                : `视觉增强完成，已生成 ${ev.images} 张图片素材${stat}。`,
          }
        }
        return {
          level: 'SUCCESS',
          text: ev.kind === 'modify' ? `应用更新完成，预览已刷新${stat}。` : `应用生成完成，预览已更新${stat}。`,
        }
      }
      const cancelled = ev.code === 'USER_CANCELLED' || ev.code === 'ABORTED'
      if (ev.code === 'MAX_TURNS_EXCEEDED' && ev.filesCommitted) {
        return {
          level: 'WARNING',
          text: 'AI 思考过多（达到轮次上限），已完成的修改已保留，可点击「继续执行」接着完成。',
        }
      }
      return {
        level: cancelled ? 'WARNING' : 'ERROR',
        text: friendlyAgentFail(ev.code) || `任务未完成（${ev.code || '未知错误'}）。`,
      }
    }
    default:
      return null
  }
}
