/**
 * core/types.ts —— 贯穿全项目的消息与工具类型
 *
 * 这些类型刻意贴近 OpenAI Chat Completions 的结构,因为它已是事实标准。
 * 理解这几个类型,基本就理解了"和大模型对话"的数据长什么样。
 */

/** 一条对话消息的角色 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** 模型请求执行工具时,返回的 tool_call 结构(OpenAI 风格) */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** 注意:参数是"字符串化的 JSON",需要自己 JSON.parse */
    arguments: string;
  };
}

/** 一条对话消息 */
export interface ChatMessage {
  role: Role;
  content: string | null;
  /** 仅 assistant 消息可能带:模型想调用的工具 */
  tool_calls?: ToolCall[];
  /** 仅 tool 消息带:对应哪个 tool_call */
  tool_call_id?: string;
  /** 仅 tool 消息带:便于展示是哪个工具 */
  name?: string;
}

/** 工具的 JSON Schema 定义(发给模型,让它知道有哪些工具可用) */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}
