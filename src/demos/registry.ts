/**
 * demos/registry.ts —— 所有阶段的元信息(导航、路由、标题共用一份数据源)
 */

export interface DemoMeta {
  id: string; // 路由 path
  order: number;
  title: string;
  subtitle: string; // 一句话说明本阶段新增了什么
  concept: string; // 核心概念标签
}

export const DEMOS: DemoMeta[] = [
  {
    id: 'config',
    order: 0,
    title: '模型配置中心',
    subtitle: '第一道坎:请求发去哪、怎么鉴权、用哪个模型',
    concept: 'baseURL / 鉴权 / 多模型',
  },
  {
    id: 'one-call',
    order: 1,
    title: '一行调用',
    subtitle: '剥开 SDK:调大模型本质就是一个 fetch POST',
    concept: '请求体 / 响应体',
  },
  {
    id: 'chat',
    order: 2,
    title: '会聊天(流式)',
    subtitle: '手写 SSE 解析,实现打字机效果',
    concept: 'SSE / ReadableStream',
  },
  {
    id: 'memory',
    order: 3,
    title: '有记忆',
    subtitle: '从"记忆"理解上下文:模型每次能看到的全部信息',
    concept: '上下文 / 上下文窗口',
  },
  {
    id: 'tools',
    order: 4,
    title: '会用工具',
    subtitle: 'Tool Calling 协议:模型只"请求",执行在你这',
    concept: 'Tool Calling',
  },
  {
    id: 'agent-loop',
    order: 5,
    title: '会思考(Agent 循环)',
    subtitle: 'ReAct:思考→行动→观察→循环,Agent 的分界线',
    concept: 'ReAct Loop',
  },
  {
    id: 'multi-tool',
    order: 6,
    title: '多工具编排',
    subtitle: '模型如何自己排出调用顺序、串起多步任务',
    concept: '工具编排 / 依赖',
  },
  {
    id: 'structured',
    order: 7,
    title: '可靠性:让每一步都不掉链子',
    subtitle: '模型是概率的,靠解析容错+重试+超时兜底',
    concept: '结构化输出 / 可靠性',
  },
  {
    id: 'multi-model',
    order: 8,
    title: '多模型兼容',
    subtitle: '不同厂商 API 差异,用适配层统一',
    concept: 'Adapter 模式',
  },
  {
    id: 'rag',
    order: 9,
    title: 'RAG:让模型用上私有知识',
    subtitle: '检索增强生成:切分→检索→增强→生成',
    concept: 'RAG / 检索增强',
  },
  {
    id: 'mcp',
    order: 10,
    title: 'MCP:可插拔的工具生态',
    subtitle: '连接 MCP Server、发现并远程调用标准工具',
    concept: 'MCP / JSON-RPC',
  },
  {
    id: 'skill',
    order: 11,
    title: 'Skill:按需装载的做事方法',
    subtitle: 'Tool 给"能做",Skill 给"会做";而 Skill 正是用 Tool 实现的',
    concept: 'Skill / 渐进式披露',
  },
  {
    id: 'outlook',
    order: 12,
    title: '展望:从骨架到生产',
    subtitle: '回顾已掌握的能力,以及真实工程里的后续方向',
    concept: '总结 / 展望',
  },
];
