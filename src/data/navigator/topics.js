/* ============================================================
 * Conversation Navigator Agent · 话题目录（本地演示数据）
 * ------------------------------------------------------------
 * 每个话题通过 messageIds 与 conversation.js 中的消息建立真实映射：
 * 点击话题 => 定位到 messageIds[0] 对应的消息。
 * 一级主题的 messageIds 覆盖其全部子主题范围。
 *
 * 未来接入真实 LLM 后，仅需用模型输出替换本数据结构
 * （保持 topicId / messageIds 字段契约），UI 无需重写。
 * ============================================================ */

const pad = (n) => String(n).padStart(3, '0')

function range(start, end) {
  const out = []
  for (let i = parseInt(start.slice(1), 10); i <= parseInt(end.slice(1), 10); i++) {
    out.push(`m${pad(i)}`)
  }
  return out
}

export const TOPICS = [
  {
    id: 't1',
    title: '需求分析与产品定位',
    desc: '目标用户、核心痛点与差异化方向',
    messageIds: range('m001', 'm010'),
    children: [
      {
        id: 't1-1',
        title: '用户画像梳理',
        desc: '自由行爱好者的规划痛点',
        messageIds: range('m001', 'm008'),
      },
      {
        id: 't1-2',
        title: '差异化定位',
        desc: '「AI 起草，你来微调」的工作台',
        messageIds: range('m009', 'm010'),
      },
    ],
  },
  {
    id: 't2',
    title: '产品功能规划',
    desc: '功能优先级评分与 MVP 范围界定',
    messageIds: range('m011', 'm020'),
    children: [
      {
        id: 't2-1',
        title: '功能优先级排序',
        desc: '优先级评分图表与长图降级决策',
        messageIds: range('m011', 'm014'),
      },
      {
        id: 't2-2',
        title: '数据结构初探',
        desc: 'Itinerary 三层数据结构起草',
        messageIds: range('m015', 'm020'),
      },
    ],
  },
  {
    id: 't3',
    title: 'UI 设计讨论',
    desc: '海洋清新风、水滴 Logo 与页面结构',
    messageIds: range('m021', 'm040'),
    children: [
      {
        id: 't3-1',
        title: '配色与品牌视觉',
        desc: '蓝色水滴 Logo、Hero 插画',
        messageIds: range('m021', 'm028'),
      },
      {
        id: 't3-2',
        title: '页面结构与设计规范',
        desc: '首页设计稿、五 Tab、图标规范',
        messageIds: range('m029', 'm040'),
      },
    ],
  },
  {
    id: 't4',
    title: '技术方案比较',
    desc: '框架、地图、存储与模型选型',
    messageIds: range('m041', 'm056'),
    children: [
      {
        id: 't4-1',
        title: '前端与地图选型',
        desc: 'React + 高德 JS API',
        messageIds: range('m041', 'm046'),
      },
      {
        id: 't4-2',
        title: '模型选型与整体架构',
        desc: '混合调度与服务层代理架构',
        messageIds: range('m047', 'm056'),
      },
    ],
  },
  {
    id: 't5',
    title: '核心功能代码实现',
    desc: '编辑器、地图、模型调用与预算',
    messageIds: range('m057', 'm072'),
    children: [
      {
        id: 't5-1',
        title: '行程编辑器与地图',
        desc: '三层组件与按天连线',
        messageIds: range('m057', 'm064'),
      },
      {
        id: 't5-2',
        title: '模型调用与配置',
        desc: '超时封装、预算结构、构建配置',
        messageIds: range('m065', 'm072'),
      },
    ],
  },
  {
    id: 't6',
    title: 'Bug 排查与性能优化',
    desc: '日期边界、渲染性能与模型超时',
    messageIds: range('m073', 'm084'),
    children: [
      {
        id: 't6-1',
        title: '行程日期计算 Bug',
        desc: '跨月多算一天的边界修复',
        messageIds: range('m073', 'm076'),
      },
      {
        id: 't6-2',
        title: '性能与模型超时',
        desc: '列表卡顿优化、15s 超时方案',
        messageIds: range('m077', 'm084'),
      },
    ],
  },
  {
    id: 't7',
    title: '预算与成本',
    desc: '运行成本、模型选型与月度预算',
    messageIds: range('m085', 'm090'),
    children: [
      {
        id: 't7-1',
        title: '成本构成与模型成本优化',
        desc: '混合调度压降 62% → 26%',
        messageIds: range('m085', 'm088'),
      },
      {
        id: 't7-2',
        title: '月度预算规划',
        desc: 'MAU 200 约 ¥94/月',
        messageIds: range('m089', 'm090'),
      },
    ],
  },
  {
    id: 't8',
    title: '总结与展望',
    desc: '六天开发成果与遗留事项',
    messageIds: range('m091', 'm092'),
    children: [],
  },
]
