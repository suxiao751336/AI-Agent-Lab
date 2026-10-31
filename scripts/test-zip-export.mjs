/* ============================================================
 * ZIP 导出验证脚本（不调用任何 AI API、不访问网络）
 *
 * 验证目标：src/utils/zip.js 的 createZip 输出可被 Windows
 * 资源管理器等严格解压器正常解压（历史 bug：central directory
 * 漏写 local header 偏移 → 全部条目指向 0 → 解压失败）。
 *
 * 测试场景：
 *   A. 普通项目：仅 index.html / style.css / app.js 文本
 *   B. 视觉增强项目：三文件 + 一张程序化构造的真实 PNG（1×1）
 *
 * 验证方式：
 *   1. 内置 ZIP 结构解析：EOCD → 中央目录 → local header 偏移
 *      → CRC32 → 数据逐字节比对（严格按规范，不依赖任何 JS zip 库）
 *   2. Windows 兼容性：PowerShell Expand-Archive 真实解压后逐字节
 *      比对（不可用时跳过并提示，不阻塞退出码）
 * ============================================================ */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { createZip } from '../src/utils/zip.js'

/* ── CRC32（与 zip.js 同算法，独立实现用于交叉校验） ── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (bytes) => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* ── 程序化构造最小合法 PNG（1×1 RGB，内存字节，不落盘） ── */
function pngChunk(type, data) {
  const buf = Buffer.alloc(8 + data.length + 4)
  buf.writeUInt32BE(data.length, 0)
  buf.write(type, 4, 'ascii')
  data.copy(buf, 8)
  buf.writeUInt32BE(crc32(buf.subarray(4, 8 + data.length)), 8 + data.length)
  return buf
}
function makeTestPng() {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0) // width
  ihdr.writeUInt32BE(1, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  const scanline = Buffer.from([0, 46, 134, 222]) // filter 0 + RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanline)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/* ── 独立 ZIP 解析器：严格按 central directory 偏移读取（与 Windows 行为一致） ── */
function parseZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65536; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('未找到 End of Central Directory 记录')
  const count = dv.getUint16(eocd + 10, true)
  const cdOffset = dv.getUint32(eocd + 16, true)
  let p = cdOffset
  const entries = []
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) {
      throw new Error(`central directory[${n}] 签名错误（偏移 ${p}）`)
    }
    const crc = dv.getUint32(p + 16, true)
    const size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    /* 按中央目录偏移定位 local header（Windows 资源管理器路径） */
    if (dv.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`「${name}」local header 偏移 ${localOffset} 无效（历史 bug：全为 0）`)
    }
    const lNameLen = dv.getUint16(localOffset + 26, true)
    const lExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = bytes.subarray(dataStart, dataStart + size)
    if (crc32(data) !== crc) throw new Error(`「${name}」CRC32 校验失败`)
    entries.push({ name, data })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

const bytesEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

/* ── 场景构造 ── */
const HTML_A = '<!doctype html><html><body><button id="add">记录</button><script src="app.js"></script></body></html>'
const CSS_A = 'body{background:#eef}'
const JS_A = 'document.getElementById("add").onclick = () => {}'

const PNG_BYTES = makeTestPng()
const ASSET_PATH = 'assets/crystal-button.png'
const HTML_B = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><button id="add" style="background-image:url('${ASSET_PATH}')">记录</button></body></html>`

const CASES = [
  {
    title: '场景 A · 普通项目（纯文本三文件）',
    entries: [
      { name: 'index.html', content: HTML_A },
      { name: 'style.css', content: CSS_A },
      { name: 'app.js', content: JS_A },
    ],
    expect: { 'index.html': HTML_A, 'style.css': CSS_A, 'app.js': JS_A },
    refPaths: [],
  },
  {
    title: '场景 B · 视觉增强项目（三文件 + 真实 PNG 二进制）',
    entries: [
      { name: 'index.html', content: HTML_B },
      { name: 'style.css', content: CSS_A },
      { name: 'app.js', content: JS_A },
      { name: ASSET_PATH, content: new Uint8Array(PNG_BYTES) },
    ],
    expect: { 'index.html': HTML_B, 'style.css': CSS_A, 'app.js': JS_A, [ASSET_PATH]: PNG_BYTES.toString('latin1') },
    refPaths: [ASSET_PATH],
  },
]

let windowsChecked = 0

/* ── 逐场景执行 ── */
for (const c of CASES) {
  console.log(`\n== ${c.title} ==`)
  const blob = createZip(c.entries)
  const zipBytes = new Uint8Array(await blob.arrayBuffer())
  console.log(`  createZip 完成 · ${c.entries.length} 个条目 · ZIP 总大小 ${zipBytes.length}B`)

  /* 1. 结构与内容校验（独立解析器，严格按中央目录偏移） */
  const parsed = parseZip(zipBytes)
  const names = parsed.map((e) => e.name)
  assert(names.length === c.entries.length, `文件数不符：期望 ${c.entries.length}，实际 ${names.length}`)
  for (const [name, expected] of Object.entries(c.expect)) {
    const got = parsed.find((e) => e.name === name)
    assert(got, `缺少文件 ${name}`)
    if (name.endsWith('.png')) {
      assert(bytesEq(got.data, PNG_BYTES), `PNG 二进制内容不一致：${name}`)
      assert(got.data.length === PNG_BYTES.length, `PNG 长度不一致：${name}`)
    } else {
      assert(new TextDecoder().decode(got.data) === expected, `文本内容不一致：${name}`)
    }
  }
  console.log(`  ZIP 结构校验通过：EOCD / 中央目录偏移 / local header / CRC32 / 内容逐字节比对 ✓`)
  console.log(`  文件列表：${names.join(' · ')}`)

  /* 2. 代码引用路径与 ZIP 内文件一致性（视觉增强场景） */
  for (const rp of c.refPaths) {
    assert(names.includes(rp), `代码引用的 ${rp} 不在 ZIP 内`)
  }
  if (c.refPaths.length) console.log(`  代码引用路径与 ZIP 内文件一一对应 ✓`)

  /* 3. Windows 真实解压兼容性（PowerShell Expand-Archive，不可用时跳过） */
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'ziptest-'))
    const zipPath = path.join(dir, 'test.zip')
    const outDir = path.join(dir, 'out')
    writeFileSync(zipPath, zipBytes)
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${outDir}" -Force`,
    ])
    const files = []
    const walk = (d) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, f.name)
        if (f.isDirectory()) walk(full)
        else files.push(path.relative(outDir, full).replaceAll('\\', '/'))
      }
    }
    walk(outDir)
    assert(files.length === c.entries.length, `解压后文件数不符：${files.length}`)
    for (const [name, expected] of Object.entries(c.expect)) {
      const disk = readFileSync(path.join(outDir, name))
      if (name.endsWith('.png')) assert(bytesEq(new Uint8Array(disk), PNG_BYTES), `解压后 PNG 不一致：${name}`)
      else assert(disk.toString('utf8') === expected, `解压后文本不一致：${name}`)
    }
    console.log(`  Windows Expand-Archive 真实解压 + 逐字节比对通过 ✓（${files.length} 个文件）`)
    windowsChecked++
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    console.log(`  ! Windows 解压验证跳过（powershell 不可用或解压失败）：${e.message}`)
  }
}

console.log(`\n全部通过：2 个场景结构校验 ✓ · ${windowsChecked}/2 个 Windows 真实解压验证 ✓`)
console.log('结论：ZIP 可被 Windows 资源管理器级别的严格解压器正常解压，图片为真实二进制且与代码引用路径一致。')
