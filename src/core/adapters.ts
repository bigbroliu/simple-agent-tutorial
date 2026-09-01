/**
 * core/adapters.ts —— 多厂商 API 适配层(Demo 8 的核心)
 *
 * 【本文件教什么】
 * 不同厂商的"聊天接口"长得不完全一样:
 *   - OpenAI 兼容(DeepSeek/Kimi/通义/OpenAI):
 *       鉴权头 Authorization: Bearer xxx
 *       请求体 { model, messages, tools?, stream? }
 *       响应体 choices[0].message
 *       流式帧 choices[0].delta.content
 *   - Anthropic(Claude):
 *       鉴权头 x-api-key + anthropic-version
 *       system 要单独拎出来,messages 里不放 system
 *       请求体 { model, system, messages, max_tokens }
 *       响应体 content[0].text
 *
 * 应对办法:定义一个统一的 Adapter 接口,把"差异"关进各自实现里,
 * 上层(llm.ts / agent.ts)只面向统一接口,不关心厂商差异。
 * 这就是工程里最常见的"适配器模式"落地。
 */

import type { ModelConfig } from './config';
import type { ChatMessage, ToolSchema } from './types';

/** 一次请求的通用参数 */
export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSchema[];
  stream?: boolean;
  temperature?: number;
}

/** 从非流式响应里解析出来的结果 */
export interface ParsedResponse {
  message: ChatMessage; // 标准化成 OpenAI 风格的 assistant 消息
}

export interface Adapter {
  /** 构造完整的 fetch 请求(url + init) */
  buildRequest(cfg: ModelConfig, req: ChatRequest): { url: string; init: RequestInit };
  /** 解析非流式响应 JSON -> 标准 assistant 消息 */
  parseResponse(json: any): ParsedResponse;
  /**
   * 解析一帧流式数据(已去掉 "data: " 前缀的 JSON 字符串对象)。
   * 返回本帧新增的文本增量;无文本则返回空串。
   */
  parseStreamChunk(json: any): string;
}

/* ---------------- OpenAI 兼容适配器 ---------------- */

const openaiAdapter: Adapter = {
  buildRequest(cfg, req) {
    // 只放入确有值的字段:有的模型/网关会拒绝多余参数
    // (例如新模型已废弃 temperature,传了反而报 400)
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: req.messages,
      stream: req.stream ?? false,
    };
    if (req.tools) body.tools = req.tools;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    return {
      url: `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      },
    };
  },
  parseResponse(json) {
    const msg = json.choices?.[0]?.message ?? { role: 'assistant', content: '' };
    return { message: msg as ChatMessage };
  },
  parseStreamChunk(json) {
    return json.choices?.[0]?.delta?.content ?? '';
  },
};

/* ---------------- Anthropic 适配器 ----------------
 * 仅覆盖教学所需的对话/流式;工具调用差异在讲解里点到为止。
 */

const anthropicAdapter: Adapter = {
  buildRequest(cfg, req) {
    // Claude 要求把 system 单独拎出来,不放进 messages
    const system = req.messages.find((m) => m.role === 'system')?.content ?? undefined;
    const messages = req.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content ?? '' }));
    return {
      url: `${cfg.baseURL.replace(/\/$/, '')}/messages`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cfg.model,
          system,
          messages,
          max_tokens: 1024,
          stream: req.stream ?? false,
        }),
      },
    };
  },
  parseResponse(json) {
    const text = json.content?.map((c: any) => c.text ?? '').join('') ?? '';
    return { message: { role: 'assistant', content: text } };
  },
  parseStreamChunk(json) {
    // Claude 流式事件:content_block_delta 里带 delta.text
    if (json.type === 'content_block_delta') return json.delta?.text ?? '';
    return '';
  },
};

export function getAdapter(cfg: ModelConfig): Adapter {
  return cfg.protocol === 'anthropic' ? anthropicAdapter : openaiAdapter;
}
