# 前端工程师的 Agent 开发进阶之路

> 一次面向前端工程师的技术分享。**不是**科普"什么是 Agent",而是带你**亲手实现**一个 Agent——从一行 API 调用,一步步长成能思考、能用工具、能编排、能兼容多模型的完整 Agent。

一个本地可运行的交互式教学网页:左边动手跑,右边看讲解和**真实源码**。

## 快速开始

```bash
npm install
npm run dev        # 打开 http://localhost:5188
```

第一步先进入 **STEP 0 · 模型配置中心**,填入至少一个模型的 Base URL / API Key / 模型名(内置 DeepSeek、Kimi、通义、OpenAI、Claude 的预置模板,点一下自动填)。配好后,后续每个 Demo 都会用它。

> 想演示最后一课「多模型兼容」,请配置 **2 个及以上**模型,最好协议不同(如 DeepSeek + Claude)。

## 设计理念

所有"教学精华"都沉淀在 **`src/core/*.ts`**(纯 TypeScript,不含任何 UI、不依赖任何 Agent 框架,总共约 500 行)。Demo 页面只是把这些能力**逐步解锁**并可视化。现场分享时,可以直接翻 `core/` 讲真实现:

| 文件 | 讲什么 |
|------|--------|
| `core/config.ts` | 模型配置模型:baseURL / 鉴权 / model,localStorage 持久化 |
| `core/llm.ts` | `chatCompletion`(一行调用)+ `streamChatCompletion`(手写 SSE 解析) |
| `core/tools.ts` | 工具注册表:`{ schema, run }`——本质是一个"迷你本地 MCP" |
| `core/agent.ts` | `runAgentLoop`:ReAct 循环,Agent 与 Chatbot 的分界线 |
| `core/reliability.ts` | 结构化输出、解析容错、重试、超时 |
| `core/adapters.ts` | 多厂商适配层:把 OpenAI / Anthropic 的差异关进 Adapter |

## 分享路线(9 步 + 1 展望)

| # | 主题 | 核心概念 / 前端陌生点 |
|---|------|----------------------|
| 0 | 模型配置中心 | baseURL / 鉴权头 / 多模型管理 |
| 1 | 一行调用 | 剥开 SDK:调用本质是一个 `fetch` POST |
| 2 | 会聊天(流式) | **手写 SSE 解析**(`ReadableStream` + `TextDecoder`) |
| 3 | 有记忆 | messages 数组即记忆;上下文窗口 |
| 4 | 会用工具 | **Tool Calling 协议**:四步往返,执行永远在前端 |
| 5 | 会思考(Agent 循环) | **ReAct**:思考→行动→观察→循环;maxSteps 安全阀 |
| 6 | 多工具真实任务 | 工具编排;接入真实天气 API;能力来自工具 |
| 7 | 结构化输出与可靠性 | JSON 约束 + 解析容错 + 重试 + 超时 |
| 8 | 多模型兼容 | **适配器模式**:同一业务代码无缝切换厂商 |
| 9 | 展望:MCP 与工具生态 | 把工具标准化;MCP 与 Tool Calling 的关系 |

## 讲稿要点(每步的"啊哈")

- **STEP 1**:无论 LangChain 还是官方 SDK,底层都是这一个 HTTP 请求。看清它,就不会被封装绕晕。
- **STEP 2**:流式不是模型的特性,是前端把响应当"可读流"逐帧解析的结果。注意半包问题。
- **STEP 3**:模型是无状态的。"记忆"是我们每轮重发全部历史造出来的假象——所以它有成本、有上限。
- **STEP 4**:**模型不执行任何代码**,它只产出"我想调用 X"的结构化请求。执行、回填全是前端的活。`arguments` 是字符串,要 `JSON.parse`。
- **STEP 5**:Chatbot 和 Agent 的差别不在模型,而在外面这个 `while` 循环。一定要有 `maxSteps`。
- **STEP 6**:想让 Agent 更强,通常不是改循环,而是**给它更好的工具**。做 Agent 很大一部分工作是"设计工具"。
- **STEP 7**:能聊天很容易,**稳定可用**很难。可靠性是能否上生产的分水岭。
- **STEP 8**:前 7 课的代码换任何模型都能跑,因为它们从没直接碰过厂商细节——这就是抽象的价值。
- **STEP 9**:你在 `core/tools.ts` 写的工具,本质就是个迷你 MCP。MCP 只是把它搬到进程外、标准化。

## 内置工具(给 Agent 用的能力)

- `calculator` / `now`:纯前端,演示"模型不擅长精确计算、没有实时信息"。
- `toggle_lamp`:改 localStorage 并派发事件,页面上真有个灯泡亮灭——演示 Agent 的**真实副作用**。
- `get_weather`:调用 [Open-Meteo](https://open-meteo.com/) 公开 API(免费、无需 key、支持 CORS),演示**真实联网工具**及其失败兜底。

## ⚠️ 安全须知(听众都是工程师,务必点明)

本项目让**浏览器直接带着 API Key** 请求模型厂商,**仅用于教学演示**。真实生产环境中:

- **绝不能把 API Key 放在前端**——任何人打开 DevTools 都能拿到。
- 正确做法是由**自己的后端代理**转发请求,Key 只存在服务端。
- 本项目的 Key 仅保存在浏览器 localStorage,不上传任何服务器;`.env*` 已加入 `.gitignore`。

## 技术栈

Vite + Vue 3 (`<script setup lang="ts">`) + TypeScript + Vue Router(hash 模式)。无运行时第三方依赖,现场零网络依赖风险(除模型 API 与天气 API 本身)。

```bash
npm run dev        # 开发
npm run build      # 类型检查 + 构建
npm run preview    # 预览构建产物
```
