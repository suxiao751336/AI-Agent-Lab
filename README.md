# AI Agent Lab

字节跳动面试作业 · AI Agent 方向。包含两个可交互的 Agent Demo，均接入真实大模型（无 Mock、无预置模板），展示多模态代码生成与长对话智能导航两类 Agent 能力。

## 两个 Agent

### 1. Vibe Coding Agent｜移动端代码生成 + AI 视觉增强

通过自然语言生成完整移动端应用，并可选调用 AI 生图能力产出视觉素材。

- **真实代码生成**：基于 Kimi K2.7 Code（硅基流动）的 Function Calling + Agent Loop，多轮工具调用自主写入 `index.html` / `style.css` / `app.js` 三个文件，产出真实可运行的工程代码
- **手机模拟器沙箱**：iframe `sandbox="allow-scripts"` 隔离预览，生成的代码仅作用于模拟器内部，原生弹窗无法逃逸
- **AI 视觉增强（可关闭）**：Z-Image-Turbo 生成按钮 / 背景 / 插画素材，生成后立即下载为项目本地素材（不依赖 1 小时有效期的外链），并打包进 ZIP 导出
- **多轮增量修改**：携带现有代码继续对话修改，支持任意自然语言需求
- **SSE 调试控制台**：服务端执行事件（轮次、工具调用、流式进度）实时推送，全部经脱敏处理
- **ZIP 一键导出**：解压后无需外部依赖即可直接运行

### 2. Conversation Navigator Agent｜长对话整理与回溯

自动整理长篇 AI 对话，生成话题目录并支持语义回溯定位。

- **三级树结构**：会话 → 话题 → 子话题，基于 `conversationId` / `topicId` / `messageId` 真实映射，点击目录精准跳转并高亮原始消息
- **智能目录生成**：DeepSeek-V4-Flash 分析全量消息自动生成话题树（SSE 阶段流，非模拟进度）
- **增量维护**：新消息追加后局部刷新目录，无需全量重新分析
- **语义搜索**：模糊描述（如"讨论预算的那段"）定位历史消息
- **应用内 AI 对话**：流式问答，逐字显示，支持停止生成
- **本地持久化**：用户会话存于 localStorage；内置 TravelMate 示例（92 条消息）与用户数据分离

## 技术架构

- **前端**：React 19 + Vite 8 + Tailwind CSS 4，oxlint 检查
- **后端**：Vite dev server 中间件（[server/devServer.js](server/devServer.js)），Node 原生实现，零额外后端依赖，`npm run dev` 一条命令同时启动前端与 API
- **通信**：REST + SSE（实时日志流 / 阶段事件流）
- **模型**（均经硅基流动 SiliconFlow）：

| 模型 | 用途 |
|---|---|
| `moonshotai/Kimi-K2.7-Code` | Vibe Coding 代码生成（流式 Function Calling） |
| `deepseek-ai/DeepSeek-V4-Flash` | Navigator 目录生成 / 增量维护 / 搜索 / 对话 |
| `Tongyi-MAI/Z-Image-Turbo` | AI 视觉增强生图 |

### Agent Loop 执行护栏

| 项 | 值 |
|---|---|
| 最大模型轮次 | 12 轮 |
| 任务总时长上限 | 600 秒 |
| 单轮硬超时 | 240 秒 |
| 无进度超时（无流式数据） | 60 秒 |
| 单任务生图上限 | 2 张（成本护栏，禁止自动重试付费请求） |
| 用户取消 | 连接断开即时中止上游请求 |
| 任务失败 | 保留当前项目文件，不覆盖已有代码 |

### API 一览

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/llm/generate` | 单轮代码生成（旧接口，保留兼容） |
| POST | `/api/llm/agent` | Vibe Coding Agent Loop |
| GET | `/api/llm/events` | SSE 实时执行日志（脱敏） |
| POST | `/api/navigator/generate-topics` | 话题目录生成（SSE 阶段流） |
| POST | `/api/navigator/maintain-topics` | 目录增量维护 |
| POST | `/api/navigator/search` | 语义搜索 |
| POST | `/api/navigator/chat` | 应用内 AI 对话（流式） |

### 安全设计

- API Key 仅存于服务端 `.env` / 环境变量，经 `process.env` 读取，不进入前端与任何响应
- 服务端日志与 SSE 事件经 `sanitize()` 脱敏（抹除 Bearer / Key 值）
- Agent 工具仅能写入 `index.html` / `style.css` / `app.js` 三个文件，无法访问真实文件系统与服务器环境变量

## 本地运行

要求 Node ≥ 20.19（Vite 8 要求）。

```bash
npm install
cp .env.example .env    # 填入 SILICONFLOW_API_KEY
npm run dev
```

打开 http://localhost:5173 。后端 API 由 Vite 中间件提供，无需单独启动服务。

其他命令：

```bash
npm run build      # 生产构建
npm run lint       # oxlint 检查
npm run check:env  # 校验 .env 配置（不发请求）
```

`scripts/` 下提供可选的模型连通性测试脚本（`npm run test:llm` 等）。注意：这些脚本会发起真实付费 API 调用，请按需使用。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SILICONFLOW_API_KEY` | 是 | 硅基流动 API Key，两个 Agent 共用，仅服务端读取 |
| `SILICONFLOW_MODEL` | 否 | Vibe Coding 代码模型，默认 `moonshotai/Kimi-K2.7-Code` |
| `SILICONFLOW_IMAGE_MODEL` | 否 | 视觉增强图像模型，默认 `Tongyi-MAI/Z-Image-Turbo` |
| `NAVIGATOR_MODEL` | 否 | Navigator 对话模型，默认 `deepseek-ai/DeepSeek-V4-Flash` |

获取 API Key：https://cloud.siliconflow.cn

## 演示视频

两个 Agent 的实际运行演示已录制，视频将随面试作业邮件单独提供，GitHub 仓库仅包含项目源码和运行说明。

## 已知限制

- 页面无路由持久化：浏览器标签页被系统回收（Chrome 内存节省等）后整页刷新会回到首页，React 状态重置，该场景无法完全拦截
- 视觉增强生成的图片保留平台默认水印；Z-Image-Turbo 输出的 PNG 可能含不透明背景，未做抠图处理
- 图像 API 外链仅 1 小时有效期，已在生成后立即下载为本地素材规避
- Navigator 用户会话存于 localStorage，清除浏览器数据会丢失（内置 TravelMate 示例不受影响）
- 长代码生成依赖上游模型稳定性，连续 60 秒无流式数据会触发无进度超时终止
- 服务端为 Vite dev 中间件形态，面向本地演示，未做生产部署的多实例 / 鉴权设计

## 目录结构

```
├── index.html / vite.config.js / package.json
├── server/        # 后端逻辑（Vite 中间件）
│   ├── devServer.js              # 路由挂载 + SSE 广播
│   ├── agentLoop.js / agentTools.js  # Vibe Agent Loop 与文件工具
│   ├── llmApi.js / imageApi.js   # 模型与图像 API 封装
│   └── navigator*.js             # Navigator 目录/搜索/对话/增量维护
├── src/
│   ├── components/vibe/          # Vibe Coding Agent UI
│   ├── components/navigator/     # Conversation Navigator UI
│   ├── services/                 # 前端 API 服务
│   └── data/                     # 示例数据与项目模板
├── scripts/       # 可选连通性测试脚本（付费调用）
└── public/        # 静态资源
```
