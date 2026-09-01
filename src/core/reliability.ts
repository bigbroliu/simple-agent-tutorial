/**
 * core/reliability.ts —— 结构化输出与可靠性(Demo 7)
 *
 * 【本文件教什么】
 * 真实产品里,你常常需要模型返回"能被代码消费的结构化数据",而不是一段散文。
 * 但模型是概率生成的,它可能:多包一层 ```json、说一堆废话、字段缺失、JSON 不合法。
 * 工程师要做的是:① 引导它输出 JSON ② 稳健地解析 ③ 失败了能重试 ④ 加超时兜底。
 */

import type { ModelConfig } from './config';
import { chatCompletion } from './llm';
import type { ChatMessage } from './types';

/** 从模型返回的文本里"尽力"抽取 JSON —— 容忍 ```json 包裹和前后废话 */
export function extractJson<T = any>(text: string): T {
  // 去掉 ```json ... ``` 代码围栏
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  // 再退一步:截取第一个 { 到最后一个 } 之间的内容
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const jsonStr = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  return JSON.parse(jsonStr) as T;
}

/** 给 fetch/异步操作加超时(用 Promise.race) */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`超时 ${ms}ms`)), ms)),
  ]);
}

export interface StructuredAttempt {
  index: number;
  ok: boolean;
  raw: string;
  error?: string;
}

export interface StructuredResult<T> {
  data: T | null;
  attempts: StructuredAttempt[];
}

/**
 * 要求模型返回结构化 JSON,带解析容错 + 自动重试。
 * @param schemaHint 用自然语言描述你想要的 JSON 结构
 * @param maxRetries 解析失败时最多重试几次
 */
export async function structuredCompletion<T = any>(
  cfg: ModelConfig,
  userPrompt: string,
  schemaHint: string,
  opts: { maxRetries?: number; timeoutMs?: number } = {},
): Promise<StructuredResult<T>> {
  const maxRetries = opts.maxRetries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const attempts: StructuredAttempt[] = [];

  const system: ChatMessage = {
    role: 'system',
    content:
      '你是一个只输出 JSON 的接口。严格按用户要求的结构返回一个 JSON 对象,' +
      '不要输出任何解释、不要用 markdown 代码块包裹。',
  };

  for (let i = 0; i <= maxRetries; i++) {
    const messages: ChatMessage[] = [
      system,
      { role: 'user', content: `${userPrompt}\n\n请严格返回如下结构的 JSON:\n${schemaHint}` },
    ];
    let raw = '';
    try {
      const msg = await withTimeout(chatCompletion(cfg, messages, { temperature: 0 }), timeoutMs);
      raw = msg.content ?? '';
      const data = extractJson<T>(raw);
      attempts.push({ index: i, ok: true, raw });
      return { data, attempts };
    } catch (e: any) {
      attempts.push({ index: i, ok: false, raw, error: e?.message ?? String(e) });
      // 继续下一次重试
    }
  }
  return { data: null, attempts };
}
