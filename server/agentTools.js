/* ============================================================
 * Visual Coding Agent 工具层（阶段 1）
 *
 * 职责：
 *  1. 请求级内存虚拟文件系统（VFS）：index.html / style.css / app.js
 *     三个文本文件（内部形状 { html, css, js } 与前端编辑器一致）
 *     + assets/*.png|jpg|webp 二进制图片素材（AI 视觉增强）
 *  2. 工具的严格参数校验与执行：
 *     · create_file —— 创建或完整覆写文件
 *     · read_file   —— 读取文件当前内容
 *     · update_file —— 唯一匹配 old_str → new_str 局部修改
 *     · finish      —— 标记任务完成并返回总结
 *     · generate_image —— 仅定义与参数校验（实际 API 调用在 agentLoop，
 *       需要事件发射与外部取消联动；开关关闭时工具不下发给模型）
 *  3. 任务失败不提交：所有修改先落在工作副本，commit() 才对外产出
 *
 * 安全边界（硬性约束）：
 *  · 不访问真实文件系统、不执行终端命令、不读取服务器环境变量
 *  · 路径白名单 + 单文件大小上限，超限直接拒绝
 *  · 图片素材路径强制 assets/ 前缀 + 白名单后缀，防路径穿越；
 *    图片来源仅限服务端图像 API 响应，不接受任意 URL 下载
 *  · 工具失败以 ERROR 文本返回给模型，允许其根据错误自行纠正
 * ============================================================ */

const ALLOWED_PATHS = ['index.html', 'style.css', 'app.js']
const PATH_TO_KEY = { 'index.html': 'html', 'style.css': 'css', 'app.js': 'js' }
const MAX_FILE_SIZE = 512 * 1024 /* 单文件 512KB 上限（与现有 generate 接口一致） */

/* 图片素材约束（AI 视觉增强） */
export const MAX_ASSET_COUNT = 12 /* 单项目图片素材数量上限（含历史素材） */
const ASSET_PATH_RE = /^assets\/[a-z0-9][a-z0-9-_]{0,47}\.(png|jpg|jpeg|webp)$/

/* ── generate_image 工具定义（视觉增强开启时由 agentLoop 拼入工具列表） ── */

export const GENERATE_IMAGE_TOOL_DEF = {
  type: 'function',
  function: {
    name: 'generate_image',
    description:
      '调用图像生成模型（Z-Image-Turbo）生成一张真实图片素材，保存到项目 assets/ 目录并返回素材信息。仅在需要真实图片视觉素材时使用；普通文字、数据、布局、配色修改直接用代码完成，不要生图。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '图片生成提示词（建议英文，描述视觉外观与风格，no text 可避免图内文字）',
        },
        asset_name: {
          type: 'string',
          description: '素材文件名（英文小写与连字符，如 crystal-water-button，不含扩展名）',
        },
        asset_type: {
          type: 'string',
          enum: ['button', 'illustration', 'background'],
          description: '素材类型：button 按钮 / illustration 插画 / background 背景',
        },
        target_description: {
          type: 'string',
          description: '要替换或插入的目标 UI 元素描述（如：页面底部的添加记录按钮）',
        },
      },
      required: ['prompt', 'asset_name', 'asset_type'],
    },
  },
}

/* 素材文件名规整：小写字母数字连字符，防路径穿越与非法字符 */
export function normalizeAssetName(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return (s || 'ai-asset').slice(0, 48)
}

/* generate_image 参数校验（执行在 agentLoop，校验规则集中在此处） */
export function validateImageArgs(args) {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (prompt.length < 5) {
    return { error: 'ERROR: prompt 必须是至少 5 个字符的图片描述' }
  }
  const assetType = args.asset_type
  if (assetType !== 'button' && assetType !== 'illustration' && assetType !== 'background') {
    return { error: 'ERROR: asset_type 必须是 button / illustration / background 之一' }
  }
  return {
    prompt: prompt.slice(0, 1000),
    assetName: normalizeAssetName(args.asset_name),
    assetType,
    target: String(args.target_description || '').slice(0, 300),
  }
}

/* ── 工具定义（OpenAI Function Calling 格式，硅基流动已验证兼容） ── */

export const AGENT_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: '在虚拟项目中创建一个文件，或完整覆写已存在的文件。新项目创建和大范围重写时使用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: ALLOWED_PATHS, description: '文件名，仅允许 index.html / style.css / app.js' },
          content: { type: 'string', description: '文件的完整内容（字符串）' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取虚拟项目中一个文件的当前完整内容。需要确认现状时使用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: ALLOWED_PATHS, description: '文件名' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_file',
      description:
        '对文件做局部修改：把 path 文件中唯一匹配的 old_str 替换为 new_str。old_str 必须与文件现有内容完全一致（含缩进），且在全文中只能出现一次。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: ALLOWED_PATHS, description: '文件名' },
          old_str: { type: 'string', description: '被替换的原文（必须与文件内容完全一致且唯一）' },
          new_str: { type: 'string', description: '替换后的新文本（可为空字符串表示删除该片段）' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: '全部文件已就绪后调用，标记任务完成并提交总结。必须在所有工作结束后调用。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '任务总结：2-3 句话说明实现了什么功能或修改了什么' },
        },
        required: ['summary'],
      },
    },
  },
]

/* ── 工具参数解析（arguments 必须是合法 JSON 对象字符串） ── */

function parseArgs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: 'ERROR: 参数为空（arguments 不是有效的 JSON 字符串）' }
  }
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: 'ERROR: 参数必须是一个 JSON 对象' }
    }
    return { value }
  } catch (e) {
    return {
      error: `ERROR: 参数不是合法 JSON（${e instanceof Error ? e.message : String(e)}）。若内容较长可能被截断，请重新提交完整参数`,
    }
  }
}

/* 校验 path 字段：必须是白名单内的字符串 */
function checkPath(args) {
  const p = args.path
  if (typeof p !== 'string' || !p.trim()) return { error: `ERROR: 缺少 path 参数（仅允许 ${ALLOWED_PATHS.join(' / ')}）` }
  const name = p.trim()
  if (!(name in PATH_TO_KEY)) {
    return { error: `ERROR: 文件 ${name} 不在允许列表中，仅允许 ${ALLOWED_PATHS.join(' / ')}` }
  }
  return { name, key: PATH_TO_KEY[name] }
}

/* 校验文件内容：非空字符串且不超大小上限 */
function checkContent(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return { error: 'ERROR: content 必须是非空字符串（文件内容不能为空）' }
  }
  if (content.length > MAX_FILE_SIZE) {
    return { error: `ERROR: 文件内容超过大小上限（${MAX_FILE_SIZE / 1024}KB），请精简后重试` }
  }
  return {}
}

/* 统计子串匹配次数（最多数到 2 即止） */
function countMatches(haystack, needle) {
  let count = 0
  let pos = haystack.indexOf(needle)
  while (pos !== -1) {
    count++
    if (count > 1) break
    pos = haystack.indexOf(needle, pos + needle.length)
  }
  return count
}

/* ── 请求级 VFS：工作副本 + 显式提交 ── */

/**
 * 创建一个请求级内存虚拟文件系统。
 * @param {{html?:string, css?:string, js?:string}} [initialFiles] 当前项目文件（多轮修改场景），缺省为空
 * @param {Array<{path:string, mime?:string, width?:number, height?:number, model?:string,
 *   type?:string, name?:string}>} [initialAssets] 历史图片素材元数据（多轮修改场景，
 *   仅元数据不含二进制：二进制始终保存在前端，避免大请求体；生成新图才产生新二进制）
 * @returns {{
 *   execute: (name:string, argsRaw:string) => {ok:boolean, text:string, finished?:boolean, summary?:string, fileEvent?:{path:string, size:number, content:string}},
 *   hasChanges: () => boolean,
 *   get updates(): number,
 *   addImageAsset: (path:string, info:{buffer:Buffer, mime:string, width?:number, height?:number, model?:string, type?:string, name?:string, sizeBytes?:number}) => {error?:string},
 *   listAssets: () => Array<{path:string, mime:string, width?:number, height?:number, model?:string, type?:string, name?:string}>,
 *   commit: () => {files:Object, assets:Array<{path:string, base64:string, mime:string, width?:number, height?:number, model?:string, type?:string, name?:string, sizeBytes?:number}>, updates:number},
 * }}
 */
export function createVfs(initialFiles, initialAssets) {
  const files = {
    html: typeof initialFiles?.html === 'string' ? initialFiles.html : '',
    css: typeof initialFiles?.css === 'string' ? initialFiles.css : '',
    js: typeof initialFiles?.js === 'string' ? initialFiles.js : '',
  }
  /* 图片素材：meta（历史元数据 + 新生成）/ buffers（新生成二进制，commit 时输出给前端） */
  const assetMeta = new Map()
  if (Array.isArray(initialAssets)) {
    for (const a of initialAssets) {
      if (a && typeof a.path === 'string' && ASSET_PATH_RE.test(a.path)) {
        assetMeta.set(a.path, {
          mime: typeof a.mime === 'string' ? a.mime : 'image/png',
          width: Number.isFinite(a.width) ? a.width : null,
          height: Number.isFinite(a.height) ? a.height : null,
          model: typeof a.model === 'string' ? a.model : '',
          type: typeof a.type === 'string' ? a.type : '',
          name: typeof a.name === 'string' ? a.name : '',
        })
      }
    }
  }
  const assetBuffers = new Map()
  let updates = 0

  function write(key, name, content) {
    files[key] = content
    updates++
    return { path: name, size: content.length, content }
  }

  return {
    get updates() {
      return updates
    },
    hasChanges() {
      return updates > 0
    },
    /* 新生成图片写入素材区（路径不合法 / 超数量上限时拒绝） */
    addImageAsset(path, info) {
      if (typeof path !== 'string' || !ASSET_PATH_RE.test(path)) {
        return { error: `ERROR: 素材路径不合法（${path}），必须形如 assets/<名称>.png|jpg|webp` }
      }
      if (!assetMeta.has(path) && assetMeta.size >= MAX_ASSET_COUNT) {
        return { error: `ERROR: 项目图片素材已达数量上限（${MAX_ASSET_COUNT} 张），请复用已有素材` }
      }
      assetMeta.set(path, {
        mime: info.mime || 'image/png',
        width: Number.isFinite(info.width) ? info.width : null,
        height: Number.isFinite(info.height) ? info.height : null,
        model: info.model || '',
        type: info.type || '',
        name: info.name || '',
      })
      assetBuffers.set(path, info.buffer)
      updates++
      return {}
    },
    /* 素材清单（提示词用：告知模型已有素材，避免重复生成） */
    listAssets() {
      return [...assetMeta.entries()].map(([path, m]) => ({ path, ...m }))
    },
    /* 只有成功路径（finish / 模型正常结束且已有修改）才会调用 commit */
    commit() {
      return {
        files: {
          'index.html': files.html,
          'style.css': files.css,
          'app.js': files.js,
        },
        /* 仅输出本次新生成的图片二进制（历史素材二进制由前端持有） */
        assets: [...assetBuffers.entries()].map(([path, buffer]) => ({
          path,
          base64: buffer.toString('base64'),
          mime: assetMeta.get(path)?.mime || 'image/png',
          width: assetMeta.get(path)?.width ?? null,
          height: assetMeta.get(path)?.height ?? null,
          model: assetMeta.get(path)?.model || '',
          type: assetMeta.get(path)?.type || '',
          name: assetMeta.get(path)?.name || '',
          sizeBytes: buffer.length,
        })),
        updates,
      }
    },
    /* 执行一个工具调用：结果文本直接作为 tool 消息返回给模型 */
    execute(name, argsRaw) {
      const parsed = parseArgs(argsRaw)
      if (parsed.error) return { ok: false, text: parsed.error }

      const args = parsed.value

      /* ---- finish：不触碰文件，仅标记完成 ---- */
      if (name === 'finish') {
        const summary = args.summary
        if (typeof summary !== 'string' || !summary.trim()) {
          return { ok: false, text: 'ERROR: finish 工具的 summary 必须是非空字符串' }
        }
        const trimmed = summary.trim().slice(0, 500)
        return { ok: true, text: `任务完成：${trimmed}`, finished: true, summary: trimmed }
      }

      /* ---- 其余三个工具都要求合法 path ---- */
      const pathInfo = checkPath(args)
      if (pathInfo.error) return { ok: false, text: pathInfo.error }
      const { name: fileName, key } = pathInfo

      /* ---- create_file：创建或完整覆写 ---- */
      if (name === 'create_file') {
        const checked = checkContent(args.content)
        if (checked.error) return { ok: false, text: checked.error }
        const existed = files[key].length > 0
        const fileEvent = write(key, fileName, args.content)
        return {
          ok: true,
          text: `已${existed ? '覆写' : '创建'} ${fileName}（${args.content.length} 字符）`,
          fileEvent,
        }
      }

      /* ---- read_file：读取当前内容 ---- */
      if (name === 'read_file') {
        if (!files[key]) {
          return { ok: true, text: `（文件 ${fileName} 当前为空，可使用 create_file 创建）` }
        }
        return { ok: true, text: files[key] }
      }

      /* ---- update_file：唯一匹配局部替换 ---- */
      if (name === 'update_file') {
        const oldStr = args.old_str
        const newStr = args.new_str
        if (typeof oldStr !== 'string' || oldStr.length === 0) {
          return { ok: false, text: 'ERROR: old_str 必须是非空字符串' }
        }
        if (typeof newStr !== 'string') {
          return { ok: false, text: 'ERROR: new_str 必须是字符串（可为空字符串表示删除片段）' }
        }
        if (oldStr === newStr) {
          return { ok: false, text: 'ERROR: old_str 与 new_str 相同，无需修改' }
        }
        if (!files[key]) {
          return { ok: false, text: `ERROR: 文件 ${fileName} 为空或不存在，请先使用 create_file 创建` }
        }
        const matches = countMatches(files[key], oldStr)
        if (matches === 0) {
          return {
            ok: false,
            text: `ERROR: old_str 在 ${fileName} 中未找到匹配。请先用 read_file 确认文件当前内容，再提供与原文完全一致（含缩进）的 old_str`,
          }
        }
        if (matches > 1) {
          return {
            ok: false,
            text: `ERROR: old_str 在 ${fileName} 中匹配到 ${matches} 处，不唯一。请扩大 old_str 范围（包含更多上下文）使其唯一匹配`,
          }
        }
        const next = files[key].replace(oldStr, newStr)
        if (!next.trim()) {
          return { ok: false, text: `ERROR: 替换后 ${fileName} 内容为空，不允许把文件清空` }
        }
        if (next.length > MAX_FILE_SIZE) {
          return { ok: false, text: `ERROR: 替换后文件超过大小上限（${MAX_FILE_SIZE / 1024}KB），请精简` }
        }
        return {
          ok: true,
          text: `已修改 ${fileName}：替换 1 处（${oldStr.length} 字符 → ${newStr.length} 字符），文件现为 ${next.length} 字符`,
          fileEvent: write(key, fileName, next),
        }
      }

      /* ---- 未知工具名 ---- */
      return {
        ok: false,
        text: `ERROR: 未知工具「${name}」，仅允许 create_file / read_file / update_file / finish`,
      }
    },
  }
}
