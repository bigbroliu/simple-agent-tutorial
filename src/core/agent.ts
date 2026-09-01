/**
 * core/agent.ts —— Agent 循环(ReAct)的心脏
 *
 * 【本文件教什么】
 * Chatbot 与 Agent 的分界线就在这个 while 循环里:
 *
 *   Chatbot: 用户问 -> 模型答 -> 结束(一问一答)
 *   Agent:   用户给目标 -> 模型思考 -> 请求调用工具 -> 我们执行 -> 把结果还给模型
 *            -> 模型再思考 -> ...... 循环,直到模型觉得"我搞定了,可以直接回答了"
 *
 * 这就是 ReAct(Reasoning + Acting)。实现它,不需要任何框架,一个 while 足矣。
 * 我们通过 onEvent 回调把每一步吐给 UI(AgentTrace.vue),清晰呈现"它在想什么、做什么"。
 */

import type { ModelConfig } from './config';
import { chatCompletion } from './llm';
import { runTool } from './tools';
import type { ChatMessage, ToolSchema } from './types';

/**
 * 轻量的参数校验:对着工具的 JSON Schema 检查模型传来的参数。
 * 【为什么要有它】模型是概率生成的,即使用了工具调用,也可能漏字段、类型给错
 * (age 给成字符串、skills 忘了给数组)。我们不能盲目相信模型的输出 ——
 * 在真正执行工具前,先自己校验一遍。这就是"可靠性"在代码里的落地(第 7 课)。
 *
 * 返回错误描述数组;为空表示校验通过。这里只做必填 + 基本类型,够教学也够实用。
 */
export function validateArgs(schema: ToolSchema, args: any): string[] {
  const errors: string[] = [];
  const params = (schema.function.parameters ?? {}) as any;
  const props: Record<string, any> = params.properties ?? {};
  const required: string[] = params.required ?? [];

  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return ['参数必须是一个对象(JSON object)'];
  }

  // 1) 必填字段是否都在
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      errors.push(`缺少必填字段 "${key}"`);
    }
  }

  // 2) 已给字段的基本类型是否对得上 schema
  for (const [key, spec] of Object.entries(props)) {
    if (args[key] === undefined || args[key] === null) continue;
    const want = (spec as any).type as string | undefined;
    if (!want) continue;
    const val = args[key];
    const okType =
      want === 'array'
        ? Array.isArray(val)
        : want === 'integer' || want === 'number'
          ? typeof val === 'number'
          : want === 'object'
            ? typeof val === 'object' && !Array.isArray(val)
            : typeof val === want; // string / boolean
    if (!okType) {
      const got = Array.isArray(val) ? 'array' : typeof val;
      errors.push(`字段 "${key}" 类型应为 ${want},实际是 ${got}`);
    }
  }
  return errors;
}

/** Agent 运行过程中的事件,用于可视化 */
export type AgentEvent =
  | { type: 'think'; content: string } // 模型产出的文字(思考/最终回答)
  | { type: 'tool_call'; name: string; args: any } // 模型请求调用工具
  | { type: 'tool_result'; name: string; result: string } // 工具执行结果
  | { type: 'final'; content: string } // 最终答案
  | { type: 'error'; message: string };

export interface RunAgentOptions {
  cfg: ModelConfig;
  tools: ToolSchema[];
  messages: ChatMessage[]; // 初始消息(含 system + user)
  onEvent: (e: AgentEvent) => void;
  maxSteps?: number; // 防止死循环的步数上限
  /**
   * 工具执行器。默认用本地 core/tools.ts 的 runTool;
   * 可覆盖为"转发给 MCP Server 执行"(见 Demo 9)—— 循环逻辑不变,只换工具来源。
   */
  execTool?: (name: string, args: any) => Promise<string> | string;
}

/**
 * 运行一次 Agent 循环。返回累积后的完整消息历史(便于继续对话)。
 */
export async function runAgentLoop(opts: RunAgentOptions): Promise<ChatMessage[]> {
  const { cfg, tools, onEvent } = opts;
  const maxSteps = opts.maxSteps ?? 6;
  const execTool = opts.execTool ?? runTool; // 默认本地执行,可换成 MCP 转发
  const messages = [...opts.messages];

  // 工具名 → schema,便于执行前查表校验参数
  const schemaByName = new Map(tools.map((t) => [t.function.name, t]));

  for (let step = 0; step < maxSteps; step++) {
    // 1) 问模型:基于当前所有消息,你想说什么 / 想调用什么工具?
    let assistant: ChatMessage;
    try {
      assistant = await chatCompletion(cfg, messages, { tools });
    } catch (e: any) {
      onEvent({ type: 'error', message: e?.message ?? String(e) });
      break;
    }
    messages.push(assistant);

    // 2) 模型如果说了话,展示为"思考"
    if (assistant.content) {
      onEvent({ type: 'think', content: assistant.content });
    }

    // 3) 模型没有请求工具 => 它认为可以收尾了 => 结束循环
    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0) {
      onEvent({ type: 'final', content: assistant.content ?? '' });
      return messages;
    }

    // 4) 逐个执行模型请求的工具,并把结果以 role:"tool" 回填
    for (const call of calls) {
      // 4a) 解析参数:arguments 是"字符串化的 JSON",必须自己 parse。
      //     解析失败不再默默传空对象,而是把错误当成工具结果回填,让模型下一轮自己纠正。
      let args: any;
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (e: any) {
        const errText = `参数不是合法 JSON,无法执行。请重新以合法 JSON 调用。(${e?.message ?? e})`;
        onEvent({ type: 'tool_result', name: call.function.name, result: `❌ ${errText}` });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: errText,
        });
        continue; // 不执行这个工具,进入下一轮让模型重试
      }

      onEvent({ type: 'tool_call', name: call.function.name, args });

      // 4b) 执行前校验参数是否符合工具的 schema(必填 + 类型)。
      //     不合规同样把错误回填,而不是硬塞给工具的 run 去崩。
      const schema = schemaByName.get(call.function.name);
      const errors = schema ? validateArgs(schema, args) : [];
      if (errors.length > 0) {
        const errText = `参数校验未通过:${errors.join(';')}。请修正后重新调用。`;
        onEvent({ type: 'tool_result', name: call.function.name, result: `❌ ${errText}` });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: errText,
        });
        continue; // 交回模型重试
      }

      const result = await execTool(call.function.name, args);
      onEvent({ type: 'tool_result', name: call.function.name, result });

      // 把工具结果作为一条 role:"tool" 消息塞回历史,供下一轮模型参考
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: result,
      });
    }
    // 5) 带着工具结果,回到循环开头,再问一次模型
  }

  // 达到步数上限仍未收尾
  onEvent({ type: 'error', message: `已达到最大步数 ${maxSteps},强制停止` });
  return messages;
}
