/* 零依赖 ZIP 打包（store 无压缩模式）
 * 生成标准 ZIP 结构：Local File Header + Central Directory + End Record
 * 文件名使用 UTF-8（EFS 标志位）
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * @param {{ name: string, content: string | Uint8Array }[]} entries 文本以字符串、二进制（图片等）以 Uint8Array 传入（store 方式无压缩，PNG/JPEG 已压缩适合 store）
 * @returns {Blob}
 */
export function createZip(entries) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  const DOS_DATE = 0x5c21 // 固定日期（2026-01-01）

  for (const entry of entries) {
    const localOffset = offset
    const nameBytes = enc.encode(entry.name)
    const dataBytes = typeof entry.content === 'string' ? enc.encode(entry.content) : entry.content
    const crc = crc32(dataBytes)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true) // PK\x03\x04
    local.setUint16(4, 20, true) // 版本
    local.setUint16(6, 0x0800, true) // UTF-8 文件名
    local.setUint16(8, 0, true) // store（无压缩）
    local.setUint16(10, 0, true) // 时间
    local.setUint16(12, DOS_DATE, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, dataBytes.length, true)
    local.setUint32(22, dataBytes.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), nameBytes, dataBytes)

    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true) // PK\x01\x02
    cd.setUint16(4, 20, true) // version made by
    cd.setUint16(6, 20, true) // version needed
    cd.setUint16(8, 0x0800, true) // UTF-8 文件名
    cd.setUint16(10, 0, true) // store（无压缩）
    cd.setUint16(12, 0, true) // 时间
    cd.setUint16(14, DOS_DATE, true) // 日期
    cd.setUint32(16, crc, true) // CRC-32
    cd.setUint32(20, dataBytes.length, true) // 压缩后大小
    cd.setUint32(24, dataBytes.length, true) // 原始大小
    cd.setUint16(28, nameBytes.length, true) // 文件名长度
    cd.setUint16(30, 0, true) // extra 长度
    cd.setUint16(32, 0, true) // 注释长度
    cd.setUint16(34, 0, true) // 起始磁盘号
    cd.setUint16(36, 0, true) // 内部属性
    cd.setUint32(38, 0, true) // 外部属性
    /* local header 偏移：Windows 资源管理器等严格解压器按中央目录偏移定位文件 */
    cd.setUint32(42, localOffset, true)
    central.push(new Uint8Array(cd.buffer), nameBytes)

    offset += 30 + nameBytes.length + dataBytes.length
  }

  const centralSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true) // PK\x05\x06
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: 'application/zip',
  })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
