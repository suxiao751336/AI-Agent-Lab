/* ============================================================
 * 环境自检脚本（npm run check:env）
 * 验证服务端能否正确读取 .env 配置。
 * 不发起任何网络请求、不调用模型、不打印 Key 内容（仅长度）。
 * ============================================================ */

import { loadEnvFile } from '../server/llmApi.js'

console.log('── 服务端环境自检 ──')
console.log(`Node 版本：${process.version}${Number(process.versions.node.split('.')[0]) >= 18 ? '（支持全局 fetch）' : '（⚠️ 需要 Node 18+）'}`)

await loadEnvFile(process.cwd())

const key = process.env.SILICONFLOW_API_KEY
const model = process.env.SILICONFLOW_MODEL || 'moonshotai/Kimi-K2.7-Code'
const navModel = process.env.NAVIGATOR_MODEL || 'deepseek-ai/DeepSeek-V4-Flash'

console.log(`.env 解析：${key !== undefined ? '成功' : '未找到（文件缺失或无该变量）'}`)
console.log(`SILICONFLOW_API_KEY：${key ? `已配置（长度 ${key.length}）` : '❌ 未配置'}`)
console.log(`SILICONFLOW_MODEL：${model}`)
console.log(`NAVIGATOR_MODEL：${navModel}${process.env.NAVIGATOR_MODEL ? '' : '（未配置，使用默认值）'}`)

if (key && key.length < 20) {
  console.log('⚠️ Key 长度异常偏短，请确认复制完整')
}
console.log(
  key
    ? '✅ 服务端已就绪：npm run dev 启动后，前端「真实模型」引擎即可经 /api/llm/generate 调用 Kimi K2.7 Code'
    : '❌ 请在项目根目录 .env 填入 SILICONFLOW_API_KEY 后重试',
)
 