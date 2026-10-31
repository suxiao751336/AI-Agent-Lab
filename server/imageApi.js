/* ============================================================
 * 硅基流动图像生成 API 封装（AI 视觉增强 · Agent 工具层后端）
 *
 * 职责：
 *  1. requestImageGeneration —— POST /v1/images/generations
 *     （Z-Image-Turbo：仅 model / prompt / image_size 基础字段，
 *      不携带 Kolors 专用 guidance_scale，不设置 X-Enable-Watermark，
 *      默认遵循平台水印规则）
 *  2. downloadImage —— 官方返回的图片 URL 仅 1 小时有效，必须立即下载
 *  3. analyzeImage —— magic bytes 实测格式 / 尺寸 / Alpha 通道（零依赖）
 *
 * 安全：
 *  · API Key 仅由调用方（agentLoop）从 process.env 传入，不进任何事件/日志
 *  · 图片来源仅为硅基流动响应中的 URL，不接受用户提供的任意 URL
 *  · 所有对外错误信息经调用方 sanitize 脱敏后再输出
 * ============================================================ */

export const IMAGE_API_URL = 'https://api.siliconflow.cn/v1/images/generations'
export const FALLBACK_IMAGE_MODEL = 'Tongyi-MAI/Z-Image-Turbo'
export const IMAGE_SIZE = '1024x1024' /* Z-Image-Turbo 支持的基础尺寸（阶段 0 已验证） */
export const IMAGE_TIMEOUT_MS = 120_000 /* 单次生图请求超时（独立于 LLM 单轮超时） */
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000 /* 图片下载超时 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 /* 单张图片大小上限 10MB */

/* 组合超时与外部取消（用户停止 Agent 时中止进行中的图像请求） */
function linkedController(signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/* ── 错误分类：DNS / 网络 / TLS / 超时 / 取消（与阶段 0 测试脚本同规则） ── */
const CODE_KINDS = [
  { kind: 'DNS 解析失败', codes: ['ENOTFOUND', 'EAI_AGAIN'] },
  {
    kind: '网络连接错误',
    codes: ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED'],
  },
]

function classifyNetworkError(err, signal) {
  if (signal?.aborted) return { kind: 'CANCELLED', message: '用户取消了任务，图像请求已中止' }
  if (err?.name === 'AbortError') return { kind: 'TIMEOUT', message: '图像请求超时' }
  const code = err?.cause?.code || err?.code || ''
  for (const g of CODE_KINDS) {
    if (g.codes.includes(code)) return { kind: 'NETWORK', message: `${g.kind}（code=${code}）` }
  }
  if (err instanceof TypeError) {
    return { kind: 'NETWORK', message: `网络层错误（未触达上游或请求被拒）${code ? ` code=${code}` : ''}` }
  }
  return { kind: 'NETWORK', message: err?.message || String(err) }
}

/**
 * 请求图像生成（单次请求，无重试 —— 禁止自动重试付费请求）
 * @returns {Promise<{ok:true, url:string, inference?:number, seed?:number} |
 *   {ok:false, kind:'HTTP'|'TIMEOUT'|'CANCELLED'|'NETWORK'|'BAD_RESPONSE', httpStatus?:number, message:string}>}
 */
export async function requestImageGeneration({ apiKey, model, prompt, signal, timeoutMs = IMAGE_TIMEOUT_MS }) {
  const link = linkedController(signal, timeoutMs)
  try {
    const resp = await fetch(IMAGE_API_URL, {
      method: 'POST',
      signal: link.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, prompt, image_size: IMAGE_SIZE }),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return {
        ok: false,
        kind: 'HTTP',
        httpStatus: resp.status,
        message: text.slice(0, 200) || `HTTP ${resp.status}`,
      }
    }
    const data = await resp.json().catch(() => null)
    const url = data?.images?.[0]?.url
    if (!url) {
      return { ok: false, kind: 'BAD_RESPONSE', message: '响应缺少 images[0].url' }
    }
    return { ok: true, url, inference: data?.timings?.inference, seed: data?.seed }
  } catch (err) {
    const classified = classifyNetworkError(err, signal)
    return { ok: false, kind: classified.kind, message: classified.message }
  } finally {
    link.done()
  }
}

/**
 * 立即下载生成的图片（官方 URL 仅 1 小时有效）
 * @returns {Promise<{ok:true, buffer:Buffer, contentType:string} | {ok:false, message:string}>}
 */
export async function downloadImage({ url, signal, timeoutMs = IMAGE_DOWNLOAD_TIMEOUT_MS }) {
  const link = linkedController(signal, timeoutMs)
  try {
    const resp = await fetch(url, { signal: link.signal })
    if (!resp.ok) {
      return { ok: false, message: `图片下载失败（HTTP ${resp.status}）` }
    }
    const buffer = Buffer.from(await resp.arrayBuffer())
    if (!buffer.length) {
      return { ok: false, message: '图片下载内容为空' }
    }
    return { ok: true, buffer, contentType: resp.headers.get('content-type') || '' }
  } catch (err) {
    const classified = classifyNetworkError(err, signal)
    return { ok: false, message: `图片下载失败（${classified.kind}）：${classified.message}` }
  } finally {
    link.done()
  }
}

/**
 * 图片二进制分析（magic bytes / 尺寸 / Alpha 通道，零依赖）
 * @returns {{format:string, ext:string, mime:string, width:number|null, height:number|null,
 *   alpha:boolean|null, alphaNote:string}}
 */
export function analyzeImage(buf) {
  /* PNG：签名 89 50 4E 47，IHDR 固定在偏移 16（宽 / 高各 4 字节大端，25 为 colorType） */
  if (buf.length > 26 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    const colorType = buf[25]
    const alpha = colorType === 6 || colorType === 4
    const colorLabel =
      { 0: '灰度', 2: 'RGB 真彩色', 3: '索引色', 4: '灰度+Alpha', 6: 'RGBA 真彩色' }[colorType] ?? `未知(${colorType})`
    return { format: 'PNG', ext: 'png', mime: 'image/png', width, height, alpha, alphaNote: `colorType=${colorType}（${colorLabel}）` }
  }
  /* JPEG：签名 FF D8 FF，逐段扫描 SOFn（C0-CF，跳过 C4/C8/CC）取尺寸；JPEG 无 Alpha */
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off += 1
        continue
      }
      const marker = buf[off + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2
        continue
      }
      const segLen = buf.readUInt16BE(off + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(off + 5)
        const width = buf.readUInt16BE(off + 7)
        return { format: 'JPEG', ext: 'jpg', mime: 'image/jpeg', width, height, alpha: false, alphaNote: 'JPEG 格式不支持 Alpha 通道' }
      }
      if (segLen < 2) break
      off += 2 + segLen
    }
    return { format: 'JPEG', ext: 'jpg', mime: 'image/jpeg', width: null, height: null, alpha: false, alphaNote: 'JPEG 格式不支持 Alpha 通道（未找到 SOF 段）' }
  }
  /* WebP：RIFF 容器，按首个 chunk 类型解析（VP8X / VP8L / VP8） */
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8X') {
      const flags = buf[20]
      const width = buf.readUIntLE(24, 3) + 1
      const height = buf.readUIntLE(27, 3) + 1
      const alpha = (flags & 0x10) !== 0
      return {
        format: 'WebP',
        ext: 'webp',
        mime: 'image/webp',
        width,
        height,
        alpha,
        alphaNote: `VP8X 扩展格式 flags=0x${flags.toString(16).padStart(2, '0')}（bit4=Alpha）`,
      }
    }
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21)
      const width = (bits & 0x3fff) + 1
      const height = ((bits >> 14) & 0x3fff) + 1
      const alpha = ((bits >> 28) & 1) === 1
      return { format: 'WebP', ext: 'webp', mime: 'image/webp', width, height, alpha, alphaNote: `VP8L 无损格式（alpha 位=${(bits >> 28) & 1}）` }
    }
    if (chunk === 'VP8') {
      const width = (buf.readUInt16LE(26) & 0x3fff) + 1
      const height = (((buf.readUInt16LE(26) >> 14) | (buf[28] << 2)) & 0x3fff) + 1
      return { format: 'WebP', ext: 'webp', mime: 'image/webp', width, height, alpha: false, alphaNote: 'VP8 有损格式（裸 chunk 不含 Alpha）' }
    }
    return { format: 'WebP', ext: 'webp', mime: 'image/webp', width: null, height: null, alpha: null, alphaNote: `未知 chunk：${chunk}` }
  }
  return {
    format: '未知',
    ext: 'bin',
    mime: '',
    width: null,
    height: null,
    alpha: null,
    alphaNote: `magic bytes 无法识别（前 16 字节 hex：${buf.subarray(0, 16).toString('hex')}）`,
  }
}
