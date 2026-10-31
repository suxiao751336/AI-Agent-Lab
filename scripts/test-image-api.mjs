/* ============================================================
 * 硅基流动图像生成 API 连通性测试（AI 视觉增强 · 阶段 0 · 单次请求 · 无重试）
 *
 * 用法：
 *   npm run test:image        （Windows 下：npm.cmd run test:image）
 *   直接调用：node scripts/test-image-api.mjs
 *
 * 验证目标：
 *   POST https://api.siliconflow.cn/v1/images/generations
 *   模型 Tongyi-MAI/Z-Image-Turbo（.env 可用 SILICONFLOW_IMAGE_MODEL 覆盖）
 *   请求体仅 model / prompt / image_size（Z-Image-Turbo 支持的基础字段；
 *   不携带 Kolors 专用的 guidance_scale，不设置 X-Enable-Watermark 头，
 *   默认遵循平台水印规则）
 *
 * 输出：请求耗时、HTTP 状态、timings.inference、seed、图片实际格式（magic bytes
 *   实测 + Content-Type 交叉验证）、尺寸、文件大小、是否含 Alpha 透明通道。
 *   官方返回的图片 URL 仅 1 小时有效，本脚本立即下载保存到
 *   scripts/image-test-output/ 目录。
 *
 * 安全：仅从 .env / 环境变量读取配置，不打印 API Key / Authorization 头；
 *   不修改任何业务代码（React 页面 / Agent Loop / 素材库 / 手机预览 / ZIP 导出均不触碰）。
 * ============================================================ */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'image-test-output')

const API_URL = 'https://api.siliconflow.cn/v1/images/generations'
const FALLBACK_IMAGE_MODEL = 'Tongyi-MAI/Z-Image-Turbo'
const TIMEOUT_MS = 120_000
const IMAGE_SIZE = '1024x1024'

const TEST_PROMPT =
  'A premium glossy sapphire-blue crystal water droplet button asset for a mobile water tracking app, centered composition, elegant 3D rendering, soft highlights, no text, clean background.'

/* ---------- .env 解析（与 server/llmApi.js 同规则：已有环境变量优先，不覆盖） ---------- */
function readEnvFile(root) {
  const map = {}
  let raw = ''
  try {
    raw = readFileSync(join(root, '.env'), 'utf8')
  } catch {
    return map
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    map[m[1]] = val
  }
  return map
}

const envFile = readEnvFile(ROOT)
const API_KEY = process.env.SILICONFLOW_API_KEY || envFile.SILICONFLOW_API_KEY || ''
const IMAGE_MODEL =
  process.env.SILICONFLOW_IMAGE_MODEL || envFile.SILICONFLOW_IMAGE_MODEL || FALLBACK_IMAGE_MODEL

/* ---------- 脱敏（防御性兜底：任何错误输出前替换可能出现的密钥形态） ---------- */
function sanitize(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-****')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ****')
}

function brief(text, n = 300) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/* ---------- 错误分类：DNS / 网络连接 / TLS / 超时 ---------- */
const CODE_KINDS = [
  { kind: 'DNS 解析失败', codes: ['ENOTFOUND', 'EAI_AGAIN'] },
  {
    kind: '网络连接错误',
    codes: ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED'],
  },
  {
    kind: 'TLS 证书错误',
    codes: [
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'ERR_SSL_WRONG_VERSION_NUMBER',
    ],
  },
]

function classifyFetchError(err) {
  const code = err?.cause?.code || err?.code || ''
  if (err?.name === 'AbortError' || code === 'ABORT_ERR') {
    return { kind: '请求超时（TIMEOUT）', code: 'ABORT_ERR' }
  }
  for (const group of CODE_KINDS) {
    if (group.codes.includes(code)) return { kind: group.kind, code }
  }
  if (err instanceof TypeError) {
    return { kind: '网络层错误（fetch TypeError，未触达上游或请求被拒）', code: code || '-' }
  }
  return { kind: '未知错误', code: code || '-' }
}

const HTTP_HINTS = {
  400: '请求参数不合法（检查 image_size 是否为该模型支持的取值）',
  401: 'API Key 无效或未授权',
  402: '余额/额度不足',
  403: '权限不足或 Key 无权访问该模型',
  404: '模型不存在（检查 SILICONFLOW_IMAGE_MODEL）',
  429: '请求频率限制',
}

/* ---------- 图片二进制分析（magic bytes / 尺寸 / Alpha 通道，零依赖） ---------- */
function analyzeImage(buf) {
  /* PNG：签名 89 50 4E 47，IHDR 固定在偏移 16（宽 / 高各 4 字节大端，25 为 colorType） */
  if (buf.length > 26 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    const colorType = buf[25]
    const alpha = colorType === 6 || colorType === 4
    const colorLabel =
      { 0: '灰度', 2: 'RGB 真彩色', 3: '索引色', 4: '灰度+Alpha', 6: 'RGBA 真彩色' }[colorType] ?? `未知(${colorType})`
    return { format: 'PNG', ext: 'png', width, height, alpha, alphaNote: `colorType=${colorType}（${colorLabel}）` }
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
        return { format: 'JPEG', ext: 'jpg', width, height, alpha: false, alphaNote: 'JPEG 格式不支持 Alpha 通道' }
      }
      if (segLen < 2) break
      off += 2 + segLen
    }
    return { format: 'JPEG', ext: 'jpg', width: null, height: null, alpha: false, alphaNote: 'JPEG 格式不支持 Alpha 通道（未找到 SOF 段，尺寸解析失败）' }
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
      return { format: 'WebP', ext: 'webp', width, height, alpha, alphaNote: `VP8L 无损格式（alpha 位=${(bits >> 28) & 1}）` }
    }
    if (chunk === 'VP8') {
      const width = (buf.readUInt16LE(26) & 0x3fff) + 1
      const height = (((buf.readUInt16LE(26) >> 14) | (buf[28] << 2)) & 0x3fff) + 1
      return { format: 'WebP', ext: 'webp', width, height, alpha: false, alphaNote: 'VP8 有损格式（裸 chunk 不含 Alpha）' }
    }
    return { format: 'WebP', ext: 'webp', width: null, height: null, alpha: null, alphaNote: `未知 chunk：${chunk}` }
  }
  return {
    format: '未知',
    ext: 'bin',
    width: null,
    height: null,
    alpha: null,
    alphaNote: `magic bytes 无法识别（前 16 字节 hex：${buf.subarray(0, 16).toString('hex')}）`,
  }
}

/* ---------- 主流程 ---------- */

console.log('── 硅基流动图像生成 API 连通性测试（AI 视觉增强 · 阶段 0）──')
console.log(`模型：${IMAGE_MODEL}${IMAGE_MODEL === FALLBACK_IMAGE_MODEL ? '（默认值）' : '（.env SILICONFLOW_IMAGE_MODEL）'}`)
console.log(`API Key：${API_KEY ? `已配置（长度 ${API_KEY.length}）` : '❌ 未配置'}`)
console.log(`image_size：${IMAGE_SIZE} · 请求超时：${TIMEOUT_MS / 1000}s · 水印：遵循平台默认（未设置 X-Enable-Watermark）`)
console.log(`Node：${process.version}`)

if (!API_KEY) {
  console.error('❌ 请先在项目根目录 .env 填入 SILICONFLOW_API_KEY（与 LLM 共用同一 Key，测试不发请求）')
  process.exit(1)
}

/* [1/2] 生成请求 */
console.log('\n[1/2] 请求 POST /v1/images/generations ...')
const t0 = Date.now()
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

try {
  const resp = await fetch(API_URL, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: TEST_PROMPT, image_size: IMAGE_SIZE }),
  })
  const requestMs = Date.now() - t0

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '')
    console.error(`❌ HTTP ${resp.status} · 请求耗时 ${requestMs}ms · ${HTTP_HINTS[resp.status] || '未分类错误'}`)
    console.error(`响应体（脱敏摘要）：${sanitize(brief(bodyText))}`)
    process.exit(1)
  }

  const data = await resp.json()
  const imageUrl = data?.images?.[0]?.url
  console.log(`✅ HTTP ${resp.status} · 请求耗时 ${requestMs}ms`)
  console.log(`推理耗时 timings.inference=${data?.timings?.inference ?? '未返回'}s · seed=${data?.seed ?? '未返回'}`)
  if (!imageUrl) {
    console.error(`❌ 响应结构异常：缺少 images[0].url。响应体（脱敏摘要）：${sanitize(brief(JSON.stringify(data)))}`)
    process.exit(1)
  }

  /* [2/2] 立即下载（官方 URL 仅 1 小时有效） */
  console.log('\n[2/2] 下载图片（官方 URL 仅 1 小时有效，立即保存本地）...')
  const t1 = Date.now()
  const imgResp = await fetch(imageUrl)
  if (!imgResp.ok) {
    console.error(`❌ 图片下载失败：HTTP ${imgResp.status}`)
    process.exit(1)
  }
  const imgBuf = Buffer.from(await imgResp.arrayBuffer())
  const downloadMs = Date.now() - t1
  const contentType = imgResp.headers.get('content-type') || '未返回'

  /* 二进制分析 + 落盘 */
  const info = analyzeImage(imgBuf)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const fileName = `z-image-test_${stamp}.${info.ext}`
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const savePath = join(OUTPUT_DIR, fileName)
  writeFileSync(savePath, imgBuf)

  console.log(`✅ 下载完成 · 耗时 ${downloadMs}ms · 文件大小 ${(imgBuf.length / 1024).toFixed(1)} KB`)
  console.log(`实际格式：${info.format}（magic bytes 实测 · HTTP Content-Type: ${contentType} 交叉验证）`)
  console.log(`尺寸：${info.width && info.height ? `${info.width}×${info.height}` : '解析失败'}`)
  console.log(
    `Alpha 透明通道：${info.alpha === null ? '未知' : info.alpha ? '有（含透明通道）' : '无（不透明）'} · ${info.alphaNote}`,
  )
  console.log(`已保存：scripts/image-test-output/${fileName}`)
  console.log('\n✅ 图像生成 API 连通性测试通过（单次请求 · 无重试）')
} catch (err) {
  const classified = classifyFetchError(err)
  console.error(`❌ 请求异常 · ${classified.kind} · code=${classified.code} · 耗时 ${Date.now() - t0}ms`)
  console.error(`错误信息（脱敏）：${sanitize(brief(err?.message || String(err)))}`)
  process.exit(1)
} finally {
  clearTimeout(timer)
}
